//! Retour casque direct (appli de bureau) : le micro va droit dans le casque par le moteur natif,
//! avec une toute petite mémoire tampon (64 / 128 échantillons, comme Pro Tools ou Logic),
//! au lieu de faire le détour par le moteur web (souvent 20 à 40 ms).
//! Le son du retour n'entre jamais dans le mix ni dans l'export : il ne sert qu'à s'entendre.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

/// File d'attente entre l'entrée (micro) et la sortie (casque) : un seul écrivain, un seul lecteur,
/// sans verrou ni allocation (les échantillons sont rangés comme des entiers 32 bits).
pub struct Ring {
    buf: Vec<AtomicU32>,
    w: AtomicUsize,
    r: AtomicUsize,
}

impl Ring {
    pub fn new(cap: usize) -> Self {
        Self { buf: (0..cap).map(|_| AtomicU32::new(0)).collect(), w: AtomicUsize::new(0), r: AtomicUsize::new(0) }
    }
    /// Échantillons en attente
    pub fn len(&self) -> usize { self.w.load(Ordering::Acquire).wrapping_sub(self.r.load(Ordering::Acquire)) }
    pub fn is_empty(&self) -> bool { self.len() == 0 }
    pub fn capacity(&self) -> usize { self.buf.len() }
    /// Côté micro. File pleine : l'échantillon est perdu (mieux vaut un trou qu'un retard qui grandit)
    pub fn push(&self, x: f32) -> bool {
        let w = self.w.load(Ordering::Relaxed);
        if w.wrapping_sub(self.r.load(Ordering::Acquire)) >= self.buf.len() { return false; }
        self.buf[w % self.buf.len()].store(x.to_bits(), Ordering::Relaxed);
        self.w.store(w.wrapping_add(1), Ordering::Release);
        true
    }
    /// Côté casque
    pub fn pop(&self) -> Option<f32> {
        let r = self.r.load(Ordering::Relaxed);
        if r == self.w.load(Ordering::Acquire) { return None; }
        let x = f32::from_bits(self.buf[r % self.buf.len()].load(Ordering::Relaxed));
        self.r.store(r.wrapping_add(1), Ordering::Release);
        Some(x)
    }
    /// Jette les plus vieux échantillons pour n'en garder que `keep` (côté casque seulement)
    pub fn skip_to(&self, keep: usize) {
        let n = self.len();
        if n > keep { self.r.fetch_add(n - keep, Ordering::AcqRel); }
    }
}

/// Tranche de la piste écoutée, appliquée au retour : ses effets, son volume et son pan (comme dans le mix).
pub struct Strip { chain: Option<crate::fx::Chain>, vol: f32, pan: f64 }

impl Strip {
    /// Retour sec (aucune piste donnée) : la voix telle quelle des deux côtés
    pub fn dry() -> Self { Self { chain: None, vol: 1.0, pan: f64::NAN } }
    /// `json` = { "track": piste du projet, "bpm": tempo } ; `sr` = fréquence du retour
    pub fn from_json(json: &str, sr: f64) -> Result<Self, String> {
        #[derive(serde::Deserialize)]
        struct Msg { track: crate::model::Track, #[serde(default)] bpm: Option<f64> }
        let m: Msg = serde_json::from_str(json).map_err(|e| format!("piste illisible : {e}"))?;
        let chain = crate::fx::Chain::for_track(&m.track, sr, m.bpm.filter(|b| *b > 0.0).unwrap_or(120.0));
        let vol = (m.track.volume.unwrap_or(100.0) / 100.0).max(0.0) as f32;
        let pan = (m.track.pan.unwrap_or(0.0) / 100.0).clamp(-1.0, 1.0);
        Ok(Self { chain: if chain.is_empty() { None } else { Some(chain) }, vol, pan })
    }
    /// `l` = voix (mono) en entrée ; ressort `l` / `r` et les gains gauche / droite à appliquer
    fn process(&mut self, l: &mut [f32], r: &mut [f32]) -> (f32, f32) {
        if self.pan.is_nan() { r.copy_from_slice(l); return (1.0, 1.0); }
        let stereo = match self.chain.as_mut() {
            Some(c) => { r.iter_mut().for_each(|x| *x = 0.0); c.process(l, r, true); c.outputs_stereo() }
            None => false,
        };
        let (gl, gr) = if stereo {
            crate::render::balance_gains(self.pan)
        } else {
            r.copy_from_slice(l);
            // son mono : puissance constante, comme une piste mono dans le mix
            let a = (self.pan + 1.0) * std::f64::consts::FRAC_PI_4;
            (a.cos() as f32, a.sin() as f32)
        };
        (gl * self.vol, gr * self.vol)
    }
}

/// Échange de tranche sans bloquer le temps réel : la page prépare la nouvelle, le casque la prend
/// au début d'un tampon (essai de verrou, jamais d'attente), l'ancienne est jetée hors du temps réel.
pub struct StripSlot { m: Mutex<(Option<Box<Strip>>, Option<Box<Strip>>)>, ready: AtomicBool }

impl StripSlot {
    pub fn new() -> Self { Self { m: Mutex::new((None, None)), ready: AtomicBool::new(false) } }
    pub fn put(&self, s: Strip) {
        let mut g = self.m.lock().unwrap();
        g.1 = None; // l'ancienne tranche est libérée ici, pas dans le temps réel
        g.0 = Some(Box::new(s));
        self.ready.store(true, Ordering::Release);
    }
    fn take_into(&self, cur: &mut Box<Strip>) {
        if !self.ready.load(Ordering::Acquire) { return; }
        if let Ok(mut g) = self.m.try_lock() {
            if let Some(n) = g.0.take() { g.1 = Some(std::mem::replace(cur, n)); }
            self.ready.store(false, Ordering::Release);
        }
    }
}

impl Default for StripSlot { fn default() -> Self { Self::new() } }

/// Côté casque : état gardé d'un tampon à l'autre
pub struct OutState { pub gain: f32, pub primed: bool, pub underruns: u64, strip: Box<Strip>, l: Vec<f32>, r: Vec<f32> }

impl OutState {
    pub fn new(gain: f32, primed: bool) -> Self { Self { gain, primed, underruns: 0, strip: Box::new(Strip::dry()), l: vec![0.0; 1024], r: vec![0.0; 1024] } }
    pub fn set_strip(&mut self, s: Strip) { self.strip = Box::new(s); }
}

/// Remplit `out` (entrelacé, `channels` voies) avec la voix passée par la tranche, à gain progressif.
/// `cushion` = réserve visée dans la file (≈ un tampon) : on attend de l'avoir avant de jouer,
/// et si la file grossit trop (les deux horloges dérivent) on rattrape pour que le retard ne grandisse jamais.
pub fn fill_output(ring: &Ring, out: &mut [f32], channels: usize, target_gain: f32, cushion: usize, st: &mut OutState) {
    let ch = channels.max(1);
    let frames = out.len() / ch;
    if !st.primed {
        if ring.len() >= cushion { st.primed = true; } else { out.iter_mut().for_each(|s| *s = 0.0); return; }
    }
    if ring.len() > cushion * 3 + frames { ring.skip_to(cushion + frames); }
    // gain lissé sur ~5 ms à 48 kHz : pas de clic quand on coupe / remet le retour
    let step = 1.0 / 256.0;
    let mut done = 0;
    while done < frames {
        let n = (frames - done).min(st.l.len());
        for i in 0..n {
            st.l[i] = match ring.pop() {
                Some(v) => v,
                None => { st.underruns += 1; st.primed = false; 0.0 }
            };
        }
        let (gl, gr) = st.strip.process(&mut st.l[..n], &mut st.r[..n]);
        for i in 0..n {
            if st.gain < target_gain { st.gain = (st.gain + step).min(target_gain); } else if st.gain > target_gain { st.gain = (st.gain - step).max(target_gain); }
            let base = (done + i) * ch;
            out[base] = st.l[i] * gl * st.gain;
            if ch > 1 { out[base + 1] = st.r[i] * gr * st.gain; }
            for c in 2..ch { out[base + c] = 0.0; }
        }
        done += n;
    }
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct MonitorInfo {
    pub running: bool,
    pub rate: u32,
    /// Taille de tampon obtenue (échantillons), entrée et sortie
    pub buffer: u32,
    pub input: String,
    pub output: String,
    /// Retard micro → casque mesuré par le système (ms), 0 si inconnu
    pub latency_ms: f64,
    pub underruns: u64,
    /// Pire temps de calcul d'un tampon, en % du temps disponible (au-delà de 100 : ça craquerait)
    pub load_max_pct: f64,
    pub error: Option<String>,
}

enum Cmd {
    Start { device: Option<String>, channel: usize, buffer: u32 },
    Stop,
}

pub struct Monitor {
    tx: Sender<Cmd>,
    gain: Arc<AtomicU32>,
    info: Arc<Mutex<MonitorInfo>>,
    lat_in: Arc<AtomicU64>,
    lat_out: Arc<AtomicU64>,
    underruns: Arc<AtomicU64>,
    started: Arc<AtomicBool>,
    load_max: Arc<AtomicU64>,
    slot: Arc<StripSlot>,
    /// Dernière piste reçue (rejouée à chaque ouverture, à la fréquence du moment)
    track: Arc<Mutex<Option<String>>>,
}

impl Monitor {
    pub fn new() -> Self {
        let (tx, rx) = channel::<Cmd>();
        let gain = Arc::new(AtomicU32::new(1f32.to_bits()));
        let info = Arc::new(Mutex::new(MonitorInfo::default()));
        let lat_in = Arc::new(AtomicU64::new(0));
        let lat_out = Arc::new(AtomicU64::new(0));
        let underruns = Arc::new(AtomicU64::new(0));
        let started = Arc::new(AtomicBool::new(false));
        let slot = Arc::new(StripSlot::new());
        let load_max = Arc::new(AtomicU64::new(0));
        let track: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        {
            let (gain, info, lat_in, lat_out, underruns, started, slot, track, load_max) = (gain.clone(), info.clone(), lat_in.clone(), lat_out.clone(), underruns.clone(), started.clone(), slot.clone(), track.clone(), load_max.clone());
            // Les flux audio ne peuvent pas changer de thread : un thread dédié les possède
            std::thread::spawn(move || {
                let mut streams: Option<(cpal::Stream, cpal::Stream)> = None;
                while let Ok(cmd) = rx.recv() {
                    streams = None;
                    started.store(false, Ordering::SeqCst);
                    match cmd {
                        Cmd::Stop => { info.lock().unwrap().running = false; }
                        Cmd::Start { device, channel, buffer } => {
                            lat_in.store(0, Ordering::Relaxed);
                            lat_out.store(0, Ordering::Relaxed);
                            underruns.store(0, Ordering::Relaxed);
                            load_max.store(0, Ordering::Relaxed);
                            // la tranche est prête avant le premier son
                            let rate = cpal::default_host().default_output_device().and_then(|d| d.default_output_config().ok()).map(|c| c.sample_rate().0).unwrap_or(48000);
                            let first = track.lock().unwrap().as_deref().and_then(|j| Strip::from_json(j, rate as f64).ok()).unwrap_or_else(Strip::dry);
                            match build(device.as_deref(), channel, buffer, &gain, &lat_in, &lat_out, &underruns, &slot, first, &load_max) {
                                Ok((i, o, mut mi)) => {
                                    streams = Some((i, o));
                                    mi.running = true;
                                    *info.lock().unwrap() = mi;
                                    started.store(true, Ordering::SeqCst);
                                }
                                Err(e) => { *info.lock().unwrap() = MonitorInfo { error: Some(e), ..Default::default() }; }
                            }
                        }
                    }
                }
                drop(streams);
            });
        }
        Self { tx, gain, info, lat_in, lat_out, underruns, started, load_max, slot, track }
    }

    /// Piste écoutée (effets, volume, pan) : `json` = { "track": …, "bpm": … }. Prise en compte en direct.
    pub fn set_track(&self, json: &str) -> Result<(), String> {
        let rate = { let i = self.info.lock().unwrap(); if i.running { i.rate } else { 0 } };
        if rate > 0 { self.slot.put(Strip::from_json(json, rate as f64)?); } else { Strip::from_json(json, 48000.0)?; }
        *self.track.lock().unwrap() = Some(json.to_string());
        Ok(())
    }
    /// Retour sec (plus de piste)
    pub fn clear_track(&self) {
        *self.track.lock().unwrap() = None;
        self.slot.put(Strip::dry());
    }

    /// Ouvre le retour direct. `device` = nom du micro (comme le montre le système), `channel` = entrée de l'interface (0 = la première),
    /// `buffer` = taille de tampon voulue (échantillons). Attend jusqu'à 2 s que les flux soient ouverts.
    pub fn start(&self, device: Option<String>, channel: usize, buffer: u32) -> MonitorInfo {
        *self.info.lock().unwrap() = MonitorInfo::default();
        let _ = self.tx.send(Cmd::Start { device, channel, buffer });
        let t0 = std::time::Instant::now();
        while t0.elapsed() < std::time::Duration::from_secs(2) {
            { let i = self.info.lock().unwrap(); if i.running || i.error.is_some() { break; } }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        self.info()
    }
    pub fn stop(&self) { let _ = self.tx.send(Cmd::Stop); }
    /// Volume du retour (0 = coupé, 1 = normal) ; le changement est progressif
    pub fn set_gain(&self, g: f32) { self.gain.store(g.clamp(0.0, 4.0).to_bits(), Ordering::Relaxed); }
    pub fn is_running(&self) -> bool { self.started.load(Ordering::SeqCst) }
    pub fn info(&self) -> MonitorInfo {
        let mut i = self.info.lock().unwrap().clone();
        if i.running {
            let (a, b) = (self.lat_in.load(Ordering::Relaxed), self.lat_out.load(Ordering::Relaxed));
            if a > 0 || b > 0 {
                // retard d'entrée + retard de sortie + la réserve gardée entre les deux (un tampon)
                i.latency_ms = (a + b) as f64 / 1000.0 + i.buffer as f64 * 1000.0 / i.rate.max(1) as f64;
            }
            i.underruns = self.underruns.load(Ordering::Relaxed);
            i.load_max_pct = self.load_max.load(Ordering::Relaxed) as f64 / 100.0;
        }
        i
    }
}

impl Default for Monitor { fn default() -> Self { Self::new() } }

/// Micro voulu : même nom, ou un nom qui le contient (le navigateur ajoute parfois « Par défaut - … »)
fn find_input(host: &cpal::Host, name: Option<&str>) -> Option<cpal::Device> {
    if let Some(want) = name.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if let Ok(list) = host.input_devices() {
            let list: Vec<cpal::Device> = list.collect();
            let wl = want.to_lowercase();
            if let Some(d) = list.iter().find(|d| d.name().map(|n| n.to_lowercase() == wl).unwrap_or(false)) { return Some(d.clone()); }
            if let Some(d) = list.iter().find(|d| d.name().map(|n| { let n = n.to_lowercase(); !n.is_empty() && (wl.contains(&n) || n.contains(&wl)) }).unwrap_or(false)) { return Some(d.clone()); }
        }
        // micro introuvable : surtout pas un autre micro à sa place (on s'entendrait par le mauvais)
        return None;
    }
    host.default_input_device()
}

fn pick_buffer(range: &cpal::SupportedBufferSize, want: u32) -> cpal::BufferSize {
    match range {
        cpal::SupportedBufferSize::Range { min, max } => cpal::BufferSize::Fixed(want.clamp(*min, *max)),
        cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
    }
}

fn micros(d: Option<std::time::Duration>) -> u64 { d.map(|d| d.as_micros() as u64).unwrap_or(0) }

#[allow(clippy::type_complexity)]
fn build(
    device: Option<&str>, channel: usize, buffer: u32,
    gain: &Arc<AtomicU32>, lat_in: &Arc<AtomicU64>, lat_out: &Arc<AtomicU64>, underruns: &Arc<AtomicU64>,
    slot: &Arc<StripSlot>, first: Strip, load_max: &Arc<AtomicU64>,
) -> Result<(cpal::Stream, cpal::Stream, MonitorInfo), String> {
    let host = cpal::default_host();
    let input = find_input(&host, device).ok_or("micro introuvable pour le retour direct")?;
    let output = host.default_output_device().ok_or("aucune sortie audio trouvée")?;
    let icfg = input.default_input_config().map_err(|e| e.to_string())?;
    let ocfg = output.default_output_config().map_err(|e| e.to_string())?;
    if icfg.sample_format() != cpal::SampleFormat::F32 || ocfg.sample_format() != cpal::SampleFormat::F32 {
        return Err("format audio non géré pour le retour direct".into());
    }
    let rate = ocfg.sample_rate().0;
    // On ne change jamais la fréquence des appareils (ça couperait le son des autres logiciels) :
    // micro et casque doivent déjà tourner à la même fréquence.
    if icfg.sample_rate().0 != rate {
        return Err(format!("le micro ({} Hz) et le casque ({} Hz) ne tournent pas à la même fréquence", icfg.sample_rate().0, rate));
    }
    let in_ch = icfg.channels() as usize;
    let out_ch = ocfg.channels() as usize;
    let pick = channel.min(in_ch.saturating_sub(1));
    let ibuf = pick_buffer(icfg.buffer_size(), buffer);
    let obuf = pick_buffer(ocfg.buffer_size(), buffer);
    let got = match obuf { cpal::BufferSize::Fixed(n) => n, cpal::BufferSize::Default => 512 };
    let ring = Arc::new(Ring::new(16384));
    let cushion = got as usize;

    let (r_in, li) = (ring.clone(), lat_in.clone());
    let istream = input
        .build_input_stream(
            &cpal::StreamConfig { channels: in_ch as u16, sample_rate: cpal::SampleRate(rate), buffer_size: ibuf },
            move |data: &[f32], info: &cpal::InputCallbackInfo| {
                // Temps réel : ni allocation, ni verrou
                for frame in data.chunks(in_ch) { r_in.push(frame[pick]); }
                let t = info.timestamp();
                li.store(micros(t.callback.duration_since(&t.capture)), Ordering::Relaxed);
            },
            |err| eprintln!("Erreur du micro (retour direct) : {err}"),
            None,
        )
        .map_err(|e| format!("micro : {e}"))?;
    let (r_out, lo, g, un, sl, lm) = (ring.clone(), lat_out.clone(), gain.clone(), underruns.clone(), slot.clone(), load_max.clone());
    let srate = rate as f64;
    let mut st = OutState::new(0.0, false);
    st.set_strip(first);
    let ostream = output
        .build_output_stream(
            &cpal::StreamConfig { channels: out_ch as u16, sample_rate: cpal::SampleRate(rate), buffer_size: obuf },
            move |out: &mut [f32], info: &cpal::OutputCallbackInfo| {
                let t0 = std::time::Instant::now();
                sl.take_into(&mut st.strip);
                fill_output(&r_out, out, out_ch, f32::from_bits(g.load(Ordering::Relaxed)), cushion, &mut st);
                // charge = temps de calcul / durée du tampon (en centièmes de %)
                let avail = (out.len() / out_ch.max(1)) as f64 / srate;
                let pct = (t0.elapsed().as_secs_f64() / avail * 10000.0) as u64;
                lm.fetch_max(pct, Ordering::Relaxed);
                un.store(st.underruns, Ordering::Relaxed);
                let t = info.timestamp();
                lo.store(micros(t.playback.duration_since(&t.callback)), Ordering::Relaxed);
            },
            |err| eprintln!("Erreur du casque (retour direct) : {err}"),
            None,
        )
        .map_err(|e| format!("casque : {e}"))?;
    istream.play().map_err(|e| e.to_string())?;
    ostream.play().map_err(|e| e.to_string())?;
    let info = MonitorInfo {
        running: false,
        rate,
        buffer: got,
        input: input.name().unwrap_or_default(),
        output: output.name().unwrap_or_default(),
        ..Default::default()
    };
    Ok((istream, ostream, info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_sans_perte_dans_l_ordre() {
        let r = Ring::new(8);
        for i in 0..8 { assert!(r.push(i as f32)); }
        assert!(!r.push(99.0), "file pleine : on jette");
        for i in 0..8 { assert_eq!(r.pop(), Some(i as f32)); }
        assert_eq!(r.pop(), None);
        // tour complet : les indices repartent sans souci
        for k in 0..100 { r.push(k as f32); assert_eq!(r.pop(), Some(k as f32)); }
    }

    #[test]
    fn sortie_attend_sa_reserve_puis_joue_sans_retard_qui_grandit() {
        let r = Ring::new(4096);
        let mut st = OutState::new(1.0, false);
        let mut out = vec![1.0f32; 2 * 64];
        // pas encore de réserve : silence
        for i in 0..32 { r.push(i as f32); }
        fill_output(&r, &mut out, 2, 1.0, 64, &mut st);
        assert!(out.iter().all(|&s| s == 0.0) && !st.primed);
        // réserve atteinte : la voix sort sur les deux côtés, dans l'ordre
        for i in 32..128 { r.push(i as f32); }
        fill_output(&r, &mut out, 2, 1.0, 64, &mut st);
        assert!(st.primed);
        assert_eq!((out[0], out[1], out[2]), (0.0, 0.0, 1.0));
        // le micro prend de l'avance (horloges qui dérivent) : on rattrape, la file ne dépasse jamais ~2 tampons
        for i in 0..2000 { r.push(i as f32); }
        fill_output(&r, &mut out, 2, 1.0, 64, &mut st);
        assert!(r.len() <= 64, "retard rattrapé : {} en attente", r.len());
    }

    #[test]
    fn coupure_progressive_sans_clic() {
        let r = Ring::new(4096);
        for _ in 0..1024 { r.push(1.0); }
        let mut st = OutState::new(1.0, true);
        let mut out = vec![0.0f32; 512];
        fill_output(&r, &mut out, 1, 0.0, 64, &mut st);
        // descend pas à pas (1/256 par échantillon), aucun saut brutal
        assert!(out.windows(2).all(|w| (w[0] - w[1]).abs() <= 1.0 / 256.0 + 1e-6));
        assert_eq!(*out.last().unwrap(), 0.0);
    }

    #[test]
    fn trou_du_micro_compte_et_relance_la_reserve() {
        let r = Ring::new(4096);
        for _ in 0..64 { r.push(0.5); }
        let mut st = OutState::new(1.0, false);
        let mut out = vec![0.0f32; 128];
        fill_output(&r, &mut out, 1, 1.0, 64, &mut st);
        assert_eq!(st.underruns, 64);
        assert!(!st.primed, "on attend de nouveau la réserve");
    }
    #[test]
    fn tranche_de_la_piste_volume_pan_et_effets() {
        let sr = 48000.0;
        let r = Ring::new(65536);
        // piste à 50 %, pan à fond à droite, sans effet : voix à droite seulement, à moitié
        let mut st = OutState::new(1.0, true);
        st.set_strip(Strip::from_json(r#"{"track":{"name":"V","volume":50,"pan":100},"bpm":120}"#, sr).unwrap());
        for _ in 0..512 { r.push(0.8); }
        let mut out = vec![0.0f32; 2 * 256];
        fill_output(&r, &mut out, 2, 1.0, 64, &mut st);
        assert!(out[0].abs() < 1e-6 && (out[1] - 0.4).abs() < 1e-4, "{} {}", out[0], out[1]);
        // centre : puissance constante (−3 dB de chaque côté), comme une piste mono dans le mix
        st.set_strip(Strip::from_json(r#"{"track":{"name":"V"}}"#, sr).unwrap());
        fill_output(&r, &mut out, 2, 1.0, 64, &mut st);
        assert!((out[0] - 0.8 * std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-4 && (out[0] - out[1]).abs() < 1e-6);
        // une reverb : le son continue après la voix (traîne) et ressort en stéréo
        let mut st = OutState::new(1.0, true);
        st.set_strip(Strip::from_json(r#"{"track":{"name":"V","effects":["reverb"],"effectParams":{"reverb":{"wet":50}}}}"#, sr).unwrap());
        let r = Ring::new(65536);
        for i in 0..4800 { r.push(if i < 480 { 0.5 } else { 0.0 }); }
        let mut out = vec![0.0f32; 2 * 4800];
        fill_output(&r, &mut out, 2, 1.0, 64, &mut st);
        let tail: f32 = out[2 * 2400..].iter().map(|x| x.abs()).sum();
        assert!(tail > 0.1, "traîne de reverb absente : {tail}");
    }

    #[test]
    fn echange_de_tranche_pris_au_tampon_suivant() {
        let slot = StripSlot::new();
        let mut cur = Box::new(Strip::dry());
        slot.put(Strip::from_json(r#"{"track":{"name":"V","volume":0}}"#, 48000.0).unwrap());
        slot.take_into(&mut cur);
        assert_eq!(cur.vol, 0.0);
        assert!(!slot.ready.load(Ordering::Acquire));
        // rien de nouveau : on garde la tranche
        slot.take_into(&mut cur);
        assert_eq!(cur.vol, 0.0);
    }
}
