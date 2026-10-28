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

/// Côté casque : remplit `out` (entrelacé, `channels` voies) avec la voix, à gain progressif.
/// `cushion` = réserve visée dans la file (≈ un tampon) : on attend de l'avoir avant de jouer,
/// et si la file grossit trop (les deux horloges dérivent) on rattrape pour que le retard ne grandisse jamais.
pub struct OutState { pub gain: f32, pub primed: bool, pub underruns: u64 }

pub fn fill_output(ring: &Ring, out: &mut [f32], channels: usize, target_gain: f32, cushion: usize, st: &mut OutState) {
    let frames = out.len() / channels.max(1);
    if !st.primed {
        if ring.len() >= cushion { st.primed = true; } else { out.iter_mut().for_each(|s| *s = 0.0); return; }
    }
    if ring.len() > cushion * 3 + frames { ring.skip_to(cushion + frames); }
    // gain lissé sur ~5 ms à 48 kHz : pas de clic quand on coupe / remet le retour
    let step = 1.0 / 256.0;
    for f in 0..frames {
        let v = match ring.pop() {
            Some(v) => v,
            None => { st.underruns += 1; st.primed = false; 0.0 }
        };
        if st.gain < target_gain { st.gain = (st.gain + step).min(target_gain); } else if st.gain > target_gain { st.gain = (st.gain - step).max(target_gain); }
        let y = v * st.gain;
        let base = f * channels;
        for c in 0..channels { out[base + c] = if c < 2 { y } else { 0.0 }; }
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
        {
            let (gain, info, lat_in, lat_out, underruns, started) = (gain.clone(), info.clone(), lat_in.clone(), lat_out.clone(), underruns.clone(), started.clone());
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
                            match build(device.as_deref(), channel, buffer, &gain, &lat_in, &lat_out, &underruns) {
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
        Self { tx, gain, info, lat_in, lat_out, underruns, started }
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
    let (r_out, lo, g, un) = (ring.clone(), lat_out.clone(), gain.clone(), underruns.clone());
    let mut st = OutState { gain: 0.0, primed: false, underruns: 0 };
    let ostream = output
        .build_output_stream(
            &cpal::StreamConfig { channels: out_ch as u16, sample_rate: cpal::SampleRate(rate), buffer_size: obuf },
            move |out: &mut [f32], info: &cpal::OutputCallbackInfo| {
                fill_output(&r_out, out, out_ch, f32::from_bits(g.load(Ordering::Relaxed)), cushion, &mut st);
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
        let mut st = OutState { gain: 1.0, primed: false, underruns: 0 };
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
        let mut st = OutState { gain: 1.0, primed: true, underruns: 0 };
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
        let mut st = OutState { gain: 1.0, primed: false, underruns: 0 };
        let mut out = vec![0.0f32; 128];
        fill_output(&r, &mut out, 1, 1.0, 64, &mut st);
        assert_eq!(st.underruns, 64);
        assert!(!st.primed, "on attend de nouveau la réserve");
    }
}
