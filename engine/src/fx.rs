//! Effets de piste : mêmes formules que les noeuds Web Audio du prototype (BiquadFilter, WaveShaper).
use crate::model::{Automation, Curve, EqBand, PitchParams, CrushParams, GateParams, ModParams, CompParams, DelayParams, EffectParams, MasterParams, ReverbParams, Send, Track};
use std::f64::consts::PI;

/// Filtre biquad (forme directe I).
#[derive(Clone, Copy)]
pub struct Biquad {
    b0: f64, b1: f64, b2: f64, a1: f64, a2: f64,
    x1: f64, x2: f64, y1: f64, y2: f64,
}

impl Biquad {
    /// Mêmes coefficients que `other` (nouveau réglage), en gardant la mémoire du filtre en cours (pas de clic)
    fn retune(&mut self, other: Biquad) {
        let (x1, x2, y1, y2) = (self.x1, self.x2, self.y1, self.y2);
        *self = other;
        self.x1 = x1; self.x2 = x2; self.y1 = y1; self.y2 = y2;
    }
    fn new(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }
    /// Passe-haut ; `q_db` est en dB comme dans Web Audio.
    pub fn highpass(sr: f64, freq: f64, q_db: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let alpha = w.sin() / (2.0 * 10f64.powf(q_db / 20.0));
        let c = w.cos();
        Self::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }
    pub fn lowpass(sr: f64, freq: f64, q_db: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let alpha = w.sin() / (2.0 * 10f64.powf(q_db / 20.0));
        let c = w.cos();
        Self::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }
    pub fn peaking(sr: f64, freq: f64, q: f64, gain_db: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let a = 10f64.powf(gain_db / 40.0);
        let alpha = w.sin() / (2.0 * q);
        let c = w.cos();
        Self::new(1.0 + alpha * a, -2.0 * c, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * c, 1.0 - alpha / a)
    }
    /// Étagère basse (mêmes formules que le BiquadFilter « lowshelf » de Web Audio).
    pub fn lowshelf(sr: f64, freq: f64, gain_db: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let a = 10f64.powf(gain_db / 40.0);
        let c = w.cos();
        let beta = 2.0 * a.sqrt() * (w.sin() / 2.0) * 2f64.sqrt();
        Self::new(
            a * ((a + 1.0) - (a - 1.0) * c + beta),
            2.0 * a * ((a - 1.0) - (a + 1.0) * c),
            a * ((a + 1.0) - (a - 1.0) * c - beta),
            (a + 1.0) + (a - 1.0) * c + beta,
            -2.0 * ((a - 1.0) + (a + 1.0) * c),
            (a + 1.0) + (a - 1.0) * c - beta,
        )
    }
    pub fn highshelf(sr: f64, freq: f64, gain_db: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let a = 10f64.powf(gain_db / 40.0);
        let c = w.cos();
        let beta = 2.0 * a.sqrt() * (w.sin() / 2.0) * 2f64.sqrt();
        Self::new(
            a * ((a + 1.0) + (a - 1.0) * c + beta),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * c),
            a * ((a + 1.0) + (a - 1.0) * c - beta),
            (a + 1.0) - (a - 1.0) * c + beta,
            2.0 * ((a - 1.0) - (a + 1.0) * c),
            (a + 1.0) - (a - 1.0) * c - beta,
        )
    }
    /// Encoche (même formule que le BiquadFilter « notch » de Web Audio).
    pub fn notch(sr: f64, freq: f64, q: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let alpha = w.sin() / (2.0 * q);
        let c = w.cos();
        Self::new(1.0, -2.0 * c, 1.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }
    /// Passe-bande (gain 0 dB au centre, comme le BiquadFilter « bandpass » de Web Audio).
    pub fn bandpass(sr: f64, freq: f64, q: f64) -> Self {
        let w = 2.0 * PI * freq / sr;
        let alpha = w.sin() / (2.0 * q);
        let c = w.cos();
        Self::new(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }
    /// Simple gain (sortie de l'EQ)
    pub fn gain(db: f64) -> Self { Self::new(10f64.powf(db / 20.0), 0.0, 0.0, 1.0, 0.0, 0.0) }
    #[inline]
    pub fn tick(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x; self.y2 = self.y1; self.y1 = y;
        y
    }
}

/// Nouveau De-esser : même calcul que le worklet `pulse-deesser2` de audio.js.
pub struct DeesserV2 {
    hp: [Biquad; 2],
    lpf: [Biquad; 2],
    k: f64,
    lp: [f64; 2],
    thr: f64,
    range: f64,
    wide: bool,
    rel: bool,
    env_b: f64,
    env_f: f64,
    gain: f64,
    att: f64,
    relc: f64,
    smooth: f64,
}
impl DeesserV2 {
    pub fn new(p: &crate::model::DeessParams, sr: f64) -> Self {
        let coef = |sec: f64| 1.0 - (-1.0 / (sec * sr)).exp();
        let lo = p.lo.unwrap_or(5000.0).clamp(1000.0, 16000.0);
        let hi = p.hi.unwrap_or(11000.0).min(20000.0).min(sr * 0.45).max(lo * 1.2);
        let biq = |hp: bool, f: f64| {
            let w = 2.0 * PI * f / sr;
            let (c, al) = (w.cos(), w.sin() / (2.0 * std::f64::consts::FRAC_1_SQRT_2));
            if hp { Biquad::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al) }
            else { Biquad::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al) }
        };
        Self {
            hp: [biq(true, lo), biq(true, lo)], lpf: [biq(false, hi), biq(false, hi)],
            k: (-2.0 * PI * lo * 0.5 / sr).exp(), lp: [0.0; 2],
            thr: p.thr.unwrap_or(-26.0), range: p.range.unwrap_or(10.0).clamp(0.0, 30.0),
            wide: p.wide.unwrap_or(false), rel: p.rel.unwrap_or(false),
            env_b: 0.0, env_f: 0.0, gain: 1.0, att: coef(0.001), relc: coef(0.060), smooth: coef(0.002),
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (mut pk_b, mut pk_f) = (0.0f64, 0.0f64);
        let mut hs = [0.0f64; 2];
        for ch in 0..nc {
            let b = self.lpf[ch].tick(self.hp[ch].tick(x[ch]));
            self.lp[ch] = x[ch] + (self.lp[ch] - x[ch]) * self.k;
            hs[ch] = x[ch] - self.lp[ch];
            pk_b = pk_b.max(b.abs());
            pk_f = pk_f.max(x[ch].abs());
        }
        self.env_b += (pk_b - self.env_b) * if pk_b > self.env_b { self.att } else { self.relc };
        self.env_f += (pk_f - self.env_f) * if pk_f > self.env_f { self.att } else { self.relc };
        let mut red = 0.0;
        if self.env_f > 0.001 {
            let det = 20.0 * (self.env_b.max(1e-9) / if self.rel { self.env_f } else { 1.0 }).log10();
            red = (det - self.thr).clamp(0.0, self.range);
        }
        let target = 10f64.powf(-red / 20.0);
        self.gain += (target - self.gain) * self.smooth;
        for ch in 0..nc {
            x[ch] = if self.wide { x[ch] * self.gain } else { x[ch] + hs[ch] * (self.gain - 1.0) };
        }
    }
}

/// De-esser : même calcul que le worklet `pulse-deesser` de audio.js (les deux doivent sonner pareil).
struct Deesser {
    max_red: f64,
    slope: f64,
    k: f64,
    lp: [f64; 2],
    hp: [Biquad; 2],
    env_h: f64,
    env_f: f64,
    gain: f64,
    att: f64,
    rel: f64,
    smooth: f64,
}

impl Deesser {
    fn new(amount: f64, freq: f64, sr: f64) -> Self {
        let amount = amount.clamp(0.0, 100.0);
        let coef = |sec: f64| 1.0 - (-1.0 / (sec * sr)).exp();
        // Butterworth 2e ordre (Q = 1/√2), écrit comme dans le worklet
        let w = 2.0 * PI * freq / sr;
        let (c, al) = (w.cos(), w.sin() / 2f64.sqrt());
        let hp = Biquad::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al);
        Self {
            max_red: amount * 0.24,
            slope: amount / 100.0 * 3.0,
            k: (-2.0 * PI * freq * 0.5 / sr).exp(),
            lp: [0.0; 2],
            hp: [hp.clone(), hp],
            env_h: 0.0,
            env_f: 0.0,
            gain: 1.0,
            att: coef(0.001),
            rel: coef(0.060),
            smooth: coef(0.002),
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (mut pk_h, mut pk_f) = (0.0f64, 0.0f64);
        let mut hs = [0.0f64; 2];
        for ch in 0..nc {
            let h = self.hp[ch].tick(x[ch]);
            self.lp[ch] = x[ch] + (self.lp[ch] - x[ch]) * self.k;
            hs[ch] = x[ch] - self.lp[ch];
            pk_h = pk_h.max(h.abs());
            pk_f = pk_f.max(x[ch].abs());
        }
        self.env_h += (pk_h - self.env_h) * if pk_h > self.env_h { self.att } else { self.rel };
        self.env_f += (pk_f - self.env_f) * if pk_f > self.env_f { self.att } else { self.rel };
        let mut target = 1.0;
        if self.env_f > 0.001 {
            let r = self.env_h / self.env_f;
            if r > 0.35 {
                let over = 20.0 * (r / 0.35).log10();
                target = 10f64.powf(-(over * self.slope).min(self.max_red) / 20.0);
            }
        }
        self.gain += (target - self.gain) * self.smooth;
        for ch in 0..nc {
            x[ch] += hs[ch] * (self.gain - 1.0);
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum ModKind {
    Chorus,
    Flanger,
    Phaser,
    Tremolo,
    Doubler,
    Slapback,
}

/// Chorus, flanger, phaser, trémolo, doubleur, slapback : même calcul que le worklet `pulse-mod` de audio.js.
struct ModFx {
    kind: ModKind,
    rate: f64,
    depth: f64,
    fb: f64,
    mix: f64,
    time: f64,
    width: f64,
    off: f64,
    sr: f64,
    buf: [Vec<f64>; 2],
    w: usize,
    ph: f64,
    z: [[f64; 4]; 2],
    prev: [f64; 2],
}

impl ModFx {
    fn new(kind: ModKind, p: &ModParams, sr: f64) -> Self {
        // (vitesse, profondeur, résonance, mélange) de départ, comme MOD_DEFAULTS dans audio.js
        let (rate, depth, fb, mix) = match kind {
            ModKind::Chorus => (0.8, 5.0, 0.0, 50.0),
            ModKind::Flanger => (0.25, 2.0, 50.0, 50.0),
            ModKind::Phaser => (0.4, 70.0, 40.0, 50.0),
            ModKind::Tremolo => (5.0, 50.0, 0.0, 100.0),
            ModKind::Doubler => (0.35, 50.0, 0.0, 50.0),
            ModKind::Slapback => (0.0, 0.0, 12.0, 25.0),
        };
        let size = (0.35 * sr).ceil() as usize + 4;
        Self {
            kind,
            rate: if kind == ModKind::Doubler { rate } else { p.rate.unwrap_or(rate) },
            depth: p.depth.unwrap_or(depth),
            fb: p.feedback.unwrap_or(fb) / 100.0,
            mix: p.mix.unwrap_or(mix) / 100.0,
            time: p.time.unwrap_or(110.0) / 1000.0,
            width: p.width.unwrap_or(depth),
            off: if kind == ModKind::Doubler { 0.5 } else { 0.25 },
            sr,
            buf: [vec![0.0; size], vec![0.0; size]],
            w: 0,
            ph: 0.0,
            z: [[0.0; 4]; 2],
            prev: [0.0; 2],
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        for ch in 0..nc {
            let xin = x[ch];
            let lfo = (2.0 * PI * (self.ph + self.off * ch as f64)).sin();
            match self.kind {
                ModKind::Tremolo => x[ch] = xin * (1.0 - self.depth / 100.0 * (0.5 - 0.5 * lfo)),
                ModKind::Phaser => {
                    let f = 300.0 * 10f64.powf((0.5 + 0.5 * lfo) * self.depth / 100.0);
                    let t = (PI * f / self.sr).tan();
                    let a = (t - 1.0) / (t + 1.0);
                    let mut v = xin + self.fb * self.prev[ch];
                    for s in 0..4 {
                        let y = a * v + self.z[ch][s];
                        self.z[ch][s] = v - a * y;
                        v = y;
                    }
                    self.prev[ch] = v;
                    x[ch] = xin * (1.0 - self.mix) + v * self.mix;
                }
                _ => {
                    let dsec = match self.kind {
                        ModKind::Chorus => 0.012 + self.depth / 1000.0 * lfo,
                        ModKind::Flanger => 0.0005 + self.depth / 1000.0 * (0.5 + 0.5 * lfo),
                        ModKind::Doubler => 0.025 + self.width / 100.0 * 0.006 * lfo,
                        _ => self.time,
                    };
                    let size = self.buf[ch].len();
                    let mut pos = self.w as f64 - dsec * self.sr;
                    pos = ((pos % size as f64) + size as f64) % size as f64;
                    let i0 = pos.floor();
                    let fr = pos - i0;
                    let (a, b) = (self.buf[ch][i0 as usize], self.buf[ch][(i0 as usize + 1) % size]);
                    let wet = a + (b - a) * fr;
                    self.buf[ch][self.w] = xin + self.fb * wet;
                    x[ch] = xin * (1.0 - self.mix) + wet * self.mix;
                }
            }
        }
        self.w = (self.w + 1) % self.buf[0].len();
        self.ph += self.rate / self.sr;
        if self.ph >= 1.0 {
            self.ph -= 1.0;
        }
    }
}

/// Bitcrusher : même calcul que le worklet `pulse-crush`.
struct Crush {
    q: f64,
    down: usize,
    mix: f64,
    c: usize,
    held: [f64; 2],
}

impl Crush {
    fn new(p: &CrushParams) -> Self {
        Self { q: 2f64.powf(p.bits.unwrap_or(8.0) - 1.0), down: (p.down.unwrap_or(4.0).round() as usize).max(1), mix: p.mix.unwrap_or(100.0) / 100.0, c: 0, held: [0.0; 2] }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        for ch in 0..nc {
            if self.c == 0 {
                self.held[ch] = (x[ch] * self.q + 0.5).floor() / self.q;
            }
            x[ch] = x[ch] * (1.0 - self.mix) + self.held[ch] * self.mix;
        }
        self.c = (self.c + 1) % self.down;
    }
}

/// Utilitaire (mono, phase, volume) ou largeur stéréo : même calcul que le worklet `pulse-util`.
struct Util {
    width_mode: bool,
    g: f64,
    mono: bool,
    width: f64,
}

impl Util {
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        if self.width_mode {
            if nc >= 2 {
                let (m, s) = ((x[0] + x[1]) / 2.0, (x[0] - x[1]) / 2.0 * self.width);
                x[0] = m + s;
                x[1] = m - s;
            }
        } else if self.mono && nc >= 2 {
            let m = (x[0] + x[1]) / 2.0 * self.g;
            x[0] = m;
            x[1] = m;
        } else {
            for v in &mut x[..nc] {
                *v *= self.g;
            }
        }
    }
}

/// Gate : même calcul que le worklet `pulse-gate` de audio.js. Sans ratio : gate franc ; avec ratio : expandeur à genou doux.
struct Gate {
    thr: f64,
    thr_db: f64,
    range: f64,
    floor: f64,
    ratio: f64,
    knee: f64,
    hold: usize,
    att: f64,
    env_rel: f64,
    g_att: f64,
    g_rel: f64,
    env: f64,
    left: usize,
    gain: f64,
    hp: Option<[f64; 5]>,
    lp: Option<[f64; 5]>,
    zh: [[f64; 4]; 2],
    zl: [[f64; 4]; 2],
}

impl Gate {
    fn new(p: &GateParams, sr: f64) -> Self {
        let coef = |sec: f64| 1.0 - (-1.0 / (sec * sr)).exp();
        let bq = |hp: bool, f: f64| {
            let w = 2.0 * PI * f / sr;
            let (c, al) = (w.cos(), w.sin() / std::f64::consts::SQRT_2);
            let a0 = 1.0 + al;
            if hp { [(1.0 + c) / 2.0 / a0, -(1.0 + c) / a0, (1.0 + c) / 2.0 / a0, -2.0 * c / a0, (1.0 - al) / a0] }
            else { [(1.0 - c) / 2.0 / a0, (1.0 - c) / a0, (1.0 - c) / 2.0 / a0, -2.0 * c / a0, (1.0 - al) / a0] }
        };
        let thr_db = p.threshold.unwrap_or(-45.0);
        let range = p.reduction.unwrap_or(40.0);
        Self {
            thr: 10f64.powf(thr_db / 20.0),
            thr_db,
            range,
            floor: 10f64.powf(-range / 20.0),
            ratio: p.ratio.filter(|r| *r > 0.0).map_or(0.0, |r| r.max(1.0)),
            knee: p.knee.unwrap_or(0.0).max(0.0),
            hold: (p.hold.unwrap_or(50.0).max(0.0) / 1000.0 * sr).round() as usize,
            att: coef(0.0005),
            env_rel: coef(0.02),
            g_att: coef((p.attack.unwrap_or(2.0) / 1000.0).max(0.0001)),
            g_rel: coef((p.release.unwrap_or(150.0) / 1000.0).max(0.005)),
            env: 0.0,
            left: 0,
            gain: 1.0,
            hp: p.hp.filter(|f| *f > 20.0).map(|f| bq(true, f.min(sr * 0.45))),
            lp: p.lp.filter(|f| *f > 0.0 && *f < 20_000.0).map(|f| bq(false, f.min(sr * 0.45))),
            zh: [[0.0; 4]; 2],
            zl: [[0.0; 4]; 2],
        }
    }
    fn target(&self) -> f64 {
        if self.left > 0 { return 1.0; }
        if self.ratio == 0.0 { return self.floor; }
        let u = self.thr_db - 20.0 * self.env.max(1e-6).log10();
        let k = self.knee / 2.0;
        let r = if u <= -k { 0.0 } else if u < k { (u + k) * (u + k) / (4.0 * self.knee.max(1e-3)) * (self.ratio - 1.0) } else { u * (self.ratio - 1.0) };
        10f64.powf(-r.max(0.0).min(self.range) / 20.0)
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let run = |k: &[f64; 5], z: &mut [f64; 4], v: f64| { let y = k[0] * v + k[1] * z[0] + k[2] * z[1] - k[3] * z[2] - k[4] * z[3]; z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y; y };
        let mut pk = 0.0f64;
        for ch in 0..nc {
            let mut d = x[ch];
            if let Some(k) = &self.hp { d = run(k, &mut self.zh[ch], d); }
            if let Some(k) = &self.lp { d = run(k, &mut self.zl[ch], d); }
            pk = pk.max(d.abs());
        }
        self.env += (pk - self.env) * if pk > self.env { self.att } else { self.env_rel };
        if self.env > self.thr {
            self.left = self.hold;
        } else if self.left > 0 {
            self.left -= 1;
        }
        let target = self.target();
        self.gain += (target - self.gain) * if target > self.gain { self.g_att } else { self.g_rel };
        for v in &mut x[..nc] {
            *v *= self.gain;
        }
    }
}

/// Compresseur : même calcul que le worklet `pulse-comp` de audio.js.
pub struct Compressor {
    thr: f64,
    slope: f64,
    knee: f64,
    att: f64,
    rel: f64,
    makeup: f64,
    mix: f64,
    red: f64,
    /// Caractère : 0 Propre, 1 Opto, 2 FET, 3 Bus
    mode: u8,
    rms_c: f64,
    slow_c: f64,
    rel_slow: f64,
    dc_c: f64,
    env2: f64,
    slow: f64,
    dc: [f64; 2],
    auto_rel: bool,
    /// Propre : maintien des crêtes du détecteur (12 ms) — le gain ne suit plus chaque arche d'une basse
    /// (3e harmonique à 60 Hz : −18 / −36 dB → sous −97 dB). Même calcul que le worklet `pulse-comp`.
    hold_n: u32,
    hold_dec: f64,
    penv: f64,
    hcnt: u32,
}

impl Compressor {
    /// Change les réglages sans remettre le compresseur à zéro (pas de clic quand on tourne un bouton dans un plugin)
    pub fn retune(&mut self, p: &CompParams, sr: f64) {
        let mut n = Self::new(p, sr);
        n.red = self.red;
        n.env2 = self.env2;
        n.slow = self.slow;
        n.dc = self.dc;
        n.penv = self.penv;
        n.hcnt = self.hcnt;
        *self = n;
    }
    /// Réduction de gain en cours, en dB (pour l'aiguille)
    pub fn reduction_db(&self) -> f64 {
        self.red
    }
    pub fn new(p: &CompParams, sr: f64) -> Self {
        let thr = p.threshold.unwrap_or(-22.0);
        let slope = 1.0 - 1.0 / p.ratio.unwrap_or(3.0).max(1.0);
        let makeup_db = p.makeup.unwrap_or(-thr * slope * 0.35);
        let mode = p.mode.unwrap_or(0.0).round().clamp(0.0, 3.0) as u8;
        let coef = |sec: f64| 1.0 - (-1.0 / (sec * sr)).exp();
        // Bus, relâchement Auto : 0,1 s sur les pointes, jusqu'à 1,2 s quand la compression dure
        let auto_rel = mode == 3 && p.auto_rel.unwrap_or(0.0) > 0.0;
        let attack_s = if mode == 2 { (p.attack.unwrap_or(10.0) / 4000.0).max(0.00005) } else { (p.attack.unwrap_or(10.0) / 1000.0).max(0.0001) };
        Self {
            thr,
            slope,
            knee: p.knee.unwrap_or(10.0).max(0.0),
            att: coef(attack_s),
            rel: if auto_rel { coef(0.1) } else { 1.0 - (-1.0 / ((p.release.unwrap_or(50.0) / 1000.0).max(0.005) * sr)).exp() },
            makeup: 10f64.powf(makeup_db / 20.0),
            mix: (p.mix.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0),
            red: 0.0,
            mode,
            rms_c: coef(0.005),
            slow_c: coef(1.0),
            rel_slow: if auto_rel { coef(1.2) } else { coef((p.release.unwrap_or(50.0) / 1000.0).max(0.005) * 4.0) },
            dc_c: coef(0.05),
            env2: 0.0,
            slow: 0.0,
            dc: [0.0; 2],
            auto_rel,
            hold_n: if mode == 0 { (0.012 * sr).round() as u32 } else { 0 },
            hold_dec: (-1.0 / (0.002 * sr)).exp(),
            penv: 0.0,
            hcnt: 0,
        }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let m = self.mode;
        let pk = x[..nc].iter().fold(0.0f64, |m, v| m.max(v.abs()));
        let mut lvl = pk;
        if self.hold_n > 0 {
            if pk >= self.penv { self.penv = pk; self.hcnt = self.hold_n; }
            else if self.hcnt > 0 { self.hcnt -= 1; }
            else { self.penv *= self.hold_dec; }
            lvl = self.penv;
        }
        if m == 1 || m == 3 {
            self.env2 += (pk * pk - self.env2) * self.rms_c;
            lvl = self.env2.sqrt() * std::f64::consts::SQRT_2;
        }
        let half = self.knee / 2.0;
        let mut want = 0.0;
        if lvl > 1e-5 {
            let over = 20.0 * lvl.log10() - self.thr;
            if over >= half {
                want = over * self.slope;
            } else if over > -half {
                want = self.slope * (over + half) * (over + half) / (2.0 * self.knee);
            }
        }
        let mut rc = self.rel;
        if m == 1 || self.auto_rel {
            self.slow += ((if self.red > 3.0 { 1.0 } else { 0.0 }) - self.slow) * self.slow_c;
            rc = self.rel + (self.rel_slow - self.rel) * self.slow;
        }
        self.red += (want - self.red) * if want > self.red { self.att } else { rc };
        let gr = 10f64.powf(-self.red / 20.0) * self.makeup;
        let h3 = if m == 2 { 0.15 + 0.02 * self.red.min(15.0) } else { 0.04 };
        for (ch, v) in x[..nc].iter_mut().enumerate() {
            let mut w = *v * gr;
            if m == 1 {
                // Chaleur de lampe : harmonique 2 (paire), sans décaler le zéro
                let e = 0.12 * w * w / (1.0 + w * w);
                self.dc[ch] += (e - self.dc[ch]) * self.dc_c;
                w += e - self.dc[ch];
            } else if m >= 2 {
                // FET / Bus : harmonique 3 (impaire), plus forte quand le FET compresse fort
                w -= h3 * w * w * w / (1.0 + w * w);
            }
            *v = (1.0 - self.mix) * *v + self.mix * w;
        }
    }
}

/// Écho : même calcul que le worklet `pulse-delay` de audio.js.
/// Ducking (écho, reverb) : même calcul que `Ducker` dans audio.js — suiveur 10 ms / 100 ms, de rien à -30 dBFS à plein effet à -10 dBFS.
#[derive(Clone)]
struct Ducker { amt: f64, env: f64, att: f64, rel: f64 }
impl Ducker {
    fn new(amount: Option<f64>, sr: f64) -> Self {
        Self { amt: (amount.unwrap_or(0.0) / 100.0).clamp(0.0, 1.0), env: 0.0, att: (-1.0 / (0.01 * sr)).exp(), rel: (-1.0 / (0.1 * sr)).exp() }
    }
    #[inline]
    fn gain(&mut self, x: f64) -> f64 {
        let d = x.abs();
        let k = if d > self.env { self.att } else { self.rel };
        self.env = k * self.env + (1.0 - k) * d;
        if self.amt <= 0.0 { return 1.0; }
        let a = ((20.0 * (self.env + 1e-9).log10() + 30.0) / 20.0).clamp(0.0, 1.0);
        1.0 - self.amt * a
    }
}

pub struct Delay {
    duck: Ducker,
    kh: f64,
    zh: [f64; 2],
    buf: [Vec<f64>; 2],
    lp: [f64; 2],
    i: usize,
    fb: f64,
    wet: f64,
    dry: f64,
    k: f64,
    pp: bool,
    /// EQ des répétitions (un jeu de filtres par côté)
    eq: [Vec<Biquad>; 2],
}

impl Delay {
    /// Plugin : change les réglages en gardant les échos en cours (la mémoire est recopiée si le temps change)
    pub fn retune(&mut self, p: &DelayParams, sr: f64, bpm: f64) {
        let mut n = Self::new(p, sr, bpm);
        let (old, new) = (self.buf[0].len(), n.buf[0].len());
        for ch in 0..2 {
            for k in 0..old.min(new) {
                // on garde les échantillons les plus récents, dans l'ordre
                let src = (self.i + old - 1 - k) % old;
                let dst = (new - 1 - k) % new;
                n.buf[ch][dst] = self.buf[ch][src];
            }
        }
        n.lp = self.lp;
        n.i = 0;
        if n.eq[0].len() == self.eq[0].len() {
            for ch in 0..2 { for (j, b) in n.eq[ch].iter_mut().enumerate() { let mut e = self.eq[ch][j]; e.retune(*b); *b = e; } }
        }
        *self = n;
    }
    pub fn new(p: &DelayParams, sr: f64, bpm: f64) -> Self {
        let time = match p.ms.filter(|m| *m > 0.0) {
            Some(ms) => ms / 1000.0,
            None => 60.0 / if bpm > 0.0 { bpm } else { 90.0 } * p.beats.filter(|b| *b > 0.0).unwrap_or(0.5),
        };
        let d = ((time * sr).round() as usize).clamp(1, (4.0 * sr) as usize);
        let eq: Vec<Biquad> = p.eq.as_deref().unwrap_or(&[]).iter().filter(|b| b.on != Some(false)).flat_map(|b| eq_sections(b, sr)).collect();
        Self {
            duck: Ducker::new(p.duck, sr),
            kh: p.hpf.filter(|h| *h > 20.0).map_or(0.0, |h| (-2.0 * PI * h / sr).exp()),
            zh: [0.0; 2],
            buf: [vec![0.0; d], vec![0.0; d]],
            lp: [0.0; 2],
            i: 0,
            fb: (p.feedback.unwrap_or(35.0) / 100.0).clamp(0.0, 0.9),
            wet: (p.wet.unwrap_or(25.0) / 100.0).clamp(0.0, 1.0),
            dry: (p.dry.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0),
            k: (-2.0 * PI * p.lpf.filter(|l| *l > 0.0).map_or(4000.0, |l| l.min(20_000.0)) / sr).exp(),
            pp: p.pp.unwrap_or(0.0) >= 0.5,
            eq: [eq.clone(), eq],
        }
    }
    #[inline]
    fn eqw(&mut self, ch: usize, mut v: f64) -> f64 {
        for b in &mut self.eq[ch] { v = b.tick(v); }
        v
    }
    #[inline]
    fn hp(&mut self, ch: usize, x: f64) -> f64 {
        if self.kh == 0.0 { return x; }
        self.zh[ch] = x + (self.zh[ch] - x) * self.kh;
        x - self.zh[ch]
    }
    /// Renvoie le nombre de canaux en sortie (le ping-pong rend toujours du stéréo).
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) -> usize {
        if self.pp {
            // Même calcul que le worklet `pulse-delay` : la voix part à gauche, rebondit à droite, et ainsi de suite
            let (inl, inr) = (x[0], if nc > 1 { x[1] } else { x[0] });
            let (dl, dr) = (self.buf[0][self.i], self.buf[1][self.i]);
            let g = self.wet * self.duck.gain(0.5 * (inl + inr));
            self.lp[0] = dl + (self.lp[0] - dl) * self.k;
            self.lp[1] = dr + (self.lp[1] - dr) * self.k;
            let feed = self.hp(0, 0.5 * (inl + inr));
            self.buf[0][self.i] = feed + self.lp[1] * self.fb;
            self.buf[1][self.i] = self.lp[0] * self.fb;
            x[0] = inl * self.dry + self.eqw(0, dl) * g;
            x[1] = inr * self.dry + self.eqw(1, dr) * g;
            self.i = (self.i + 1) % self.buf[0].len();
            return 2;
        }
        let m = x[..nc].iter().sum::<f64>() / nc as f64;
        let g = self.wet * self.duck.gain(m);
        for ch in 0..nc {
            let d = self.buf[ch][self.i];
            self.lp[ch] = d + (self.lp[ch] - d) * self.k;
            let feed = self.hp(ch, x[ch]);
            self.buf[ch][self.i] = feed + self.lp[ch] * self.fb;
            x[ch] = x[ch] * self.dry + self.eqw(ch, d) * g;
        }
        self.i = (self.i + 1) % self.buf[0].len();
        nc
    }
}

/// Pitch −/+ : même calcul que le worklet `pulse-pitch` de audio.js
/// (deux têtes de lecture dans une mémoire de 50 ms, fondu croisé sin²).
pub struct Pitch {
    buf: [Vec<f64>; 2],
    w: f64,
    i: usize,
    ph: f64,
    step: f64,
    mix: f64,
}

impl Pitch {
    /// Plugin : nouveaux réglages, même mémoire (pas de trou dans le son)
    pub fn retune(&mut self, p: &PitchParams, sr: f64) {
        let n = Self::new(p, sr);
        self.step = n.step;
        self.mix = n.mix;
    }
    pub fn new(p: &PitchParams, sr: f64) -> Self {
        let semi = p.semi.unwrap_or(0.0).clamp(-12.0, 12.0);
        let w = (0.05 * sr).round();
        let len = w as usize * 2 + 8;
        Self {
            buf: [vec![0.0; len], vec![0.0; len]],
            w,
            i: 0,
            ph: 0.0,
            step: (1.0 - 2f64.powf(semi / 12.0)) / w,
            mix: (p.mix.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0),
        }
    }
    fn read(b: &[f64], i: usize, d: f64) -> f64 {
        let l = b.len() as f64;
        let mut pos = i as f64 - d - 1.0;
        while pos < 0.0 {
            pos += l;
        }
        let i0 = pos.floor() as usize;
        let f = pos - i0 as f64;
        let i1 = (i0 + 1) % b.len();
        b[i0] + (b[i1] - b[i0]) * f
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let p1 = self.ph;
        let p2 = (p1 + 0.5) % 1.0;
        let g1 = (PI * p1).sin().powi(2);
        let g2 = (PI * p2).sin().powi(2);
        for ch in 0..nc {
            self.buf[ch][self.i] = x[ch];
            let wet = Self::read(&self.buf[ch], self.i, p1 * self.w) * g1 + Self::read(&self.buf[ch], self.i, p2 * self.w) * g2;
            x[ch] = x[ch] * (1.0 - self.mix) + wet * self.mix;
        }
        self.ph += self.step;
        self.ph -= self.ph.floor();
        self.i = (self.i + 1) % self.buf[0].len();
    }
}

/// Ligne à retard en boucle (un écho ou un diffuseur de la reverb).
#[derive(Clone)]
struct Line {
    buf: Vec<f64>,
    i: usize,
    store: f64,
}

impl Line {
    fn new(len_44k: usize, sr: f64) -> Self {
        Self { buf: vec![0.0; ((len_44k as f64 * sr / 44_100.0).round() as usize).max(1)], i: 0, store: 0.0 }
    }
}

/// Reverb : même calcul que le worklet `pulse-reverb` de audio.js (schéma Freeverb, sans hasard).
pub struct Reverb {
    duck: Ducker,
    kl: f64,
    zl: f64,
    kh: f64,
    zh: f64,
    wet: f64,
    /// Gain de sortie de l'effet (linéaire)
    out: f64,
    fb: f64,
    damp: f64,
    /// Largeur de la queue (1 = normal)
    width: f64,
    /// EQ de la reverb (sur l'effet seulement), un jeu de filtres par côté
    eq: [Vec<Biquad>; 2],
    comb: [Vec<Line>; 2],
    ap: [Vec<Line>; 2],
    /// Pré-délai (vide = aucun)
    pre: Vec<f64>,
    pi: usize,
}

impl Reverb {
    /// Plugin : nouvelle quantité / taille, la queue de reverb continue
    pub fn retune(&mut self, p: &ReverbParams, sr: f64) {
        let n = Self::new(p, sr);
        self.wet = n.wet;
        self.out = n.out;
        self.fb = n.fb;
        self.damp = n.damp;
        self.width = n.width;
        if n.eq[0].len() == self.eq[0].len() {
            for ch in 0..2 { for (a, b) in self.eq[ch].iter_mut().zip(n.eq[ch].iter()) { a.retune(*b); } }
        } else { self.eq = n.eq; }
    }
    pub fn new(p: &ReverbParams, sr: f64) -> Self {
        const COMB: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
        const AP: [usize; 4] = [556, 441, 341, 225];
        let lines = |t: &[usize], spread: usize| t.iter().map(|n| Line::new(n + spread, sr)).collect::<Vec<_>>();
        let pre = ((p.pre.unwrap_or(0.0) / 1000.0).clamp(0.0, 0.5) * sr).round() as usize;
        let eq: Vec<Biquad> = p.eq.as_deref().unwrap_or(&[]).iter().filter(|b| b.on != Some(false)).flat_map(|b| eq_sections(b, sr)).collect();
        Self {
            duck: Ducker::new(p.duck, sr),
            kl: p.low.filter(|l| *l > 20.0).map_or(0.0, |l| (-2.0 * PI * l / sr).exp()),
            zl: 0.0,
            kh: p.high.filter(|h| *h > 0.0 && *h < 20_000.0).map_or(0.0, |h| (-2.0 * PI * h / sr).exp()),
            zh: 0.0,
            wet: (p.wet.unwrap_or(18.0) / 100.0).clamp(0.0, 1.0),
            out: 10f64.powf(p.out.unwrap_or(0.0) / 20.0),
            fb: (0.72 + 0.2 * ((p.size.unwrap_or(1.8) - 1.2) / 2.0).clamp(0.0, 1.0) + (p.decay.unwrap_or(2.5) - 2.5) * 0.025).clamp(0.5, 0.97),
            damp: p.bright.map_or(0.35, |b| (0.35 + (50.0 - b) / 50.0 * 0.3).clamp(0.02, 0.7)),
            width: p.width.map_or(1.0, |w| w.clamp(0.0, 150.0) / 100.0),
            eq: [eq.clone(), eq],
            comb: [lines(&COMB, 0), lines(&COMB, 23)],
            ap: [lines(&AP, 0), lines(&AP, 23)],
            pre: vec![0.0; pre],
            pi: 0,
        }
    }
    /// Entrée mono (`nc` = 1) ou stéréo ; la sortie est toujours stéréo.
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let mono = nc < 2;
        let scale = if mono { std::f64::consts::FRAC_1_SQRT_2 } else { 1.0 };
        let (dry, wet) = ((1.0 - self.wet) * scale, self.wet * 3.0 * self.out * scale);
        let (xl, xr) = (x[0], if mono { x[0] } else { x[1] });
        let mut input = (xl + xr) * 0.015;
        let dg = self.duck.gain((xl + xr) * 0.5);
        if self.kl != 0.0 { self.zl = input + (self.zl - input) * self.kl; input -= self.zl; }
        if self.kh != 0.0 { self.zh = input + (self.zh - input) * self.kh; input = self.zh; }
        if !self.pre.is_empty() {
            input = std::mem::replace(&mut self.pre[self.pi], input);
            self.pi = (self.pi + 1) % self.pre.len();
        }
        let mut w2 = [0.0; 2];
        for ch in 0..2 {
            let mut acc = 0.0;
            for f in &mut self.comb[ch] {
                let y = f.buf[f.i];
                f.store = y * (1.0 - self.damp) + f.store * self.damp;
                f.buf[f.i] = input + f.store * self.fb;
                f.i = (f.i + 1) % f.buf.len();
                acc += y;
            }
            for f in &mut self.ap[ch] {
                let y = f.buf[f.i];
                f.buf[f.i] = acc + y * 0.5;
                f.i = (f.i + 1) % f.buf.len();
                acc = y - acc;
            }
            for b in &mut self.eq[ch] { acc = b.tick(acc); }
            w2[ch] = acc;
        }
        if self.width != 1.0 {
            let (m, s) = ((w2[0] + w2[1]) * 0.5, (w2[0] - w2[1]) * 0.5 * self.width);
            w2 = [m + s, m - s];
        }
        x[0] = xl * dry + w2[0] * wet * dg;
        x[1] = xr * dry + w2[1] * wet * dg;
    }
}

/// Saturation : (k, compensation de volume) pour une chaleur de 0 à 100 (aucune si 0)
pub fn sat_coeffs(drive: f64) -> Option<(f64, f64)> {
    (drive > 0.0).then(|| {
        let k = 1.0 + drive * 0.05;
        (k, 1.0 / (k / k.tanh()).sqrt())
    })
}
/// Filtre de suréchantillonnage ×4 : 64 coefficients, sinus cardinal fenêtré (Blackman), coupure à 0,1125 de la cadence ×4
/// (≈ 21,6 kHz à 48 kHz). Même filtre que `satFir` dans audio.js. Parasites d'une saturation poussée : −22 dB → −99 dB.
pub fn sat_fir() -> [f64; 64] {
    let mut h = [0.0; 64];
    let fc = 0.1125;
    for (i, v) in h.iter_mut().enumerate() {
        let m = i as f64 - 31.5;
        let x = 2.0 * fc * m;
        let sinc = if x.abs() < 1e-12 { 1.0 } else { (PI * x).sin() / (PI * x) };
        let w = 0.42 - 0.5 * (2.0 * PI * i as f64 / 63.0).cos() + 0.08 * (4.0 * PI * i as f64 / 63.0).cos();
        *v = 2.0 * fc * sinc * w;
    }
    let s: f64 = h.iter().sum();
    for v in h.iter_mut() { *v /= s; }
    h
}
/// Saturation suréchantillonnée ×4 (même calcul que le worklet `pulse-sat`) : la courbe tanh est calculée 4 fois plus vite,
/// puis on revient à la cadence normale à travers le même filtre. Retard : ~16 échantillons.
pub struct Saturator {
    k: f64,
    trim: f64,
    h: [f64; 64],
    xin: [[f64; 16]; 2],
    xs: [[f64; 64]; 2],
    pos: [usize; 2],
}
impl Saturator {
    pub fn new(drive: f64) -> Option<Self> {
        sat_coeffs(drive).map(|(k, trim)| Self { k, trim, h: sat_fir(), xin: [[0.0; 16]; 2], xs: [[0.0; 64]; 2], pos: [0; 2] })
    }
    #[inline]
    pub fn tick(&mut self, v: f64, ch: usize) -> f64 {
        let xin = &mut self.xin[ch];
        xin.copy_within(0..15, 1);
        xin[0] = v;
        let (h, k, tk) = (&self.h, self.k, self.k.tanh());
        let xs = &mut self.xs[ch];
        for p in 0..4 {
            let mut u = 0.0;
            for j in 0..16 { u += h[p + 4 * j] * xin[j]; }
            let y = (k * (4.0 * u).clamp(-1.0, 1.0)).tanh() / tk;
            self.pos[ch] = (self.pos[ch] + 1) % 64;
            xs[self.pos[ch]] = y;
        }
        let (mut out, mut idx) = (0.0, self.pos[ch]);
        for hi in h.iter() { out += hi * xs[idx]; idx = (idx + 63) % 64; }
        out * self.trim
    }
}
/// Un échantillon saturé, sans suréchantillonnage (plugin AU de saturation, gardé tel quel)
pub fn sat_tick(v: f64, k: f64, trim: f64) -> f64 {
    (k * v.clamp(-1.0, 1.0)).tanh() / k.tanh() * trim
}

/// Chaîne d'une piste : EQ → saturation → de-esser → compresseur → écho → reverb, les deux canaux liés.
pub struct Chain {
    /// Filtre (coupe-bas / coupe-haut), avant l'EQ
    cut: Vec<[Biquad; 2]>,
    filters: Vec<[Biquad; 2]>,
    /// Points dynamiques de l'EQ (après les points fixes et la sortie)
    dyn_eq: Vec<DynBand>,
    /// Saturation : (k, compensation de volume)
    sat: Option<Saturator>,
    gate: Option<Gate>,
    crush: Option<Crush>,
    util: Option<Util>,
    width: Option<Util>,
    modfx: Vec<(Stage, ModFx)>,
    deess: Option<Deesser>,
    deess2: Option<DeesserV2>,
    comp: Option<Compressor>,
    master: Option<Master>,
    limit: Option<Limiter>,
    delay: Option<Delay>,
    reverb: Option<Reverb>,
    pitch: Option<Pitch>,
    order: Vec<Stage>,
    /// Automation des réglages d'effet (même liste de réglages que le navigateur, voir AUTO_FX dans studio.js)
    auto: Vec<AutoParam>,
    auto_from: f64,
    sr: f64,
    comp_p: CompParams,
    /// Bandes de l'EQ libre et filtre de la chaîne pour chacune (None = bande ignorée)
    eq_bands: Vec<(EqBand, Option<(usize, usize)>)>,
    /// Filtre coupe-bas / coupe-haut : (coupe-bas ?, Q en dB) pour chaque cellule de `cut`
    cut_kinds: Vec<(bool, f64)>,
    names: Vec<String>,
    deess_freq: f64,
}

/// Un réglage d'effet automatisé : sa courbe (0..1) et sa plage
struct AutoParam {
    fx: String,
    key: String,
    curve: Curve,
    min: f64,
    max: f64,
    log: bool,
}

/// Plages des réglages automatisables (mêmes que FX_PANEL_DEFS dans studio.js)
fn auto_range(fx: &str, key: &str) -> Option<(f64, f64, bool)> {
    Some(match (fx, key) {
        ("comp", "threshold") => (-40.0, 0.0, false),
        ("comp", "ratio") => (1.0, 20.0, false),
        ("comp", "mix") => (0.0, 100.0, false),
        ("comp", "attack") => (0.1, 100.0, true),
        ("comp", "release") => (10.0, 1200.0, true),
        ("comp", "knee") => (0.0, 24.0, false),
        ("comp", "makeup") => (-12.0, 24.0, false),
        ("delay", "wet") | ("delay", "dry") | ("reverb", "wet") => (0.0, 100.0, false),
        ("delay", "feedback") => (0.0, 85.0, false),
        ("util", "gain") => (-24.0, 24.0, false),
        ("width", "width") => (0.0, 200.0, false),
        ("filter", "hpf") => (20.0, 1000.0, true),
        ("filter", "lpf") => (1000.0, 20_000.0, true),
        ("deess", "amount") => (0.0, 100.0, false),
        ("gate", "threshold") => (-70.0, -20.0, false),
        ("gate", "release") => (20.0, 500.0, false),
        ("gate", "reduction") => (6.0, 80.0, false),
        ("crush", "bits") => (4.0, 16.0, false),
        ("crush", "down") => (1.0, 32.0, false),
        ("crush", "mix") | ("pitch", "mix") => (0.0, 100.0, false),
        ("pitch", "semi") => (-12.0, 12.0, false),
        ("tremolo", "rate") => (0.5, 15.0, false),
        ("tremolo", "depth") | ("phaser", "depth") => (0.0, 100.0, false),
        ("phaser", "rate") => (0.05, 3.0, false),
        ("phaser", "feedback") | ("flanger", "feedback") => (0.0, 90.0, false),
        ("flanger", "rate") => (0.05, 2.0, false),
        ("flanger", "depth") => (0.5, 5.0, false),
        ("chorus", "rate") => (0.1, 3.0, false),
        ("chorus", "depth") => (1.0, 10.0, false),
        ("doubler", "width") => (0.0, 100.0, false),
        ("slapback", "time") => (30.0, 300.0, false),
        ("slapback", "feedback") => (0.0, 50.0, false),
        ("phaser", "mix") | ("flanger", "mix") | ("chorus", "mix") | ("doubler", "mix") | ("slapback", "mix") => (0.0, 100.0, false),
        ("eq", k) if k.ends_with("-freq") => (20.0, 20_000.0, true),
        ("eq", k) if k.ends_with("-gain") => (-18.0, 18.0, false),
        _ => return None,
    })
}

/// Un point dynamique de l'EQ : il écoute sa zone (passe-bande) et ne bouge que quand elle dépasse le seuil.
/// Même calcul que le worklet `pulse-dyneq` de audio.js : gain = gain + plage × min(1, dépassement / 12 dB),
/// suiveur 5 ms / 80 ms, filtres recalculés tous les 32 échantillons.
pub fn eq_is_dynamic(bd: &EqBand) -> bool {
    bd.dyn_range.is_some_and(|d| d != 0.0) && matches!(bd.kind.as_str(), "bell" | "lowshelf" | "highshelf" | "tilt")
}
struct DynBand {
    bd: EqBand,
    sr: f64,
    det: Biquad,
    env: f64,
    att: f64,
    rel: f64,
    secs: Vec<[Biquad; 2]>,
    cnt: usize,
}
impl DynBand {
    fn new(bd: &EqBand, sr: f64) -> Self {
        let q = if bd.kind == "bell" && bd.q > 0.0 { bd.q } else { 0.7 };
        let secs = eq_sections(bd, sr).into_iter().map(|b| [b.clone(), b]).collect();
        Self { bd: bd.clone(), sr, det: Biquad::bandpass(sr, bd.freq.clamp(20.0, 20_000.0), q), env: 0.0,
            att: (-1.0 / (0.005 * sr)).exp(), rel: (-1.0 / (0.08 * sr)).exp(), secs, cnt: 0 }
    }
    fn gain_now(&self) -> f64 {
        let over = (20.0 * (self.env + 1e-9).log10() - self.bd.thr.unwrap_or(-30.0)).max(0.0);
        self.bd.gain + self.bd.dyn_range.unwrap_or(0.0) * (over / 12.0).min(1.0)
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        if self.cnt % 32 == 0 {
            let bd = EqBand { gain: self.gain_now(), ..self.bd.clone() };
            for (j, b) in eq_sections(&bd, self.sr).into_iter().enumerate() {
                for ch in 0..2 { self.secs[j][ch].retune(b.clone()); }
            }
        }
        self.cnt += 1;
        let m = if nc == 2 { (x[0] + x[1]) * 0.5 } else { x[0] };
        let d = self.det.tick(m).abs();
        let k = if d > self.env { self.att } else { self.rel };
        self.env = k * self.env + (1.0 - k) * d;
        for ch in 0..nc {
            for s in &mut self.secs { x[ch] = s[ch].tick(x[ch]); }
        }
    }
}

/// Filtres d'une bande d'EQ (mêmes calculs que `eqSections` dans audio.js).
/// EQ « calé sur l'analogique » (filtres matched, M. Vicanek 2016) : même calcul que `eqMatched` dans audio.js.
/// `kind` : peaking, lowshelf, highshelf, highpass, lowpass, notch ; `q` linéaire.
pub fn eq_matched(kind: &str, f0: f64, q: f64, g: f64, sr: f64) -> Biquad {
    let f = f0.clamp(10.0, sr * 0.499);
    let poles = |w: f64, qq: f64| {
        let z = 1.0 / (2.0 * qq);
        let a1 = if z <= 1.0 { -2.0 * (-z * w).exp() * ((1.0 - z * z).sqrt() * w).cos() } else { -2.0 * (-z * w).exp() * ((z * z - 1.0).sqrt() * w).cosh() };
        (a1, (-2.0 * z * w).exp())
    };
    let ph = |fr: f64| { let p1 = (PI * fr / sr).sin().powi(2); (1.0 - p1, p1, 4.0 * (1.0 - p1) * p1) };
    let from_b = |b0_: f64, b1_: f64, b2_: f64, a1: f64, a2: f64| {
        let (s0, s1) = (b0_.max(0.0).sqrt(), b1_.max(0.0).sqrt());
        let w = 0.5 * (s0 + s1);
        let b0 = 0.5 * (w + (w * w + b2_).max(0.0).sqrt());
        [b0, 0.5 * (s0 - s1), -b2_ / (4.0 * b0), a1, a2]
    };
    let w0 = 2.0 * PI * f / sr;
    let k: [f64; 5] = match kind {
        "peaking" | "bell" => {
            let a = 10f64.powf(g / 40.0);
            let gg = a * a;
            let (a1, a2) = poles(w0, a * q);
            let (p0, p1, p2) = ph(f);
            let (aa0, aa1, aa2) = ((1.0 + a1 + a2).powi(2), (1.0 - a1 + a2).powi(2), -4.0 * a2);
            let r1 = (aa0 * p0 + aa1 * p1 + aa2 * p2) * gg * gg;
            let r2 = (-aa0 + aa1 + 4.0 * (p0 - p1) * aa2) * gg * gg;
            let bb0 = aa0;
            let bb2 = (r1 - r2 * p1 - bb0) / (4.0 * p1 * p1);
            let bb1 = r2 + bb0 + 4.0 * (p1 - p0) * bb2;
            from_b(bb0, bb1, bb2, a1, a2)
        }
        "lowpass" | "highpass" => {
            let (a1, a2) = poles(w0, q);
            let (p0, p1, p2) = ph(f);
            let (aa0, aa1, aa2) = ((1.0 + a1 + a2).powi(2), (1.0 - a1 + a2).powi(2), -4.0 * a2);
            if kind == "highpass" {
                let b0 = (aa0 * p0 + aa1 * p1 + aa2 * p2).max(0.0).sqrt() * q / (4.0 * p1);
                [b0, -2.0 * b0, b0, a1, a2]
            } else {
                let bb1 = ((aa0 * p0 + aa1 * p1 + aa2 * p2) * q * q - aa0 * p0) / p1;
                let b0 = 0.5 * (aa0.sqrt() + bb1.max(0.0).sqrt());
                [b0, aa0.sqrt() - b0, 0.0, a1, a2]
            }
        }
        "notch" => {
            let (a1, a2) = poles(w0, q);
            let c = w0.cos();
            let k = (1.0 + a1 + a2) / (2.0 - 2.0 * c);
            [k, -2.0 * c * k, k, a1, a2]
        }
        _ => {
            // Plateaux : on calcule la forme dont les pôles restent sous la fréquence, puis on l'inverse si besoin
            let ls = kind == "lowshelf";
            let inv = (ls && g < 0.0) || (!ls && g > 0.0);
            let gd = if inv { -g } else { g };
            let a = 10f64.powf(gd / 40.0);
            let (qq, sa) = (std::f64::consts::FRAC_1_SQRT_2, a.sqrt());
            let h2 = |fr: f64| {
                let w = fr.max(1e-6) / f;
                let (re, im) = (-w * w, w * sa / qq);
                let (nr, ni, dr, di) = if ls { (a * (re + a), a * im, a * re + 1.0, im) } else { (a * (a * re + 1.0), a * im, re + a, im) };
                (nr * nr + ni * ni) / (dr * dr + di * di)
            };
            let (a1, a2) = poles(2.0 * PI * (if ls { f / sa } else { f * sa }) / sr, qq);
            let (p0, p1, p2) = ph(f);
            let (aa0, aa1, aa2) = ((1.0 + a1 + a2).powi(2), (1.0 - a1 + a2).powi(2), -4.0 * a2);
            let bb0 = aa0 * h2(0.0);
            let bb1 = aa1 * h2(sr / 2.0);
            let bb2 = (h2(f) * (aa0 * p0 + aa1 * p1 + aa2 * p2) - bb0 * p0 - bb1 * p1) / p2;
            let c = from_b(bb0, bb1, bb2, a1, a2);
            if inv { [1.0 / c[0], a1 / c[0], a2 / c[0], c[1] / c[0], c[2] / c[0]] } else { c }
        }
    };
    Biquad::new(k[0], k[1], k[2], 1.0, k[3], k[4])
}

/// Filtres d'une bande d'EQ (mêmes calculs que `eqBandCoefs` dans audio.js).
fn eq_sections(bd: &EqBand, sr: f64) -> Vec<Biquad> {
    let freq = bd.freq.clamp(20.0, 20_000.0);
    let q = if bd.q > 0.0 { bd.q } else { 1.0 };
    match bd.kind.as_str() {
        "hpf" | "lpf" => {
            let kind = if bd.kind == "hpf" { "highpass" } else { "lowpass" };
            let n = ((bd.slope.unwrap_or(12.0) / 12.0).round() as usize).clamp(1, 4);
            let qs: Vec<f64> = if n == 1 { vec![q] } else {
                (0..n).map(|k| {
                    let qk = 1.0 / (2.0 * ((2 * k + 1) as f64 * PI / (4 * n) as f64).cos());
                    if k == n - 1 { qk * q / std::f64::consts::FRAC_1_SQRT_2 } else { qk }
                }).collect()
            };
            qs.into_iter().map(|qk| eq_matched(kind, freq, qk, 0.0, sr)).collect()
        }
        "lowshelf" | "highshelf" => vec![eq_matched(&bd.kind, freq, std::f64::consts::FRAC_1_SQRT_2, bd.gain, sr)],
        "notch" => vec![eq_matched("notch", freq, q, 0.0, sr)],
        "tilt" => vec![eq_matched("lowshelf", freq, std::f64::consts::FRAC_1_SQRT_2, -bd.gain / 2.0, sr), eq_matched("highshelf", freq, std::f64::consts::FRAC_1_SQRT_2, bd.gain / 2.0, sr)],
        _ => vec![eq_matched("peaking", freq, q, bd.gain, sr)],
    }
}

/// Ancienne chaîne fixe (projets d'avant l'EQ libre) = 4 points, comme `legacyEqBands` dans audio.js
fn legacy_eq_bands(p: &crate::model::EqParams) -> Vec<EqBand> {
    let b = |kind: &str, freq: f64, gain: f64, q: f64| EqBand { kind: kind.into(), freq, gain, q, ..Default::default() };
    let mut out = vec![b("hpf", p.hpf.unwrap_or(80.0), 0.0, 1.0839), b("bell", 300.0, p.mid_gain.unwrap_or(-2.0), 1.0),
        b("bell", 4000.0, p.presence.unwrap_or(2.0), 0.7), b("highshelf", 10_000.0, p.air.unwrap_or(1.0), 0.7)];
    if let Some(l) = p.lpf.filter(|f| *f > 0.0) { out.push(b("lpf", l, 0.0, 1.0839)); }
    out
}

impl Chain {
    pub fn for_track(track: &Track, sr: f64, bpm: f64) -> Self {
        Self::new(&track.effects, &track.effect_params, sr, bpm, -0.3).with_order(&track.fx_order)
    }
    /// `bpm` : tempo du projet (échos calés sur le rythme). `ceiling_db` : plafond du projet (limiteur de bus).
    pub fn new(effects: &[String], effect_params: &EffectParams, sr: f64, bpm: f64, ceiling_db: f64) -> Self {
        let has = |name: &str| effects.iter().any(|e| e == name);
        let mut cut = Vec::new();
        let mut cut_kinds = Vec::new();
        let mut eq_bands = Vec::new();
        let mut dyn_eq = Vec::new();
        if has("filter") {
            // Butterworth : une cellule (Q 0,7071) à 12 dB / octave, deux (Q 0,5412 puis 1,3066) à 24 dB
            let p = effect_params.filter.clone().unwrap_or_default();
            let (hpf, lpf) = (p.hpf.unwrap_or(80.0), p.lpf.unwrap_or(20_000.0));
            let qs: &[f64] = if p.slope == Some(24.0) { &[0.5412, 1.3066] } else { &[std::f64::consts::FRAC_1_SQRT_2] };
            if hpf > 20.0 {
                for q in qs { let b = Biquad::highpass(sr, hpf.min(20_000.0), 20.0 * q.log10()); cut.push([b.clone(), b]); cut_kinds.push((true, 20.0 * q.log10())); }
            }
            if lpf < 20_000.0 {
                for q in qs { let b = Biquad::lowpass(sr, lpf.max(20.0), 20.0 * q.log10()); cut.push([b.clone(), b]); cut_kinds.push((false, 20.0 * q.log10())); }
            }
        }
        let mut filters = Vec::new();
        let mut push = |b: Biquad| filters.push([b.clone(), b]);
        if has("eq") {
            let p = effect_params.eq.clone().unwrap_or_default();
            let legacy;
            let bands = match p.bands.as_ref() { Some(b) => b, None => { legacy = legacy_eq_bands(&p); &legacy } };
            {
                // EQ libre : mêmes bandes que le navigateur (24 au plus, Q linéaire, dB pour les coupes)
                let mut k = 0;
                for bd in bands.iter().take(24) {
                    if bd.on != Some(false) && bd.freq > 0.0 && eq_is_dynamic(bd) {
                        dyn_eq.push(DynBand::new(bd, sr));
                        eq_bands.push((bd.clone(), None));
                    } else if bd.on != Some(false) && bd.freq > 0.0 {
                        let secs = eq_sections(bd, sr);
                        let n = secs.len();
                        for b in secs { push(b); }
                        eq_bands.push((bd.clone(), Some((k, n))));
                        k += n;
                    } else {
                        eq_bands.push((bd.clone(), None));
                    }
                }
                if let Some(out) = p.out.filter(|o| *o != 0.0) { push(Biquad::gain(out)); }
            }
        }
        let drive = if has("sat") { effect_params.sat.as_ref().map_or(0.0, |s| s.drive) } else { 0.0 };
        let sat = Saturator::new(drive);
        let de = effect_params.deess.clone().unwrap_or_default();
        let deess2 = (has("deess") && de.thr.is_some()).then(|| DeesserV2::new(&de, sr));
        let deess = (has("deess") && de.thr.is_none() && de.amount > 0.0).then(|| Deesser::new(de.amount, de.freq.unwrap_or(5500.0), sr));
        let gate = has("gate").then(|| Gate::new(&effect_params.gate.clone().unwrap_or_default(), sr));
        let crush = has("crush").then(|| Crush::new(&effect_params.crush.clone().unwrap_or_default()));
        let util = has("util").then(|| {
            let u = effect_params.util.clone().unwrap_or_default();
            Util { width_mode: false, g: 10f64.powf(u.gain.unwrap_or(0.0) / 20.0) * if u.invert.unwrap_or(0.0) > 0.0 { -1.0 } else { 1.0 }, mono: u.mono.unwrap_or(0.0) > 0.0, width: 1.0 }
        });
        let width = has("width").then(|| Util { width_mode: true, g: 1.0, mono: false, width: effect_params.width.as_ref().and_then(|w| w.width).unwrap_or(100.0) / 100.0 });
        let mut modfx = Vec::new();
        for (name, st, kind, p) in [
            ("tremolo", Stage::Tremolo, ModKind::Tremolo, &effect_params.tremolo),
            ("phaser", Stage::Phaser, ModKind::Phaser, &effect_params.phaser),
            ("flanger", Stage::Flanger, ModKind::Flanger, &effect_params.flanger),
            ("chorus", Stage::Chorus, ModKind::Chorus, &effect_params.chorus),
            ("doubler", Stage::Doubler, ModKind::Doubler, &effect_params.doubler),
            ("slapback", Stage::Slapback, ModKind::Slapback, &effect_params.slapback),
        ] {
            if has(name) {
                modfx.push((st, ModFx::new(kind, &p.clone().unwrap_or_default(), sr)));
            }
        }
        let comp = has("comp").then(|| Compressor::new(&effect_params.comp.clone().unwrap_or_default(), sr));
        let reverb = has("reverb").then(|| Reverb::new(&effect_params.reverb.clone().unwrap_or_default(), sr));
        let delay = has("delay").then(|| Delay::new(&effect_params.delay.clone().unwrap_or_default(), sr, bpm));
        let master = has("master").then(|| Master::new(&effect_params.master.clone().unwrap_or_default(), sr));
        let limit = has("limit").then(|| Limiter::with(&effect_params.limit.clone().unwrap_or_default(), ceiling_db, sr));
        let pitch = (has("pitch") && effect_params.pitch.as_ref().and_then(|p| p.semi).unwrap_or(0.0) != 0.0)
            .then(|| Pitch::new(&effect_params.pitch.clone().unwrap_or_default(), sr));
        let comp_p = effect_params.comp.clone().unwrap_or_default();
        Self { cut, filters, dyn_eq, sat, gate, crush, util, width, modfx, deess, deess2, comp, master, limit, delay, reverb, pitch, order: Stage::DEFAULT.to_vec(),
            auto: Vec::new(), auto_from: 0.0, sr, comp_p, eq_bands, cut_kinds, names: effects.to_vec(), deess_freq: de.freq.unwrap_or(5500.0) }
    }
    /// Branche les courbes d'automation des réglages d'effet (`from` = instant du premier échantillon traité)
    pub fn with_auto(mut self, automation: &Automation, from: f64) -> Self {
        for (k, c) in &automation.other {
            let mut it = k.splitn(3, ':');
            let (Some("fx"), Some(fx), Some(key)) = (it.next(), it.next(), it.next()) else { continue };
            let Some((min, max, log)) = auto_range(fx, key) else { continue };
            let Some(curve) = automation.curve(k) else { continue };
            let _ = c;
            self.auto.push(AutoParam { fx: fx.to_owned(), key: key.to_owned(), curve, min, max, log });
        }
        self.auto_from = from;
        // De-esser / pitch réglés à zéro mais automatisés : on les crée quand même (comme le navigateur)
        let has = |fx: &str| self.names.iter().any(|n| n == fx) && self.auto.iter().any(|a| a.fx == fx);
        if self.deess.is_none() && self.deess2.is_none() && has("deess") { self.deess = Some(Deesser::new(0.0, self.deess_freq, self.sr)); }
        if self.pitch.is_none() && has("pitch") { self.pitch = Some(Pitch::new(&PitchParams::default(), self.sr)); }
        self
    }
    fn apply_auto(&mut self, t: f64) {
        let mut comp_changed = false;
        let mut cut_changed = false;
        for i in 0..self.auto.len() {
            let a = &self.auto[i];
            let n = a.curve.at(t).clamp(0.0, 1.0);
            let v = if a.log && a.min > 0.0 { a.min * (a.max / a.min).powf(n) } else { a.min + n * (a.max - a.min) };
            let (fx, key) = (a.fx.clone(), a.key.clone());
            match (fx.as_str(), key.as_str()) {
                ("comp", k) => {
                    let p = &mut self.comp_p;
                    match k { "threshold" => p.threshold = Some(v), "ratio" => p.ratio = Some(v), "mix" => p.mix = Some(v), "attack" => p.attack = Some(v),
                        "release" => p.release = Some(v), "knee" => p.knee = Some(v), "makeup" => p.makeup = Some(v), _ => {} }
                    comp_changed = true;
                }
                ("delay", k) => if let Some(d) = &mut self.delay {
                    match k { "wet" => d.wet = (v / 100.0).clamp(0.0, 1.0), "dry" => d.dry = v / 100.0, "feedback" => d.fb = (v / 100.0).clamp(0.0, 0.9), _ => {} }
                },
                ("reverb", "wet") => if let Some(r) = &mut self.reverb { r.wet = (v / 100.0).clamp(0.0, 1.0); },
                ("util", "gain") => if let Some(u) = &mut self.util { let sign = if u.g < 0.0 { -1.0 } else { 1.0 }; u.g = 10f64.powf(v / 20.0) * sign; },
                ("width", "width") => if let Some(w) = &mut self.width { w.width = v / 100.0; },
                ("deess", "amount") => if let Some(d) = &mut self.deess { let a = v.clamp(0.0, 100.0); d.max_red = a * 0.24; d.slope = a / 100.0 * 3.0; },
                ("gate", k) => if let Some(g) = &mut self.gate {
                    let sr = self.sr;
                    match k { "threshold" => { g.thr = 10f64.powf(v / 20.0); g.thr_db = v; } "reduction" => { g.floor = 10f64.powf(-v / 20.0); g.range = v; }
                        "release" => g.g_rel = 1.0 - (-1.0 / ((v / 1000.0).max(0.005) * sr)).exp(), _ => {} }
                },
                ("crush", k) => if let Some(c) = &mut self.crush {
                    match k { "bits" => c.q = 2f64.powf(v - 1.0), "down" => c.down = (v.round() as usize).max(1), "mix" => c.mix = v / 100.0, _ => {} }
                },
                ("pitch", k) => if let Some(p) = &mut self.pitch {
                    match k { "semi" => p.step = (1.0 - 2f64.powf(v.clamp(-12.0, 12.0) / 12.0)) / p.w, "mix" => p.mix = (v / 100.0).clamp(0.0, 1.0), _ => {} }
                },
                (m @ ("tremolo" | "phaser" | "flanger" | "chorus" | "doubler" | "slapback"), k) => {
                    let st = match m { "tremolo" => Stage::Tremolo, "phaser" => Stage::Phaser, "flanger" => Stage::Flanger, "chorus" => Stage::Chorus, "doubler" => Stage::Doubler, _ => Stage::Slapback };
                    if let Some((_, f)) = self.modfx.iter_mut().find(|(s2, _)| *s2 == st) {
                        match k { "rate" => f.rate = v, "depth" => f.depth = v, "width" => f.width = v, "feedback" => f.fb = v / 100.0, "mix" => f.mix = v / 100.0, "time" => f.time = v / 1000.0, _ => {} }
                    }
                }
                ("filter", "hpf") | ("filter", "lpf") => {
                    let hp = key == "hpf";
                    for (j, (is_hp, qdb)) in self.cut_kinds.iter().enumerate() {
                        if *is_hp != hp { continue; }
                        let b = if hp { Biquad::highpass(self.sr, v.min(20_000.0), *qdb) } else { Biquad::lowpass(self.sr, v.max(20.0), *qdb) };
                        for ch in 0..2 { self.cut[j][ch].retune(b.clone()); }
                    }
                    cut_changed = true;
                }
                ("eq", k) => {
                    let Some((idx, field)) = k.strip_prefix('b').and_then(|r| r.split_once('-')) else { continue };
                    let Ok(bi) = idx.parse::<usize>() else { continue };
                    let Some((bd, Some((fi, _)))) = self.eq_bands.get_mut(bi) else { continue };
                    if field == "freq" { bd.freq = v } else { bd.gain = v }
                    let fi = *fi;
                    for (j, b) in eq_sections(bd, self.sr).into_iter().enumerate() {
                        for ch in 0..2 { self.filters[fi + j][ch].retune(b.clone()); }
                    }
                }
                _ => {}
            }
        }
        let _ = cut_changed;
        if comp_changed {
            let p = self.comp_p.clone();
            if let Some(c) = &mut self.comp { c.retune(&p, self.sr); }
        }
    }
    pub fn with_order(mut self, custom: &[String]) -> Self {
        self.order = Stage::order(custom);
        self
    }
    pub fn is_empty(&self) -> bool {
        self.cut.is_empty() && self.filters.is_empty() && self.dyn_eq.is_empty() && self.sat.is_none() && self.gate.is_none() && self.crush.is_none() && self.util.is_none() && self.width.is_none() && self.modfx.is_empty() && self.deess.is_none() && self.deess2.is_none() && self.comp.is_none() && self.master.is_none() && self.limit.is_none() && self.delay.is_none() && self.reverb.is_none() && self.pitch.is_none()
    }
    /// Une piste avec reverb sort toujours en stéréo, même si ses sons sont mono.
    pub fn makes_stereo(&self) -> bool {
        self.reverb.is_some() || self.master.is_some() || self.limit.is_some()
    }
    /// La sortie est en stéréo même pour une entrée mono (reverb, écho ping-pong…), comme les worklets à 2 canaux du navigateur
    pub fn outputs_stereo(&self) -> bool {
        self.makes_stereo() || self.delay.as_ref().is_some_and(|d| d.pp)
    }
    /// `mono` : la piste n'a que des sons mono (seul `left` est lu). Si la chaîne élargit en stéréo
    /// (`makes_stereo`), `right` doit quand même avoir la taille de `left` : il reçoit le canal droit.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) {
        let order = self.order.clone();
        for n in 0..left.len() {
            if !self.auto.is_empty() && n % 128 == 0 {
                self.apply_auto(self.auto_from + n as f64 / self.sr);
            }
            let mut nc = if mono { 1 } else { 2 };
            let mut x = [left[n] as f64, if nc == 2 { right[n] as f64 } else { 0.0 }];
            for stage in &order {
                match stage {
                    Stage::Filter => {
                        for ch in 0..nc {
                            for f in &mut self.cut {
                                x[ch] = f[ch].tick(x[ch]);
                            }
                        }
                    }
                    Stage::Crush => {
                        if let Some(c) = &mut self.crush {
                            c.tick(&mut x, nc);
                        }
                    }
                    Stage::Util => {
                        if let Some(u) = &mut self.util {
                            u.tick(&mut x, nc);
                        }
                    }
                    Stage::Width => {
                        if let Some(u) = &mut self.width {
                            u.tick(&mut x, nc);
                        }
                    }
                    Stage::Tremolo | Stage::Phaser | Stage::Flanger | Stage::Chorus | Stage::Doubler | Stage::Slapback => {
                        if let Some((_, m)) = self.modfx.iter_mut().find(|(st, _)| st == stage) {
                            m.tick(&mut x, nc);
                        }
                    }
                    Stage::Gate => {
                        if let Some(g) = &mut self.gate {
                            g.tick(&mut x, nc);
                        }
                    }
                    Stage::Eq => {
                        for ch in 0..nc {
                            for f in &mut self.filters {
                                x[ch] = f[ch].tick(x[ch]);
                            }
                        }
                        for d in &mut self.dyn_eq { d.tick(&mut x, nc); }
                    }
                    Stage::Sat => {
                        if let Some(sat) = &mut self.sat {
                            for (ch, v) in x[..nc].iter_mut().enumerate() { *v = sat.tick(*v, ch); }
                        }
                    }
                    Stage::Deess => {
                        if let Some(d) = &mut self.deess {
                            d.tick(&mut x, nc);
                        }
                        if let Some(d) = &mut self.deess2 {
                            d.tick(&mut x, nc);
                        }
                    }
                    Stage::Comp => {
                        if let Some(c) = &mut self.comp {
                            c.tick(&mut x, nc);
                        }
                    }
                    Stage::Master => {
                        if let Some(m) = &mut self.master {
                            m.tick(&mut x, nc);
                            nc = 2;
                        }
                    }
                    Stage::Limit => {
                        if let Some(l) = &mut self.limit {
                            if nc < 2 {
                                x[1] = x[0];
                                nc = 2;
                            }
                            l.tick(&mut x);
                        }
                    }
                    Stage::Delay => {
                        if let Some(d) = &mut self.delay {
                            nc = d.tick(&mut x, nc);
                        }
                    }
                    Stage::Pitch => {
                        if let Some(p) = &mut self.pitch {
                            p.tick(&mut x, nc);
                        }
                    }
                    Stage::Reverb => {
                        if let Some(r) = &mut self.reverb {
                            r.tick(&mut x, nc);
                            nc = 2;
                        }
                    }
                }
            }
            left[n] = x[0] as f32;
            if nc == 2 {
                right[n] = x[1] as f32;
            }
        }
    }
}

/// Un étage de la chaîne. L'ordre habituel est celui de `Stage::DEFAULT` ; l'utilisateur peut le changer.
#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Filter,
    Gate,
    Eq,
    Sat,
    Crush,
    Deess,
    Comp,
    Util,
    Width,
    Tremolo,
    Phaser,
    Flanger,
    Chorus,
    Doubler,
    Slapback,
    Master,
    Limit,
    Delay,
    Reverb,
    Pitch,
}

impl Stage {
    const DEFAULT: [Stage; 20] = [Stage::Pitch, Stage::Filter, Stage::Gate, Stage::Eq, Stage::Sat, Stage::Crush, Stage::Deess, Stage::Comp, Stage::Util, Stage::Width, Stage::Tremolo, Stage::Phaser, Stage::Flanger, Stage::Chorus, Stage::Doubler, Stage::Slapback, Stage::Master, Stage::Limit, Stage::Delay, Stage::Reverb];
    fn parse(name: &str) -> Option<Stage> {
        Some(match name {
            "filter" => Stage::Filter,
            "gate" => Stage::Gate,
            "crush" => Stage::Crush,
            "util" => Stage::Util,
            "width" => Stage::Width,
            "tremolo" => Stage::Tremolo,
            "phaser" => Stage::Phaser,
            "flanger" => Stage::Flanger,
            "chorus" => Stage::Chorus,
            "doubler" => Stage::Doubler,
            "slapback" => Stage::Slapback,
            "eq" => Stage::Eq,
            "sat" => Stage::Sat,
            "deess" => Stage::Deess,
            "comp" => Stage::Comp,
            "master" => Stage::Master,
            "limit" => Stage::Limit,
            "delay" => Stage::Delay,
            "reverb" => Stage::Reverb,
            "pitch" => Stage::Pitch,
            _ => return None,
        })
    }
    /// L'ordre demandé d'abord, puis les étages non cités à leur place habituelle (comme audio.js).
    fn order(custom: &[String]) -> Vec<Stage> {
        let mut out: Vec<Stage> = Vec::new();
        for st in custom.iter().filter_map(|n| Stage::parse(n)).chain(Stage::DEFAULT) {
            if !out.contains(&st) {
                out.push(st);
            }
        }
        out
    }
}

/// Limiteur : même calcul que le worklet `pulse-limiter` de audio.js.
/// Transparent sous le plafond ; retarde le son de 1,5 ms pour voir venir les crêtes ; rien ne dépasse le plafond.
pub struct Limiter {
    thr: f64,
    /// gain d'entrée (linéaire), pic réel, mémoire pour les points intermédiaires (×4)
    g: f64,
    tp: bool,
    hist: [[f64; 16]; 2],
    h: [f64; 64],
    buf: [Vec<f64>; 2],
    i: usize,
    env: f64,
    gain: f64,
    att: f64,
    rel: f64,
}

impl Limiter {
    pub fn new(ceiling_db: f64, sr: f64) -> Self {
        Self::with(&crate::model::LimitParams::default(), ceiling_db, sr)
    }
    /// Même calcul que le worklet `pulse-limiter` de audio.js
    pub fn with(p: &crate::model::LimitParams, ceiling_db: f64, sr: f64) -> Self {
        let tp = p.tp.unwrap_or(0.0) >= 0.5;
        let look = (p.lookahead.unwrap_or(1.5).clamp(0.1, 10.0)) / 1000.0;
        let base = ((look * sr).round() as usize).max(1);
        let l = base + if tp { 8 } else { 0 };
        Self {
            thr: 10f64.powf(p.ceiling.unwrap_or(ceiling_db) / 20.0).min(1.0),
            g: 10f64.powf(p.gain.unwrap_or(0.0) / 20.0),
            tp,
            hist: [[0.0; 16]; 2],
            h: sat_fir(),
            buf: [vec![0.0; l], vec![0.0; l]],
            i: 0,
            env: 0.0,
            gain: 1.0,
            att: 1.0 - (-4.0 / base as f64).exp(),
            rel: 1.0 - (-1.0 / (p.release.unwrap_or(120.0).clamp(1.0, 2000.0) / 1000.0 * sr)).exp(),
        }
    }
    pub fn tick(&mut self, x: &mut [f64; 2]) {
        x[0] *= self.g;
        x[1] *= self.g;
        let mut pk = x[0].abs().max(x[1].abs());
        if self.tp {
            // crêtes entre les échantillons : 3 points intermédiaires (même filtre que la saturation)
            for ch in 0..2 {
                let hs = &mut self.hist[ch];
                hs.copy_within(0..15, 1);
                hs[0] = x[ch];
                for ph in 1..4 {
                    let mut u = 0.0;
                    for j in 0..16 { u += self.h[ph + 4 * j] * hs[j]; }
                    pk = pk.max((4.0 * u).abs());
                }
            }
        }
        let d = [self.buf[0][self.i], self.buf[1][self.i]];
        self.buf[0][self.i] = x[0];
        self.buf[1][self.i] = x[1];
        self.i = (self.i + 1) % self.buf[0].len();
        self.env = if pk > self.env { pk } else { self.env + (pk - self.env) * self.rel };
        let target = if self.env > self.thr { self.thr / self.env } else { 1.0 };
        self.gain += (target - self.gain) * if target < self.gain { self.att } else { self.rel };
        x[0] = (d[0] * self.gain).clamp(-self.thr, self.thr);
        x[1] = (d[1] * self.gain).clamp(-self.thr, self.thr);
    }
}

/// Limiteur de sécurité de la sortie, sur tout le mix.
pub fn limit(left: &mut [f32], right: &mut [f32], sr: f64, ceiling_db: f64) {
    let mut lim = Limiter::new(ceiling_db, sr);
    for n in 0..left.len() {
        let mut x = [left[n] as f64, right[n] as f64];
        lim.tick(&mut x);
        left[n] = x[0] as f32;
        right[n] = x[1] as f32;
    }
}

/// Finition (premaster) : même chaîne que l'effet « master » de audio.js.
struct Master {
    filters: Vec<[Biquad; 2]>,
    glue: Option<Compressor>,
    warm: Option<(f64, f64)>,
    width: Option<f64>,
    push: Option<(f64, Limiter)>,
}

impl Master {
    fn new(p: &MasterParams, sr: f64) -> Self {
        let mut filters = Vec::new();
        if p.body != 0.0 {
            let b = Biquad::lowshelf(sr, 100.0, p.body);
            filters.push([b, b]);
        }
        if p.air != 0.0 {
            let b = Biquad::highshelf(sr, 10_000.0, p.air);
            filters.push([b, b]);
        }
        let glue = (p.glue > 0.0).then(|| {
            Compressor::new(&CompParams { threshold: Some(-12.0 - p.glue * 0.12), ratio: Some(1.5 + p.glue * 0.015), attack: Some(30.0), release: Some(150.0), knee: None, makeup: None, mix: None, mode: None, auto_rel: None }, sr)
        });
        let warm = (p.warm > 0.0).then(|| {
            let k = 1.0 + p.warm * 0.03;
            (k, 1.0 / (k / k.tanh()).sqrt())
        });
        Self {
            filters,
            glue,
            warm,
            width: p.width.filter(|w| (*w - 1.0).abs() > 1e-9),
            push: (p.push > 0.0).then(|| (10f64.powf(p.push / 20.0), Limiter::new(-1.0, sr))),
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        for ch in 0..nc {
            for f in &mut self.filters {
                x[ch] = f[ch].tick(x[ch]);
            }
        }
        if nc < 2 {
            x[1] = x[0];
        }
        if let Some(c) = &mut self.glue {
            c.tick(x, 2);
        }
        if let Some((k, trim)) = self.warm {
            for v in x.iter_mut() {
                *v = (k * v.clamp(-1.0, 1.0)).tanh() / k.tanh() * trim;
            }
        }
        if let Some(w) = self.width {
            let (m, sd) = ((x[0] + x[1]) * 0.5, (x[0] - x[1]) * 0.5 * w);
            x[0] = m + sd;
            x[1] = m - sd;
        }
        if let Some((g, lim)) = &mut self.push {
            x[0] *= *g;
            x[1] *= *g;
            lim.tick(x);
        }
    }
}

/// Traite le retour d'un envoi sur place : 100 % d'effet, aucun son direct (comme `getSend` dans audio.js).
pub fn process_send(send: &Send, left: &mut [f32], right: &mut [f32], sr: f64, bpm: f64) {
    let trim = if send.kind == "delay" { 1.0 } else { 1.0 / 3.0 } * send.volume.unwrap_or(100.0) / 100.0;
    let mut delay = (send.kind == "delay").then(|| {
        let mut d = Delay::new(&DelayParams { wet: Some(100.0), feedback: send.feedback, ms: send.ms, beats: send.beats, pp: send.pp, dry: None, ..Default::default() }, sr, bpm);
        d.dry = 0.0;
        d
    });
    let mut reverb = (send.kind != "delay").then(|| {
        let mut r = Reverb::new(&ReverbParams { wet: Some(100.0), size: Some(send.size.unwrap_or(3.2)), ..Default::default() }, sr);
        r.pre = vec![0.0; ((send.pre.unwrap_or(0.0).clamp(0.0, 500.0) / 1000.0) * sr).round() as usize];
        r
    });
    for n in 0..left.len() {
        let mut x = [left[n] as f64, right[n] as f64];
        if let Some(d) = &mut delay {
            d.tick(&mut x, 2);
        }
        if let Some(r) = &mut reverb {
            r.tick(&mut x, 2);
        }
        left[n] = (x[0] * trim) as f32;
        right[n] = (x[1] * trim) as f32;
    }
}

#[cfg(test)]
mod tests_pitch_pingpong {
    use super::*;

    fn freq(sig: &[f64], sr: f64) -> f64 {
        let mut z = 0;
        for w in sig.windows(2) {
            if w[0] <= 0.0 && w[1] > 0.0 {
                z += 1;
            }
        }
        z as f64 / (sig.len() as f64 / sr)
    }

    #[test]
    fn pitch_monte_et_descend() {
        let sr = 48_000.0;
        for (semi, want) in [(12.0, 880.0), (-12.0, 220.0), (5.0, 440.0 * 2f64.powf(5.0 / 12.0))] {
            let mut p = Pitch::new(&PitchParams { semi: Some(semi), mix: Some(100.0) }, sr);
            let out: Vec<f64> = (0..48_000)
                .map(|n| {
                    let mut x = [(2.0 * PI * 440.0 * n as f64 / sr).sin(), 0.0];
                    p.tick(&mut x, 1);
                    x[0]
                })
                .collect();
            let f = freq(&out[4_800..], sr);
            assert!((f - want).abs() / want < 0.03, "{semi} demi-tons : {f:.1} Hz au lieu de {want:.1}");
        }
    }

    #[test]
    fn retune_garde_les_echos() {
        // Un clic, puis on tourne « Répétitions » juste avant le 1er écho : l'écho doit quand même sortir
        let sr = 48_000.0;
        let p = |fb: f64| DelayParams { wet: Some(100.0), feedback: Some(fb), ms: Some(100.0), beats: None, pp: None, dry: Some(0.0), ..Default::default() };
        let mut d = Delay::new(&p(30.0), sr, 120.0);
        let mut seen = 0.0f64;
        for n in 0..9_600 {
            if n == 2_400 { d.retune(&p(60.0), sr, 120.0); }
            let mut x = [if n == 0 { 1.0 } else { 0.0 }, 0.0];
            d.tick(&mut x, 1);
            if (4_780..4_820).contains(&n) { seen = seen.max(x[0].abs()); }
        }
        assert!(seen > 0.3, "l'écho a disparu au changement de réglage ({seen})");
    }

    #[test]
    fn ping_pong_alterne() {
        let sr = 48_000.0;
        let mut d = Delay::new(&DelayParams { wet: Some(100.0), feedback: Some(50.0), ms: Some(100.0), beats: None, pp: Some(1.0), dry: None, ..Default::default() }, sr, 120.0);
        d.dry = 0.0;
        let (mut l, mut r) = (vec![0.0; 24_000], vec![0.0; 24_000]);
        for n in 0..24_000 {
            let mut x = [if n == 0 { 1.0 } else { 0.0 }, 0.0];
            assert_eq!(d.tick(&mut x, 1), 2);
            l[n] = x[0];
            r[n] = x[1];
        }
        let around = |v: &Vec<f64>, at: usize| v[at - 20..at + 20].iter().map(|x| x.abs()).fold(0.0, f64::max);
        assert!(around(&l, 4_800) > 0.3 && around(&r, 4_800) < 1e-6, "1re répétition à gauche");
        assert!(around(&r, 9_600) > 0.1 && around(&l, 9_600) < 1e-6, "2e répétition à droite");
    }
}
