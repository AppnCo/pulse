//! Lecture sur la carte son (cpal), au fil de l'eau : un fil « mixeur » prépare la suite du morceau bloc par bloc
//! (≈ 0,2 s d'avance), la carte son ne fait que lire cette réserve. On commence à jouer tout de suite, sans attendre
//! que tout le morceau soit mixé, et un à-coup de l'ordi (le temps d'un bloc) ne s'entend pas : la réserve couvre.
//! Un thread dédié possède le flux audio (il ne peut pas changer de thread), les autres threads lui envoient des ordres.
use crate::monitor::Ring;
use crate::render::{Media, Renderer};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Niveaux d'un bloc mixé, rangés selon l'échantillon (temps continu de la carte son) où il sera entendu
#[derive(Clone, Default, serde::Serialize)]
pub struct Levels {
    /// (piste, crête gauche, crête droite, efficace)
    pub tracks: Vec<(usize, f32, f32, f32)>,
    pub master: f32,
}

/// Ce que le mixeur partage avec le reste : tours de boucle et niveaux, repérés sur le temps continu de la carte son
#[derive(Default)]
struct Shared {
    /// (échantillon continu, décalage à ajouter pour avoir la position dans le morceau) à chaque tour de boucle
    wraps: VecDeque<(usize, i64)>,
    /// (échantillon continu du début du bloc, niveaux)
    levels: VecDeque<(usize, Levels)>,
    /// Boucle demandée par la page, à prendre par le mixeur (Some(None) = enlever la boucle)
    loop_req: Option<Option<(f64, f64)>>,
    /// Boucle acceptée par le mixeur
    loop_ok: bool,
}

/// Taille d'un bloc mixé (échantillons)
const BLOCK: usize = 1024;
/// Réserve entre le mixeur et la carte son : 2^17 valeurs = 65 536 échantillons stéréo ≈ 1,4 s à 48 kHz
const RESERVE: usize = 1 << 17;
/// On commence à jouer quand la réserve a ≈ 0,1 s (ou que le morceau est entièrement prêt)
const START_FRAMES: usize = 4800;
/// Avance gardée par le mixeur (≈ 0,2 s à 48 kHz) : assez pour couvrir un à-coup de l'ordi,
/// assez court pour qu'un fader, un mute ou un solo s'entende tout de suite
const AHEAD_FRAMES: usize = 9600;

enum Cmd {
    Stream { renderer: Box<Renderer>, media: Arc<Media>, start: usize },
    Stop,
}

pub struct Player {
    tx: Sender<Cmd>,
    pos: Arc<AtomicUsize>,
    total: Arc<AtomicUsize>,
    rate: Arc<AtomicU32>,
    playing: Arc<AtomicBool>,
    underruns: Arc<AtomicU64>,
    /// Nombre de lectures lancées depuis l'ouverture (une prise de mix en direct ne compte pas)
    plays: AtomicU64,
    /// Nouveau mix (volumes, mute, solo…) à prendre en direct par le mixeur
    mix: Arc<std::sync::Mutex<Option<crate::model::Project>>>,
    shared: Arc<Mutex<Shared>>,
    pub error: Arc<std::sync::Mutex<Option<String>>>,
}

/// Fil mixeur en cours (on l'arrête avant d'en lancer un autre)
struct Feeder { stop: Arc<AtomicBool>, handle: Option<std::thread::JoinHandle<()>> }

impl Drop for Feeder {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() { let _ = h.join(); }
    }
}

impl Player {
    pub fn new() -> Self {
        let (tx, rx) = channel::<Cmd>();
        let pos = Arc::new(AtomicUsize::new(0));
        let total = Arc::new(AtomicUsize::new(0));
        let rate = Arc::new(AtomicU32::new(0));
        let playing = Arc::new(AtomicBool::new(false));
        let underruns = Arc::new(AtomicU64::new(0));
        let error = Arc::new(std::sync::Mutex::new(None));
        let mix: Arc<std::sync::Mutex<Option<crate::model::Project>>> = Arc::new(std::sync::Mutex::new(None));
        let shared: Arc<Mutex<Shared>> = Arc::new(Mutex::new(Shared::default()));
        {
            let (pos, total, rate, playing, underruns, error, mix, shared) = (pos.clone(), total.clone(), rate.clone(), playing.clone(), underruns.clone(), error.clone(), mix.clone(), shared.clone());
            std::thread::spawn(move || {
                let mut stream: Option<cpal::Stream> = None;
                let mut feeder: Option<Feeder> = None;
                let host = cpal::default_host();
                if let Some(d) = host.default_output_device() {
                    if let Ok(c) = d.default_output_config() {
                        rate.store(c.sample_rate().0, Ordering::SeqCst);
                    }
                }
                while let Ok(cmd) = rx.recv() {
                    // d'abord couper le son, puis arrêter le mixeur
                    stream = None;
                    feeder = None;
                    match cmd {
                        Cmd::Stop => playing.store(false, Ordering::SeqCst),
                        Cmd::Stream { renderer, media, start } => {
                            underruns.store(0, Ordering::SeqCst);
                            match build(renderer, media, start, &pos, &total, &playing, &underruns, &mix, &shared) {
                                Ok((s, f)) => { stream = Some(s); feeder = Some(f); *error.lock().unwrap() = None; }
                                Err(e) => { playing.store(false, Ordering::SeqCst); *error.lock().unwrap() = Some(e); }
                            }
                        }
                    }
                }
                drop(stream);
                drop(feeder);
            });
        }
        Self { tx, pos, total, rate, playing, underruns, plays: AtomicU64::new(0), mix, shared, error }
    }

    /// Fréquence de la sortie par défaut (0 = aucune sortie audio)
    pub fn output_rate(&self) -> u32 { self.rate.load(Ordering::SeqCst) }
    /// Joue au fil de l'eau ce que `renderer` mixe. `start_frame` = position du début du mixage dans le morceau (échantillons).
    pub fn play_stream(&self, renderer: Renderer, media: Arc<Media>, start_frame: usize) {
        {
            let mut sh = self.shared.lock().unwrap();
            sh.wraps.clear();
            sh.levels.clear();
            sh.loop_req = None;
            sh.loop_ok = renderer.has_loop();
        }
        self.playing.store(true, Ordering::SeqCst);
        self.plays.fetch_add(1, Ordering::SeqCst);
        self.pos.store(start_frame, Ordering::SeqCst);
        self.total.store(start_frame + renderer.frames(), Ordering::SeqCst);
        *self.mix.lock().unwrap() = None;
        let _ = self.tx.send(Cmd::Stream { renderer: Box::new(renderer), media, start: start_frame });
    }
    pub fn stop(&self) { let _ = self.tx.send(Cmd::Stop); }
    /// Volumes, pan, mute / solo, envois, groupes, Master changés : pris en direct (≈ 0,2 s), sans couper ni relancer
    pub fn set_mix(&self, project: crate::model::Project) { *self.mix.lock().unwrap() = Some(project); }
    pub fn is_playing(&self) -> bool { self.playing.load(Ordering::SeqCst) }
    /// Position de lecture en secondes (dans le morceau : tient compte des tours de boucle)
    pub fn position(&self) -> f64 {
        let r = self.output_rate().max(1) as f64;
        let p = self.pos.load(Ordering::Relaxed);
        let mut sh = self.shared.lock().unwrap();
        while sh.wraps.len() >= 2 && sh.wraps[1].0 <= p { sh.wraps.pop_front(); }
        let off = match sh.wraps.front() { Some(&(at, o)) if at <= p => o, _ => 0 };
        (p as i64 + off).max(0) as f64 / r
    }
    /// Niveaux de ce qu'on entend en ce moment (None à l'arrêt)
    pub fn levels(&self) -> Option<Levels> {
        if !self.is_playing() { return None; }
        let p = self.pos.load(Ordering::Relaxed);
        let mut sh = self.shared.lock().unwrap();
        while sh.levels.len() >= 2 && sh.levels[1].0 <= p { sh.levels.pop_front(); }
        sh.levels.front().filter(|(at, _)| *at <= p + BLOCK).map(|(_, l)| l.clone())
    }
    /// Pose / enlève la boucle pendant la lecture. Renvoie l'état connu (le mixeur la prend au bloc suivant).
    pub fn set_loop(&self, l: Option<(f64, f64)>) { self.shared.lock().unwrap().loop_req = Some(l); }
    /// Vrai si le mixeur boucle lui-même (sinon la page doit relancer au début de la boucle)
    pub fn loop_ok(&self) -> bool { let sh = self.shared.lock().unwrap(); sh.loop_req.is_none() && sh.loop_ok }
    /// Durée du morceau (secondes, queue des effets comprise)
    pub fn duration(&self) -> f64 { self.total.load(Ordering::Relaxed) as f64 / self.output_rate().max(1) as f64 }
    /// Moments où la réserve était vide (le mixeur n'a pas suivi) depuis le début de la lecture
    pub fn underruns(&self) -> u64 { self.underruns.load(Ordering::Relaxed) }
    pub fn plays(&self) -> u64 { self.plays.load(Ordering::SeqCst) }
    pub fn take_error(&self) -> Option<String> { self.error.lock().unwrap().take() }
}

impl Default for Player { fn default() -> Self { Self::new() } }

/// Fil mixeur : remplit la réserve (gauche, droite, gauche, droite…) tant qu'il y a de la place
fn spawn_feeder(mut renderer: Box<Renderer>, media: Arc<Media>, ring: Arc<Ring>, done: Arc<AtomicBool>, mix: Arc<std::sync::Mutex<Option<crate::model::Project>>>, shared: Arc<Mutex<Shared>>, start: usize, rate: f64) -> Feeder {
    let stop = Arc::new(AtomicBool::new(false));
    let st = stop.clone();
    let handle = std::thread::Builder::new().name("pulse-mixeur".into()).spawn(move || {
        let (mut l, mut r) = (vec![0.0f32; BLOCK], vec![0.0f32; BLOCK]);
        // temps continu de la carte son (ne revient jamais en arrière) du prochain échantillon poussé
        let mut lin = start;
        while !st.load(Ordering::Relaxed) {
            let next = mix.lock().ok().and_then(|mut g| g.take());
            if let Some(p) = next { renderer.mix_from(&p, &media); }
            let req = shared.lock().ok().and_then(|mut g| g.loop_req.take());
            if let Some(lp) = req {
                let ok = renderer.set_loop(lp);
                let mut sh = shared.lock().unwrap();
                sh.loop_ok = ok && lp.is_some();
                if renderer.take_wrap() { sh.wraps.push_back((lin, (renderer.time() * rate).round() as i64 - lin as i64)); }
            }
            if ring.len() >= 2 * AHEAD_FRAMES || ring.capacity() - ring.len() < 2 * BLOCK {
                std::thread::sleep(std::time::Duration::from_millis(2));
                continue;
            }
            let n = renderer.process(&media, &mut l, &mut r);
            for k in 0..n {
                ring.push(l[k]);
                ring.push(r[k]);
            }
            {
                let (tracks, master) = renderer.levels();
                let mut sh = shared.lock().unwrap();
                if n > 0 {
                    sh.levels.push_back((lin, Levels { tracks: tracks.to_vec(), master }));
                    while sh.levels.len() > 256 { sh.levels.pop_front(); }
                }
                lin += n;
                if renderer.take_wrap() {
                    sh.wraps.push_back((lin, (renderer.time() * rate).round() as i64 - lin as i64));
                    while sh.wraps.len() > 256 { sh.wraps.pop_front(); }
                }
            }
            if renderer.is_done() {
                done.store(true, Ordering::SeqCst);
                break;
            }
        }
    }).expect("fil mixeur");
    Feeder { stop, handle: Some(handle) }
}

fn build(
    renderer: Box<Renderer>, media: Arc<Media>, start: usize,
    pos: &Arc<AtomicUsize>, total: &Arc<AtomicUsize>, playing: &Arc<AtomicBool>, underruns: &Arc<AtomicU64>,
    mix: &Arc<std::sync::Mutex<Option<crate::model::Project>>>, shared: &Arc<Mutex<Shared>>,
) -> Result<(cpal::Stream, Feeder), String> {
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("aucune sortie audio trouvée — branche un casque ou des enceintes")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    if config.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("format de sortie non géré pour l'instant : {:?}", config.sample_format()));
    }
    let channels = config.channels() as usize;
    let frames = renderer.frames();
    pos.store(start, Ordering::SeqCst);
    total.store(start + frames, Ordering::SeqCst);
    let ring = Arc::new(Ring::new(RESERVE));
    let done = Arc::new(AtomicBool::new(frames == 0));
    let rate = config.sample_rate().0 as f64;
    let feeder = spawn_feeder(renderer, media, ring.clone(), done.clone(), mix.clone(), shared.clone(), start, rate);
    // un peu d'avance avant le premier son (au plus 2 s d'attente)
    let t0 = std::time::Instant::now();
    while ring.len() < 2 * START_FRAMES.min(frames) && !done.load(Ordering::SeqCst) && t0.elapsed() < std::time::Duration::from_secs(2) {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    let (cb_pos, cb_play, cb_ring, cb_done, cb_under) = (pos.clone(), playing.clone(), ring.clone(), done.clone(), underruns.clone());
    let stream = device
        .build_output_stream(
            &config.into(),
            move |out: &mut [f32], _| {
                // Temps réel : ni allocation, ni verrou — on ne fait que lire la réserve
                let mut p = cb_pos.load(Ordering::Relaxed);
                let mut empty = false;
                for frame in out.chunks_mut(channels) {
                    let (l, r) = if cb_ring.len() >= 2 {
                        p += 1;
                        (cb_ring.pop().unwrap_or(0.0), cb_ring.pop().unwrap_or(0.0))
                    } else {
                        empty = true;
                        (0.0, 0.0)
                    };
                    for (c, s) in frame.iter_mut().enumerate() {
                        *s = match c { 0 => l, 1 => r, _ => 0.0 };
                    }
                }
                cb_pos.store(p, Ordering::Relaxed);
                if empty {
                    if cb_done.load(Ordering::Relaxed) { cb_play.store(false, Ordering::Relaxed); }
                    else { cb_under.fetch_add(1, Ordering::Relaxed); }
                }
            },
            |err| eprintln!("Erreur de la sortie audio : {err}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, feeder))
}
