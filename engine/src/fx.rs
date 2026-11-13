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
    pub(crate) fn retune(&mut self, other: Biquad) {
        let (x1, x2, y1, y2) = (self.x1, self.x2, self.y1, self.y2);
        *self = other;
        self.x1 = x1; self.x2 = x2; self.y1 = y1; self.y2 = y2;
    }
    /// Filtre du 1er ordre (6 dB/oct, transformée bilinéaire) : passe-haut ou passe-bas
    pub(crate) fn first_order(highpass: bool, f: f64, sr: f64) -> Self {
        let k = (PI * f.clamp(1.0, sr * 0.49) / sr).tan();
        let a1 = (k - 1.0) / (k + 1.0);
        if highpass { let b0 = 1.0 / (1.0 + k); Self::new(b0, -b0, 0.0, 1.0, a1, 0.0) } else { let b0 = k / (1.0 + k); Self::new(b0, b0, 0.0, 1.0, a1, 0.0) }
    }
    pub(crate) fn new(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
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

/// Saturation multibande : même calcul que le worklet `pulse-msat` de audio.js (tout à 4 fois la cadence, filtre `sat_fir`).
const MSAT_VK: [f64; 3] = [0.6, 1.0, 1.7];
fn msat_curve(sty: &str, x: f64, k: f64) -> f64 {
    let x = x.clamp(-4.0, 4.0);
    match sty {
        "lampe" => (k * (x + 0.18 * x * x)).tanh() / (k * 1.18).tanh(),
        "ampli" => { let a = k * x; (a / (1.0 + a.abs()) * (1.0 + 1.0 / k)).clamp(-1.0, 1.0) }
        "transfo" => ((x * (0.6 + k * 0.08)).clamp(-1.0, 1.0) * PI / 2.0).sin(),
        "repli" => { let mut a = x * (1.0 + k * 0.35); for _ in 0..4 { if a > 1.0 { a = 2.0 - a; } else if a < -1.0 { a = -2.0 - a; } } a }
        "lofi" => { let q = 10.0 - k.min(7.0); ((k * x).tanh() / k.tanh() * q + 0.5).floor() / q }
        _ => (k * x * 0.9).tanh() / (k * 0.9).tanh(),
    }
}
/// Auto gain : un son à −12 dB (sinus d'amplitude 0,25) ressort au même niveau, quelle que soit la chaleur
fn msat_trim(sty: &str, k: f64) -> f64 {
    let s: f64 = (0..64).map(|i| { let y = msat_curve(sty, 0.25 * (2.0 * PI * i as f64 / 64.0).sin(), k); y * y }).sum();
    0.25 * std::f64::consts::FRAC_1_SQRT_2 / (s / 64.0).sqrt().max(1e-6)
}
struct MsBand {
    ks: [Vec<Biquad>; 2], tone: [Vec<Biquad>; 2], sty: String, k: f64, trim: f64, dynamics: f64, env: f64, att: f64, rel: f64,
    fbk: f64, bp: [Biquad; 2], last: [f64; 2], hold: u64, hc: u64, hv: [f64; 2], mix: f64, lvl: f64, solo: bool,
    idx: usize, va: usize, mute: bool, tg: [f64; 4], t_all: bool, n: usize, lo: f64, hi: f64, is_base: bool,
}
pub struct MultiSat { free: Vec<MsBand>, base: Option<MsBand>, any_solo: bool, gmix: f64, gout: f64, ag: bool, sr4: f64, h: [f64; 64], xin: [[f64; 16]; 2], xs: [[f64; 64]; 2], pos: [usize; 2] }
impl MultiSat {
    /// Filtres d'une bande libre + filtre de la résonance (même calcul que mkKs dans pulse-msat)
    fn make_ks(lo0: f64, hi0: f64, n: usize, sr4: f64) -> (Vec<Biquad>, Biquad) {
        let biq = |hp: bool, f: f64| {
            let w = 2.0 * PI * f / sr4;
            let (c, al) = (w.cos(), w.sin() / (2.0 * std::f64::consts::FRAC_1_SQRT_2));
            if hp { Biquad::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al) }
            else { Biquad::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al) }
        };
        let lo = lo0.clamp(20.0, 20000.0);
        let hi = hi0.min(20000.0).max(lo * 1.05);
        let mut ks = Vec::new();
        if lo > 20.5 { for _ in 0..n { ks.push(biq(true, lo)); } }
        if hi < 19999.0 { for _ in 0..n { ks.push(biq(false, hi)); } }
        let fc = (lo * hi).sqrt();
        let w = 2.0 * PI * fc / sr4; let al = w.sin() / 4.0;
        (ks, Biquad::new(al, 0.0, -al, 1.0 + al, -2.0 * w.cos(), 1.0 - al))
    }
    pub fn new(p: &crate::model::MsatParams, sr: f64) -> Option<Self> {
        let sr4 = sr * 4.0;
        let bpf = |f: f64| { let w = 2.0 * PI * f / sr4; let al = w.sin() / 4.0; Biquad::new(al, 0.0, -al, 1.0 + al, -2.0 * w.cos(), 1.0 - al) };
        let co = |ms: f64| 1.0 - (-1.0 / (ms / 1000.0 * sr4)).exp();
        let ag = p.ag != Some(false);
        let mk = |b: &crate::model::MsatBand, is_base: bool, idx: usize| {
            let lo = if is_base { 20.0 } else { b.lo.unwrap_or(20.0).clamp(20.0, 20000.0) };
            let hi = if is_base { 20000.0 } else { b.hi.unwrap_or(20000.0).min(20000.0).max(lo * 1.05) };
            let sl = b.slope.unwrap_or(24.0);
            let n = if sl >= 48.0 { 4 } else if sl >= 24.0 { 2 } else { 1 };
            let ks = if is_base { Vec::new() } else { Self::make_ks(b.lo.unwrap_or(20.0), b.hi.unwrap_or(20000.0), n, sr4).0 };
            let sty = b.sty.clone().unwrap_or_else(|| "bande".into());
            let va = (b.va.unwrap_or(1.0).round() as usize).min(2);
            let heat = b.heat.unwrap_or(30.0).clamp(0.0, 100.0);
            let k = (1.0 + heat / 100.0 * 7.0) * MSAT_VK[va];
            let tone: Vec<Biquad> = [("lowshelf", 150.0, b.lo2, 0.7071), ("bell", 1000.0, b.md, 0.7), ("highshelf", 6000.0, b.hi2, 0.7071), ("bell", 3500.0, b.pr, 1.2)].iter()
                .filter(|t| t.2.unwrap_or(0.0) != 0.0)
                .flat_map(|t| eq_sections(&EqBand { kind: t.0.into(), freq: t.1, gain: t.2.unwrap_or(0.0), q: t.3, ..Default::default() }, sr4)).collect();
            let fc = if is_base { 1000.0 } else { (lo * hi).sqrt() };
            MsBand {
                ks: [ks.clone(), ks], tone: [tone.clone(), tone], trim: if ag { msat_trim(&sty, k) } else { 1.0 }, k,
                dynamics: b.dynamics.unwrap_or(0.0).clamp(-50.0, 50.0), env: 0.0, att: co(5.0), rel: co(80.0),
                fbk: b.fb.unwrap_or(0.0).clamp(0.0, 100.0) / 100.0 * 0.6, bp: [bpf(fc), bpf(fc)], last: [0.0; 2],
                hold: if sty == "lofi" && va == 1 { 4 * (1 + (heat / 100.0 * 15.0).floor() as u64) } else { 0 }, hc: 0, hv: [0.0; 2],
                mix: b.mix.unwrap_or(100.0).clamp(0.0, 100.0) / 100.0,
                lvl: if b.mute.unwrap_or(false) { 0.0 } else { 10f64.powf(b.out.unwrap_or(0.0).clamp(-60.0, 24.0) / 20.0) },
                solo: b.solo.unwrap_or(false), sty,
                idx, va, mute: b.mute.unwrap_or(false), tg: [b.lo2.unwrap_or(0.0), b.md.unwrap_or(0.0), b.hi2.unwrap_or(0.0), b.pr.unwrap_or(0.0)], t_all: false, n, lo: b.lo.unwrap_or(20.0), hi: b.hi.unwrap_or(20000.0), is_base,
            }
        };
        let all: Vec<(usize, &crate::model::MsatBand)> = p.bands.iter().enumerate().filter(|(_, b)| b.on != Some(false)).collect();
        if all.is_empty() { return None; }
        let free: Vec<MsBand> = all.iter().filter(|(_, b)| b.base != Some(true)).take(6).map(|(i, b)| mk(b, false, *i)).collect();
        let base = all.iter().find(|(_, b)| b.base == Some(true)).map(|(i, b)| mk(b, true, *i));
        let any_solo = free.iter().any(|b| b.solo) || base.as_ref().is_some_and(|b| b.solo);
        Some(Self { free, base, any_solo, gmix: p.mix.unwrap_or(100.0).clamp(0.0, 100.0) / 100.0, gout: 10f64.powf(p.out.unwrap_or(0.0).clamp(-24.0, 24.0) / 20.0),
            ag, sr4, h: sat_fir(), xin: [[0.0; 16]; 2], xs: [[0.0; 64]; 2], pos: [0; 2] })
    }
    /// Automation (mêmes règles que le worklet pulse-msat) : « mix » / « out » = tout l'effet, « b1-heat » = bande n° 1
    fn set(&mut self, key: &str, v: f64) {
        match key {
            "mix" => { self.gmix = v.clamp(0.0, 100.0) / 100.0; return; }
            "out" => { self.gout = 10f64.powf(v.clamp(-24.0, 24.0) / 20.0); return; }
            _ => {}
        }
        let Some((idx, f)) = key.strip_prefix('b').and_then(|r| r.split_once('-')) else { return };
        let Ok(idx) = idx.parse::<usize>() else { return };
        let (ag, sr4) = (self.ag, self.sr4);
        let b = match self.free.iter_mut().find(|b| b.idx == idx) { Some(b) => b, None => match self.base.as_mut() { Some(b) if b.idx == idx => b, _ => return } };
        match f {
            "heat" => {
                let h = v.clamp(0.0, 100.0);
                b.k = (1.0 + h / 100.0 * 7.0) * MSAT_VK[b.va];
                b.trim = if ag { msat_trim(&b.sty, b.k) } else { 1.0 };
                if b.sty == "lofi" && b.va == 1 { b.hold = 4 * (1 + (h / 100.0 * 15.0).floor() as u64); }
            }
            "dyn" => b.dynamics = v.clamp(-50.0, 50.0),
            "fb" => b.fbk = v.clamp(0.0, 100.0) / 100.0 * 0.6,
            "mix" => b.mix = v.clamp(0.0, 100.0) / 100.0,
            "out" => b.lvl = if b.mute { 0.0 } else { 10f64.powf(v.clamp(-60.0, 24.0) / 20.0) },
            "lo" | "hi" => {
                if b.is_base || (f == "lo" && b.lo == v) || (f == "hi" && b.hi == v) { return; }
                if f == "lo" { b.lo = v } else { b.hi = v }
                let (ks, bp) = Self::make_ks(b.lo, b.hi, b.n, sr4);
                b.ks = retune_all(&b.ks, ks);
                for ch in 0..2 { b.bp[ch].retune(bp.clone()); }
            }
            "lo2" | "md" | "hi2" | "pr" => {
                let ti = ["lo2", "md", "hi2", "pr"].iter().position(|x| *x == f).unwrap();
                if b.tg[ti] == v && b.t_all { return; }
                // ton automatisé : les 4 filtres restent en place (à 0 dB ils ne changent rien)
                b.tg[ti] = v;
                let tone: Vec<Biquad> = [("lowshelf", 150.0, b.tg[0], 0.7071), ("bell", 1000.0, b.tg[1], 0.7), ("highshelf", 6000.0, b.tg[2], 0.7071), ("bell", 3500.0, b.tg[3], 1.2)].iter()
                    .flat_map(|t| eq_sections(&EqBand { kind: t.0.into(), freq: t.1, gain: t.2, q: t.3, ..Default::default() }, sr4)).collect();
                if tone.len() != b.tone[0].len() { b.tone = [tone.clone(), tone]; }
                else { for ch in 0..2 { for (j, t) in tone.iter().enumerate() { b.tone[ch][j].retune(t.clone()); } } }
                b.t_all = true;
            }
            _ => {}
        }
    }
    fn band(b: &mut MsBand, v: &mut [f64; 2], nc: usize) {
        let mut pk = 0.0f64;
        for ch in 0..nc { pk = pk.max(v[ch].abs()); }
        b.env += (pk - b.env) * if pk > b.env { b.att } else { b.rel };
        let mut gd = 1.0;
        if b.dynamics != 0.0 {
            let l = 20.0 * b.env.max(1e-9).log10();
            let mut r = 0.0;
            if b.dynamics > 0.0 { r = ((l + 24.0).max(0.0) * b.dynamics / 50.0 * 0.75).min(24.0); }
            else if l > -70.0 { r = ((-24.0 - l).max(0.0) * -b.dynamics / 50.0 * 0.75).min(24.0); }
            gd = 10f64.powf(-r / 20.0);
        }
        let do_hold = b.hold > 0 && b.hc % b.hold == 0;
        if b.hold > 0 { b.hc += 1; }
        for ch in 0..nc {
            let dry = v[ch];
            let mut u = dry * gd;
            if b.fbk > 0.0 { u += b.fbk * b.bp[ch].tick(b.last[ch]); }
            let mut w = msat_curve(&b.sty, u, b.k);
            b.last[ch] = w;
            if b.hold > 0 { if do_hold { b.hv[ch] = w; } w = b.hv[ch]; }
            w *= b.trim;
            for f in &mut b.tone[ch] { w = f.tick(w); }
            v[ch] = (dry * (1.0 - b.mix) + w * b.mix) * b.lvl;
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        for ch in 0..nc { self.xin[ch].copy_within(0..15, 1); self.xin[ch][0] = x[ch]; }
        for p4 in 0..4 {
            let mut x4 = [0.0f64; 2];
            for ch in 0..nc { let mut u = 0.0; for j in 0..16 { u += self.h[p4 + 4 * j] * self.xin[ch][j]; } x4[ch] = 4.0 * u; }
            let mut res = x4;
            let mut acc = [0.0f64; 2];
            let any_solo = self.any_solo;
            for b in &mut self.free {
                let mut o = [0.0f64; 2];
                for ch in 0..nc { let mut s = x4[ch]; for f in &mut b.ks[ch] { s = f.tick(s); } o[ch] = s; res[ch] -= s; }
                Self::band(b, &mut o, nc);
                if !any_solo || b.solo { for ch in 0..nc { acc[ch] += o[ch]; } }
            }
            if let Some(b) = &mut self.base {
                let mut v = res;
                Self::band(b, &mut v, nc);
                if !any_solo || b.solo { for ch in 0..nc { acc[ch] += v[ch]; } }
            } else if !any_solo { for ch in 0..nc { acc[ch] += res[ch]; } }
            for ch in 0..nc {
                let y = (x4[ch] * (1.0 - self.gmix) + acc[ch] * self.gmix) * self.gout;
                self.pos[ch] = (self.pos[ch] + 1) % 64;
                self.xs[ch][self.pos[ch]] = y;
            }
        }
        for ch in 0..nc {
            let (mut y, mut idx) = (0.0, self.pos[ch]);
            for hj in self.h.iter() { y += hj * self.xs[ch][idx]; idx = (idx + 63) % 64; }
            x[ch] = y;
        }
    }
}

/// Multibande à bandes libres : même calcul que le worklet `pulse-mband` de audio.js.
struct MbBand { ks: [Vec<Biquad>; 2], gl: f64, mg: f64, env: f64, att: f64, rel: f64, thr: f64, range: f64, out: f64, solo: bool, mute: bool, idx: usize, lo: f64, hi: f64 }
/// Nouveaux filtres pour une bande : même nombre = on garde leur mémoire, sinon on repart de zéro (comme le navigateur)
fn retune_all(old: &[Vec<Biquad>; 2], new: Vec<Biquad>) -> [Vec<Biquad>; 2] {
    if old[0].len() != new.len() { return [new.clone(), new]; }
    let mut o = old.clone();
    for ch in 0..2 { for (j, b) in new.iter().enumerate() { o[ch][j].retune(b.clone()); } }
    o
}
/// Séparation du multibande en tranches (filtres Linkwitz-Riley 24 dB/oct aux limites des bandes) : recollées sans réglage,
/// les tranches redonnent le son au même volume à toutes les fréquences (seule la phase tourne, comme dans tout multibande).
/// Chaque tranche reçoit le gain des bandes qui la couvrent : une bande muette disparaît vraiment.
/// Même calcul que mkXo / le recollage du worklet `pulse-mband` (audio.js).
struct Xover {
    edges: Vec<f64>,
    /// par limite : passe-bas ×2, passe-haut ×2, passe-tout (un jeu par côté)
    lp: Vec<[[Biquad; 2]; 2]>,
    hp: Vec<[[Biquad; 2]; 2]>,
    ap: Vec<[Biquad; 2]>,
    /// par tranche : les bandes qui la couvrent (leur place dans `bands`), et son gain du moment
    cover: Vec<Vec<usize>>,
    gseg: Vec<f64>,
}
impl Xover {
    /// Limites d'une bande vues par la séparation (None = pas de limite de ce côté)
    fn band_edges(lo0: f64, hi0: f64, sr: f64) -> (Option<f64>, Option<f64>) {
        let lo = lo0.clamp(20.0, 20000.0);
        let hi = hi0.min(20000.0).min(sr * 0.45).max(lo * 1.05);
        ((lo > 20.5).then_some(lo), (hi0.min(20000.0) < 19999.0).then_some(hi))
    }
    fn coefs(f: f64, sr: f64) -> (Biquad, Biquad, Biquad) {
        let w = 2.0 * PI * f / sr;
        let (c, al) = (w.cos(), w.sin() / (2.0 * std::f64::consts::FRAC_1_SQRT_2));
        (Biquad::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al),
         Biquad::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al),
         Biquad::new(1.0 - al, -2.0 * c, 1.0 + al, 1.0 + al, -2.0 * c, 1.0 - al))
    }
    fn new(bands: &[MbBand], sr: f64, old: Option<&Xover>) -> Self {
        let mut edges: Vec<f64> = Vec::new();
        let be: Vec<(Option<f64>, Option<f64>)> = bands.iter().map(|b| Self::band_edges(b.lo, b.hi, sr)).collect();
        for (lo, hi) in &be { if let Some(v) = lo { edges.push(*v); } if let Some(v) = hi { edges.push(*v); } }
        edges.sort_by(|a, b| a.total_cmp(b));
        edges.dedup();
        let (mut lp, mut hp, mut ap) = (Vec::new(), Vec::new(), Vec::new());
        for (j, f) in edges.iter().enumerate() {
            let (l, h, a) = Self::coefs(*f, sr);
            // même nombre de limites : on garde la mémoire des filtres (pas de clic quand une limite est automatisée)
            match old.filter(|o| o.edges.len() == edges.len()) {
                Some(o) => {
                    let (mut l2, mut h2, mut a2) = (o.lp[j], o.hp[j], o.ap[j]);
                    for ch in 0..2 { for k in 0..2 { l2[ch][k].retune(l); h2[ch][k].retune(h); } a2[ch].retune(a); }
                    lp.push(l2); hp.push(h2); ap.push(a2);
                }
                None => { lp.push([[l; 2]; 2]); hp.push([[h; 2]; 2]); ap.push([a; 2]); }
            }
        }
        let cover = (0..=edges.len()).map(|j| {
            let (slo, shi) = (if j == 0 { 0.0 } else { edges[j - 1] }, if j == edges.len() { f64::INFINITY } else { edges[j] });
            be.iter().enumerate().filter(|(_, (lo, hi))| lo.unwrap_or(0.0) <= slo && shi <= hi.unwrap_or(f64::INFINITY)).map(|(i, _)| i).collect()
        }).collect::<Vec<Vec<usize>>>();
        let gseg = vec![1.0; edges.len() + 1];
        Self { edges, lp, hp, ap, cover, gseg }
    }
    /// Recolle un côté : tranche j = sous la limite j ; ce qui est déjà recollé passe par le passe-tout de la limite suivante
    #[inline]
    fn run(&mut self, ch: usize, x: f64) -> f64 {
        let (mut rest, mut acc) = (x, 0.0);
        for j in 0..self.edges.len() {
            let l1 = self.lp[j][ch][0].tick(rest);
            let low = self.lp[j][ch][1].tick(l1);
            let h1 = self.hp[j][ch][0].tick(rest);
            rest = self.hp[j][ch][1].tick(h1);
            if j > 0 { acc = self.ap[j][ch].tick(acc); }
            acc += self.gseg[j] * low;
        }
        acc + self.gseg[self.edges.len()] * rest
    }
}

pub struct MultiBand { bands: Vec<MbBand>, any_solo: bool, sr: f64, xo: Xover }
impl MultiBand {
    /// afficheur : par bande, le gain dynamique le plus marqué (dB) et le niveau (dB)
    fn take_meter(&mut self) -> (Vec<f32>, Vec<f32>) {
        let g = self.bands.iter().map(|b| b.mg as f32).collect();
        let e = self.bands.iter().map(|b| (20.0 * b.env.max(1e-9).log10()) as f32).collect();
        self.bands.iter_mut().for_each(|b| b.mg = 0.0);
        (g, e)
    }
    /// Filtres d'une bande (refaits quand ses limites sont automatisées), même calcul que mkKs dans pulse-mband
    fn make_ks(lo0: f64, hi0: f64, sr: f64) -> Vec<Biquad> {
        let biq = |hp: bool, f: f64| {
            let w = 2.0 * PI * f / sr;
            let (c, al) = (w.cos(), w.sin() / (2.0 * std::f64::consts::FRAC_1_SQRT_2));
            if hp { Biquad::new((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al) }
            else { Biquad::new((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + al, -2.0 * c, 1.0 - al) }
        };
        let lo = lo0.clamp(20.0, 20000.0);
        let hi = hi0.min(20000.0).min(sr * 0.45).max(lo * 1.05);
        let mut ks = Vec::new();
        if lo > 20.5 { ks.push(biq(true, lo)); ks.push(biq(true, lo)); }
        if hi < 19999.0 { ks.push(biq(false, hi)); ks.push(biq(false, hi)); }
        ks
    }
    pub fn new(p: &crate::model::MbandParams, sr: f64) -> Option<Self> {
        let co = |ms: f64| 1.0 - (-1.0 / (ms.max(0.05) / 1000.0 * sr)).exp();
        let bands: Vec<MbBand> = p.bands.iter().enumerate().filter(|(_, b)| b.on != Some(false)).take(6).map(|(idx, b)| {
            let ks = Self::make_ks(b.lo.unwrap_or(20.0), b.hi.unwrap_or(20000.0), sr);
            MbBand { lo: b.lo.unwrap_or(20.0), hi: b.hi.unwrap_or(20000.0), ks: [ks.clone(), ks], gl: 1.0, mg: 0.0, env: 0.0, att: co(b.att.unwrap_or(10.0)), rel: co(b.rel.unwrap_or(120.0)), thr: b.thr.unwrap_or(-30.0),
                range: b.range.unwrap_or(-6.0).clamp(-24.0, 24.0), out: b.out.unwrap_or(0.0).clamp(-24.0, 24.0), solo: b.solo.unwrap_or(false), mute: b.mute.unwrap_or(false), idx }
        }).collect();
        if bands.is_empty() { return None; }
        let any_solo = bands.iter().any(|b| b.solo);
        let xo = Xover::new(&bands, sr, None);
        Some(Self { bands, any_solo, sr, xo })
    }
    /// Automation d'un réglage de bande (mêmes règles que le worklet pulse-mband)
    fn set(&mut self, idx: usize, field: &str, v: f64) {
        let sr = self.sr;
        let co = |ms: f64| 1.0 - (-1.0 / (ms.max(0.05) / 1000.0 * sr)).exp();
        let Some(b) = self.bands.iter_mut().find(|b| b.idx == idx) else { return };
        if (field == "lo" && b.lo != v) || (field == "hi" && b.hi != v) {
            if field == "lo" { b.lo = v } else { b.hi = v }
            b.ks = retune_all(&b.ks, Self::make_ks(b.lo, b.hi, sr));
            self.xo = Xover::new(&self.bands, sr, Some(&self.xo));
            return;
        }
        match field { "thr" => b.thr = v, "range" => b.range = v.clamp(-24.0, 24.0), "out" => b.out = v.clamp(-24.0, 24.0), "att" => b.att = co(v), "rel" => b.rel = co(v), _ => {} }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        // 1. chaque bande mesure sa zone (filtres de détection) et calcule son gain
        for b in &mut self.bands {
            let mut pk = 0.0f64;
            for ch in 0..nc {
                let mut s = x[ch];
                for f in &mut b.ks[ch] { s = f.tick(s); }
                pk = pk.max(s.abs());
            }
            b.env += (pk - b.env) * if pk > b.env { b.att } else { b.rel };
            let over = 20.0 * b.env.max(1e-9).log10() - b.thr;
            let gd = b.range * (over / 12.0).clamp(0.0, 1.0);
            b.gl = if b.mute { 0.0 } else { 10f64.powf((gd + b.out) / 20.0) };
            if gd.abs() > b.mg.abs() { b.mg = gd; }
        }
        // 2. chaque tranche prend le gain des bandes qui la couvrent (solo : seulement les tranches d'une bande en solo)
        for (j, cv) in self.xo.cover.iter().enumerate() {
            let solo_ok = !self.any_solo || cv.iter().any(|&i| self.bands[i].solo);
            self.xo.gseg[j] = if solo_ok { cv.iter().fold(1.0, |g, &i| g * self.bands[i].gl) } else { 0.0 };
        }
        // 3. on découpe et on recolle
        for ch in 0..nc { x[ch] = self.xo.run(ch, x[ch]); }
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
    /// afficheur : crête du son, niveau dans la zone, réduction (dB) depuis la dernière lecture
    m_v: f64,
    m_s: f64,
    m_r: f64,
    /// Plugin : « Écouter » (0 = la voix, 1 = seulement la zone des « s ») et Séparé (0) / Large (1), passages en fondu
    lmix: f64,
    wmix: f64,
    glide: Glide,
}
impl DeesserV2 {
    /// Plugin : afficheur (crête du son, niveau dans la zone, réduction en dB, niveau global) depuis la dernière lecture
    pub fn meter_take(&mut self) -> [f32; 4] { self.take_meter() }
    /// Plugin : écouter seulement ce qui est détecté (fondu de ~10 ms)
    pub fn set_listen(&mut self, on: bool) { let t = if on { 1.0 } else { 0.0 }; if t != self.glide.to[0] { self.glide.aim(t, self.glide.to[1]); } }
    /// Plugin : nouveaux réglages sans repartir de zéro (filtres et enveloppes gardés)
    pub fn retune(&mut self, p: &crate::model::DeessParams, sr: f64) {
        let n = Self::new(p, sr);
        for ch in 0..2 { self.hp[ch].retune(n.hp[ch]); self.lpf[ch].retune(n.lpf[ch]); }
        self.k = n.k;
        self.thr = n.thr;
        self.range = n.range;
        let w = if n.wide { 1.0 } else { 0.0 };
        if w != self.glide.to[1] { self.glide.aim(self.glide.to[0], w); }
        self.wide = n.wide;
        self.rel = n.rel;
    }
    pub fn process(&mut self, x: &mut [f64; 2], nc: usize) { self.tick(x, nc) }
    /// Fondus terminés tout de suite
    pub fn settle(&mut self) { self.glide.land(&mut self.lmix, &mut self.wmix); }
    fn take_meter(&mut self) -> [f32; 4] {
        let m = [self.m_v as f32, self.m_s as f32, self.m_r as f32, self.env_f as f32];
        self.m_v = 0.0; self.m_s = 0.0; self.m_r = 0.0;
        m
    }
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
            m_v: 0.0, m_s: 0.0, m_r: 0.0,
            lmix: 0.0, wmix: if p.wide.unwrap_or(false) { 1.0 } else { 0.0 },
            glide: { let mut g = Glide::new(sr); g.to = [0.0, if p.wide.unwrap_or(false) { 1.0 } else { 0.0 }]; g },
        }
    }
    fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        self.glide.step(&mut self.lmix, &mut self.wmix);
        let mut band = [0.0f64; 2];
        let (mut pk_b, mut pk_f) = (0.0f64, 0.0f64);
        let mut hs = [0.0f64; 2];
        for ch in 0..nc {
            let b = self.lpf[ch].tick(self.hp[ch].tick(x[ch]));
            band[ch] = b;
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
            let (large, sep) = (x[ch] * self.gain, x[ch] + hs[ch] * (self.gain - 1.0));
            let y = if self.wmix >= 1.0 { large } else if self.wmix <= 0.0 { sep } else { sep + (large - sep) * self.wmix };
            x[ch] = if self.lmix > 0.0 { y + (band[ch] - y) * self.lmix } else { y };
        }
        if pk_f > self.m_v { self.m_v = pk_f; }
        if self.env_b > self.m_s { self.m_s = self.env_b; }
        let rd = -20.0 * self.gain.max(1e-9).log10();
        if rd > self.m_r { self.m_r = rd; }
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

/// Vitesse (Hz) d'un mouvement calé sur le tempo : un cycle dure `beats` temps (même calcul que modSyncRate dans audio.js)
fn mod_sync_rate(bpm: f64, beats: f64) -> f64 { (if bpm > 0.0 { bpm } else { 90.0 }) / 60.0 / beats }

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
    /// Temps entendu : il glisse vers `time` quand on tourne le bouton (un saut de temps = un clic)
    time_s: f64,
    width: f64,
    off: f64,
    /// vitesse calée sur le tempo : durée d'un cycle en temps
    beats: Option<f64>,
    sr: f64,
    buf: [Vec<f64>; 2],
    w: usize,
    ph: f64,
    z: [[f64; 4]; 2],
    prev: [f64; 2],
}

impl ModFx {
    fn new(kind: ModKind, p: &ModParams, sr: f64, bpm: f64) -> Self {
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
        let beats = (matches!(kind, ModKind::Chorus | ModKind::Flanger | ModKind::Phaser | ModKind::Tremolo) && p.sync.unwrap_or(0.0) > 0.0)
            .then(|| p.beats.filter(|b| *b > 0.0).unwrap_or(1.0));
        Self {
            kind,
            rate: if kind == ModKind::Doubler { rate } else if let Some(b) = beats { mod_sync_rate(bpm, b) } else { p.rate.unwrap_or(rate) },
            beats,
            depth: p.depth.unwrap_or(depth),
            fb: p.feedback.unwrap_or(fb) / 100.0,
            mix: p.mix.unwrap_or(mix) / 100.0,
            time: p.time.unwrap_or(110.0) / 1000.0,
            time_s: p.time.unwrap_or(110.0) / 1000.0,
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
        if self.time_s != self.time {
            self.time_s += (self.time - self.time_s) / (0.05 * self.sr);
            if (self.time - self.time_s).abs() < 1e-7 { self.time_s = self.time; }
        }
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
                        _ => self.time_s,
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
pub struct Gate {
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
    /// afficheur : niveau vu par le gate (max) et gain appliqué (min) depuis la dernière lecture
    m_env: f64,
    m_gain: f64,
    /// Plugin : « Écouter » (0 = le son, 1 = ce que le déclencheur entend), passage en fondu
    lmix: f64,
    spare: f64,
    glide: Glide,
}

impl Gate {
    /// Plugin : afficheur (niveau vu par le gate, gain le plus bas) depuis la dernière lecture
    pub fn meter_take(&mut self) -> [f32; 2] { self.take_meter() }
    /// Plugin : écouter le déclencheur (filtré), en fondu
    pub fn set_listen(&mut self, on: bool) { let t = if on { 1.0 } else { 0.0 }; if t != self.glide.to[0] { self.glide.aim(t, 0.0); } }
    pub fn settle(&mut self) { self.glide.land(&mut self.lmix, &mut self.spare); }
    pub fn process(&mut self, x: &mut [f64; 2], nc: usize) { self.tick(x, nc) }
    /// Plugin : nouveaux réglages sans repartir de zéro (enveloppe, maintien, gain, filtres gardés)
    pub fn retune(&mut self, p: &GateParams, sr: f64) {
        let mut n = Self::new(p, sr);
        n.env = self.env; n.left = self.left; n.gain = self.gain;
        if n.hp.is_some() == self.hp.is_some() { n.zh = self.zh; }
        if n.lp.is_some() == self.lp.is_some() { n.zl = self.zl; }
        n.m_env = self.m_env; n.m_gain = self.m_gain;
        n.lmix = self.lmix; n.spare = self.spare; n.glide = self.glide;
        *self = n;
    }
    pub fn new(p: &GateParams, sr: f64) -> Self {
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
            m_env: 0.0,
            m_gain: 1.0,
            lmix: 0.0, spare: 0.0, glide: Glide::new(sr),
        }
    }
    fn take_meter(&mut self) -> [f32; 2] {
        let m = [self.m_env as f32, self.m_gain as f32];
        self.m_env = 0.0; self.m_gain = 1.0;
        m
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
        self.glide.step(&mut self.lmix, &mut self.spare);
        let mut pk = 0.0f64;
        let mut det = [0.0f64; 2];
        for ch in 0..nc {
            let mut d = x[ch];
            if let Some(k) = &self.hp { d = run(k, &mut self.zh[ch], d); }
            if let Some(k) = &self.lp { d = run(k, &mut self.zl[ch], d); }
            det[ch] = d;
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
        for (ch, v) in x[..nc].iter_mut().enumerate() {
            *v *= self.gain;
            if self.lmix > 0.0 { *v += (det[ch] - *v) * self.lmix; }
        }
        if self.env > self.m_env { self.m_env = self.env; }
        if self.gain < self.m_gain { self.m_gain = self.gain; }
    }
}

/// Plugins : un réglage de volume tourné (quantité, mélange…) glisse en ~10 ms vers sa nouvelle valeur au lieu de
/// sauter (un saut = un clic). Il n'agit qu'après un `retune` : sans changement, le son reste identique à l'échantillon.
#[derive(Clone, Copy, Debug)]
struct Glide { to: [f64; 2], k: f64, on: bool }
impl Glide {
    fn new(sr: f64) -> Self { Self { to: [0.0; 2], k: 1.0 - (-1.0 / (0.01 * sr)).exp(), on: false } }
    fn aim(&mut self, a: f64, b: f64) { self.to = [a, b]; self.on = true; }
    /// Saute directement à la cible
    fn land(&mut self, a: &mut f64, b: &mut f64) { if self.on { *a = self.to[0]; *b = self.to[1]; self.on = false; } }
    #[inline]
    fn step(&mut self, a: &mut f64, b: &mut f64) {
        if !self.on { return; }
        *a += (self.to[0] - *a) * self.k;
        *b += (self.to[1] - *b) * self.k;
        if (self.to[0] - *a).abs() < 1e-7 && (self.to[1] - *b).abs() < 1e-7 { *a = self.to[0]; *b = self.to[1]; self.on = false; }
    }
}

/// Compresseur : même calcul que le worklet `pulse-comp` de audio.js.
pub struct Compressor {
    glide: Glide,
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
    /// Crête du détecteur depuis la dernière lecture (point sur la courbe de la fenêtre, comme Pro-C)
    peak_in: f64,
    /// Coupe-bas du détecteur (deux étages d'un pôle, par canal) — 0 = éteint. Même calcul que le worklet `pulse-comp`.
    sc_c: f64,
    sc: [[f64; 2]; 2],
    /// Réduction maximale (dB)
    range: f64,
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
        n.sc = self.sc;
        let (mix, makeup) = (n.mix, n.makeup);
        n.mix = self.mix;
        n.makeup = self.makeup;
        n.glide = self.glide;
        n.glide.aim(mix, makeup);
        *self = n;
    }
    /// Automation de Pulse : la valeur est prise tout de suite (la courbe est déjà progressive)
    pub fn settle(&mut self) { self.glide.land(&mut self.mix, &mut self.makeup); }
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
            glide: Glide::new(sr),
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
            peak_in: 0.0,
            sc_c: { let f = p.sc_hp.unwrap_or(20.0); if f > 21.0 { 1.0 - (-2.0 * std::f64::consts::PI * f.min(500.0) / sr).exp() } else { 0.0 } },
            sc: [[0.0; 2]; 2],
            range: { let r = p.range.unwrap_or(40.0); if r >= 40.0 { 1e9 } else { r.max(0.0) } },
        }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        self.glide.step(&mut self.mix, &mut self.makeup);
        let m = self.mode;
        let mut pk = 0.0f64;
        for ch in 0..nc {
            let mut v = x[ch];
            if self.sc_c > 0.0 { let s = &mut self.sc[ch]; s[0] += (v - s[0]) * self.sc_c; v -= s[0]; s[1] += (v - s[1]) * self.sc_c; v -= s[1]; }
            pk = pk.max(v.abs());
        }
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
        if lvl > self.peak_in { self.peak_in = lvl; }
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
        if want > self.range { want = self.range; }
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
    glide: Glide,
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
    /// Écho calé sur le rythme : nombre de temps (None = temps en millisecondes, ne suit pas le tempo)
    beats: Option<f64>,
    sr: f64,
}

impl Delay {
    /// Le tempo change (piste de tempo) : nouvelle longueur d'écho, les répétitions en cours sont gardées
    /// (même recopie que `retune` ; même calcul que `setBpm` du worklet `pulse-delay`)
    pub fn set_bpm(&mut self, bpm: f64) {
        let Some(beats) = self.beats else { return };
        let time = 60.0 / if bpm > 0.0 { bpm } else { 90.0 } * beats;
        let new = ((time * self.sr).round() as usize).clamp(1, (4.0 * self.sr) as usize);
        let old = self.buf[0].len();
        if new == old { return; }
        for ch in 0..2 {
            let mut nb = vec![0.0; new];
            for k in 0..old.min(new) { nb[(new - 1 - k) % new] = self.buf[ch][(self.i + old - 1 - k) % old]; }
            self.buf[ch] = nb;
        }
        self.i = 0;
    }
    /// Valeurs de volume prises tout de suite, sans glisser
    pub fn settle(&mut self) { self.glide.land(&mut self.wet, &mut self.dry); }
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
        n.zh = self.zh;
        n.duck.env = self.duck.env;   // le ducking ne repart pas de zéro à chaque réglage
        let (wet, dry) = (n.wet, n.dry);
        n.wet = self.wet;
        n.dry = self.dry;
        n.glide = self.glide;
        n.glide.aim(wet, dry);
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
            glide: Glide::new(sr),
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
            beats: if p.ms.filter(|m| *m > 0.0).is_some() { None } else { Some(p.beats.filter(|b| *b > 0.0).unwrap_or(0.5)) },
            sr,
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
        self.glide.step(&mut self.wet, &mut self.dry);
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

/// Pitch « voix fidèle » (hauteur et formants séparés) : voir pitch.rs
pub use crate::pitch::Pitch;

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
    glide: Glide,
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
    /// Pré-délai qui glisse (seulement après un réglage tourné en lecture) : ligne, écriture, retard entendu, retard visé
    ring: Vec<f64>, rw: usize, rd: f64, rt: f64, sr_pre: f64,
    pi: usize,
}

impl Reverb {
    /// Valeurs de volume prises tout de suite, sans glisser
    pub fn settle(&mut self) { self.glide.land(&mut self.wet, &mut self.out); self.rd = self.rt; }
    /// Plugin : nouveaux réglages, la queue de reverb continue
    pub fn retune(&mut self, p: &ReverbParams, sr: f64) {
        let n = Self::new(p, sr);
        self.duck.amt = n.duck.amt;   // l'enveloppe du ducking continue
        self.kl = n.kl;
        self.kh = n.kh;
        let cur = if self.ring.is_empty() { self.pre.len() } else { self.rt as usize };
        if n.pre.len() != cur {
            // pré-délai tourné en lecture : on passe sur une longue ligne dont la lecture glisse vers le nouveau temps
            // (avant : la ligne était vidée à chaque cran = un trou, donc un clic)
            if self.ring.is_empty() {
                let (old, size) = (self.pre.len(), (0.5 * sr) as usize + 8);
                self.ring = vec![0.0; size];
                self.rw = old % size;
                for k in 0..old { self.ring[(self.rw + size - 1 - k) % size] = self.pre[(self.pi + old - 1 - k) % old]; }
                self.rd = old as f64;
                self.pre = Vec::new(); self.pi = 0;
            }
            self.rt = n.pre.len() as f64;
        }
        self.glide.aim(n.wet, n.out);
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
            glide: Glide::new(sr),
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
            ring: Vec::new(), rw: 0, rd: 0.0, rt: 0.0, sr_pre: sr,
            pi: 0,
        }
    }
    /// Entrée mono (`nc` = 1) ou stéréo ; la sortie est toujours stéréo.
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        self.glide.step(&mut self.wet, &mut self.out);
        let mono = nc < 2;
        let scale = if mono { std::f64::consts::FRAC_1_SQRT_2 } else { 1.0 };
        let (dry, wet) = ((1.0 - self.wet) * scale, self.wet * 3.0 * self.out * scale);
        let (xl, xr) = (x[0], if mono { x[0] } else { x[1] });
        let mut input = (xl + xr) * 0.015;
        let dg = self.duck.gain((xl + xr) * 0.5);
        if self.kl != 0.0 { self.zl = input + (self.zl - input) * self.kl; input -= self.zl; }
        if self.kh != 0.0 { self.zh = input + (self.zh - input) * self.kh; input = self.zh; } else { self.zh = input; }
        if !self.ring.is_empty() {
            let size = self.ring.len();
            self.ring[self.rw] = input;
            if self.rd != self.rt { self.rd += (self.rt - self.rd) / (0.05 * self.sr_pre); if (self.rt - self.rd).abs() < 1e-3 { self.rd = self.rt; } }
            let pos = (self.rw as f64 - self.rd + size as f64) % size as f64;
            let i0 = pos.floor() as usize; let f = pos - i0 as f64;
            input = self.ring[i0 % size] + (self.ring[(i0 + 1) % size] - self.ring[i0 % size]) * f;
            self.rw = (self.rw + 1) % size;
        }
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
#[derive(Clone)]
pub struct Saturator {
    k: f64,
    tk: f64,
    trim: f64,
    /// chaleur 0 : même chemin (même retard, même filtre) mais sans courbe — pour le plugin, dont le retard ne doit jamais changer
    lin: bool,
    /// famille : « classique » = la saturation d'origine de Pulse, sinon une courbe de la Saturation multibande
    sty: &'static str,
    /// Entrée (gain avant la courbe), Sortie, Mélange (0 à 1)
    gin: f64,
    gout: f64,
    mix: f64,
    /// Ton (plus sombre / plus brillant), sur le son saturé seulement : étagère grave 300 Hz + étagère aigu 3 kHz
    tone: [[Biquad; 2]; 2],
    has_tone: bool,
    /// son d'origine passé par le même filtre (même retard) : pour le Mélange
    keep_dry: bool,
    /// réglages en cours [chaleur, entrée, ton, mélange, sortie] + volume égal (automation)
    knobs: [f64; 5],
    ag: bool,
    sr: f64,
    h: [f64; 64],
    xin: [[f64; 16]; 2],
    xs: [[f64; 64]; 2],
    pos: [usize; 2],
    dxin: [[f64; 16]; 2],
    dxs: [[f64; 64]; 2],
    dpos: [usize; 2],
}
/// Familles de la Saturation (« classique » d'abord : réglage de départ, celui des anciens projets)
pub const SAT_FAMILIES: [&str; 7] = ["classique", "bande", "lampe", "ampli", "transfo", "repli", "lofi"];
impl Saturator {
    fn blank() -> Self {
        let b = Biquad::gain(0.0);
        Self { k: 1.0, tk: 1f64.tanh(), trim: 1.0, lin: true, sty: "classique", gin: 1.0, gout: 1.0, mix: 1.0, tone: [[b; 2]; 2], has_tone: false, keep_dry: false, knobs: [0.0, 0.0, 0.0, 100.0, 0.0], ag: true, sr: 48_000.0,
            h: sat_fir(), xin: [[0.0; 16]; 2], xs: [[0.0; 64]; 2], pos: [0; 2], dxin: [[0.0; 16]; 2], dxs: [[0.0; 64]; 2], dpos: [0; 2] }
    }
    pub fn new(drive: f64) -> Option<Self> {
        (drive > 0.0).then(|| Self::with_drive(drive))
    }
    /// Saturation d'une piste (réglages du panneau). Chaleur 0 = pas d'effet (None), comme avant.
    pub fn from_params(p: &crate::model::SatParams, sr: f64) -> Option<Self> {
        (p.drive > 0.0).then(|| { let mut s = Self::blank(); s.configure(p, sr); s })
    }
    /// Retard en échantillons (mesuré : 15 tout rond) : annoncé au logiciel hôte par le plugin
    pub const LATENCY: u32 = 15;
    /// Comme `new`, mais chaleur 0 = le son passe tel quel par le même chemin (même retard)
    pub fn with_drive(drive: f64) -> Self {
        let mut s = Self::blank();
        s.set_drive(drive);
        s
    }
    /// Plugin : garder le son d'origine à jour en permanence (Mélange tourné en plein son sans trou)
    pub fn keep_dry(&mut self) { self.keep_dry = true; }
    /// Change la chaleur en gardant la mémoire des filtres (pas de trou dans le son)
    pub fn set_drive(&mut self, drive: f64) {
        self.knobs[0] = drive;
        self.apply_knobs();
    }
    /// Tous les réglages d'un coup, en gardant la mémoire des filtres
    pub fn configure(&mut self, p: &crate::model::SatParams, sr: f64) {
        self.sty = SAT_FAMILIES.iter().copied().find(|f| Some(*f) == p.sty.as_deref()).unwrap_or("classique");
        self.knobs = [p.drive, p.input.unwrap_or(0.0), p.tone.unwrap_or(0.0), p.mix.unwrap_or(100.0), p.out.unwrap_or(0.0)];
        self.ag = p.ag != Some(false);
        self.sr = sr;
        self.apply_knobs();
    }
    /// Automation : « drive », « input », « tone », « mix », « out » (mêmes noms que le panneau)
    pub fn set_live(&mut self, key: &str, v: f64) {
        let i = match key { "drive" => 0, "input" => 1, "tone" => 2, "mix" => 3, "out" => 4, _ => return };
        if self.knobs[i] != v { self.knobs[i] = v; self.apply_knobs(); }
    }
    fn apply_knobs(&mut self) {
        let [drive, input, tone, mix, out] = self.knobs;
        let drive = drive.clamp(0.0, 100.0);
        self.gin = 10f64.powf(input.clamp(-12.0, 24.0) / 20.0);
        self.gout = 10f64.powf(out.clamp(-24.0, 12.0) / 20.0);
        self.mix = mix.clamp(0.0, 100.0) / 100.0;
        let ag = self.ag;
        self.lin = drive <= 0.0;
        if self.lin {
            self.k = 1.0; self.trim = if ag { 1.0 / self.gin } else { 1.0 };
        } else if self.sty == "classique" {
            let (k, trim) = sat_coeffs(drive).unwrap();
            self.k = k; self.trim = if ag { trim / self.gin } else { 1.0 };
        } else {
            self.k = 1.0 + drive / 100.0 * 7.0;
            self.trim = if ag { msat_trim(self.sty, self.k) / self.gin } else { 1.0 };
        }
        self.tk = self.k.tanh();
        let t = tone.clamp(-100.0, 100.0);
        self.has_tone = t != 0.0;
        if self.has_tone {
            // mêmes filtres que eq_sections (étagères à Q 0,707), sans liste : rien n'est alloué pendant le son
            let lo = eq_matched("lowshelf", 300.0, std::f64::consts::FRAC_1_SQRT_2, -t * 0.06, self.sr);
            let hi = eq_matched("highshelf", 3000.0, std::f64::consts::FRAC_1_SQRT_2, t * 0.06, self.sr);
            for ch in 0..2 { self.tone[0][ch].retune(lo); self.tone[1][ch].retune(hi); }
        }
    }
    #[inline]
    fn lin_path(h: &[f64; 64], xin: &mut [f64; 16], xs: &mut [f64; 64], pos: &mut usize, v: f64) -> f64 {
        xin.copy_within(0..15, 1);
        xin[0] = v;
        for p in 0..4 {
            let mut u = 0.0;
            for j in 0..16 { u += h[p + 4 * j] * xin[j]; }
            *pos = (*pos + 1) % 64;
            xs[*pos] = 4.0 * u;
        }
        let (mut out, mut idx) = (0.0, *pos);
        for hi in h.iter() { out += hi * xs[idx]; idx = (idx + 63) % 64; }
        out
    }
    #[inline]
    pub fn tick(&mut self, v: f64, ch: usize) -> f64 {
        let xin = &mut self.xin[ch];
        xin.copy_within(0..15, 1);
        xin[0] = v * self.gin;
        let (h, k, tk) = (&self.h, self.k, self.tk);
        let xs = &mut self.xs[ch];
        for p in 0..4 {
            let mut u = 0.0;
            for j in 0..16 { u += h[p + 4 * j] * xin[j]; }
            let y = if self.lin { 4.0 * u } else if self.sty == "classique" { (k * (4.0 * u).clamp(-1.0, 1.0)).tanh() / tk } else { msat_curve(self.sty, 4.0 * u, k) };
            self.pos[ch] = (self.pos[ch] + 1) % 64;
            xs[self.pos[ch]] = y;
        }
        let (mut out, mut idx) = (0.0, self.pos[ch]);
        for hi in h.iter() { out += hi * xs[idx]; idx = (idx + 63) % 64; }
        out *= self.trim;
        if self.has_tone { let [a, b] = &mut self.tone; out = b[ch].tick(a[ch].tick(out)); }
        if self.mix < 1.0 || self.keep_dry {
            let d = Self::lin_path(&self.h, &mut self.dxin[ch], &mut self.dxs[ch], &mut self.dpos[ch], v);
            if self.mix < 1.0 { out = d + (out - d) * self.mix; }
        }
        out * self.gout
    }
}
/// Un échantillon saturé, sans suréchantillonnage (plugin AU de saturation, gardé tel quel)
pub fn sat_tick(v: f64, k: f64, trim: f64) -> f64 {
    (k * v.clamp(-1.0, 1.0)).tanh() / k.tanh() * trim
}

/// Chaîne d'une piste : EQ → saturation → de-esser → compresseur → écho → reverb, les deux canaux liés.
/// Mesures pour les fenêtres de plugin (format attendu par la page, comme les messages des worklets)
#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct FxMeters {
    /// [niveau vu, gain]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<[f32; 2]>,
    /// [crête, niveau zone, réduction dB, niveau actuel]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deess: Option<[f32; 4]>,
    /// (gain dB par bande, niveau dB par bande)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mband: Option<(Vec<f32>, Vec<f32>)>,
    /// [crête entrée, crête sortie, gain]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<[f32; 3]>,
}

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
    mband: Option<MultiBand>,
    msat: Option<MultiSat>,
    comp: Option<Compressor>,
    master: Option<Master>,
    limit: Option<Limiter>,
    delay: Option<Delay>,
    reverb: Option<Reverb>,
    pitch: Option<Pitch>,
    /// Gamme Analogique (analog.rs) : la machine et ses réglages (pour l'automation)
    fet76: Option<(crate::analog::Fet76, crate::analog::Fet76Params)>,
    pre73: Option<(crate::analog::Pre73, crate::analog::Pre73Params)>,
    opto2a: Option<(crate::analog::Opto2A, crate::analog::Opto2AParams)>,
    eqp1: Option<(crate::analog::EqP1, crate::analog::EqP1Params)>,
    busg: Option<(crate::analog::BusG, crate::analog::BusGParams)>,
    tape: Option<(crate::analog::Tape, crate::analog::TapeParams)>,
    dtr: Option<(crate::analog::Dtr, crate::analog::DtrParams)>,
    stripe: Option<(crate::analog::StripE, crate::analog::StripEParams)>,
    eq550: Option<(crate::analog::Eq550, crate::analog::Eq550Params)>,
    comp25: Option<(crate::analog::Comp25, crate::analog::Comp25Params)>,
    bus33: Option<(crate::analog::Bus33, crate::analog::Bus33Params)>,
    massif: Option<(crate::analog::Massif, crate::analog::MassifParams)>,
    horizon: Option<(crate::horizon::Horizon, crate::horizon::HorizonParams)>,
    plate: Option<(crate::analog::Plate, crate::analog::PlateParams)>,
    techo: Option<(crate::analog::TapeEcho, crate::analog::TapeEchoParams)>,
    hall80: Option<(crate::analog::Hall80, crate::analog::Hall80Params)>,
    h910: Option<(crate::analog::H910, crate::analog::H910Params)>,
    dim: Option<(crate::analog::Dim, crate::analog::DimParams)>,
    prev76: Option<(crate::analog::PreV76, crate::analog::PreV76Params)>,
    eclat: Option<(crate::analog::Eclat, crate::analog::EclatParams)>,
    souffle: Option<(crate::analog::Souffle, crate::analog::SouffleParams)>,
    l670: Option<(crate::analog::L670, crate::analog::L670Params)>,
    order: Vec<Stage>,
    /// Automation des réglages d'effet (même liste de réglages que le navigateur, voir AUTO_FX dans studio.js)
    auto: Vec<AutoParam>,
    auto_from: f64,
    /// Échantillons déjà traités depuis `auto_from` (la chaîne peut être appelée bloc par bloc)
    pos: u64,
    /// Paliers de tempo `(seconde, bpm)` suivis par l'écho calé sur le rythme ; `tempo_i` = palier en cours
    tempo: Vec<(f64, f64)>,
    tempo_i: usize,
    sr: f64,
    comp_p: CompParams,
    /// Réglages de la reverb et de l'écho en cours (pour les recalculer sans les vider quand on tourne un bouton)
    reverb_p: ReverbParams,
    delay_p: DelayParams,
    bpm0: f64,
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
        ("comp", "scHp") => (20.0, 500.0, true),
        ("comp", "range") => (0.0, 40.0, false),
        ("delay", "wet") | ("delay", "dry") | ("reverb", "wet") => (0.0, 100.0, false),
        ("delay", "feedback") => (0.0, 85.0, false),
        ("util", "gain") => (-24.0, 24.0, false),
        ("width", "width") => (0.0, 200.0, false),
        ("filter", "hpf") => (20.0, 1000.0, true),
        ("filter", "lpf") => (1000.0, 20_000.0, true),
        ("deess", "amount") => (0.0, 100.0, false),
        ("deess", "thr") => (-60.0, 0.0, false),
        ("gate", "ratio") => (1.0, 100.0, true),
        ("gate", "knee") => (0.0, 24.0, false),
        ("gate", "attack") => (0.1, 50.0, true),
        ("gate", "hold") => (0.0, 500.0, false),
        ("msat", "mix") => (0.0, 100.0, false),
        ("sat", "drive") | ("sat", "mix") => (0.0, 100.0, false),
        ("sat", "input") => (-12.0, 24.0, false),
        ("sat", "tone") => (-100.0, 100.0, false),
        ("sat", "out") => (-12.0, 12.0, false),
        ("msat", "out") => (-12.0, 12.0, false),
        ("mband", k) | ("msat", k) if k.ends_with("-lo") || k.ends_with("-hi") => (20.0, 20000.0, true),
        ("mband", k) if k.ends_with("-thr") => (-60.0, 0.0, false),
        ("mband", k) if k.ends_with("-range") => (-24.0, 24.0, false),
        ("mband", k) if k.ends_with("-att") => (0.5, 200.0, true),
        ("mband", k) if k.ends_with("-rel") => (20.0, 1000.0, true),
        ("mband", k) if k.ends_with("-out") => (-12.0, 12.0, false),
        ("msat", k) if k.ends_with("-heat") || k.ends_with("-fb") || k.ends_with("-mix") => (0.0, 100.0, false),
        ("msat", k) if k.ends_with("-dyn") => (-50.0, 50.0, false),
        ("msat", k) if k.ends_with("-out") => (-24.0, 12.0, false),
        ("msat", k) if k.ends_with("-lo2") || k.ends_with("-md") || k.ends_with("-hi2") || k.ends_with("-pr") => (-12.0, 12.0, false),
        ("deess", "range") => (0.0, 24.0, false),
        ("limit", "ceiling") => (-12.0, 0.0, false),
        ("limit", "gain") => (0.0, 24.0, false),
        ("limit", "release") => (5.0, 2000.0, true),
        ("gate", "threshold") => (-70.0, -20.0, false),
        ("gate", "release") => (20.0, 500.0, false),
        ("gate", "reduction") => (6.0, 80.0, false),
        ("crush", "bits") => (4.0, 16.0, false),
        ("crush", "down") => (1.0, 32.0, false),
        ("crush", "mix") | ("pitch", "mix") => (0.0, 100.0, false),
        ("pitch", "semi") | ("pitch", "formant") => (-12.0, 12.0, false),
        ("fet76", "input") | ("fet76", "output") => (0.0, 48.0, false),
        ("fet76", "attack") | ("fet76", "release") => (1.0, 7.0, false),
        ("fet76", "mix") => (0.0, 100.0, false),
        ("pre73", "gain") => (0.0, 30.0, false),
        ("pre73", "output") => (-24.0, 12.0, false),
        ("pre73", "high") | ("pre73", "low") | ("pre73", "lmid") => (-16.0, 16.0, false),
        ("pre73", "mid") => (-18.0, 18.0, false),
        ("eqp1", "lowBoost") | ("eqp1", "lowAtten") | ("eqp1", "highBoost") | ("eqp1", "highAtten") | ("eqp1", "bw") => (0.0, 10.0, false),
        ("eqp1", "output") => (-12.0, 12.0, false),
        ("dtr", "input") | ("dtr", "output") | ("dtr", "attack") | ("dtr", "release") => (0.0, 10.0, false),
        ("dtr", "mix") => (0.0, 100.0, false),
        ("stripe", "lf") | ("stripe", "hf") => (-16.5, 16.5, false),
        ("stripe", "lmf") | ("stripe", "hmf") => (-15.0, 15.0, false),
        ("stripe", "cthr") => (-30.0, 10.0, false),
        ("stripe", "output") => (-20.0, 20.0, false),
        ("eq550", "lf") | ("eq550", "mf") | ("eq550", "hf") | ("eq550", "output") => (-12.0, 12.0, false),
        ("comp25", "thr") => (-20.0, 10.0, false),
        ("comp25", "makeup") => (0.0, 20.0, false),
        ("comp25", "mix") => (0.0, 100.0, false),
        ("bus33", "cthr") => (-20.0, 10.0, false),
        ("bus33", "lthr") => (-12.0, 0.0, false),
        ("bus33", "makeup") => (0.0, 20.0, false),
        ("bus33", "mix") => (0.0, 100.0, false),
        ("massif", "g1") | ("massif", "g2") | ("massif", "g3") | ("massif", "g4") => (-20.0, 20.0, false),
        ("massif", "output") => (-12.0, 12.0, false),
        ("horizon", k) if k.starts_with('g') && k.len() == 2 => (-18.0, 18.0, false),
        ("horizon", "earth") | ("horizon", "air") => (0.0, 10.0, false),
        ("horizon", "strength") => (0.0, 150.0, false),
        ("horizon", "output") => (-18.0, 18.0, false),
        ("plate", "decay") => (0.4, 6.0, false),
        ("plate", "mix") | ("plate", "bright") => (0.0, 100.0, false),
        ("plate", "pre") => (0.0, 200.0, false),
        ("techo", "rate") => (0.5, 2.0, false),
        ("techo", "intensity") => (0.0, 120.0, false),
        ("techo", "echo") | ("techo", "spring") => (0.0, 100.0, false),
        ("hall80", "decay") => (0.3, 20.0, false),
        ("hall80", "pre") => (0.0, 200.0, false),
        ("hall80", "size") => (50.0, 150.0, false),
        ("hall80", "bass") => (0.5, 2.5, false),
        ("hall80", "xover") => (100.0, 1500.0, true),
        ("hall80", "treble") => (1000.0, 16000.0, true),
        ("hall80", "diffusion") | ("hall80", "spin") | ("hall80", "mix") => (0.0, 100.0, false),
        ("hall80", "width") => (0.0, 150.0, false),
        ("h910", "pitchL") | ("h910", "pitchR") => (-12.0, 12.0, false),
        ("h910", "delay") => (0.0, 120.0, false),
        ("h910", "feedback") => (0.0, 90.0, false),
        ("h910", "mix") => (0.0, 100.0, false),
        ("dim", "mix") => (0.0, 100.0, false),
        ("dim", "width") => (0.0, 150.0, false),
        ("prev76", "gain") => (0.0, 36.0, false),
        ("prev76", "output") => (-36.0, 12.0, false),
        ("eclat", "intensity") => (0.0, 10.0, false),
        ("eclat", "output") => (-18.0, 12.0, false),
        ("eclat", "noise") => (0.0, 100.0, false),
        ("souffle", "mid") | ("souffle", "high") => (0.0, 100.0, false),
        ("souffle", "trim") => (-12.0, 12.0, false),
        ("busg", "thr") => (-30.0, 0.0, false),
        ("tape", "input") => (-12.0, 18.0, false),
        ("l670", "input") => (-10.0, 20.0, false),
        ("l670", "thr") => (0.0, 10.0, false),
        ("l670", "output") => (-20.0, 20.0, false),
        ("l670", "mix") => (0.0, 100.0, false),
        ("tape", "output") => (-12.0, 12.0, false),
        ("tape", "bias") => (-100.0, 100.0, false),
        ("tape", "noise") | ("tape", "wow") | ("tape", "mix") => (0.0, 100.0, false),
        ("busg", "makeup") => (0.0, 15.0, false),
        ("busg", "mix") => (0.0, 100.0, false),
        ("opto2a", "gain") | ("opto2a", "peak") | ("opto2a", "emph") | ("opto2a", "mix") => (0.0, 100.0, false),
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
        let sat = if has("sat") { effect_params.sat.as_ref().and_then(|p| Saturator::from_params(p, sr)) } else { None };
        let de = effect_params.deess.clone().unwrap_or_default();
        let deess2 = (has("deess") && de.thr.is_some()).then(|| DeesserV2::new(&de, sr));
        let msat = if has("msat") { effect_params.msat.as_ref().and_then(|m| MultiSat::new(m, sr)) } else { None };
        let mband = if has("mband") { effect_params.mband.as_ref().and_then(|m| MultiBand::new(m, sr)) } else { None };
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
                modfx.push((st, ModFx::new(kind, &p.clone().unwrap_or_default(), sr, bpm)));
            }
        }
        let comp = has("comp").then(|| Compressor::new(&effect_params.comp.clone().unwrap_or_default(), sr));
        let reverb = has("reverb").then(|| Reverb::new(&effect_params.reverb.clone().unwrap_or_default(), sr));
        let delay = has("delay").then(|| Delay::new(&effect_params.delay.clone().unwrap_or_default(), sr, bpm));
        let master = has("master").then(|| Master::new(&effect_params.master.clone().unwrap_or_default(), sr));
        let limit = has("limit").then(|| Limiter::with(&effect_params.limit.clone().unwrap_or_default(), ceiling_db, sr));
        let pitch = (has("pitch") && effect_params.pitch.as_ref().is_some_and(|p| p.semi.unwrap_or(0.0) != 0.0 || p.formant.unwrap_or(0.0) != 0.0))
            .then(|| Pitch::new(&effect_params.pitch.clone().unwrap_or_default(), sr));
        let fet76 = has("fet76").then(|| { let p = crate::analog::Fet76Params::from(&effect_params.fet76.clone().unwrap_or_default()); (crate::analog::Fet76::new(&p, sr), p) });
        let pre73 = has("pre73").then(|| { let p = crate::analog::Pre73Params::from(&effect_params.pre73.clone().unwrap_or_default()); (crate::analog::Pre73::new(&p, sr), p) });
        let opto2a = has("opto2a").then(|| { let p = crate::analog::Opto2AParams::from(&effect_params.opto2a.clone().unwrap_or_default()); (crate::analog::Opto2A::new(&p, sr), p) });
        let eqp1 = has("eqp1").then(|| { let p = crate::analog::EqP1Params::from(&effect_params.eqp1.clone().unwrap_or_default()); (crate::analog::EqP1::new(&p, sr), p) });
        let busg = has("busg").then(|| { let p = crate::analog::BusGParams::from(&effect_params.busg.clone().unwrap_or_default()); (crate::analog::BusG::new(&p, sr), p) });
        let tape = has("tape").then(|| { let p = crate::analog::TapeParams::from(&effect_params.tape.clone().unwrap_or_default()); (crate::analog::Tape::new(&p, sr), p) });
        let l670 = has("l670").then(|| { let p = crate::analog::L670Params::from(&effect_params.l670.clone().unwrap_or_default()); (crate::analog::L670::new(&p, sr), p) });
        let dtr = has("dtr").then(|| { let p = crate::analog::DtrParams::from(&effect_params.dtr.clone().unwrap_or_default()); (crate::analog::Dtr::new(&p, sr), p) });
        let stripe = has("stripe").then(|| { let p = crate::analog::StripEParams::from(&effect_params.stripe.clone().unwrap_or_default()); (crate::analog::StripE::new(&p, sr), p) });
        let eq550 = has("eq550").then(|| { let p = crate::analog::Eq550Params::from(&effect_params.eq550.clone().unwrap_or_default()); (crate::analog::Eq550::new(&p, sr), p) });
        let comp25 = has("comp25").then(|| { let p = crate::analog::Comp25Params::from(&effect_params.comp25.clone().unwrap_or_default()); (crate::analog::Comp25::new(&p, sr), p) });
        let bus33 = has("bus33").then(|| { let p = crate::analog::Bus33Params::from(&effect_params.bus33.clone().unwrap_or_default()); (crate::analog::Bus33::new(&p, sr), p) });
        let massif = has("massif").then(|| { let p = crate::analog::MassifParams::from(&effect_params.massif.clone().unwrap_or_default()); (crate::analog::Massif::new(&p, sr), p) });
        let horizon = has("horizon").then(|| { let p = crate::horizon::HorizonParams::from(&effect_params.horizon.clone().unwrap_or_default()); (crate::horizon::Horizon::new(&p, sr), p) });
        let plate = has("plate").then(|| { let p = crate::analog::PlateParams::from(&effect_params.plate.clone().unwrap_or_default()); (crate::analog::Plate::new(&p, sr), p) });
        let techo = has("techo").then(|| { let p = crate::analog::TapeEchoParams::from(&effect_params.techo.clone().unwrap_or_default()); (crate::analog::TapeEcho::new(&p, sr), p) });
        let hall80 = has("hall80").then(|| { let p = crate::analog::Hall80Params::from(&effect_params.hall80.clone().unwrap_or_default()); (crate::analog::Hall80::new(&p, sr), p) });
        let h910 = has("h910").then(|| { let p = crate::analog::H910Params::from(&effect_params.h910.clone().unwrap_or_default()); (crate::analog::H910::new(&p, sr), p) });
        let dim = has("dim").then(|| { let p = crate::analog::DimParams::from(&effect_params.dim.clone().unwrap_or_default()); (crate::analog::Dim::new(&p, sr), p) });
        let prev76 = has("prev76").then(|| { let p = crate::analog::PreV76Params::from(&effect_params.prev76.clone().unwrap_or_default()); (crate::analog::PreV76::new(&p, sr), p) });
        let eclat = has("eclat").then(|| { let p = crate::analog::EclatParams::from(&effect_params.eclat.clone().unwrap_or_default()); (crate::analog::Eclat::new(&p, sr), p) });
        let souffle = has("souffle").then(|| { let p = crate::analog::SouffleParams::from(&effect_params.souffle.clone().unwrap_or_default()); (crate::analog::Souffle::new(&p, sr), p) });
        let comp_p = effect_params.comp.clone().unwrap_or_default();
        Self { cut, filters, dyn_eq, sat, gate, crush, util, width, modfx, deess, deess2, mband, msat, comp, master, limit, delay, reverb, pitch, fet76, pre73, opto2a, eqp1, busg, tape, l670, dtr, stripe, eq550, comp25, bus33, massif, horizon, plate, techo, hall80, h910, dim, prev76, eclat, souffle, order: Stage::DEFAULT.to_vec(),
            auto: Vec::new(), auto_from: 0.0, pos: 0, tempo: Vec::new(), tempo_i: 0, sr, comp_p, reverb_p: effect_params.reverb.clone().unwrap_or_default(), delay_p: effect_params.delay.clone().unwrap_or_default(), bpm0: bpm, eq_bands, cut_kinds, names: effects.to_vec(), deess_freq: de.freq.unwrap_or(5500.0) }
    }
    /// Tempo qui change en cours de morceau : l'écho calé sur le rythme (1/4, 1/8…) suit le tempo de l'endroit joué.
    /// `from` = instant du premier échantillon traité (le même que pour `with_auto`).
    pub fn with_tempo(mut self, segs: Vec<(f64, f64)>, from: f64) -> Self {
        if segs.len() < 2 { return self; }
        let i = segs.iter().rposition(|s| s.0 <= from + 1e-9).unwrap_or(0);
        if let Some(d) = &mut self.delay { d.set_bpm(segs[i].1); }
        // mouvements calés sur le tempo : la vitesse du tempo de départ (comme le navigateur)
        for (_, f) in &mut self.modfx { if let Some(b) = f.beats { f.rate = mod_sync_rate(segs[i].1, b); } }
        self.tempo = segs;
        self.tempo_i = i;
        self.auto_from = from;
        self
    }
    /// Saut dans le morceau (tour de boucle) : les effets gardent leur état, les courbes et le tempo repartent de `t`
    pub fn seek(&mut self, t: f64) {
        self.auto_from = t;
        self.pos = 0;
        if self.tempo.len() >= 2 {
            let i = self.tempo.iter().rposition(|s| s.0 <= t + 1e-9).unwrap_or(0);
            if i != self.tempo_i { if let Some(d) = &mut self.delay { d.set_bpm(self.tempo[i].1); } }
            self.tempo_i = i;
        }
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
        for i in 0..self.auto.len() {
            let a = &self.auto[i];
            let n = a.curve.at(t).clamp(0.0, 1.0);
            let v = if a.log && a.min > 0.0 { a.min * (a.max / a.min).powf(n) } else { a.min + n * (a.max - a.min) };
            let (fx, key) = (a.fx.clone(), a.key.clone());
            comp_changed |= self.set_live(&fx, &key, v);
        }
        if comp_changed {
            let p = self.comp_p.clone();
            if let Some(c) = &mut self.comp { c.retune(&p, self.sr); c.settle(); }
        }
    }
    /// Un réglage d'effet changé en direct (automation de Pulse, ou réglage d'un plugin), en unités du panneau de Pulse.
    /// Renvoie vrai si le compresseur doit être recalculé (`retune`).
    pub fn set_live(&mut self, fx: &str, key: &str, v: f64) -> bool {
        let mut comp_changed = false;
        let mut cut_changed = false;
        match (fx, key) {
            ("comp", k) => {
                let p = &mut self.comp_p;
                match k { "threshold" => p.threshold = Some(v), "ratio" => p.ratio = Some(v), "mix" => p.mix = Some(v), "attack" => p.attack = Some(v),
                    "release" => p.release = Some(v), "knee" => p.knee = Some(v), "makeup" => p.makeup = Some(v), "scHp" => p.sc_hp = Some(v), "range" => p.range = Some(v), _ => {} }
                comp_changed = true;
            }
            ("delay", k) => if let Some(d) = &mut self.delay {
                let p = &mut self.delay_p;
                match k { "wet" => { p.wet = Some(v); d.wet = (v / 100.0).clamp(0.0, 1.0) } "dry" => { p.dry = Some(v); d.dry = v / 100.0 } "feedback" => { p.feedback = Some(v); d.fb = (v / 100.0).clamp(0.0, 0.9) }
                    // filtres et ducking de l'écho : recalculés sans vider les répétitions en cours
                    "duck" | "hpf" | "lpf" => {
                        match k { "duck" => p.duck = Some(v), "hpf" => p.hpf = Some(v), _ => p.lpf = Some(v) }
                        let bpm = if self.tempo.len() >= 2 { self.tempo[self.tempo_i].1 } else { self.bpm0 };
                        d.retune(p, self.sr, bpm); d.settle();
                    }
                    _ => {} }
            },
            ("reverb", k) => if let Some(r) = &mut self.reverb {
                let p = &mut self.reverb_p;
                match k {
                    "wet" => { p.wet = Some(v); r.wet = (v / 100.0).clamp(0.0, 1.0); }
                    // taille, déclin, pré-délai, filtres, brillance, largeur : recalculés sans couper la queue en cours
                    "size" | "decay" | "pre" | "duck" | "low" | "high" | "bright" | "width" => {
                        match k { "size" => p.size = Some(v), "decay" => p.decay = Some(v), "pre" => p.pre = Some(v), "duck" => p.duck = Some(v), "low" => p.low = Some(v), "high" => p.high = Some(v), "bright" => p.bright = Some(v), _ => p.width = Some(v) }
                        r.retune(p, self.sr);   // pas de settle : le pré-délai et la quantité glissent
                    }
                    _ => {} }
            },
            ("util", "gain") => if let Some(u) = &mut self.util { let sign = if u.g < 0.0 { -1.0 } else { 1.0 }; u.g = 10f64.powf(v / 20.0) * sign; },
            ("width", "width") => if let Some(w) = &mut self.width { w.width = v / 100.0; },
            ("deess", "thr") => if let Some(d) = &mut self.deess2 { d.thr = v; },
            ("mband", k) => if let Some(m) = &mut self.mband {
                if let Some((i, f)) = k.strip_prefix('b').and_then(|r| r.split_once('-')) { if let Ok(i) = i.parse::<usize>() { m.set(i, f, v); } }
            },
            ("msat", k) => if let Some(m) = &mut self.msat { m.set(k, v); },
            ("sat", k) => if let Some(m) = &mut self.sat { m.set_live(k, v); },
            ("deess", "range") => if let Some(d) = &mut self.deess2 { d.range = v.clamp(0.0, 30.0); },
            ("limit", k) => if let Some(l) = &mut self.limit {
                match k { "ceiling" => l.thr = 10f64.powf(v / 20.0).min(1.0), "gain" => l.g = 10f64.powf(v / 20.0),
                    "release" => l.rel = 1.0 - (-1.0 / (v.clamp(1.0, 2000.0) * l.rm / 1000.0 * self.sr)).exp(), _ => {} }
            },
            ("deess", "amount") => if let Some(d) = &mut self.deess { let a = v.clamp(0.0, 100.0); d.max_red = a * 0.24; d.slope = a / 100.0 * 3.0; },
            ("gate", k) => if let Some(g) = &mut self.gate {
                let sr = self.sr;
                match k { "threshold" => { g.thr = 10f64.powf(v / 20.0); g.thr_db = v; } "reduction" => { g.floor = 10f64.powf(-v / 20.0); g.range = v; }
                    "release" => g.g_rel = 1.0 - (-1.0 / ((v / 1000.0).max(0.005) * sr)).exp(),
                    "ratio" => g.ratio = if v >= 99.0 { 0.0 } else { v.max(1.0) }, "knee" => g.knee = v.max(0.0),
                    "attack" => g.g_att = 1.0 - (-1.0 / ((v / 1000.0).max(0.0001) * sr)).exp(), "hold" => g.hold = (v.max(0.0) / 1000.0 * sr).round() as usize, _ => {} }
            },
            ("crush", k) => if let Some(c) = &mut self.crush {
                match k { "bits" => c.q = 2f64.powf(v - 1.0), "down" => c.down = (v.round() as usize).max(1), "mix" => c.mix = v / 100.0, _ => {} }
            },
            ("pitch", k) => if let Some(p) = &mut self.pitch { p.set_live(k, v); },
            ("fet76", k) => if let Some((m, p)) = &mut self.fet76 { if p.set_key(k, v) { m.set(p); } },
            ("pre73", k) => if let Some((m, p)) = &mut self.pre73 { if p.set_key(k, v) { m.set(p, self.sr); } },
            ("opto2a", k) => if let Some((m, p)) = &mut self.opto2a { if p.set_key(k, v) { m.set(p); } },
            ("eqp1", k) => if let Some((m, p)) = &mut self.eqp1 { if p.set_key(k, v) { m.set(p, self.sr); } },
            ("dtr", k) => if let Some((m, p)) = &mut self.dtr { if p.set_key(k, v) { m.set(p); } },
            ("stripe", k) => if let Some((m, p)) = &mut self.stripe { if p.set_key(k, v) { m.set(p); } },
            ("eq550", k) => if let Some((m, p)) = &mut self.eq550 { if p.set_key(k, v) { m.set(p); } },
            ("comp25", k) => if let Some((m, p)) = &mut self.comp25 { if p.set_key(k, v) { m.set(p); } },
            ("bus33", k) => if let Some((m, p)) = &mut self.bus33 { if p.set_key(k, v) { m.set(p); } },
            ("massif", k) => if let Some((m, p)) = &mut self.massif { if p.set_key(k, v) { m.set(p); } },
            ("horizon", k) => if let Some((m, p)) = &mut self.horizon { if p.set_key(k, v) { m.set(p); } },
            ("plate", k) => if let Some((m, p)) = &mut self.plate { if p.set_key(k, v) { m.set(p); } },
            ("techo", k) => if let Some((m, p)) = &mut self.techo { if p.set_key(k, v) { m.set(p); } },
            ("hall80", k) => if let Some((m, p)) = &mut self.hall80 { if p.set_key(k, v) { m.set(p); } },
            ("h910", k) => if let Some((m, p)) = &mut self.h910 { if p.set_key(k, v) { m.set(p); } },
            ("dim", k) => if let Some((m, p)) = &mut self.dim { if p.set_key(k, v) { m.set(p); } },
            ("prev76", k) => if let Some((m, p)) = &mut self.prev76 { if p.set_key(k, v) { m.set(p); } },
            ("eclat", k) => if let Some((m, p)) = &mut self.eclat { if p.set_key(k, v) { m.set(p); } },
            ("souffle", k) => if let Some((m, p)) = &mut self.souffle { if p.set_key(k, v) { m.set(p); } },
            ("busg", k) => if let Some((m, p)) = &mut self.busg { if p.set_key(k, v) { m.set(p); } },
            ("tape", k) => if let Some((m, p)) = &mut self.tape { if p.set_key(k, v) { m.set(p); } },
            ("l670", k) => if let Some((m, p)) = &mut self.l670 { if p.set_key(k, v) { m.set(p); } },
            (m @ ("tremolo" | "phaser" | "flanger" | "chorus" | "doubler" | "slapback"), k) => {
                let st = match m { "tremolo" => Stage::Tremolo, "phaser" => Stage::Phaser, "flanger" => Stage::Flanger, "chorus" => Stage::Chorus, "doubler" => Stage::Doubler, _ => Stage::Slapback };
                if let Some((_, f)) = self.modfx.iter_mut().find(|(s2, _)| *s2 == st) {
                    match k { "rate" => if f.beats.is_none() { f.rate = v }, "depth" => f.depth = v, "width" => f.width = v, "feedback" => f.fb = v / 100.0, "mix" => f.mix = v / 100.0, "time" => f.time = v / 1000.0, _ => {} }
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
                let Some((idx, field)) = k.strip_prefix('b').and_then(|r| r.split_once('-')) else { return false };
                let Ok(bi) = idx.parse::<usize>() else { return false };
                let Some((bd, Some((fi, _)))) = self.eq_bands.get_mut(bi) else { return false };
                match field { "freq" => bd.freq = v, "gain" => bd.gain = v, "q" => bd.q = v, _ => return false }
                let fi = *fi;
                for (j, b) in eq_sections(bd, self.sr).into_iter().enumerate() {
                    for ch in 0..2 { self.filters[fi + j][ch].retune(b.clone()); }
                }
            }
            _ => {}
        }
        let _ = cut_changed;
        comp_changed
    }
    /// Réglage tourné à la main pendant la lecture : comme `set_live`, et le compresseur est recalculé en gardant son état
    /// (son mélange et son rattrapage glissent, ils ne sautent pas)
    pub fn live(&mut self, fx: &str, key: &str, v: f64) {
        if self.set_live(fx, key, v) {
            let p = self.comp_p.clone();
            if let Some(c) = &mut self.comp { c.retune(&p, self.sr); }
        }
    }
    pub fn with_order(mut self, custom: &[String]) -> Self {
        self.order = Stage::order(custom);
        self
    }
    /// Réduction de gain du compresseur en ce moment (dB, dosée par le mélange), comme l'aiguille du navigateur
    pub fn comp_gr(&self) -> Option<f32> { self.comp.as_ref().map(|c| (c.red * c.mix) as f32) }
    /// Niveau d'entrée du Compresseur (dB, crête du détecteur depuis la dernière lecture, remise à zéro)
    pub fn comp_in(&mut self) -> Option<f32> { self.comp.as_mut().map(|c| { let v = c.peak_in; c.peak_in = 0.0; if v > 1e-6 { (20.0 * v.log10()) as f32 } else { -120.0 } }) }
    /// Réduction des compresseurs de la gamme Analogique (dB), pour l'aiguille de leur façade
    pub fn analog_gr(&self, out: &mut Vec<(&'static str, f32)>) {
        let r = |x: f64| x.abs() as f32;
        if let Some((m, _)) = &self.fet76 { out.push(("fet76", r(m.reduction()))); }
        if let Some((m, _)) = &self.opto2a { out.push(("opto2a", r(m.reduction()))); }
        if let Some((m, _)) = &self.busg { out.push(("busg", r(m.reduction()))); }
        if let Some((m, _)) = &self.l670 { out.push(("l670", r(m.reduction()))); }
        if let Some((m, _)) = &self.dtr { out.push(("dtr", r(m.reduction()))); }
        if let Some((m, _)) = &self.comp25 { out.push(("comp25", r(m.reduction()))); }
        if let Some((m, _)) = &self.bus33 { out.push(("bus33", r(m.reduction()))); }
    }
    /// Afficheurs des fenêtres de plugin (gate, de-esser, multibande, limiteur) : mêmes mesures que les worklets, remises à zéro à la lecture
    pub fn take_meters(&mut self) -> Option<FxMeters> {
        let m = FxMeters {
            gate: self.gate.as_mut().map(|g| g.take_meter()),
            deess: self.deess2.as_mut().map(|d| d.take_meter()),
            mband: self.mband.as_mut().map(|b| b.take_meter()),
            limit: self.limit.as_mut().map(|l| l.take_meter()),
        };
        if m.gate.is_none() && m.deess.is_none() && m.mband.is_none() && m.limit.is_none() { None } else { Some(m) }
    }
    pub fn is_empty(&self) -> bool {
        self.cut.is_empty() && self.filters.is_empty() && self.dyn_eq.is_empty() && self.sat.is_none() && self.gate.is_none() && self.crush.is_none() && self.util.is_none() && self.width.is_none() && self.modfx.is_empty() && self.deess.is_none() && self.deess2.is_none() && self.mband.is_none() && self.msat.is_none() && self.comp.is_none() && self.master.is_none() && self.limit.is_none() && self.delay.is_none() && self.reverb.is_none() && self.pitch.is_none() && self.fet76.is_none() && self.pre73.is_none() && self.opto2a.is_none() && self.eqp1.is_none() && self.busg.is_none() && self.souffle.is_none() && self.eclat.is_none() && self.prev76.is_none() && self.dim.is_none() && self.h910.is_none() && self.hall80.is_none() && self.techo.is_none() && self.plate.is_none() && self.horizon.is_none() && self.massif.is_none() && self.bus33.is_none() && self.comp25.is_none() && self.eq550.is_none() && self.stripe.is_none() && self.dtr.is_none() && self.tape.is_none() && self.l670.is_none()
    }
    /// Une piste avec reverb sort toujours en stéréo, même si ses sons sont mono.
    pub fn makes_stereo(&self) -> bool {
        self.reverb.is_some() || self.master.is_some() || self.limit.is_some() || self.plate.is_some() || self.techo.is_some() || self.hall80.is_some() || self.h910.is_some() || self.dim.is_some()
    }
    /// La sortie est en stéréo même pour une entrée mono (reverb, écho ping-pong…), comme les worklets à 2 canaux du navigateur
    pub fn outputs_stereo(&self) -> bool {
        self.makes_stereo() || self.delay.as_ref().is_some_and(|d| d.pp)
    }
    /// `mono` : la piste n'a que des sons mono (seul `left` est lu). Si la chaîne élargit en stéréo
    /// (`makes_stereo`), `right` doit quand même avoir la taille de `left` : il reçoit le canal droit.
    /// L'étage a-t-il quelque chose à faire ? (la boucle par échantillon ne passe que par ceux-là)
    fn has(&self, st: Stage) -> bool {
        match st {
            Stage::Filter => !self.cut.is_empty(),
            Stage::Eq => !self.filters.is_empty() || !self.dyn_eq.is_empty(),
            Stage::Crush => self.crush.is_some(), Stage::Util => self.util.is_some(), Stage::Width => self.width.is_some(),
            Stage::Tremolo | Stage::Phaser | Stage::Flanger | Stage::Chorus | Stage::Doubler | Stage::Slapback => self.modfx.iter().any(|(x, _)| *x == st),
            Stage::Gate => self.gate.is_some(), Stage::Sat => self.sat.is_some(), Stage::Deess => self.deess.is_some() || self.deess2.is_some(),
            Stage::Msat => self.msat.is_some(), Stage::Mband => self.mband.is_some(), Stage::Comp => self.comp.is_some(),
            Stage::Master => self.master.is_some(), Stage::Limit => self.limit.is_some(), Stage::Delay => self.delay.is_some(),
            Stage::Pitch => self.pitch.is_some(), Stage::Reverb => self.reverb.is_some(),
            Stage::Fet76 => self.fet76.is_some(), Stage::Pre73 => self.pre73.is_some(), Stage::Opto2A => self.opto2a.is_some(),
            Stage::EqP1 => self.eqp1.is_some(), Stage::Dtr => self.dtr.is_some(), Stage::StripE => self.stripe.is_some(),
            Stage::Eq550 => self.eq550.is_some(), Stage::Comp25 => self.comp25.is_some(), Stage::Bus33 => self.bus33.is_some(),
            Stage::Massif => self.massif.is_some(), Stage::Horizon => self.horizon.is_some(), Stage::Plate => self.plate.is_some(),
            Stage::TapeEcho => self.techo.is_some(), Stage::Hall80 => self.hall80.is_some(), Stage::H910 => self.h910.is_some(),
            Stage::Dim => self.dim.is_some(), Stage::PreV76 => self.prev76.is_some(), Stage::Eclat => self.eclat.is_some(),
            Stage::Souffle => self.souffle.is_some(), Stage::BusG => self.busg.is_some(), Stage::Tape => self.tape.is_some(),
            Stage::L670 => self.l670.is_some(),
        }
    }
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) {
        // emprunté puis rendu : aucune allocation (le retour casque direct appelle ceci en temps réel)
        let full = std::mem::take(&mut self.order);
        // seulement les étages actifs, dans l'ordre (avant : les 44 étages testés à chaque échantillon)
        let mut act = [Stage::Filter; 64];
        let mut na = 0;
        for &st in full.iter() { if na < 64 && self.has(st) { act[na] = st; na += 1; } }
        let order = &act[..na];
        for n in 0..left.len() {
            let now = self.auto_from + self.pos as f64 / self.sr;
            if !self.auto.is_empty() && self.pos % 128 == 0 {
                self.apply_auto(now);
            }
            self.pos += 1;
            if self.tempo_i + 1 < self.tempo.len() && now >= self.tempo[self.tempo_i + 1].0 - 1e-9 {
                self.tempo_i += 1;
                let bpm = self.tempo[self.tempo_i].1;
                if let Some(d) = &mut self.delay { d.set_bpm(bpm); }
            }
            let mut nc = if mono { 1 } else { 2 };
            let mut x = [left[n] as f64, if nc == 2 { right[n] as f64 } else { 0.0 }];
            for stage in order {
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
                    Stage::Msat => {
                        if let Some(m) = &mut self.msat {
                            m.tick(&mut x, nc);
                        }
                    }
                    Stage::Mband => {
                        if let Some(m) = &mut self.mband {
                            m.tick(&mut x, nc);
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
                    Stage::Fet76 => {
                        if let Some((m, _)) = &mut self.fet76 { m.tick(&mut x, nc); }
                    }
                    Stage::Pre73 => {
                        if let Some((m, _)) = &mut self.pre73 { m.tick(&mut x, nc); }
                    }
                    Stage::Opto2A => {
                        if let Some((m, _)) = &mut self.opto2a { m.tick(&mut x, nc); }
                    }
                    Stage::EqP1 => {
                        if let Some((m, _)) = &mut self.eqp1 { m.tick(&mut x, nc); }
                    }
                    Stage::Dtr => {
                        if let Some((m, _)) = &mut self.dtr { m.tick(&mut x, nc); }
                    }
                    Stage::StripE => {
                        if let Some((m, _)) = &mut self.stripe { m.tick(&mut x, nc); }
                    }
                    Stage::Eq550 => {
                        if let Some((m, _)) = &mut self.eq550 { m.tick(&mut x, nc); }
                    }
                    Stage::Comp25 => {
                        if let Some((m, _)) = &mut self.comp25 { m.tick(&mut x, nc); }
                    }
                    Stage::Bus33 => {
                        if let Some((m, _)) = &mut self.bus33 { m.tick(&mut x, nc); }
                    }
                    Stage::Massif => {
                        if let Some((m, _)) = &mut self.massif { m.tick(&mut x, nc); }
                    }
                    Stage::Horizon => {
                        if let Some((m, _)) = &mut self.horizon { m.tick(&mut x, nc); }
                    }
                    Stage::Plate => {
                        if let Some((m, _)) = &mut self.plate { m.tick(&mut x, nc); nc = 2; }
                    }
                    Stage::TapeEcho => {
                        if let Some((m, _)) = &mut self.techo { m.tick(&mut x, nc); nc = 2; }
                    }
                    Stage::Hall80 => {
                        if let Some((m, _)) = &mut self.hall80 { m.tick(&mut x, nc); nc = 2; }
                    }
                    Stage::H910 => {
                        if let Some((m, _)) = &mut self.h910 { m.tick(&mut x, nc); nc = 2; }
                    }
                    Stage::Dim => {
                        if let Some((m, _)) = &mut self.dim { m.tick(&mut x, nc); nc = 2; }
                    }
                    Stage::PreV76 => {
                        if let Some((m, _)) = &mut self.prev76 { m.tick(&mut x, nc); }
                    }
                    Stage::Eclat => {
                        if let Some((m, _)) = &mut self.eclat { m.tick(&mut x, nc); }
                    }
                    Stage::Souffle => {
                        if let Some((m, _)) = &mut self.souffle { m.tick(&mut x, nc); }
                    }
                    Stage::BusG => {
                        if let Some((m, _)) = &mut self.busg { m.tick(&mut x, nc); }
                    }
                    Stage::Tape => {
                        if let Some((m, _)) = &mut self.tape { m.tick(&mut x, nc); }
                    }
                    Stage::L670 => {
                        if let Some((m, _)) = &mut self.l670 { m.tick(&mut x, nc); }
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
        self.order = full;
    }
}

/// Un étage de la chaîne. L'ordre habituel est celui de `Stage::DEFAULT` ; l'utilisateur peut le changer.
#[derive(Clone, Copy, PartialEq)]
enum Stage {
    Filter,
    Gate,
    Eq,
    Sat,
    Msat,
    Crush,
    Deess,
    Comp,
    Mband,
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
    Fet76,
    Pre73,
    Opto2A,
    EqP1,
    BusG,
    Souffle,
    Eclat,
    PreV76,
    Dim,
    H910,
    Hall80,
    TapeEcho,
    Plate,
    Horizon,
    Massif,
    Bus33,
    Comp25,
    Eq550,
    StripE,
    Dtr,
    Tape,
    L670,
}

impl Stage {
    const DEFAULT: [Stage; 44] = [Stage::Pitch, Stage::Filter, Stage::Pre73, Stage::PreV76, Stage::StripE, Stage::Gate, Stage::Eq, Stage::EqP1, Stage::Horizon, Stage::Souffle, Stage::Eq550, Stage::Massif, Stage::Tape, Stage::Eclat, Stage::Sat, Stage::Msat, Stage::Crush, Stage::Deess, Stage::Fet76, Stage::Opto2A, Stage::L670, Stage::Dtr, Stage::Comp25, Stage::Comp, Stage::Mband, Stage::Bus33, Stage::BusG, Stage::Util, Stage::Width, Stage::Tremolo, Stage::Phaser, Stage::Flanger, Stage::Chorus, Stage::Dim, Stage::Doubler, Stage::Slapback, Stage::Master, Stage::Limit, Stage::Delay, Stage::TapeEcho, Stage::H910, Stage::Plate, Stage::Hall80, Stage::Reverb];
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
            "msat" => Stage::Msat,
            "deess" => Stage::Deess,
            "comp" => Stage::Comp,
            "mband" => Stage::Mband,
            "master" => Stage::Master,
            "limit" => Stage::Limit,
            "delay" => Stage::Delay,
            "reverb" => Stage::Reverb,
            "pitch" => Stage::Pitch,
            "fet76" => Stage::Fet76,
            "pre73" => Stage::Pre73,
            "opto2a" => Stage::Opto2A,
            "eqp1" => Stage::EqP1,
            "busg" => Stage::BusG,
            "souffle" => Stage::Souffle,
            "eclat" => Stage::Eclat,
            "prev76" => Stage::PreV76,
            "dim" => Stage::Dim,
            "h910" => Stage::H910,
            "hall80" => Stage::Hall80,
            "techo" => Stage::TapeEcho,
            "plate" => Stage::Plate,
            "horizon" => Stage::Horizon,
            "massif" => Stage::Massif,
            "bus33" => Stage::Bus33,
            "comp25" => Stage::Comp25,
            "eq550" => Stage::Eq550,
            "stripe" => Stage::StripE,
            "dtr" => Stage::Dtr,
            "tape" => Stage::Tape,
            "l670" => Stage::L670,
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
    /// Doux : premier étage de lissage de la réduction ; style (0 / 1 / 2) et facteur de relâchement
    gain1: f64,
    sty: u8,
    rm: f64,
    att: f64,
    rel: f64,
    /// afficheur : crête d'entrée, crête de sortie, gain (min) depuis la dernière lecture
    m_in: f64,
    m_out: f64,
    m_gr: f64,
    glide: Glide,
}

impl Limiter {
    fn take_meter(&mut self) -> [f32; 3] {
        let m = [self.m_in as f32, self.m_out as f32, self.m_gr as f32];
        self.m_in = 0.0; self.m_out = 0.0; self.m_gr = 1.0;
        m
    }
    pub fn new(ceiling_db: f64, sr: f64) -> Self {
        Self::with(&crate::model::LimitParams::default(), ceiling_db, sr)
    }
    /// Même calcul que le worklet `pulse-limiter` de audio.js
    pub fn with(p: &crate::model::LimitParams, ceiling_db: f64, sr: f64) -> Self {
        let tp = p.tp.unwrap_or(0.0) >= 0.5;
        let look = (p.lookahead.unwrap_or(1.5).clamp(0.1, 10.0)) / 1000.0;
        let base = ((look * sr).round() as usize).max(1);
        let l = base + if tp { 8 } else { 0 };
        // Style : 0 Transparent · 1 Doux (deux étages, relâchement ×2,2) · 2 Franc (attaque serrée, relâchement ×0,45) — comme le worklet
        let sty = match p.style.unwrap_or(0.0).round() as i64 { 1 => 1u8, 2 => 2u8, _ => 0u8 };
        let rm = [1.0, 2.2, 0.45][sty as usize];
        let an = [4.0, 8.0, 10.0][sty as usize];
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
            gain1: 1.0,
            sty,
            rm,
            att: 1.0 - (-an / base as f64).exp(),
            rel: 1.0 - (-1.0 / (p.release.unwrap_or(120.0).clamp(1.0, 2000.0) * rm / 1000.0 * sr)).exp(),
            m_in: 0.0, m_out: 0.0, m_gr: 1.0,
            glide: Glide::new(sr),
        }
    }
    /// Plugin : afficheur (crête d'entrée, crête de sortie, gain le plus bas) depuis la dernière lecture
    pub fn meter_take(&mut self) -> [f32; 3] { self.take_meter() }
    /// Le son d'origine qui sortira au prochain `tick` (même retard, sans gain ni limitation) : bypass sans décalage
    pub fn delayed(&self, _x: &[f64; 2]) -> [f64; 2] {
        let g = if self.g > 0.0 { self.g } else { 1.0 };
        [self.buf[0][self.i] / g, self.buf[1][self.i] / g]
    }
    /// Retard du limiteur (anticipation + pic réel), en échantillons : le logiciel hôte le compense
    pub fn latency(&self) -> usize { self.buf[0].len() }
    /// Plugin : nouveaux réglages sans repartir de zéro ; plafond et gain d'entrée glissent en ~10 ms (pas de clic).
    /// Si l'anticipation change, la mémoire change de taille (le retard aussi).
    pub fn retune(&mut self, p: &crate::model::LimitParams, ceiling_db: f64, sr: f64) {
        let mut n = Self::with(p, ceiling_db, sr);
        let (thr, g) = (n.thr, n.g);
        n.thr = self.thr;
        n.g = self.g;
        n.glide = self.glide;
        n.glide.aim(thr, g);
        n.env = self.env;
        n.gain = self.gain;
        n.gain1 = self.gain1;
        n.m_in = self.m_in; n.m_out = self.m_out; n.m_gr = self.m_gr;
        if n.tp == self.tp { n.hist = self.hist; }
        if n.buf[0].len() == self.buf[0].len() { n.buf = std::mem::take(&mut self.buf); n.i = self.i; }
        *self = n;
    }
    pub fn tick(&mut self, x: &mut [f64; 2]) {
        self.glide.step(&mut self.thr, &mut self.g);
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
        if self.sty == 1 {
            // Doux : deux étages en série, la réduction arrive et repart sans à-coup
            self.gain1 += (target - self.gain1) * if target < self.gain1 { self.att } else { self.rel };
            self.gain += (self.gain1 - self.gain) * if self.gain1 < self.gain { self.att } else { self.rel };
        } else {
            self.gain += (target - self.gain) * if target < self.gain { self.att } else { self.rel };
        }
        x[0] = (d[0] * self.gain).clamp(-self.thr, self.thr);
        x[1] = (d[1] * self.gain).clamp(-self.thr, self.thr);
        if pk > self.m_in { self.m_in = pk; }
        let o = x[0].abs().max(x[1].abs());
        if o > self.m_out { self.m_out = o; }
        if self.gain < self.m_gr { self.m_gr = self.gain; }
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
            Compressor::new(&CompParams { threshold: Some(-12.0 - p.glue * 0.12), ratio: Some(1.5 + p.glue * 0.015), attack: Some(30.0), release: Some(150.0), knee: None, makeup: None, mix: None, mode: None, auto_rel: None, ..Default::default() }, sr)
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
/// Retour d'un envoi (écho ou reverb), utilisable bloc par bloc
pub struct SendFx { trim: f64, delay: Option<Delay>, reverb: Option<Reverb> }

impl SendFx {
    pub fn new(send: &Send, sr: f64, bpm: f64) -> Self {
        let trim = if send.kind == "delay" { 1.0 } else { 1.0 / 3.0 } * send.volume.unwrap_or(100.0) / 100.0;
        let delay = (send.kind == "delay").then(|| {
            let mut d = Delay::new(&DelayParams { wet: Some(100.0), feedback: send.feedback, ms: send.ms, beats: send.beats, pp: send.pp, dry: None, ..Default::default() }, sr, bpm);
            d.dry = 0.0;
            d
        });
        let reverb = (send.kind != "delay").then(|| {
            let mut r = Reverb::new(&ReverbParams { wet: Some(100.0), size: Some(send.size.unwrap_or(3.2)), ..Default::default() }, sr);
            r.pre = vec![0.0; ((send.pre.unwrap_or(0.0).clamp(0.0, 500.0) / 1000.0) * sr).round() as usize];
            r
        });
        Self { trim, delay, reverb }
    }
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for n in 0..left.len() {
            let mut x = [left[n] as f64, right[n] as f64];
            if let Some(d) = &mut self.delay {
                d.tick(&mut x, 2);
            }
            if let Some(r) = &mut self.reverb {
                r.tick(&mut x, 2);
            }
            left[n] = (x[0] * self.trim) as f32;
            right[n] = (x[1] * self.trim) as f32;
        }
    }
}

pub fn process_send(send: &Send, left: &mut [f32], right: &mut [f32], sr: f64, bpm: f64) {
    SendFx::new(send, sr, bpm).process(left, right);
}

/// Chaîne d'effets d'une piste, d'un groupe ou d'une région, avec plusieurs exemplaires possibles d'un même effet
/// (« comp », « comp#2 »…, comme des inserts Logic). Sans doublon : une seule `Chain`, exactement comme avant.
/// Avec doublons : la liste (dans l'ordre affiché, voir chainOf dans studio.js) est coupée en tranches sans doublon,
/// jouées l'une après l'autre ; chaque tranche ne voit que ses exemplaires, sous leur nom de type.
/// Les plugins externes (« vst#… ») sont des tranches à part : `ext[i]` joue à la place de la tranche i (vide).
pub struct FxChain { parts: Vec<(Chain, Vec<String>)>, ext: Vec<Option<crate::ext::ExtSlot>>, ramps: Vec<Ramp>, ramp_len: usize }

/// Un réglage tourné pendant la lecture : la valeur entendue glisse vers la valeur du bouton (≈ 40 ms, par pas de
/// 8 échantillons) au lieu de sauter d'un coup au début du bloc — un saut = un clic, une main qui tourne = un crépitement.
/// Sans réglage en cours de glissement, le son reste identique à l'échantillon près.
struct Ramp { part: usize, ty: String, fx: String, key: String, cur: f64, to: f64, left: usize }
/// Pas du glissement (échantillons)
const RAMP_STEP: usize = 8;

impl FxChain {
    /// L'ordre de jeu : l'ordre choisi (`fx_order`), puis les autres à leur place habituelle (par type), puis le reste
    pub fn ordered(effects: &[String], fx_order: &[String]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for n in fx_order { if effects.contains(n) && !out.contains(n) { out.push(n.clone()); } }
        for st in Stage::DEFAULT {
            for n in effects { if Stage::parse(crate::model::fx_type(n)) == Some(st) && !out.contains(n) { out.push(n.clone()); } }
        }
        for n in effects { if !out.contains(n) { out.push(n.clone()); } }
        out
    }
    pub fn new(effects: &[String], params: &EffectParams, fx_order: &[String], sr: f64, bpm: f64, ceiling_db: f64) -> Self {
        let dup = effects.iter().any(|e| e.contains('#'));
        if !dup { return Self { parts: vec![(Chain::new(effects, params, sr, bpm, ceiling_db).with_order(fx_order), effects.to_vec())], ext: vec![None], ramps: Vec::new(), ramp_len: (0.04 * sr) as usize }; }
        let mut groups: Vec<Vec<String>> = vec![Vec::new()];
        for id in Self::ordered(effects, fx_order) {
            let ty = crate::model::fx_type(&id);
            // plugin externe : toujours seul dans sa tranche
            if ty == "vst" { groups.push(vec![id]); groups.push(Vec::new()); continue; }
            if groups.last().unwrap().iter().any(|g| crate::model::fx_type(g) == ty) { groups.push(Vec::new()); }
            groups.last_mut().unwrap().push(id);
        }
        let groups: Vec<Vec<String>> = groups.into_iter().filter(|g| !g.is_empty()).collect();
        let ext = groups.iter().map(|g| if g.len() == 1 && crate::model::fx_type(&g[0]) == "vst" { Some(crate::ext::ExtSlot::new(&g[0], sr)) } else { None }).collect();
        let parts = groups.into_iter().map(|ids| {
            if crate::model::fx_type(&ids[0]) == "vst" { return (Chain::new(&[], &EffectParams::default(), sr, bpm, ceiling_db), ids); }
            let mut ep = EffectParams::default();
            for id in &ids {
                let one = params.instance(id);
                macro_rules! take { ($($f:ident),*) => { $( if one.$f.is_some() { ep.$f = one.$f; } )* } }
                take!(filter, gate, chorus, flanger, phaser, tremolo, doubler, slapback, crush, util, width, eq, sat, deess, comp, mband, msat, reverb, delay, master, limit, pitch, fet76, pre73, opto2a, eqp1, busg, tape, l670, dtr, stripe, eq550, comp25, bus33, massif, horizon, plate, techo, hall80, h910, dim, prev76, eclat, souffle);
            }
            let types: Vec<String> = ids.iter().map(|i| crate::model::fx_type(i).to_owned()).collect();
            (Chain::new(&types, &ep, sr, bpm, ceiling_db).with_order(&types), ids)
        }).collect();
        Self { parts, ext, ramps: Vec::new(), ramp_len: (0.04 * sr) as usize }
    }
    pub fn for_track(track: &Track, sr: f64, bpm: f64) -> Self {
        Self::new(&track.effects, &track.effect_params, &track.fx_order, sr, bpm, -0.3)
    }
    /// Courbes d'automation : « fx:comp#2:… » va à la tranche de comp#2, sous le nom « comp »
    pub fn with_auto(self, automation: &Automation, from: f64) -> Self {
        if self.parts.len() == 1 && !self.parts[0].1.iter().any(|i| i.contains('#')) {
            let (c, ids) = self.parts.into_iter().next().unwrap();
            return Self { parts: vec![(c.with_auto(automation, from), ids)], ext: self.ext, ramps: self.ramps, ramp_len: self.ramp_len };
        }
        let parts: Vec<(Chain, Vec<String>)> = self.parts.into_iter().map(|(c, ids)| {
            let mut a = Automation { volume: None, other: Default::default() };
            for (k, v) in &automation.other {
                let mut it = k.splitn(3, ':');
                let (Some("fx"), Some(fx), Some(key)) = (it.next(), it.next(), it.next()) else { continue };
                if ids.iter().any(|i| i == fx) { a.other.insert(format!("fx:{}:{key}", crate::model::fx_type(fx)), v.clone()); }
            }
            (c.with_auto(&a, from), ids)
        }).collect();
        let mut ext = self.ext;
        // plugins externes : leurs courbes « fx:vst#…:<n° du réglage> »
        for (i, (_, ids)) in parts.iter().enumerate() {
            let Some(Some(slot)) = ext.get_mut(i) else { continue };
            let pre = format!("fx:{}:", ids[0]);
            let curves: Vec<(u32, crate::model::Curve)> = automation.other.iter().filter_map(|(k, c)| k.strip_prefix(&pre).and_then(|n| n.parse::<u32>().ok()).map(|n| (n, c.clone()))).collect();
            if !curves.is_empty() { slot.set_auto(curves, from); }
        }
        Self { parts, ext, ramps: self.ramps, ramp_len: self.ramp_len }
    }
    pub fn with_tempo(self, segs: Vec<(f64, f64)>, from: f64) -> Self {
        Self { parts: self.parts.into_iter().map(|(c, ids)| (c.with_tempo(segs.clone(), from), ids)).collect(), ext: self.ext, ramps: self.ramps, ramp_len: self.ramp_len }
    }
    pub fn seek(&mut self, t: f64) { for (c, _) in &mut self.parts { c.seek(t); } for e in self.ext.iter_mut().flatten() { e.seek(t); } }
    /// Réglage changé en direct : `fx` = nom d'exemplaire (« comp#2 ») ou de type. La valeur entendue glisse vers `v`.
    pub fn set_live(&mut self, fx: &str, key: &str, v: f64) -> bool { self.set_live_from(fx, key, v, None) }
    /// Pareil, en sachant d'où part le bouton (`from`) : le tout premier geste glisse aussi.
    /// Sans `from`, le premier réglage d'un bouton est pris tel quel, les suivants glissent depuis la valeur entendue.
    pub fn set_live_from(&mut self, fx: &str, key: &str, v: f64, from: Option<f64>) -> bool {
        if !v.is_finite() { return false; }
        let ty = crate::model::fx_type(fx);
        let mut hit = false;
        for (i, (c, ids)) in self.parts.iter_mut().enumerate() {
            if !ids.iter().any(|id| id == fx) { continue; }
            hit = true;
            if let Some(r) = self.ramps.iter_mut().find(|r| r.part == i && r.fx == fx && r.key == key) {
                r.to = v;
                r.left = if r.cur == v { 0 } else { self.ramp_len.max(RAMP_STEP) };
                continue;
            }
            match from.filter(|f| f.is_finite() && *f != v) {
                Some(f) => self.ramps.push(Ramp { part: i, ty: ty.to_owned(), fx: fx.to_owned(), key: key.to_owned(), cur: f, to: v, left: self.ramp_len.max(RAMP_STEP) }),
                None => { c.live(ty, key, v); self.ramps.push(Ramp { part: i, ty: ty.to_owned(), fx: fx.to_owned(), key: key.to_owned(), cur: v, to: v, left: 0 }); }
            }
        }
        hit
    }
    pub fn is_empty(&self) -> bool { self.parts.iter().all(|(c, _)| c.is_empty()) && self.ext.iter().all(|e| e.is_none()) }
    pub fn makes_stereo(&self) -> bool { self.parts.iter().any(|(c, _)| c.makes_stereo()) || self.ext.iter().any(|e| e.is_some()) }
    pub fn outputs_stereo(&self) -> bool { self.parts.iter().any(|(c, _)| c.outputs_stereo()) || self.ext.iter().any(|e| e.is_some()) }
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) {
        let mut mono = mono;
        for (i, (c, _)) in self.parts.iter_mut().enumerate() {
            // plugin externe : toujours en stéréo (gauche recopiée à droite pour une piste mono)
            if let Some(Some(e)) = self.ext.get_mut(i) { e.process(left, right, mono); mono = false; continue; }
            if self.ramps.iter().any(|r| r.part == i && r.left > 0) {
                // réglages en train de glisser : la tranche avance par petits pas, chaque pas avec sa valeur
                let n = left.len();
                let two = right.len() >= n;
                let mut o = 0;
                while o < n {
                    let k = (n - o).min(RAMP_STEP);
                    for r in self.ramps.iter_mut().filter(|r| r.part == i && r.left > 0) {
                        if r.left <= k { r.cur = r.to; r.left = 0; } else { r.cur += (r.to - r.cur) * k as f64 / r.left as f64; r.left -= k; }
                        c.live(&r.ty, &r.key, r.cur);
                    }
                    // (piste mono : le canal droit peut être absent)
                    if two { c.process(&mut left[o..o + k], &mut right[o..o + k], mono); } else { c.process(&mut left[o..o + k], &mut right[..0], mono); }
                    o += k;
                }
            } else {
                c.process(left, right, mono);
            }
            // une tranche qui élargit en stéréo (reverb, écho ping-pong…) a rempli `right` : la suite est stéréo
            if mono && c.outputs_stereo() { mono = false; }
        }
    }
    pub fn comp_gr(&self) -> Option<f32> { self.parts.iter().find_map(|(c, _)| c.comp_gr()) }
    pub fn comp_in(&mut self) -> Option<f32> { self.parts.iter_mut().find_map(|(c, _)| c.comp_in()) }
    pub fn analog_gr(&self) -> Vec<(&'static str, f32)> { let mut v = Vec::new(); for (c, _) in &self.parts { c.analog_gr(&mut v); } v }
    pub fn take_meters(&mut self) -> Option<FxMeters> {
        let mut out: Option<FxMeters> = None;
        for (c, _) in &mut self.parts {
            if let Some(m) = c.take_meters() {
                match &mut out {
                    None => out = Some(m),
                    Some(o) => { if o.gate.is_none() { o.gate = m.gate; } if o.deess.is_none() { o.deess = m.deess; } if o.mband.is_none() { o.mband = m.mband; } if o.limit.is_none() { o.limit = m.limit; } }
                }
            }
        }
        out
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
        // Son riche (dents de scie à 220 Hz, comme une voix) : la note arrive où on l'attend, retard compris.
        // (un son pur n'est pas un bon test : la technique travaille période par période sur les harmoniques)
        let sr = 48_000.0;
        // la note se lit sous 6 kHz : au-dessus (souffle, air), le Pitch garde le son continu, sans le transposer
        let smooth = |sig: &[f64]| -> Vec<f64> { (0..sig.len()).map(|i| sig[i.saturating_sub(7)..=i].iter().sum::<f64>() / 8.0).collect() };
        let period = |sig: &[f64]| {
            let sig = &smooth(sig)[..];
            // autocorrélation : meilleur décalage entre 1 et 15 ms
            let (lo, hi) = ((0.001 * sr) as usize, (0.015 * sr) as usize);
            let n = 4096;
            let best = (lo..hi).map(|t| (t, (0..n).map(|i| sig[i] * sig[i + t]).sum::<f64>() / (0..n).map(|i| sig[i + t] * sig[i + t]).sum::<f64>().sqrt()))
                .fold((lo, f64::MIN), |a, b| if b.1 > a.1 * 1.05 { b } else { a }).0;
            sr / best as f64
        };
        for (semi, want) in [(12.0, 440.0), (-12.0, 110.0), (5.0, 220.0 * 2f64.powf(5.0 / 12.0)), (-5.0, 220.0 * 2f64.powf(-5.0 / 12.0))] {
            let mut p = Pitch::new(&PitchParams { semi: Some(semi), mix: Some(100.0), ..Default::default() }, sr);
            let out: Vec<f64> = (0..48_000).map(|n| { let mut x = [((n as f64 * 220.0 / sr) % 1.0) - 0.5, 0.0]; p.tick(&mut x, 1); x[0] }).collect();
            let f = period(&out[12_000..]);
            assert!((f - want).abs() / want < 0.03, "{semi} demi-tons : {f:.1} Hz au lieu de {want:.1}");
        }
        // formant seul : la note ne bouge pas
        let mut p = Pitch::new(&PitchParams { semi: Some(0.0), formant: Some(5.0), mix: Some(100.0) }, sr);
        let out: Vec<f64> = (0..48_000).map(|n| { let mut x = [((n as f64 * 220.0 / sr) % 1.0) - 0.5, 0.0]; p.tick(&mut x, 1); x[0] }).collect();
        let f = period(&out[12_000..]);
        assert!((f - 220.0).abs() / 220.0 < 0.03, "formant seul : {f:.1} Hz au lieu de 220");
    }

    /// Voix descendue d'une octave : la nouvelle note (harmoniques impaires de 100 Hz, absentes de la voix d'origine à 200 Hz)
    /// est aussi forte que les harmoniques communes — sinon on entend la voix d'origine en doublage
    #[test]
    fn pitch_octave_sans_doublage() {
        let sr = 48_000.0;
        // voix simplifiée à 200 Hz : une impulsion par période (comme la glotte) dans un formant à 700 Hz
        let (r, th) = ((-PI * 120.0 / sr).exp(), 2.0 * PI * 700.0 / sr);
        let mut y = [0.0f64; 2];
        let x: Vec<f64> = (0..96_000).map(|n| { let v = if n % 240 == 0 { 1.0 } else { 0.0 } + 2.0 * r * th.cos() * y[0] - r * r * y[1]; y = [v, y[0]]; v * 0.02 }).collect();
        let mut p = Pitch::new(&PitchParams { semi: Some(-12.0), mix: Some(100.0), ..Default::default() }, sr);
        let out: Vec<f64> = x.iter().map(|v| { let mut s = [*v, 0.0]; p.tick(&mut s, 1); s[0] }).collect();
        let seg = &out[48_000..96_000];
        let amp = |f: f64| { let (mut c, mut s) = (0.0, 0.0); for (i, v) in seg.iter().enumerate() { let a = 2.0 * PI * f * i as f64 / sr; c += v * a.cos(); s += v * a.sin(); } (c * c + s * s).sqrt() };
        let odd: f64 = (0..10).map(|k| amp(100.0 * (2 * k + 1) as f64).powi(2)).sum();
        let even: f64 = (1..=10).map(|k| amp(200.0 * k as f64).powi(2)).sum();
        let db = 10.0 * (odd / even).log10();
        assert!(db > -1.5, "doublage à l'octave : impaires {db:.1} dB sous les paires (attendu > −1,5 dB)");
    }

    /// Voix descendue d'une octave : le souffle aigu (au-dessus de 6 kHz) reste continu, il n'est pas haché à chaque période
    /// (c'est ce hachage qui faisait « craquer » la voix)
    #[test]
    fn pitch_souffle_continu() {
        let sr = 48_000.0;
        let mut seed = 1u64;
        let mut noise = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; (seed as f64 / u64::MAX as f64) - 0.5 };
        // voix simplifiée : harmoniques de 200 Hz jusqu'à 5 kHz + souffle (bruit)
        let x: Vec<f64> = (0..96_000).map(|n| (1..=25).map(|h| (2.0 * PI * 200.0 * h as f64 * n as f64 / sr).sin() / h as f64).sum::<f64>() * 0.3 + 0.05 * noise()).collect();
        let mut p = Pitch::new(&PitchParams { semi: Some(-12.0), mix: Some(100.0), ..Default::default() }, sr);
        let out: Vec<f64> = x.iter().map(|v| { let mut s = [*v, 0.0]; p.tick(&mut s, 1); s[0] }).collect();
        // énergie du souffle par tranche de 1 ms
        // passe-haut à 7 kHz (sinus cardinal fenêtré) : ne garde que le souffle
        let (h, fc) = (127i64, 7000.0 / sr);
        let lp: Vec<f64> = (-h..=h).map(|k| { let k = k as f64; let s = if k == 0.0 { 2.0 * fc } else { (2.0 * PI * fc * k).sin() / (PI * k) }; s * (0.42 + 0.5 * (PI * k / (h as f64 + 1.0)).cos() + 0.08 * (2.0 * PI * k / (h as f64 + 1.0)).cos()) }).collect();
        let hf: Vec<f64> = (2 * h as usize..out.len()).map(|i| out[i - h as usize] - lp.iter().enumerate().map(|(j, c)| c * out[i - j]).sum::<f64>()).collect();
        let e: Vec<f64> = hf[24_000..90_000].chunks(48).map(|c| (c.iter().map(|v| v * v).sum::<f64>() / 48.0).sqrt()).collect();
        let m = e.iter().sum::<f64>() / e.len() as f64;
        let var = (e.iter().map(|v| (v - m).powi(2)).sum::<f64>() / e.len() as f64).sqrt() / m;
        assert!(var < 0.25, "souffle haché : variation {var:.2} (attendu < 0,25)");
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
    fn retune_reverb_applique_tout() {
        // Plugin : chaque réglage tourné (pré-délai, ducking, grave, aigu, brillance, largeur…) doit s'entendre
        // tout de suite : une reverb « retouchée » au départ sonne comme une reverb neuve avec ces réglages.
        let sr = 48_000.0;
        let a = ReverbParams { wet: Some(30.0), ..Default::default() };
        let b = ReverbParams { wet: Some(40.0), size: Some(3.0), decay: Some(3.5), pre: Some(60.0), duck: Some(70.0), low: Some(300.0),
            high: Some(6000.0), bright: Some(80.0), width: Some(140.0), ..Default::default() };
        let mut r1 = Reverb::new(&a, sr);
        r1.retune(&b, sr);
        r1.settle();
        let mut r2 = Reverb::new(&b, sr);
        for n in 0..24_000 {
            let v = (2.0 * PI * 220.0 * n as f64 / sr).sin() * if n < 6_000 { 0.8 } else { 0.0 };
            let (mut x1, mut x2) = ([v, -v * 0.5], [v, -v * 0.5]);
            r1.tick(&mut x1, 2);
            r2.tick(&mut x2, 2);
            assert!((x1[0] - x2[0]).abs() < 1e-12 && (x1[1] - x2[1]).abs() < 1e-12, "échantillon {n} : un réglage n'a pas été pris");
        }
    }

    #[test]
    fn retune_echo_applique_tout() {
        let sr = 48_000.0;
        let a = DelayParams { wet: Some(25.0), beats: Some(0.5), ..Default::default() };
        let b = DelayParams { wet: Some(60.0), feedback: Some(55.0), beats: Some(0.5), dry: Some(70.0), duck: Some(50.0), hpf: Some(400.0), lpf: Some(2500.0), ..Default::default() };
        let mut d1 = Delay::new(&a, sr, 120.0);
        d1.retune(&b, sr, 120.0);
        d1.settle();
        let mut d2 = Delay::new(&b, sr, 120.0);
        for n in 0..48_000 {
            let v = (2.0 * PI * 330.0 * n as f64 / sr).sin() * if n < 4_000 { 0.8 } else { 0.0 };
            let (mut x1, mut x2) = ([v, v], [v, v]);
            d1.tick(&mut x1, 2);
            d2.tick(&mut x2, 2);
            assert!((x1[0] - x2[0]).abs() < 1e-12 && (x1[1] - x2[1]).abs() < 1e-12, "échantillon {n} : un réglage n'a pas été pris");
        }
    }

    #[test]
    fn retune_comp_et_pitch_appliquent_tout() {
        let sr = 48_000.0;
        let ca = CompParams { threshold: Some(-10.0), ..Default::default() };
        let cb = CompParams { mode: Some(2.0), threshold: Some(-30.0), ratio: Some(8.0), mix: Some(70.0), attack: Some(1.0), release: Some(300.0),
            auto_rel: Some(0.0), knee: Some(3.0), makeup: Some(4.0), ..Default::default() };
        let (mut c1, mut c2) = (Compressor::new(&ca, sr), Compressor::new(&cb, sr));
        c1.retune(&cb, sr);
        c1.settle();
        let pa = PitchParams { semi: Some(3.0), mix: Some(100.0), ..Default::default() };
        let pb = PitchParams { semi: Some(-5.0), mix: Some(60.0), ..Default::default() };
        let (mut p1, mut p2) = (Pitch::new(&pa, sr), Pitch::new(&pb, sr));
        p1.retune(&pb, sr);
        p1.settle();
        for n in 0..24_000 {
            let v = (2.0 * PI * 220.0 * n as f64 / sr).sin() * 0.8;
            let (mut a, mut b) = ([v, v * 0.3], [v, v * 0.3]);
            c1.tick(&mut a, 2); c2.tick(&mut b, 2);
            assert!((a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12, "compresseur, échantillon {n}");
            let (mut a, mut b) = ([v, v], [v, v]);
            p1.tick(&mut a, 2); p2.tick(&mut b, 2);
            assert!((a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12, "pitch, échantillon {n}");
        }
    }

    #[test]
    fn reglage_tourne_sans_clic() {
        // Plugin : Quantité / Mélange poussés d'un coup en pleine note : le son glisse, il ne saute pas
        let sr = 48_000.0;
        let note = |n: usize| 0.5 * (2.0 * PI * 220.0 * n as f64 / sr).sin();
        let max_jump = |f: &mut dyn FnMut(usize, &mut [f64; 2])| {
            let (mut prev, mut j) = (0.0f64, 0.0f64);
            for n in 0..48_000 { let mut x = [note(n), note(n)]; f(n, &mut x); if n > 0 { j = j.max((x[0] - prev).abs()); } prev = x[0]; }
            j
        };
        let calm = 2.0 * PI * 220.0 / sr * 0.5 * 1.6;   // pente de la note elle-même (avec un peu de marge pour l'effet)
        let mut d = Delay::new(&DelayParams { wet: Some(0.0), beats: Some(0.5), ..Default::default() }, sr, 120.0);
        let j = max_jump(&mut |n, x| { if n == 24_000 { d.retune(&DelayParams { wet: Some(100.0), dry: Some(0.0), beats: Some(0.5), ..Default::default() }, sr, 120.0); } d.tick(x, 2); });
        assert!(j < calm * 1.5, "écho : saut de {j:.3}");
        let mut c = Compressor::new(&CompParams { mix: Some(0.0), ..Default::default() }, sr);
        let j = max_jump(&mut |n, x| { if n == 24_000 { c.retune(&CompParams { mix: Some(100.0), threshold: Some(-30.0), ..Default::default() }, sr); } c.tick(x, 2); });
        assert!(j < calm * 1.5, "compresseur : saut de {j:.3}");
        let mut p = Pitch::new(&PitchParams { semi: Some(5.0), mix: Some(0.0), ..Default::default() }, sr);
        let j = max_jump(&mut |n, x| { if n == 24_000 { p.retune(&PitchParams { semi: Some(5.0), mix: Some(100.0), ..Default::default() }, sr); } p.tick(x, 2); });
        assert!(j < calm * 1.5, "pitch : saut de {j:.3}");
        let mut r = Reverb::new(&ReverbParams { wet: Some(0.0), ..Default::default() }, sr);
        let j = max_jump(&mut |n, x| { if n == 24_000 { r.retune(&ReverbParams { wet: Some(100.0), ..Default::default() }, sr); } r.tick(x, 2); });
        assert!(j < calm * 3.0, "reverb : saut de {j:.3}");
    }

    #[test]
    fn limiteur_retune() {
        // Plugin : changer le relâchement ou le style garde la mémoire (même son qu'un limiteur neuf, une fois posé),
        // et monter le gain d'entrée d'un coup ne claque pas
        let sr = 48_000.0;
        let a = crate::model::LimitParams { tp: Some(1.0), ..Default::default() };
        let b = crate::model::LimitParams { tp: Some(1.0), release: Some(400.0), style: Some(1.0), ..Default::default() };
        let (mut l1, mut l2) = (Limiter::with(&a, -1.0, sr), Limiter::with(&b, -1.0, sr));
        l1.retune(&b, -1.0, sr);
        assert_eq!(l1.latency(), l2.latency());
        for n in 0..24_000 {
            let v = (2.0 * PI * 110.0 * n as f64 / sr).sin() * 1.4;
            let (mut x1, mut x2) = ([v, v], [v, v]);
            l1.tick(&mut x1); l2.tick(&mut x2);
            assert!((x1[0] - x2[0]).abs() < 1e-12, "échantillon {n}");
        }
        let mut l = Limiter::with(&a, -1.0, sr);
        let (mut prev, mut jump) = (0.0f64, 0.0f64);
        for n in 0..48_000 {
            if n == 24_000 { l.retune(&crate::model::LimitParams { tp: Some(1.0), gain: Some(12.0), ..Default::default() }, -1.0, sr); }
            let mut x = [(2.0 * PI * 220.0 * n as f64 / sr).sin() * 0.2; 2];
            l.tick(&mut x);
            if n > 200 { jump = jump.max((x[0] - prev).abs()); }
            prev = x[0];
        }
        assert!(jump < 0.05, "saut de {jump:.3} quand le gain d'entrée monte");
    }

    #[test]
    fn deesser_retune_et_ecoute() {
        use crate::model::DeessParams;
        let sr = 48_000.0;
        // une voix simplifiée : grave + « s » (bruit aigu) qui revient
        let mut seed = 1u32;
        let mut sig = |n: usize| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let s = if (n / 6000) % 2 == 1 { (seed as f64 / u32::MAX as f64 - 0.5) * 0.6 } else { 0.0 };
            0.3 * (2.0 * PI * 180.0 * n as f64 / sr).sin() + s
        };
        let a = DeessParams { thr: Some(-26.0), ..Default::default() };
        let b = DeessParams { thr: Some(-40.0), range: Some(18.0), lo: Some(4000.0), hi: Some(12000.0), rel: Some(true), wide: Some(true), ..Default::default() };
        let (mut d1, mut d2) = (DeesserV2::new(&a, sr), DeesserV2::new(&b, sr));
        d1.retune(&b, sr);
        d1.settle();
        let input: Vec<f64> = (0..48_000).map(&mut sig).collect();
        for (n, v) in input.iter().enumerate() {
            let (mut x1, mut x2) = ([*v, *v], [*v, *v]);
            d1.process(&mut x1, 2); d2.process(&mut x2, 2);
            assert!((x1[0] - x2[0]).abs() < 1e-12, "échantillon {n} : un réglage n'a pas été pris");
        }
        // « Écouter » : on n'entend plus le grave (180 Hz), et le passage glisse
        let mut d = DeesserV2::new(&a, sr);
        let (mut lo_after, mut prev, mut jump) = (0.0f64, 0.0f64, 0.0f64);
        for n in 0..24_000 {
            if n == 12_000 { d.set_listen(true); }
            let v = 0.3 * (2.0 * PI * 180.0 * n as f64 / sr).sin();
            let mut x = [v, v];
            d.process(&mut x, 2);
            if n > 0 { jump = jump.max((x[0] - prev).abs()); }
            prev = x[0];
            if n > 18_000 { lo_after = lo_after.max(x[0].abs()); }
        }
        assert!(lo_after < 0.01, "en écoute, la voix reste : {lo_after}");
        assert!(jump < 0.02, "saut de {jump}");
    }

    #[test]
    fn gate_retune_et_ecoute() {
        let sr = 48_000.0;
        let a = GateParams { threshold: Some(-45.0), ..Default::default() };
        let b = GateParams { threshold: Some(-30.0), reduction: Some(20.0), ratio: Some(4.0), knee: Some(6.0), attack: Some(5.0), hold: Some(80.0), release: Some(300.0), hp: Some(120.0), lp: Some(8000.0) };
        let (mut g1, mut g2) = (Gate::new(&a, sr), Gate::new(&b, sr));
        g1.retune(&b, sr);
        for n in 0..48_000 {
            let v = (2.0 * PI * 200.0 * n as f64 / sr).sin() * if (n / 8000) % 2 == 0 { 0.5 } else { 0.004 };
            let (mut x1, mut x2) = ([v, v], [v, v]);
            g1.process(&mut x1, 2); g2.process(&mut x2, 2);
            assert!((x1[0] - x2[0]).abs() < 1e-12, "échantillon {n}");
        }
        // « Écouter » avec un coupe-bas à 1 kHz : le 200 Hz disparaît, en glissant
        let mut g = Gate::new(&GateParams { hp: Some(1000.0), ..Default::default() }, sr);
        let (mut prev, mut jump, mut after) = (0.0f64, 0.0f64, 0.0f64);
        for n in 0..24_000 {
            if n == 12_000 { g.set_listen(true); }
            let mut x = [(2.0 * PI * 200.0 * n as f64 / sr).sin() * 0.5; 2];
            g.process(&mut x, 2);
            if n > 0 { jump = jump.max((x[0] - prev).abs()); }
            prev = x[0];
            if n > 18_000 { after = after.max(x[0].abs()); }
        }
        assert!(after < 0.05, "en écoute, le grave reste : {after}");
        assert!(jump < 0.03, "saut de {jump}");
    }

    #[test]
    fn multibande_tranches_justes() {
        use crate::model::{MbandBand, MbandParams};
        let sr = 48_000.0;
        let rms_of = |mb: &mut MultiBand, f: f64| {
            let (mut si, mut so) = (0.0, 0.0);
            for n in 0..48_000 {
                let v = (2.0 * PI * f * n as f64 / sr).sin() * 0.3;
                let mut x = [v, v];
                mb.tick(&mut x, 2);
                if n >= 24_000 { si += v * v; so += x[0] * x[0]; }
            }
            20.0 * (so / si).sqrt().log10()
        };
        let band = |lo: f64, hi: f64, mute: bool| MbandBand { lo: Some(lo), hi: Some(hi), thr: Some(0.0), range: Some(0.0), mute: Some(mute), ..Default::default() };
        // bandes au repos : le volume ne bouge à aucune fréquence (tranches recollées)
        for f in [40.0, 150.0, 700.0, 3000.0, 12_000.0] {
            let mut mb = MultiBand::new(&MbandParams { bands: vec![band(100.0, 500.0, false), band(500.0, 4000.0, false), band(2000.0, 8000.0, false)] }, sr).unwrap();
            let d = rms_of(&mut mb, f);
            assert!(d.abs() < 0.01, "{f} Hz : {d:.3} dB au repos");
        }
        // une bande muette disparaît vraiment (et seulement elle)
        let mut mb = MultiBand::new(&MbandParams { bands: vec![band(1000.0, 20000.0, true)] }, sr).unwrap();
        let d = rms_of(&mut mb, 5000.0);
        assert!(d < -50.0, "5 kHz dans une bande muette : {d:.1} dB");
        let mut mb = MultiBand::new(&MbandParams { bands: vec![band(1000.0, 20000.0, true)] }, sr).unwrap();
        let d = rms_of(&mut mb, 100.0);
        assert!(d.abs() < 0.05, "100 Hz hors de la bande muette : {d:.2} dB");
        // une bande en solo : on n'entend qu'elle
        let mut solo = band(200.0, 2000.0, false); solo.solo = Some(true);
        let mut mb = MultiBand::new(&MbandParams { bands: vec![solo.clone()] }, sr).unwrap();
        assert!(rms_of(&mut mb, 8000.0) < -40.0, "solo : 8 kHz doit disparaître");
        let mut mb = MultiBand::new(&MbandParams { bands: vec![solo] }, sr).unwrap();
        assert!(rms_of(&mut mb, 700.0).abs() < 0.3, "solo : 700 Hz doit rester");
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

#[cfg(test)]
mod taille {
    #[test]
    #[ignore]
    fn taille_chain() { println!("Chain = {} octets, FxChain = {} octets", std::mem::size_of::<super::Chain>(), std::mem::size_of::<super::FxChain>()); }
}
