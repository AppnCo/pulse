//! Effets de piste : mêmes formules que les noeuds Web Audio du prototype (BiquadFilter, WaveShaper).
use crate::model::{CompParams, DelayParams, EffectParams, MasterParams, ReverbParams, Send, Track};
use std::f64::consts::PI;

/// Filtre biquad (forme directe I).
#[derive(Clone, Copy)]
pub struct Biquad {
    b0: f64, b1: f64, b2: f64, a1: f64, a2: f64,
    x1: f64, x2: f64, y1: f64, y2: f64,
}

impl Biquad {
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
    #[inline]
    pub fn tick(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x; self.y2 = self.y1; self.y1 = y;
        y
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

/// Compresseur : même calcul que le worklet `pulse-comp` de audio.js.
struct Compressor {
    thr: f64,
    slope: f64,
    knee: f64,
    att: f64,
    rel: f64,
    makeup: f64,
    mix: f64,
    red: f64,
}

impl Compressor {
    fn new(p: &CompParams, sr: f64) -> Self {
        let thr = p.threshold.unwrap_or(-22.0);
        let slope = 1.0 - 1.0 / p.ratio.unwrap_or(3.0).max(1.0);
        let makeup_db = p.makeup.unwrap_or(-thr * slope * 0.35);
        Self {
            thr,
            slope,
            knee: 10.0,
            att: 1.0 - (-1.0 / ((p.attack.unwrap_or(10.0) / 1000.0).max(0.0001) * sr)).exp(),
            rel: 1.0 - (-1.0 / ((p.release.unwrap_or(50.0) / 1000.0).max(0.005) * sr)).exp(),
            makeup: 10f64.powf(makeup_db / 20.0),
            mix: (p.mix.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0),
            red: 0.0,
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let pk = x[..nc].iter().fold(0.0f64, |m, v| m.max(v.abs()));
        let half = self.knee / 2.0;
        let mut want = 0.0;
        if pk > 1e-5 {
            let over = 20.0 * pk.log10() - self.thr;
            if over >= half {
                want = over * self.slope;
            } else if over > -half {
                want = self.slope * (over + half) * (over + half) / (2.0 * self.knee);
            }
        }
        self.red += (want - self.red) * if want > self.red { self.att } else { self.rel };
        let g = (1.0 - self.mix) + self.mix * 10f64.powf(-self.red / 20.0) * self.makeup;
        for v in &mut x[..nc] {
            *v *= g;
        }
    }
}

/// Écho : même calcul que le worklet `pulse-delay` de audio.js.
struct Delay {
    buf: [Vec<f64>; 2],
    lp: [f64; 2],
    i: usize,
    fb: f64,
    wet: f64,
    dry: f64,
    k: f64,
}

impl Delay {
    fn new(p: &DelayParams, sr: f64, bpm: f64) -> Self {
        let time = match p.ms.filter(|m| *m > 0.0) {
            Some(ms) => ms / 1000.0,
            None => 60.0 / if bpm > 0.0 { bpm } else { 90.0 } * p.beats.filter(|b| *b > 0.0).unwrap_or(0.5),
        };
        let d = ((time * sr).round() as usize).clamp(1, (4.0 * sr) as usize);
        Self {
            buf: [vec![0.0; d], vec![0.0; d]],
            lp: [0.0; 2],
            i: 0,
            fb: (p.feedback.unwrap_or(35.0) / 100.0).clamp(0.0, 0.9),
            wet: (p.wet.unwrap_or(25.0) / 100.0).clamp(0.0, 1.0),
            dry: 1.0,
            k: (-2.0 * PI * 4000.0 / sr).exp(),
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        for ch in 0..nc {
            let d = self.buf[ch][self.i];
            self.lp[ch] = d + (self.lp[ch] - d) * self.k;
            self.buf[ch][self.i] = x[ch] + self.lp[ch] * self.fb;
            x[ch] = x[ch] * self.dry + d * self.wet;
        }
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
struct Reverb {
    wet: f64,
    fb: f64,
    damp: f64,
    comb: [Vec<Line>; 2],
    ap: [Vec<Line>; 2],
    /// Pré-délai (vide = aucun)
    pre: Vec<f64>,
    pi: usize,
}

impl Reverb {
    fn new(p: &ReverbParams, sr: f64) -> Self {
        const COMB: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
        const AP: [usize; 4] = [556, 441, 341, 225];
        let lines = |t: &[usize], spread: usize| t.iter().map(|n| Line::new(n + spread, sr)).collect::<Vec<_>>();
        Self {
            wet: (p.wet.unwrap_or(18.0) / 100.0).clamp(0.0, 1.0),
            fb: 0.72 + 0.2 * ((p.size.unwrap_or(1.8) - 1.2) / 2.0).clamp(0.0, 1.0),
            damp: 0.35,
            comb: [lines(&COMB, 0), lines(&COMB, 23)],
            ap: [lines(&AP, 0), lines(&AP, 23)],
            pre: Vec::new(),
            pi: 0,
        }
    }
    /// Entrée mono (`nc` = 1) ou stéréo ; la sortie est toujours stéréo.
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let mono = nc < 2;
        let scale = if mono { std::f64::consts::FRAC_1_SQRT_2 } else { 1.0 };
        let (dry, wet) = ((1.0 - self.wet) * scale, self.wet * 3.0 * scale);
        let (xl, xr) = (x[0], if mono { x[0] } else { x[1] });
        let mut input = (xl + xr) * 0.015;
        if !self.pre.is_empty() {
            input = std::mem::replace(&mut self.pre[self.pi], input);
            self.pi = (self.pi + 1) % self.pre.len();
        }
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
            x[ch] = if ch == 0 { xl } else { xr } * dry + acc * wet;
        }
    }
}

/// Chaîne d'une piste : EQ → saturation → de-esser → compresseur → écho → reverb, les deux canaux liés.
pub struct Chain {
    filters: Vec<[Biquad; 2]>,
    /// Saturation : (k, compensation de volume)
    sat: Option<(f64, f64)>,
    deess: Option<Deesser>,
    comp: Option<Compressor>,
    master: Option<Master>,
    limit: Option<Limiter>,
    delay: Option<Delay>,
    reverb: Option<Reverb>,
    order: Vec<Stage>,
}

impl Chain {
    pub fn for_track(track: &Track, sr: f64, bpm: f64) -> Self {
        Self::new(&track.effects, &track.effect_params, sr, bpm, -0.3).with_order(&track.fx_order)
    }
    /// `bpm` : tempo du projet (échos calés sur le rythme). `ceiling_db` : plafond du projet (limiteur de bus).
    pub fn new(effects: &[String], effect_params: &EffectParams, sr: f64, bpm: f64, ceiling_db: f64) -> Self {
        let has = |name: &str| effects.iter().any(|e| e == name);
        let mut filters = Vec::new();
        let mut push = |b: Biquad| filters.push([b.clone(), b]);
        if has("eq") {
            let p = effect_params.eq.clone().unwrap_or_default();
            if let Some(bands) = p.bands.as_ref() {
                // EQ libre : mêmes bandes que le navigateur (24 au plus, Q linéaire, dB pour les coupes)
                for bd in bands.iter().take(24).filter(|b| b.on != Some(false) && b.freq > 0.0) {
                    let freq = bd.freq.clamp(20.0, 20_000.0);
                    let q = if bd.q > 0.0 { bd.q } else { 1.0 };
                    push(match bd.kind.as_str() {
                        "hpf" => Biquad::highpass(sr, freq, 20.0 * q.log10()),
                        "lpf" => Biquad::lowpass(sr, freq, 20.0 * q.log10()),
                        "lowshelf" => Biquad::lowshelf(sr, freq, bd.gain),
                        "highshelf" => Biquad::highshelf(sr, freq, bd.gain),
                        _ => Biquad::peaking(sr, freq, q, bd.gain),
                    });
                }
            } else {
                push(Biquad::highpass(sr, p.hpf.unwrap_or(80.0), 0.7));
                push(Biquad::peaking(sr, 300.0, 1.0, p.mid_gain.unwrap_or(-2.0)));
                push(Biquad::peaking(sr, 4000.0, 0.7, p.presence.unwrap_or(2.0)));
                push(Biquad::highshelf(sr, 10_000.0, p.air.unwrap_or(1.0)));
                if let Some(lpf) = p.lpf.filter(|f| *f > 0.0) {
                    push(Biquad::lowpass(sr, lpf, 0.7));
                }
            }
        }
        let drive = if has("sat") { effect_params.sat.as_ref().map_or(0.0, |s| s.drive) } else { 0.0 };
        let sat = (drive > 0.0).then(|| {
            let k = 1.0 + drive * 0.05;
            (k, 1.0 / (k / k.tanh()).sqrt())
        });
        let de = effect_params.deess.clone().unwrap_or_default();
        let deess = (has("deess") && de.amount > 0.0).then(|| Deesser::new(de.amount, de.freq.unwrap_or(5500.0), sr));
        let comp = has("comp").then(|| Compressor::new(&effect_params.comp.clone().unwrap_or_default(), sr));
        let reverb = has("reverb").then(|| Reverb::new(&effect_params.reverb.clone().unwrap_or_default(), sr));
        let delay = has("delay").then(|| Delay::new(&effect_params.delay.clone().unwrap_or_default(), sr, bpm));
        let master = has("master").then(|| Master::new(&effect_params.master.clone().unwrap_or_default(), sr));
        let limit = has("limit").then(|| Limiter::new(effect_params.limit.as_ref().and_then(|l| l.ceiling).unwrap_or(ceiling_db), sr));
        Self { filters, sat, deess, comp, master, limit, delay, reverb, order: Stage::DEFAULT.to_vec() }
    }
    pub fn with_order(mut self, custom: &[String]) -> Self {
        self.order = Stage::order(custom);
        self
    }
    pub fn is_empty(&self) -> bool {
        self.filters.is_empty() && self.sat.is_none() && self.deess.is_none() && self.comp.is_none() && self.master.is_none() && self.limit.is_none() && self.delay.is_none() && self.reverb.is_none()
    }
    /// Une piste avec reverb sort toujours en stéréo, même si ses sons sont mono.
    pub fn makes_stereo(&self) -> bool {
        self.reverb.is_some() || self.master.is_some() || self.limit.is_some()
    }
    /// `mono` : la piste n'a que des sons mono (seul `left` est lu). Si la chaîne élargit en stéréo
    /// (`makes_stereo`), `right` doit quand même avoir la taille de `left` : il reçoit le canal droit.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) {
        let order = self.order.clone();
        for n in 0..left.len() {
            let mut nc = if mono { 1 } else { 2 };
            let mut x = [left[n] as f64, if nc == 2 { right[n] as f64 } else { 0.0 }];
            for stage in &order {
                match stage {
                    Stage::Eq => {
                        for ch in 0..nc {
                            for f in &mut self.filters {
                                x[ch] = f[ch].tick(x[ch]);
                            }
                        }
                    }
                    Stage::Sat => {
                        if let Some((k, trim)) = self.sat {
                            for v in &mut x[..nc] {
                                *v = (k * v.clamp(-1.0, 1.0)).tanh() / k.tanh() * trim;
                            }
                        }
                    }
                    Stage::Deess => {
                        if let Some(d) = &mut self.deess {
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
                            d.tick(&mut x, nc);
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
    Eq,
    Sat,
    Deess,
    Comp,
    Master,
    Limit,
    Delay,
    Reverb,
}

impl Stage {
    const DEFAULT: [Stage; 8] = [Stage::Eq, Stage::Sat, Stage::Deess, Stage::Comp, Stage::Master, Stage::Limit, Stage::Delay, Stage::Reverb];
    fn parse(name: &str) -> Option<Stage> {
        Some(match name {
            "eq" => Stage::Eq,
            "sat" => Stage::Sat,
            "deess" => Stage::Deess,
            "comp" => Stage::Comp,
            "master" => Stage::Master,
            "limit" => Stage::Limit,
            "delay" => Stage::Delay,
            "reverb" => Stage::Reverb,
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
    buf: [Vec<f64>; 2],
    i: usize,
    env: f64,
    gain: f64,
    att: f64,
    rel: f64,
}

impl Limiter {
    pub fn new(ceiling_db: f64, sr: f64) -> Self {
        let l = ((0.0015 * sr).round() as usize).max(1);
        Self {
            thr: 10f64.powf(ceiling_db / 20.0).min(1.0),
            buf: [vec![0.0; l], vec![0.0; l]],
            i: 0,
            env: 0.0,
            gain: 1.0,
            att: 1.0 - (-4.0 / l as f64).exp(),
            rel: 1.0 - (-1.0 / (0.12 * sr)).exp(),
        }
    }
    pub fn tick(&mut self, x: &mut [f64; 2]) {
        let pk = x[0].abs().max(x[1].abs());
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
            Compressor::new(&CompParams { threshold: Some(-12.0 - p.glue * 0.12), ratio: Some(1.5 + p.glue * 0.015), attack: Some(30.0), release: Some(150.0), makeup: None, mix: None }, sr)
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
        let mut d = Delay::new(&DelayParams { wet: Some(100.0), feedback: send.feedback, ms: send.ms, beats: send.beats }, sr, bpm);
        d.dry = 0.0;
        d
    });
    let mut reverb = (send.kind != "delay").then(|| {
        let mut r = Reverb::new(&ReverbParams { wet: Some(100.0), size: Some(send.size.unwrap_or(3.2)) }, sr);
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
