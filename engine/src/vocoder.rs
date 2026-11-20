//! Vocodeur : la voix « parle » à travers un synthé. Même calcul que le worklet `pulse-vocoder` de audio.js (parité testée).
//!
//! Principe :
//! 1. le synthé (porteuse) : scies sans repli (PolyBLEP) + un peu de souffle ; sa note suit la voix (arrondie au demi-ton :
//!    effet robot chanté) ou reste fixe (robot rap), en une note seule, octave, quinte ou accord mineur ;
//! 2. la voix et le synthé passent dans le même banc de filtres (8 à 32 bandes, 120 Hz – 8 kHz, 4e ordre) ;
//! 3. chaque bande du synthé prend le volume de la même bande de la voix (le volume propre du synthé est retiré : le timbre
//!    sorti est celui de la voix) ; le formant décale les bandes du synthé (voix plus grosse / plus fine) ;
//! 4. l'« air » remet l'aigu de la voix (au-dessus de 6 kHz : les « s », les « t ») pour qu'on comprenne les mots.
//! Aucun retard.
use std::f64::consts::PI;

const DS: usize = 4;
const HOP: usize = 256;
const FMIN: f64 = 70.0;
const FMAX: f64 = 800.0;
const GATE: f64 = 0.004;
const LO: f64 = 120.0;
const HI: f64 = 8000.0;
/// Accords (demi-tons au-dessus de la note) : seule, octave, quinte, mineur, mineur 7
const CHORDS: [&[f64]; 5] = [&[0.0], &[-12.0, 0.0], &[0.0, 7.0], &[0.0, 3.0, 7.0], &[0.0, 3.0, 7.0, 10.0]];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VocoderParams {
    /// 0 = la note suit la voix, 1 = note fixe
    pub mode: f64,
    /// note fixe (MIDI)
    pub note: f64,
    pub chord: f64,
    pub bands: f64,
    /// décalage des bandes du synthé (demi-tons)
    pub formant: f64,
    /// réactivité 0–100
    pub speed: f64,
    /// aigu de la voix remis (0–100)
    pub air: f64,
    /// souffle dans le synthé (0–100)
    pub tone: f64,
    pub mix: f64,
}
impl Default for VocoderParams {
    fn default() -> Self { Self { mode: 0.0, note: 48.0, chord: 0.0, bands: 20.0, formant: 0.0, speed: 50.0, air: 40.0, tone: 10.0, mix: 100.0 } }
}
impl VocoderParams {
    pub fn from(j: &crate::model::VocoderJson) -> Self {
        let d = Self::default();
        Self { mode: j.mode.unwrap_or(d.mode), note: j.note.unwrap_or(d.note), chord: j.chord.unwrap_or(d.chord), bands: j.bands.unwrap_or(d.bands),
            formant: j.formant.unwrap_or(d.formant), speed: j.speed.unwrap_or(d.speed), air: j.air.unwrap_or(d.air), tone: j.tone.unwrap_or(d.tone), mix: j.mix.unwrap_or(d.mix) }
    }
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "mode" => self.mode = v, "note" => self.note = v, "chord" => self.chord = v, "bands" => self.bands = v, "formant" => self.formant = v,
            "speed" => self.speed = v, "air" => self.air = v, "tone" => self.tone = v, "mix" => self.mix = v, _ => return false }
        true
    }
}

/// Passe-bande RBJ (gain 1 au centre), coefficients normalisés
#[derive(Clone, Copy, Default)]
struct Bq { b0: f64, b2: f64, a1: f64, a2: f64 }
fn bandpass(sr: f64, f: f64, bw: f64) -> Bq {
    let w = 2.0 * PI * f / sr;
    let (s, c) = (w.sin(), w.cos());
    let al = s * ((2f64).ln() / 2.0 * bw * w / s).sinh();
    let a0 = 1.0 + al;
    Bq { b0: al / a0, b2: -al / a0, a1: -2.0 * c / a0, a2: (1.0 - al) / a0 }
}
/// Passe-haut RBJ (Q 0,707) : coefficients b0 b1 b2 a1 a2
fn highpass(sr: f64, f: f64) -> [f64; 5] {
    let w = 2.0 * PI * f / sr;
    let (s, c) = (w.sin(), w.cos());
    let al = s / (2.0 * std::f64::consts::FRAC_1_SQRT_2);
    let a0 = 1.0 + al;
    [(1.0 + c) / 2.0 / a0, -(1.0 + c) / a0, (1.0 + c) / 2.0 / a0, -2.0 * c / a0, (1.0 - al) / a0]
}
/// Forme directe transposée ; état [z1, z2]
#[inline]
fn bp_run(q: &Bq, z: &mut [f64; 2], x: f64) -> f64 {
    let y = q.b0 * x + z[0];
    z[0] = -q.a1 * y + z[1];
    z[1] = q.b2 * x - q.a2 * y;
    y
}

pub struct Vocoder {
    sr: f64,
    p: VocoderParams,
    n: usize,
    fc: Vec<f64>,
    bw: f64,
    mq: Vec<Bq>,
    cq: Vec<Bq>,
    mz: Vec<[[f64; 2]; 2]>,
    cz: Vec<[[f64; 2]; 2]>,
    env: Vec<f64>,
    cenv: Vec<f64>,
    hp: [f64; 5],
    hz: [[f64; 2]; 2],
    cform: f64,
    // suivi de la note
    ds: Vec<f64>,
    acc: f64,
    w: usize,
    win_d: usize,
    tmin_d: usize,
    tmax_d: usize,
    dwin: Vec<f64>,
    diff: Vec<f64>,
    /// note du synthé (MIDI, glissée)
    cur: f64,
    target: f64,
    glide: f64,
    ph: [f64; 4],
    seed: u32,
    att: f64,
    rel: f64,
    crel: f64,
    mix: f64,
    mix_k: f64,
    /// Volume calé sur la voix : énergie moyenne (0,4 s) de la voix et du synthé, le synthé est ramené au niveau de la voix
    /// (sinon le volume changeait de 0 à −6 dB selon le nombre de bandes, l'accord, le formant)
    lin: f64,
    lout: f64,
    lk: f64,
    /// gain appliqué : glisse (0,2 s) vers le rapport mesuré, part de 1 → pas de coup de volume au départ
    lg: f64,
    lgk: f64,
}

impl Vocoder {
    pub fn new(p: &VocoderParams, sr: f64) -> Self {
        let sd = sr / DS as f64;
        let tmax_d = (sd / FMIN).ceil() as usize;
        let tmin_d = ((sd / FMAX).floor() as usize).max(2);
        let win_d = 2 * tmax_d + 32;
        let mut s = Self {
            sr, p: *p, n: 0, fc: vec![], bw: 0.0, mq: vec![], cq: vec![], mz: vec![], cz: vec![], env: vec![], cenv: vec![],
            hp: highpass(sr, 6000.0), hz: [[0.0; 2]; 2], cform: f64::NAN,
            ds: vec![0.0; win_d], acc: 0.0, w: 0, win_d, tmin_d, tmax_d, dwin: vec![0.0; win_d], diff: vec![0.0; tmax_d + 1],
            cur: p.note, target: p.note, glide: 1.0 - (-1.0 / (0.03 * sr)).exp(), ph: [0.0, 0.25, 0.5, 0.75], seed: 22222,
            att: 0.0, rel: 0.0, crel: 1.0 - (-1.0 / (0.05 * sr)).exp(), mix: 1.0, mix_k: 1.0 - (-1.0 / (0.01 * sr)).exp(),
            lin: 0.0, lout: 0.0, lk: 1.0 - (-1.0 / (0.4 * sr)).exp(), lg: 1.0, lgk: 1.0 - (-1.0 / (0.2 * sr)).exp(),
        };
        s.set(p);
        s.mix = s.p.mix.clamp(0.0, 100.0) / 100.0;
        s
    }
    pub fn set(&mut self, p: &VocoderParams) {
        self.p = *p;
        let n = (p.bands.round() as usize).clamp(8, 32);
        if n != self.n {
            self.n = n;
            let hi = HI.min(0.42 * self.sr);
            let r = (hi / LO).powf(1.0 / (n - 1) as f64);
            self.fc = (0..n).map(|i| LO * r.powi(i as i32)).collect();
            self.bw = r.log2();
            self.mq = self.fc.iter().map(|&f| bandpass(self.sr, f, self.bw)).collect();
            self.mz = vec![[[0.0; 2]; 2]; n];
            self.cz = vec![[[0.0; 2]; 2]; n];
            self.env = vec![0.0; n];
            self.cenv = vec![0.0; n];
            self.cform = f64::NAN;
        }
        let fm = p.formant.clamp(-12.0, 12.0);
        if fm != self.cform {
            self.cform = fm;
            let k = 2f64.powf(fm / 12.0);
            let top = 0.45 * self.sr;
            self.cq = self.fc.iter().map(|&f| bandpass(self.sr, (f * k).min(top), self.bw)).collect();
        }
        let s = p.speed.clamp(0.0, 100.0) / 100.0;
        self.att = 1.0 - (-1.0 / ((0.02 - 0.018 * s) * self.sr)).exp();
        self.rel = 1.0 - (-1.0 / ((0.2 - 0.19 * s) * self.sr)).exp();
        if p.mode >= 0.5 { self.target = p.note.clamp(24.0, 84.0); }
    }
    pub fn set_key(&mut self, k: &str, v: f64) { let mut p = self.p; if p.set_key(k, v) { self.set(&p); } }
    pub fn latency(&self) -> usize { 0 }

    /// Note de la voix (MIDI, arrondie au demi-ton) sur la dernière fenêtre, ou None
    fn track(&mut self) -> Option<f64> {
        let wd = self.win_d;
        let nd = self.w / DS;
        let mut e = 0.0;
        for j in 0..wd {
            let k = nd as i64 - wd as i64 + j as i64;
            let v = if k < 0 { 0.0 } else { self.ds[(k as usize) % wd] };
            self.dwin[j] = v;
            e += v * v;
        }
        if (e / wd as f64).sqrt() < GATE { return None; }
        let ww = wd - self.tmax_d;
        for t in 0..=self.tmax_d {
            let mut s = 0.0;
            for j in 0..ww { let d = self.dwin[j] - self.dwin[j + t]; s += d * d; }
            self.diff[t] = s;
        }
        let mut cs = 0.0;
        self.diff[0] = 1.0;
        for t in 1..=self.tmax_d { cs += self.diff[t]; self.diff[t] = if cs > 1e-12 { self.diff[t] * t as f64 / cs } else { 1.0 }; }
        let (tm, mut t) = (self.tmax_d, self.tmin_d);
        while t < tm && self.diff[t] >= 0.15 { t += 1; }
        if t >= tm { return None; }
        while t + 1 < tm && self.diff[t + 1] < self.diff[t] { t += 1; }
        let cm = &self.diff;
        let den = 2.0 * (cm[t - 1] - 2.0 * cm[t] + cm[t + 1]);
        let b = t as f64 + if den.abs() > 1e-12 { (cm[t - 1] - cm[t + 1]) / den } else { 0.0 };
        let f = self.sr / (b * DS as f64);
        Some((69.0 + 12.0 * (f / 440.0).log2()).round())
    }

    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let m = if nc > 1 { 0.5 * (x[0] + x[1]) } else { x[0] };
        // 1. note
        self.acc += m;
        self.w += 1;
        if self.w % DS == 0 { self.ds[(self.w / DS - 1) % self.win_d] = self.acc / DS as f64; self.acc = 0.0; }
        if self.p.mode < 0.5 && self.w % HOP == 0 {
            if let Some(n) = self.track() { self.target = n; }
        }
        self.cur += (self.target - self.cur) * self.glide;
        // 2. synthé
        let ch = CHORDS[(self.p.chord.round() as usize).min(CHORDS.len() - 1)];
        let mut saw = 0.0;
        for (i, iv) in ch.iter().enumerate() {
            let f = 440.0 * 2f64.powf((self.cur + iv - 69.0) / 12.0);
            let dt = (f / self.sr).min(0.45);
            let mut ph = self.ph[i] + dt;
            if ph >= 1.0 { ph -= 1.0; }
            self.ph[i] = ph;
            let mut v = 2.0 * ph - 1.0;
            // PolyBLEP : pas de repli dans l'aigu
            if ph < dt { let t = ph / dt; v -= t + t - t * t - 1.0; } else if ph > 1.0 - dt { let t = (ph - 1.0) / dt; v -= t * t + t + t + 1.0; }
            saw += v;
        }
        saw /= (ch.len() as f64).sqrt();
        self.seed = self.seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let noise = self.seed as f64 / 4_294_967_296.0 * 2.0 - 1.0;
        let tone = self.p.tone.clamp(0.0, 100.0) / 100.0;
        let car = saw * (1.0 - tone) + noise * tone;
        // 3. bandes
        let mut out = 0.0;
        for i in 0..self.n {
            let mut a = bp_run(&self.mq[i], &mut self.mz[i][0], m);
            a = bp_run(&self.mq[i], &mut self.mz[i][1], a);
            let mut c = bp_run(&self.cq[i], &mut self.cz[i][0], car);
            c = bp_run(&self.cq[i], &mut self.cz[i][1], c);
            let ra = a.abs();
            let e = self.env[i];
            self.env[i] = e + (ra - e) * if ra > e { self.att } else { self.rel };
            let ce = self.cenv[i];
            self.cenv[i] = ce + (c.abs() - ce) * self.crel;
            out += c * self.env[i] / (self.cenv[i] + 1e-3);
        }
        if m * m > 1e-8 || self.lin > 1e-7 { self.lin += (m * m - self.lin) * self.lk; self.lout += (out * out - self.lout) * self.lk; }
        if self.lin > 1e-7 { self.lg += (((self.lin + 1e-9) / (self.lout + 1e-9)).sqrt().clamp(0.25, 4.0) - self.lg) * self.lgk; }
        out *= self.lg;
        // 4. air : l'aigu de la voix
        let hp = &self.hp;
        let mut h = m;
        for z in self.hz.iter_mut() {
            let y = hp[0] * h + z[0];
            z[0] = hp[1] * h - hp[3] * y + z[1];
            z[1] = hp[2] * h - hp[4] * y;
            h = y;
        }
        let wet = out + h * self.p.air.clamp(0.0, 100.0) / 100.0;
        self.mix += (self.p.mix.clamp(0.0, 100.0) / 100.0 - self.mix) * self.mix_k;
        for c in 0..nc.max(1).min(2) { x[c] += (wet - x[c]) * self.mix; }
        if nc < 2 { x[1] = x[0]; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn voix(sr: f64, f: f64, n: usize) -> Vec<f64> {
        // voix synthétique : impulsions à f (harmoniques), passées dans deux résonances (formants)
        let mut ph = 0.0; let (r1, r2) = (bandpass(sr, 700.0, 0.5), bandpass(sr, 1200.0, 0.5)); let (mut z1, mut z2) = ([0.0; 2], [0.0; 2]);
        (0..n).map(|_| { ph += f / sr; let p = if ph >= 1.0 { ph -= 1.0; 1.0 } else { 0.0 }; 0.5 * bp_run(&r1, &mut z1, p) + 0.5 * bp_run(&r2, &mut z2, p) }).collect()
    }
    fn pitch_of(y: &[f64], sr: f64) -> f64 {
        // autocorrélation brute 70–800 Hz
        let (a, b) = ((sr / 800.0) as usize, (sr / 70.0) as usize);
        let mut best = (0, f64::MIN);
        for t in a..b { let s: f64 = (0..4096).map(|i| y[i] * y[i + t]).sum(); if s > best.1 { best = (t, s); } }
        sr / best.0 as f64
    }
    #[test]
    fn suit_la_voix_et_parle() {
        let sr = 48000.0;
        let x = voix(sr, 220.0, sr as usize);
        let mut v = Vocoder::new(&VocoderParams { air: 0.0, tone: 0.0, ..Default::default() }, sr);
        let y: Vec<f64> = x.iter().map(|&s| { let mut f = [s, 0.0]; v.tick(&mut f, 1); f[0] }).collect();
        let tail = &y[sr as usize / 2..];
        let f = pitch_of(tail, sr);
        assert!((f / 220.0).log2().abs() * 1200.0 < 30.0, "note du synthé {f} Hz au lieu de 220");
        let (ri, ro) = ((x[24000..].iter().map(|v| v * v).sum::<f64>() / 24000.0).sqrt(), (tail.iter().map(|v| v * v).sum::<f64>() / tail.len() as f64).sqrt());
        assert!(ro > ri * 0.3 && ro < ri * 3.0, "volume {ro} pour une voix à {ri}");
    }
    #[test]
    fn note_fixe_et_silence() {
        let sr = 48000.0;
        let x = voix(sr, 300.0, sr as usize);
        let mut v = Vocoder::new(&VocoderParams { mode: 1.0, note: 45.0, air: 0.0, tone: 0.0, ..Default::default() }, sr);
        let y: Vec<f64> = x.iter().map(|&s| { let mut f = [s, 0.0]; v.tick(&mut f, 1); f[0] }).collect();
        let f = pitch_of(&y[sr as usize / 2..], sr);
        assert!((f / 110.0).log2().abs() * 1200.0 < 30.0, "note fixe {f} Hz au lieu de 110");
        // sans voix, pas de son
        for _ in 0..24000 { let mut f = [0.0, 0.0]; v.tick(&mut f, 1); }
        let mut s = 0.0;
        for _ in 0..24000 { let mut f = [0.0, 0.0]; v.tick(&mut f, 1); s += f[0] * f[0]; }
        assert!((s / 24000.0).sqrt() < 1e-3, "souffle sans voix : {}", (s / 24000.0).sqrt());
    }
}
