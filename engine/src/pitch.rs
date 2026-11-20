//! Pitch « voix fidèle » : la hauteur et les formants se règlent séparément, la voix garde son timbre.
//! Même calcul que le worklet `pulse-pitch` de audio.js (parité testée).
//!
//! Principe (TD-PSOLA en temps réel) :
//! 1. on suit la note de la voix (YIN sur le son ramené à un quart de cadence) toutes les 256 échantillons ;
//! 2. on pose un repère par période de la voix (calé sur la crête locale) ; hors voix (souffle, « s ») un repère toutes les 5 ms ;
//! 3. on rejoue des grains de deux périodes, rapprochés (plus aigu) ou écartés (plus grave) ;
//!    (les grains gardent le timbre d'origine) ;
//! 4. le volume est recalé par la somme des fenêtres (pas de battement).
//! 5. au-dessus de 6 kHz (souffle, air de la voix ; jusqu'à 3,5 kHz vers l'octave en dessous) le son n'est pas haché :
//!    un grain par repère, à sa place (note inchangée), sans trou. Sans ça, en descendant, ce souffle « craque ».
//! 6. formant : la voix sortie passe dans un filtre qui déplace son enveloppe (la « couleur », lissée par cepstre) de N échantillons
//!    de fenêtre, sans toucher aux harmoniques — plus naturel que d'étirer les grains (moins de grain, timbre plus juste).
//!    Grains placés à la fraction d'échantillon près, au rythme des vraies périodes de la voix (micro-variations gardées).
//! Les repères suivent la forme de l'onde (le plus ressemblant à la période d'avant), pas seulement la crête :
//! une crête qui saute d'un côté à l'autre de l'onde faisait aussi craquer.
//! Retard fixe `latency()` (≈ 102 ms à 48 kHz) : l'hôte (Logic, Pulse) le compense.
use crate::model::PitchParams;
use std::collections::VecDeque;
use std::f64::consts::PI;

const DS: usize = 4;
const HOP: usize = 256;
const FMIN: f64 = 70.0;
const FMAX: f64 = 1000.0;
const YIN_THR: f64 = 0.15;
const GATE: f64 = 0.003_981_071_705_534_973; // −48 dB
/// Coupure entre la voix (traitée période par période) et le souffle aigu (grains continus)
const SPLIT_HZ: f64 = 6000.0;
/// Demi-longueur du filtre de coupure (phase linéaire, Blackman)
const FIR_H: usize = 64;
/// Formant : fenêtre d'analyse (2048 à 44,1 / 48 kHz) et lissage de l'enveloppe (cepstre gardé jusqu'à 0,83 ms)
const LIFTER_S: f64 = 40.0 / 48000.0;

/// FFT complexe en place (radix 2), tables précalculées
struct Fft { n: usize, cs: Vec<f64>, sn: Vec<f64>, rev: Vec<usize> }
impl Fft {
    fn new(n: usize) -> Self {
        let bits = n.trailing_zeros();
        let rev = (0..n).map(|i| i.reverse_bits() >> (usize::BITS - bits)).collect();
        Self { n, cs: (0..n / 2).map(|k| (2.0 * PI * k as f64 / n as f64).cos()).collect(), sn: (0..n / 2).map(|k| -(2.0 * PI * k as f64 / n as f64).sin()).collect(), rev }
    }
    fn run(&self, re: &mut [f64], im: &mut [f64]) {
        let n = self.n;
        for i in 0..n { let j = self.rev[i]; if j > i { re.swap(i, j); im.swap(i, j); } }
        let mut len = 2;
        while len <= n {
            let st = n / len;
            for b in (0..n).step_by(len) {
                for k in 0..len / 2 {
                    let (c, s) = (self.cs[k * st], self.sn[k * st]);
                    let (i, j) = (b + k, b + k + len / 2);
                    let (tr, ti) = (re[j] * c - im[j] * s, re[j] * s + im[j] * c);
                    re[j] = re[i] - tr; im[j] = im[i] - ti; re[i] += tr; im[i] += ti;
                }
            }
            len *= 2;
        }
    }
}

/// Déplace l'enveloppe spectrale (formants) d'un facteur, harmoniques intactes. Retard : n échantillons.
struct Formant {
    n: usize, hop: usize, lift: usize, fft: Fft, win: Vec<f64>,
    inp: [Vec<f64>; 2], ola: [Vec<f64>; 2], cnt: usize,
    re: [Vec<f64>; 2], im: [Vec<f64>; 2], cr: Vec<f64>, ci: Vec<f64>, env: Vec<f64>,
}
impl Formant {
    fn new(sr: f64) -> Self {
        let n = if sr > 50_000.0 { 4096 } else { 2048 };
        let z = || vec![0.0; n];
        Self { n, hop: n / 4, lift: (LIFTER_S * sr).round().max(8.0) as usize, fft: Fft::new(n),
            win: (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect(),
            inp: [z(), z()], ola: [vec![0.0; 2 * n], vec![0.0; 2 * n]], cnt: 0,
            re: [z(), z()], im: [z(), z()], cr: z(), ci: z(), env: vec![0.0; n / 2 + 1] }
    }
    /// Un échantillon (nc canaux) entre, celui d'il y a n échantillons sort
    fn tick(&mut self, x: &mut [f64; 2], nc: usize, fr: f64) {
        let (n, m2) = (self.n, 2 * self.n - 1);
        let wi = self.cnt % n;
        for ch in 0..nc { self.inp[ch][wi] = x[ch]; }
        self.cnt += 1;
        if self.cnt % self.hop == 0 { self.frame(nc, fr); }
        let o = self.cnt.wrapping_sub(1 + n);
        for ch in 0..nc {
            if self.cnt < n + 1 { x[ch] = 0.0; continue; }
            let j = o & m2;
            x[ch] = self.ola[ch][j]; self.ola[ch][j] = 0.0;
        }
    }
    fn frame(&mut self, nc: usize, fr: f64) {
        let n = self.n; let m2 = 2 * n - 1; let h = n / 2;
        let g = 1.0 / 1.5; // somme des fenêtres² au quart de recouvrement
        let same = (fr - 1.0).abs() < 1e-6;
        for ch in 0..nc {
            for i in 0..n {
                let t = self.cnt as i64 - n as i64 + i as i64;
                let v = if t < 0 { 0.0 } else { self.inp[ch][(t as usize) % n] } * self.win[i];
                if same { if t >= 0 { self.ola[ch][(t as usize) & m2] += v * self.win[i] * g; } continue; }
                self.re[ch][i] = v; self.im[ch][i] = 0.0;
            }
        }
        if same { return; }
        for ch in 0..nc { let (re, im) = (&mut self.re[ch], &mut self.im[ch]); self.fft.run(re, im); }
        // enveloppe : log de l'amplitude (moyenne des canaux en puissance), cepstre gardé jusqu'à `lift`, retour
        for k in 0..=h {
            let mut p = 0.0;
            for ch in 0..nc { p += self.re[ch][k] * self.re[ch][k] + self.im[ch][k] * self.im[ch][k]; }
            let a = (p / nc as f64).sqrt().max(1e-9).ln();
            self.cr[k] = a; self.ci[k] = 0.0;
            if k > 0 && k < h { self.cr[n - k] = a; self.ci[n - k] = 0.0; }
        }
        self.fft.run(&mut self.cr, &mut self.ci);
        let l = self.lift.min(h);
        for i in 0..n { self.ci[i] = 0.0; self.cr[i] = if i < l || i > n - l { self.cr[i] / n as f64 } else { 0.0 }; }
        self.fft.run(&mut self.cr, &mut self.ci);
        for k in 0..=h { self.env[k] = self.cr[k]; }
        // gain : enveloppe lue en k / fr, moins l'enveloppe d'origine (plafonné à +18 dB)
        for k in 0..=h {
            let x = k as f64 / fr;
            let e = if x >= h as f64 { self.env[h] } else { let i = x.floor() as usize; let f = x - i as f64; self.env[i] + (self.env[i + 1] - self.env[i]) * f };
            let gk = (e - self.env[k]).min(8f64.ln()).exp();
            for ch in 0..nc {
                self.re[ch][k] *= gk; self.im[ch][k] *= gk;
                if k > 0 && k < h { self.re[ch][n - k] *= gk; self.im[ch][n - k] *= gk; }
            }
        }
        // retour (FFT inverse = conjugué de la FFT du conjugué), fenêtre, addition
        for ch in 0..nc {
            for v in self.im[ch].iter_mut() { *v = -*v; }
            let (re, im) = (&mut self.re[ch], &mut self.im[ch]); self.fft.run(re, im);
            for i in 0..n {
                let t = self.cnt as i64 - n as i64 + i as i64;
                if t >= 0 { self.ola[ch][(t as usize) & m2] += self.re[ch][i] / n as f64 * self.win[i] * g; }
            }
        }
    }
}

#[derive(Clone, Copy)]
struct Mark { pos: i64, t: usize, voiced: bool, /** période exacte (fraction d'échantillon) */ p: f64, /** position exacte */ pf: f64 }

pub struct Pitch {
    sr: f64,
    // réglages
    ratio: f64,
    fratio: f64,
    mix: f64,
    mix_to: f64,
    mix_k: f64,
    /// part du pitch (0 = son d'origine) : à 0 demi-ton et 0 formant on repasse au son d'origine en fondu
    act: f64,
    /// part des grains : 0 quand la hauteur ne bouge pas (formant seul : la voix passe telle quelle dans le filtre de formant)
    pact: f64,
    // tailles
    nb: usize,
    nbd: usize,
    tmax_d: usize,
    tmin_d: usize,
    win_d: usize,
    dla: usize,
    g: usize,
    lat: usize,
    /// retard des grains seuls (avant le filtre de formant)
    lat_p: usize,
    form: Formant,
    unv: usize,
    // mémoires
    buf: [Vec<f64>; 2],
    /// partie sous 6 kHz de l'entrée (même retard que `buf`, calculée FIR_H échantillons plus tard)
    bufl: [Vec<f64>; 2],
    fir: Vec<f64>,
    /// souffle aigu : sortie, somme des fenêtres
    yh: [Vec<f64>; 2],
    wsh: Vec<f64>,
    mono: Vec<f64>,
    ds: Vec<f64>,
    acc: f64,
    w: i64,
    f0: Vec<f64>,
    hops: i64,
    marks: VecDeque<Mark>,
    /// mêmes repères, pour le souffle aigu (qui garde la note : un grain par période, au même endroit)
    hmarks: VecDeque<Mark>,
    /// coupure actuelle voix / souffle (Hz)
    cut: f64,
    next_mark: f64,
    ts: f64,
    y: [Vec<f64>; 2],
    wsum: Vec<f64>,
    floor: Vec<f64>,
    dwin: Vec<f64>,
    diff: Vec<f64>,
}

impl Pitch {
    pub fn new(p: &PitchParams, sr: f64) -> Self {
        let sd = sr / DS as f64;
        let tmax_d = (sd / FMIN).ceil() as usize;
        let tmin_d = ((sd / FMAX).floor() as usize).max(2);
        let win_d = 2 * tmax_d + 32;
        let dla = win_d * DS / 2;
        let tmax = (sr / FMIN).ceil() as usize;
        let g = (0.025 * sr).round() as usize;
        let lat_p = g + dla + (1.3 * tmax as f64).ceil() as usize + 16;
        let form = Formant::new(sr);
        let lat = lat_p + form.n;
        let nb = (4 * lat).next_power_of_two();
        let nbd = (nb / DS).next_power_of_two();
        let mut s = Self {
            sr, ratio: 1.0, fratio: 1.0, mix: 1.0, mix_to: 1.0, mix_k: 1.0 - (-1.0 / (0.01 * sr)).exp(), act: 1.0, pact: 1.0,
            nb, nbd, tmax_d, tmin_d, win_d, dla, g, lat, lat_p, form, unv: (0.005 * sr).round() as usize,
            buf: [vec![0.0; nb], vec![0.0; nb]], bufl: [vec![0.0; nb], vec![0.0; nb]], fir: Self::fir(sr, SPLIT_HZ),
            yh: [vec![0.0; nb], vec![0.0; nb]], wsh: vec![0.0; nb], mono: vec![0.0; nb], ds: vec![0.0; nbd], acc: 0.0, w: 0,
            f0: vec![0.0; 64], hops: 0, marks: VecDeque::with_capacity(256), hmarks: VecDeque::with_capacity(256), cut: SPLIT_HZ, next_mark: 0.0, ts: 0.0,
            y: [vec![0.0; nb], vec![0.0; nb]], wsum: vec![0.0; nb], floor: vec![1.0; nb],
            dwin: vec![0.0; win_d], diff: vec![0.0; tmax_d + 1],
        };
        s.set(p);
        s.mix = s.mix_to;
        s.act = s.act_to();
        s.pact = s.pact_to();
        s
    }
    /// Passe-bas à phase linéaire (sinus cardinal fenêtré Blackman, gain 1), même calcul que pitchFir dans audio.js
    fn fir(sr: f64, cut: f64) -> Vec<f64> {
        let (h, fc) = (FIR_H as f64, cut / sr);
        let mut f: Vec<f64> = (0..=2 * FIR_H).map(|i| {
            let k = i as f64 - h;
            let sinc = if k == 0.0 { 2.0 * fc } else { (2.0 * PI * fc * k).sin() / (PI * k) };
            sinc * (0.42 + 0.5 * (PI * k / (h + 1.0)).cos() + 0.08 * (2.0 * PI * k / (h + 1.0)).cos())
        }).collect();
        let sum: f64 = f.iter().sum();
        for v in &mut f { *v /= sum; }
        f
    }
    fn set(&mut self, p: &PitchParams) {
        let semi = p.semi.unwrap_or(0.0).clamp(-12.0, 12.0);
        let form = p.formant.unwrap_or(0.0).clamp(-12.0, 12.0);
        self.ratio = 2f64.powf(semi / 12.0);
        self.fratio = 2f64.powf(form / 12.0);
        self.mix_to = (p.mix.unwrap_or(100.0) / 100.0).clamp(0.0, 1.0);
        self.split();
    }
    /// Coupure voix / souffle : 6 kHz, descendue peu à peu jusqu'à 3,5 kHz quand on descend vers l'octave (grains courts, donc des
    /// trous entre eux : le souffle du médium aigu doit aussi rester continu). Pas plus bas ailleurs : la note d'origine s'entendrait.
    /// Même calcul que pitchCut dans audio.js.
    fn split(&mut self) {
        let q = 1.0 / self.ratio;
        let cut = SPLIT_HZ - 2500.0 * ((q - 1.6) / 0.4).clamp(0.0, 1.0);
        if (cut - self.cut).abs() > 25.0 || self.fir.is_empty() { self.cut = cut; self.fir = Self::fir(self.sr, cut); }
    }
    fn pact_to(&self) -> f64 { if (self.ratio - 1.0).abs() < 1e-9 { 0.0 } else { 1.0 } }
    fn act_to(&self) -> f64 { if (self.ratio - 1.0).abs() < 1e-9 && (self.fratio - 1.0).abs() < 1e-9 { 0.0 } else { 1.0 } }
    /// Retard en échantillons (fixe pour une fréquence d'échantillonnage donnée)
    pub fn latency(&self) -> usize { self.lat }
    /// Retard pour une fréquence donnée, sans créer l'effet
    pub fn latency_for(sr: f64) -> usize { Self::new(&PitchParams::default(), sr).lat }
    /// Valeurs de volume prises tout de suite, sans glisser
    pub fn settle(&mut self) { self.mix = self.mix_to; self.act = self.act_to(); self.pact = self.pact_to(); }
    /// Plugin : nouveaux réglages, même mémoire (pas de trou dans le son)
    pub fn retune(&mut self, p: &PitchParams, _sr: f64) { self.set(p); }
    /// Automation : « semi », « formant », « mix »
    pub fn set_live(&mut self, key: &str, v: f64) {
        match key {
            "semi" => { self.ratio = 2f64.powf(v.clamp(-12.0, 12.0) / 12.0); self.split(); }
            "formant" => self.fratio = 2f64.powf(v.clamp(-12.0, 12.0) / 12.0),
            "mix" => self.mix_to = (v / 100.0).clamp(0.0, 1.0),
            _ => {}
        }
    }
    #[inline]
    fn at(&self, b: &[f64], i: i64) -> f64 { if i < 0 || i >= self.w { 0.0 } else { b[(i as usize) & (self.nb - 1)] } }
    /// Note (période en échantillons, 0 = pas de note) du bloc d'analyse centré sur `c`
    fn yin(&mut self, c: i64) -> f64 {
        let cd = c / DS as i64 - (self.win_d / 2) as i64;
        let nd = self.w / DS as i64;
        let mut e = 0.0;
        for j in 0..self.win_d {
            let k = cd + j as i64;
            let v = if k < 0 || k >= nd { 0.0 } else { self.ds[(k as usize) & (self.nbd - 1)] };
            self.dwin[j] = v;
            e += v * v;
        }
        if (e / self.win_d as f64).sqrt() < GATE { return 0.0; }
        let ww = self.win_d - self.tmax_d;
        for t in 0..=self.tmax_d {
            let mut s = 0.0;
            for j in 0..ww { let d = self.dwin[j] - self.dwin[j + t]; s += d * d; }
            self.diff[t] = s;
        }
        // différence cumulée normalisée (en place)
        let mut cs = 0.0;
        self.diff[0] = 1.0;
        for t in 1..=self.tmax_d { cs += self.diff[t]; self.diff[t] = if cs > 1e-12 { self.diff[t] * t as f64 / cs } else { 1.0 }; }
        let cm = &self.diff;
        let (tm, mut t) = (self.tmax_d, self.tmin_d);
        while t < tm && cm[t] >= YIN_THR { t += 1; }
        if t >= tm { return 0.0; }
        while t + 1 < tm && cm[t + 1] < cm[t] { t += 1; }
        let den = 2.0 * (cm[t - 1] - 2.0 * cm[t] + cm[t + 1]);
        let b = t as f64 + if den.abs() > 1e-12 { (cm[t - 1] - cm[t + 1]) / den } else { 0.0 };
        b * DS as f64
    }
    fn period_at(&self, pos: f64) -> f64 {
        let h = ((pos / HOP as f64).round() as i64).clamp(0, (self.hops - 1).max(0));
        if self.hops == 0 { 0.0 } else { self.f0[(h as usize) % self.f0.len()] }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let nb1 = self.nb - 1;
        // 1. mémoire d'entrée
        let wi = (self.w as usize) & nb1;
        let mut m = 0.0;
        for ch in 0..2 { let v = if ch < nc { x[ch] } else { x[0] }; self.buf[ch][wi] = v; m += v; }
        m *= 0.5;
        self.mono[wi] = m;
        self.acc += m;
        if (self.w + 1) % DS as i64 == 0 { self.ds[((self.w as usize) / DS) & (self.nbd - 1)] = self.acc / DS as f64; self.acc = 0.0; }
        self.w += 1;
        // 1b. partie sous 6 kHz, centrée FIR_H échantillons plus tôt
        let c = self.w - 1 - FIR_H as i64;
        if c >= 0 {
            for ch in 0..2 {
                let mut a = 0.0;
                for (j, f) in self.fir.iter().enumerate() { let i = c - FIR_H as i64 + j as i64; if i >= 0 { a += f * self.buf[ch][(i as usize) & nb1]; } }
                self.bufl[ch][(c as usize) & nb1] = a;
            }
        }
        // 2. suivi de la note
        while self.hops * HOP as i64 + (self.dla + DS) as i64 <= self.w {
            let c = self.hops * HOP as i64;
            let p = self.yin(c);
            let n = self.f0.len();
            self.f0[(self.hops as usize) % n] = p;
            self.hops += 1;
        }
        // 3. repères (un par période)
        loop {
            let pos = self.next_mark;
            let per = self.period_at(pos);
            let t = if per > 0.0 { (per.round() as usize).max(8) } else { self.unv };
            let reach = pos + 0.3 * t as f64 + 1.0;
            if reach > (self.w - self.dla as i64) as f64 || ((pos / HOP as f64).round() as i64) >= self.hops { break; }
            if per > 0.0 {
                let lo = (pos - 0.3 * t as f64) as i64;
                let hi = (pos + 0.3 * t as f64) as i64;
                let (mut pk, mut best) = (lo.max(0), f64::MIN);
                let mut cv: Vec<f64> = Vec::new();
                match self.marks.back().copied().filter(|m| m.voiced) {
                    // suite d'une note : le repère dont la période ressemble le plus à celle d'avant (corrélation, un point sur deux)
                    Some(pm) => {
                        let n = t as i64;
                        for k in lo.max(0)..=hi {
                            let (mut c, mut ea, mut eb) = (0.0, 1e-12, 1e-12);
                            let mut j = -n / 2;
                            while j < n / 2 { let a = self.at(&self.mono, pm.pos + j); let b = self.at(&self.mono, k + j); c += a * b; ea += a * a; eb += b * b; j += 2; }
                            let v = c / (ea * eb).sqrt();
                            cv.push(v);
                            if v > best { best = v; pk = k; }
                        }
                    }
                    // début de note : la crête
                    None => for k in lo.max(0)..=hi { let v = self.at(&self.mono, k).abs(); if v > best { best = v; pk = k; } },
                }
                // position affinée entre deux échantillons (sommet de la corrélation)
                let mut pf = pk as f64;
                let j = (pk - lo.max(0)) as usize;
                if j >= 1 && j + 1 < cv.len() {
                    let (a, b, c) = (cv[j - 1], cv[j], cv[j + 1]);
                    let den = a - 2.0 * b + c;
                    if den < -1e-12 { pf += (0.5 * (a - c) / den).clamp(-0.5, 0.5); }
                }
                if let Some(last) = self.marks.back() { if pk <= last.pos { pk = pos as i64; pf = pk as f64; } }
                // la période d'avant = l'écart réel entre les deux repères : la sortie garde les micro-variations de la voix
                if let Some(last) = self.marks.back_mut().filter(|m| m.voiced) {
                    let d = pf - last.pf;
                    if d > 0.7 * last.p && d < 1.3 * last.p { last.p = d; }
                }
                if let Some(last) = self.hmarks.back_mut().filter(|m| m.voiced) {
                    let d = pf - last.pf;
                    if d > 0.7 * last.p && d < 1.3 * last.p { last.p = d; }
                }
                self.marks.push_back(Mark { pos: pk, t, voiced: true, p: per.max(8.0), pf });
                self.hmarks.push_back(Mark { pos: pk, t, voiced: true, p: per.max(8.0), pf });
                self.next_mark = (pk + t as i64) as f64;
            } else {
                self.marks.push_back(Mark { pos: pos as i64, t, voiced: false, p: t as f64, pf: pos.floor() });
                self.hmarks.push_back(Mark { pos: pos as i64, t, voiced: false, p: t as f64, pf: pos.floor() });
                self.next_mark = pos + t as f64;
            }
        }
        // 4. grains
        let o = self.w - 1 - self.lat_p as i64;
        while self.ts <= (o + self.g as i64) as f64 && !self.marks.is_empty() {
            while self.marks.len() > 1 && (self.marks[1].pos as f64 - self.ts).abs() <= (self.marks[0].pos as f64 - self.ts).abs() { self.marks.pop_front(); }
            let mk = self.marks[0];
            let rr = if mk.voiced { self.ratio } else { 1.0 };
            let q = 1.0 / rr;
            // grain allongé quand on descend un peu ; vers l'octave, raccourci (moins d'une période de chaque côté) : sinon la note
            // d'origine reste dedans et on entend un doublage. (Le formant se fait après, par le filtre d'enveloppe.)
            let ext = if !mk.voiced { 1.0 } else if q <= 1.4 { q } else { (1.4 - (q - 1.4) * 2.0).max(0.65) };
            let l = (((mk.t as f64 * ext) as usize).max(1)).min(self.g);
            // grain posé à la fraction d'échantillon près (sinon la période de sortie tremble d'un demi-échantillon : voix rêche)
            let c = self.ts.floor() as i64;
            let fc = self.ts - c as f64;
            let fl = if rr < 1.0 { rr } else { 1.0 };
            for k in -(l as i64)..=(l as i64 + 1) {
                let di = c + k;
                if di < 0 { continue; }
                let u = k as f64 - fc;
                if u.abs() >= l as f64 { continue; }
                let si = mk.pf + u;
                if si < 0.0 || si >= (self.w - 1) as f64 { continue; }
                let i0 = si.floor() as i64;
                let f = si - i0 as f64;
                let wv = 0.5 + 0.5 * (PI * u / l as f64).cos();
                let dj = (di as usize) & nb1;
                for ch in 0..2 {
                    let a = self.bufl[ch][(i0 as usize) & nb1];
                    let b = self.bufl[ch][((i0 + 1) as usize) & nb1];
                    self.y[ch][dj] += (a + (b - a) * f) * wv;
                }
                self.wsum[dj] += wv;
                self.floor[dj] = fl;
            }
            self.ts += mk.p / rr;
        }
        // 4b. souffle aigu : un grain par repère, au même endroit (note inchangée), sans trou entre eux
        while self.hmarks.front().is_some_and(|m| m.pos <= o + self.g as i64) {
            let m = self.hmarks.pop_front().unwrap();
            let l = ((m.t as i64).max(1)).min(self.g as i64);
            for k in -l..=l {
                let di = m.pos + k;
                if di < 0 { continue; }
                let si = m.pos as f64 + k as f64;
                if si < 0.0 { continue; }
                let i0 = si.floor() as i64;
                let f = si - i0 as f64;
                let wv = 0.5 + 0.5 * (PI * k as f64 / l as f64).cos();
                let dj = (di as usize) & nb1;
                for ch in 0..2 {
                    let (j0, j1) = ((i0 as usize) & nb1, ((i0 + 1) as usize) & nb1);
                    let a = self.buf[ch][j0] - self.bufl[ch][j0];
                    let b = self.buf[ch][j1] - self.bufl[ch][j1];
                    self.yh[ch][dj] += (a + (b - a) * f) * wv;
                }
                self.wsh[dj] += wv;
            }
        }
        // 5. sortie (retard fixe), mélangée au son d'origine au même retard
        self.mix += (self.mix_to - self.mix) * self.mix_k;
        let at = self.act_to();
        self.act += (at - self.act) * self.mix_k;
        if (self.act - at).abs() < 1e-7 { self.act = at; }
        let pt = self.pact_to();
        self.pact += (pt - self.pact) * self.mix_k;
        if (self.pact - pt).abs() < 1e-7 { self.pact = pt; }
        let mut wet = [0.0; 2];
        let oj = (o.max(0) as usize) & nb1;
        if o >= 0 {
            let den = self.wsum[oj].max(self.floor[oj]);
            for ch in 0..nc {
                let g = self.y[ch][oj] / den + self.yh[ch][oj] / self.wsh[oj].max(1e-3);
                let d = self.buf[ch][oj];
                wet[ch] = d + (g - d) * self.pact;
            }
        }
        // formant (retard fixe form.n), puis mélange avec le son d'origine au même retard
        let fr = self.fratio;
        self.form.tick(&mut wet, nc.min(2), fr);
        let od = self.w - 1 - self.lat as i64;
        for ch in 0..nc {
            let dry = if od < 0 { 0.0 } else { self.buf[ch][(od as usize) & nb1] };
            x[ch] = if od < 0 { 0.0 } else { dry + (wet[ch] - dry) * self.mix * self.act };
        }
        if o < 0 { return; }
        self.y[0][oj] = 0.0; self.y[1][oj] = 0.0; self.wsum[oj] = 0.0; self.floor[oj] = 1.0;
        self.yh[0][oj] = 0.0; self.yh[1][oj] = 0.0; self.wsh[oj] = 0.0;
    }

}
