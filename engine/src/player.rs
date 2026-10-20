//! Lecture temps réel sur la carte son (cpal). Un thread dédié possède le flux audio
//! (il ne peut pas changer de thread), les autres threads lui envoient des ordres.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

enum Cmd {
    Play { left: Vec<f32>, right: Vec<f32>, start: usize },
    Stop,
}

pub struct Player {
    tx: Sender<Cmd>,
    pos: Arc<AtomicUsize>,
    total: Arc<AtomicUsize>,
    rate: Arc<AtomicU32>,
    playing: Arc<AtomicBool>,
    pub error: Arc<std::sync::Mutex<Option<String>>>,
}

impl Player {
    pub fn new() -> Self {
        let (tx, rx) = channel::<Cmd>();
        let pos = Arc::new(AtomicUsize::new(0));
        let total = Arc::new(AtomicUsize::new(0));
        let rate = Arc::new(AtomicU32::new(0));
        let playing = Arc::new(AtomicBool::new(false));
        let error = Arc::new(std::sync::Mutex::new(None));
        {
            let (pos, total, rate, playing, error) = (pos.clone(), total.clone(), rate.clone(), playing.clone(), error.clone());
            std::thread::spawn(move || {
                let mut stream: Option<cpal::Stream> = None;
                let host = cpal::default_host();
                if let Some(d) = host.default_output_device() {
                    if let Ok(c) = d.default_output_config() {
                        rate.store(c.sample_rate().0, Ordering::SeqCst);
                    }
                }
                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        Cmd::Stop => {
                            stream = None;
                            playing.store(false, Ordering::SeqCst);
                        }
                        Cmd::Play { left, right, start } => {
                            stream = None;
                            match build(left, right, start, &pos, &total, &playing) {
                                Ok(s) => { stream = Some(s); *error.lock().unwrap() = None; }
                                Err(e) => { playing.store(false, Ordering::SeqCst); *error.lock().unwrap() = Some(e); }
                            }
                        }
                    }
                }
                drop(stream);
            });
        }
        Self { tx, pos, total, rate, playing, error }
    }

    /// Fréquence de la sortie par défaut (0 = aucune sortie audio)
    pub fn output_rate(&self) -> u32 { self.rate.load(Ordering::SeqCst) }
    pub fn play(&self, left: Vec<f32>, right: Vec<f32>, start_frame: usize) {
        self.playing.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Cmd::Play { left, right, start: start_frame });
    }
    pub fn stop(&self) { let _ = self.tx.send(Cmd::Stop); }
    pub fn is_playing(&self) -> bool { self.playing.load(Ordering::SeqCst) }
    /// Position de lecture en secondes
    pub fn position(&self) -> f64 {
        let r = self.output_rate().max(1) as f64;
        self.pos.load(Ordering::Relaxed) as f64 / r
    }
    /// Durée du morceau en cours (secondes)
    pub fn duration(&self) -> f64 { self.total.load(Ordering::Relaxed) as f64 / self.output_rate().max(1) as f64 }
    pub fn take_error(&self) -> Option<String> { self.error.lock().unwrap().take() }
}

impl Default for Player { fn default() -> Self { Self::new() } }

fn build(
    left: Vec<f32>, right: Vec<f32>, start: usize,
    pos: &Arc<AtomicUsize>, total: &Arc<AtomicUsize>, playing: &Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("aucune sortie audio trouvée — branche un casque ou des enceintes")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    if config.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("format de sortie non géré pour l'instant : {:?}", config.sample_format()));
    }
    let channels = config.channels() as usize;
    let n = left.len().min(right.len());
    pos.store(start.min(n), Ordering::SeqCst);
    total.store(n, Ordering::SeqCst);
    let (cb_pos, cb_play) = (pos.clone(), playing.clone());
    let stream = device
        .build_output_stream(
            &config.into(),
            move |out: &mut [f32], _| {
                // Temps réel : ni allocation, ni verrou
                let mut p = cb_pos.load(Ordering::Relaxed);
                for frame in out.chunks_mut(channels) {
                    let (l, r) = if p < n { (left[p], right[p]) } else { (0.0, 0.0) };
                    for (c, s) in frame.iter_mut().enumerate() {
                        *s = match c { 0 => l, 1 => r, _ => 0.0 };
                    }
                    if p < n { p += 1; }
                }
                cb_pos.store(p, Ordering::Relaxed);
                if p >= n { cb_play.store(false, Ordering::Relaxed); }
            },
            |err| eprintln!("Erreur de la sortie audio : {err}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}
