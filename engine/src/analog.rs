//! Gamme Analogique : machines de studio reprises « à notre sauce » (comportement et façon de régler des vraies,
//! noms et façades à nous). Branchées dans la chaîne d'effets (fx.rs) sous les noms « fet76 » et « pre73 ».
//!
//! `Fet76` — compresseur FET, esprit « 76 » (le WA76 de la chaîne du studio) :
//! - pas de seuil : on pousse l'Entrée, la Sortie remet le niveau ;
//! - Attaque et Relâchement de 1 (lent) à 7 (rapide) : 800 µs → 20 µs, 1,1 s → 50 ms ;
//! - ratios 4, 8, 12, 20 et « tous enfoncés » (plus que 20:1, attaque plus molle, ça pompe et ça grogne) ;
//! - couleur : le FET ajoute surtout de l'harmonique 2 quand il réduit, l'étage de sortie (transfo) arrondit les crêtes
//!   (harmonique 3) ; calculés 4× plus vite (pas de parasites aigus), comme la Saturation.
//!
//! `Pre73` — préampli + EQ de console, esprit « 73 » (le WA73 du studio) :
//! - Gain du préampli (0 à +30 dB) : plus on pousse, plus les transfos et l'étage classe A colorent (harmonique 2 puis 3) ;
//! - EQ à fréquences fixes comme la machine : aigus 12 kHz (plateau), médiums 360 Hz · 700 Hz · 1,6 · 3,2 · 4,8 · 7,2 kHz (cloche large),
//!   graves 35 · 60 · 110 · 220 Hz (plateau), coupe-bas 50 · 80 · 160 · 300 Hz (18 dB / octave) ;
//! - Sortie pour remettre le niveau.
use std::f64::consts::PI;
use crate::fx::{eq_matched, Biquad};

/// Filtre du suréchantillonnage des machines : 128 coefficients (Blackman), coupure ≈ 22,6 kHz à 48 kHz —
/// plus raide que celui de la Saturation : les aigus restent à plat jusqu'à 18-20 kHz
fn os_fir() -> [f64; 128] {
    let mut h = [0.0; 128];
    let fc = 0.118;
    for (i, v) in h.iter_mut().enumerate() {
        let m = i as f64 - 63.5;
        let x = 2.0 * fc * m;
        let sinc = if x.abs() < 1e-12 { 1.0 } else { (PI * x).sin() / (PI * x) };
        let w = 0.42 - 0.5 * (2.0 * PI * i as f64 / 127.0).cos() + 0.08 * (4.0 * PI * i as f64 / 127.0).cos();
        *v = 2.0 * fc * sinc * w;
    }
    let s: f64 = h.iter().sum();
    for v in h.iter_mut() { *v /= s; }
    h
}
/// Suréchantillonnage ×4 : `f` est appelée 4 fois par échantillon, à 4× la cadence. Retard : 31,5 échantillons.
#[derive(Clone)]
struct Os4 { h: [f64; 128], xin: [f64; 32], xs: [f64; 128], pos: usize }
impl Os4 {
    fn new() -> Self { Self { h: os_fir(), xin: [0.0; 32], xs: [0.0; 128], pos: 0 } }
    fn run(&mut self, v: f64, mut f: impl FnMut(f64) -> f64) -> f64 {
        self.xin.copy_within(0..31, 1);
        self.xin[0] = v;
        for p in 0..4 {
            let mut u = 0.0;
            for j in 0..32 { u += self.h[p + 4 * j] * self.xin[j]; }
            self.pos = (self.pos + 1) % 128;
            self.xs[self.pos] = f(4.0 * u);
        }
        let (mut out, mut idx) = (0.0, self.pos);
        for hi in self.h.iter() { out += hi * self.xs[idx]; idx = (idx + 127) % 128; }
        out
    }
}

/// Transfo (le fer) : le flux magnétique suit l'intégrale du signal, donc il sature d'abord dans les graves —
/// d'où l'harmonique 3 grave et le « poids » des machines à transfos, qui disparaît dans les aigus.
/// `u` en unités de marge de la machine, à 4× la cadence. Flux normalisé : un sinus de 50 Hz a le même flux que sa crête.
#[derive(Clone, Copy, Default)]
struct Iron { phi: f64 }
impl Iron {
    fn run(&mut self, u: f64, w: f64, leak: f64, beta: f64) -> f64 {
        self.phi = self.phi * leak + u * w;
        u - beta * self.phi * self.phi * self.phi
    }
}
/// Force du fer : grosses carcasses du 73 (≈ 0,3 % d'harmonique 3 à 20 Hz près du max, quasi rien au-dessus de 100 Hz), transfo plus petit du 76
const IRON73: f64 = 0.06;
const IRON76: f64 = 0.03;
/// Pas d'intégration et fuite (coupure 3 Hz, pas de dérive) du flux, à 4× la cadence `sr`
fn iron_k(sr: f64) -> (f64, f64) { (2.0 * PI * 50.0 / (4.0 * sr), (-2.0 * PI * 3.0 / (4.0 * sr)).exp()) }

/// Réglages du compresseur FET (unités de la façade)
#[derive(Clone, Debug)]
pub struct Fet76Params {
    /// Entrée : 0 à 48 (24 = gain unité) — plus on pousse, plus ça compresse
    pub input: f64,
    /// Sortie : 0 à 48 (24 = gain unité)
    pub output: f64,
    /// 1 (lent) à 7 (rapide)
    pub attack: f64,
    /// 1 (lent) à 7 (rapide)
    pub release: f64,
    /// 4, 8, 12, 20, ou 0 = tous les boutons enfoncés
    pub ratio: f64,
    /// Mélange avec le son d'origine (%), 100 = comme la machine
    pub mix: f64,
}
impl From<&crate::model::Fet76Json> for Fet76Params {
    fn from(j: &crate::model::Fet76Json) -> Self {
        let d = Self::default();
        Self { input: j.input.unwrap_or(d.input), output: j.output.unwrap_or(d.output), attack: j.attack.unwrap_or(d.attack),
            release: j.release.unwrap_or(d.release), ratio: j.ratio.unwrap_or(d.ratio), mix: j.mix.unwrap_or(d.mix) }
    }
}
impl Fet76Params {
    /// Un réglage changé en direct (automation), unités de la façade
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "input" => self.input = v, "output" => self.output = v, "attack" => self.attack = v, "release" => self.release = v,
            "ratio" => self.ratio = v, "mix" => self.mix = v, _ => return false }
        true
    }
}
impl Default for Fet76Params {
    fn default() -> Self { Self { input: 24.0, output: 24.0, attack: 3.0, release: 5.0, ratio: 4.0, mix: 100.0 } }
}

/// Seuil interne (dBFS, crête) : là où la machine commence à travailler, Entrée à 24
const FET_THR: f64 = -18.0;
/// Marge avant saturation de l'étage de sortie (−12 dB)
const HR76: f64 = 0.251_188_643_150_958;
/// Marge du préampli (−15 dB) : à gain 0 il reste propre, poussé il chauffe sur les crêtes
const HR73: f64 = 0.177_827_941_003_892_3;

pub struct Fet76 {
    sr: f64,
    gin: f64,
    gout: f64,
    ratio: f64,
    knee: f64,
    all: bool,
    att: f64,
    rel_fast: f64,
    rel_slow: f64,
    mix: f64,
    /// réduction en cours (dB, positive) : deux mémoires pour le relâchement en deux temps de la machine
    gr: f64,
    gr_slow: f64,
    /// « tous enfoncés » : réduction en plus, qui fait plonger le son quand on pousse fort (le circuit change de polarisation)
    ff: f64,
    iron: [Iron; 2],
    ik: (f64, f64),
    os: [Os4; 2],
    dc: [(f64, f64); 2],
    /// son d'origine retardé comme la partie suréchantillonnée
    dry: [[f64; 40]; 2],
}

impl Fet76 {
    pub fn new(p: &Fet76Params, sr: f64) -> Self {
        let mut s = Self { sr, gin: 1.0, gout: 1.0, ratio: 4.0, knee: 6.0, all: false, att: 0.0, rel_fast: 0.0, rel_slow: 0.0, mix: 1.0,
            gr: 0.0, gr_slow: 0.0, ff: 0.0, iron: [Iron::default(); 2], ik: iron_k(sr), os: [Os4::new(), Os4::new()], dc: [(0.0, 0.0); 2], dry: [[0.0; 40]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &Fet76Params) {
        let sr = self.sr;
        self.gin = 10f64.powf((p.input.clamp(0.0, 48.0) - 24.0) / 20.0);
        self.gout = 10f64.powf((p.output.clamp(0.0, 48.0) - 24.0) / 20.0);
        self.all = p.ratio <= 0.0;
        // ratio et genou : plus le ratio monte, plus le genou est franc (comme la machine)
        let (r, k) = match p.ratio.round() as i64 { r if r <= 0 => (30.0, 1.0), 4 => (4.0, 6.0), 8 => (8.0, 4.0), 12 => (12.0, 3.0), _ => (20.0, 2.0) };
        self.ratio = r;
        self.knee = k;
        // 1 → 7 : courbe logarithmique entre les deux bouts de la machine
        let a = (p.attack.clamp(1.0, 7.0) - 1.0) / 6.0;
        let r7 = (p.release.clamp(1.0, 7.0) - 1.0) / 6.0;
        let att_s = 800e-6 * (20e-6f64 / 800e-6).powf(a) * if self.all { 2.5 } else { 1.0 };
        let rel_s = 1.1 * (0.05f64 / 1.1).powf(r7) * if self.all { 0.6 } else { 1.0 };
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        self.att = co(att_s);
        self.rel_fast = co(rel_s);
        self.rel_slow = co(rel_s * 6.0);
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    /// Compresseur à contre-réaction, comme la machine : le détecteur écoute le son DÉJÀ compressé (`lvl` = niveau de sortie, dB).
    /// La réduction demandée vaut (ratio − 1) × dépassement de sortie (genou doux) ; à l'équilibre on retrouve la pente 1 − 1/ratio,
    /// mais l'attaque laisse passer le début des transitoires comme le vrai circuit.
    fn curve(&self, lvl: f64) -> f64 {
        let over = lvl - FET_THR;
        let k = self.knee;
        let s = self.ratio - 1.0;
        if over <= -k / 2.0 { 0.0 } else if over >= k / 2.0 { over * s } else { s * (over + k / 2.0).powi(2) / (2.0 * k) }
    }
    /// Réduction en cours (dB), pour l'aiguille
    pub fn reduction(&self) -> f64 { self.gr + self.ff }
    /// Retard (échantillons) : celui du suréchantillonnage
    pub const LATENCY: usize = 31;
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        // détection liée sur les deux canaux, crête
        let mut pk = 0.0f64;
        for ch in 0..nc { pk = pk.max((x[ch] * self.gin).abs()); }
        let lin = 20.0 * (pk + 1e-12).log10();
        let want = self.curve(lin - self.gr);
        // dans la boucle, la vitesse d'attaque est multipliée par le ratio : on la divise d'autant (temps de la machine respectés)
        if want > self.gr { self.gr += (want - self.gr) * self.att / self.ratio; }
        else {
            // relâchement en deux temps : vite au début, plus lent sur la fin (la réduction qui reste longtemps se relâche lentement)
            self.gr_slow += (self.gr - self.gr_slow) * self.rel_slow * 0.5;
            let target = want.max(0.0);
            let rel = if self.gr_slow > 0.6 * self.gr { self.rel_slow } else { self.rel_fast };
            self.gr += (target - self.gr) * rel;
        }
        if want > self.gr_slow { self.gr_slow += (want - self.gr_slow) * self.att * 0.05; }
        // tous enfoncés : au-delà de 8 dB au-dessus du seuil, le son plonge (≈ 0,2 dB de moins par dB de plus)
        let fft = if self.all { 0.2 * (lin - FET_THR - 8.0).max(0.0) } else { 0.0 };
        self.ff += (fft - self.ff) * if fft > self.ff { self.att } else { self.rel_fast };
        let g = 10f64.powf(-(self.gr + self.ff) / 20.0);
        let (iw, il) = self.ik;
        // couleur : harmonique 2 du FET (croît avec la réduction), puis l'étage de sortie qui arrondit les crêtes
        let fet = (0.04 + 0.5 * (1.0 - g)) * if self.all { 2.2 } else { 1.0 };
        for ch in 0..nc {
            let v = x[ch] * self.gin;
            let iron = &mut self.iron[ch];
            let mut y = self.os[ch].run(v, |u| {
                // marge de la machine : 0 dBFS est à 12 dB sous le point où l'étage de sortie sature
                let c = u * g * HR76;
                let c = c + fet * c * c;
                // étage de sortie classe A puis transfo de sortie (sature dans les graves)
                iron.run((1.15 * c).tanh() / 1.15, iw, il, IRON76) / HR76
            });
            // l'harmonique 2 décale un peu le zéro : on le retire (comme le condensateur de sortie)
            let (xp, yp) = self.dc[ch];
            let o = y - xp + 0.9995 * yp;
            self.dc[ch] = (y, o);
            y = o * self.gout;
            let d = &mut self.dry[ch];
            d.copy_within(0..39, 1);
            d[0] = x[ch];
            x[ch] = if self.mix < 1.0 { d[Self::LATENCY] + (y - d[Self::LATENCY]) * self.mix } else { y };
        }
    }
}


/// Fréquences fixes du préampli, comme sur la machine
pub const PRE73_MID: [f64; 6] = [360.0, 700.0, 1600.0, 3200.0, 4800.0, 7200.0];
pub const PRE73_LOW: [f64; 4] = [35.0, 60.0, 110.0, 220.0];
pub const PRE73_HPF: [f64; 4] = [50.0, 80.0, 160.0, 300.0];

#[derive(Clone, Debug)]
pub struct Pre73Params {
    /// Gain du préampli (dB, 0 à 30) : la couleur
    pub gain: f64,
    /// Sortie (dB, −24 à +12)
    pub output: f64,
    /// Aigus 12 kHz, médiums, graves (dB, ±16 / ±18 / ±16)
    pub high: f64,
    pub mid: f64,
    /// index dans PRE73_MID
    pub mid_f: usize,
    pub low: f64,
    /// index dans PRE73_LOW
    pub low_f: usize,
    /// coupe-bas : None = éteint, sinon index dans PRE73_HPF
    pub hpf: Option<usize>,
    /// EQ en service (comme l'interrupteur EQ de la machine)
    pub eq: bool,
}
impl From<&crate::model::Pre73Json> for Pre73Params {
    fn from(j: &crate::model::Pre73Json) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { gain: j.gain.unwrap_or(d.gain), output: j.output.unwrap_or(d.output), high: j.high.unwrap_or(0.0), mid: j.mid.unwrap_or(0.0),
            mid_f: idx(j.mid_f, d.mid_f, 5), low: j.low.unwrap_or(0.0), low_f: idx(j.low_f, d.low_f, 3),
            hpf: j.hpf.filter(|v| *v >= -0.5).map(|v| (v.round() as usize).min(3)), eq: j.eq.unwrap_or(1.0) >= 0.5 }
    }
}
impl Pre73Params {
    /// Un réglage changé en direct (automation), unités de la façade
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "gain" => self.gain = v, "output" => self.output = v, "high" => self.high = v, "mid" => self.mid = v, "low" => self.low = v,
            "midF" => self.mid_f = (v.round().max(0.0) as usize).min(5), "lowF" => self.low_f = (v.round().max(0.0) as usize).min(3),
            "hpf" => self.hpf = (v >= -0.5).then(|| (v.round() as usize).min(3)), "eq" => self.eq = v >= 0.5, _ => return false }
        true
    }
}
impl Default for Pre73Params {
    fn default() -> Self { Self { gain: 0.0, output: 0.0, high: 0.0, mid: 0.0, mid_f: 2, low: 0.0, low_f: 1, hpf: None, eq: true } }
}

pub struct Pre73 {
    gin: f64,
    gout: f64,
    drive: f64,
    /// EQ et coupe-bas, calculés à 4× la cadence (dans le suréchantillonnage, entre les deux transfos)
    eq: Vec<[Biquad; 2]>,
    os: [Os4; 2],
    dc: [(f64, f64); 2],
    /// transfos d'entrée et de sortie (le fer qui donne le grave de la machine)
    iron: [[Iron; 2]; 2],
    ik: (f64, f64),
}

impl Pre73 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &Pre73Params, sr: f64) -> Self {
        let sr = sr * 4.0;
        let mut eq: Vec<Biquad> = Vec::new();
        if let Some(i) = p.hpf { for q in [1.0, 0.5] { eq.push(eq_matched("highpass", PRE73_HPF[i.min(3)], q, 0.0, sr)); } eq.push(Biquad::highpass(sr, PRE73_HPF[i.min(3)], 0.0)); }
        if p.eq {
            if p.low.abs() > 1e-6 { eq.push(eq_matched("lowshelf", PRE73_LOW[p.low_f.min(3)], 0.9, p.low.clamp(-16.0, 16.0), sr)); }
            // cloche large et un peu plus serrée quand on pousse fort (bobine de la machine)
            if p.mid.abs() > 1e-6 { eq.push(eq_matched("peaking", PRE73_MID[p.mid_f.min(5)], 0.7 + 0.02 * p.mid.abs(), p.mid.clamp(-18.0, 18.0), sr)); }
            // « 12 kHz » sur la façade : le plateau atteint son plein vers 12-16 kHz
            if p.high.abs() > 1e-6 { eq.push(eq_matched("highshelf", 8_500.0, 0.7, p.high.clamp(-16.0, 16.0), sr)); }
        }
        Self { gin: 10f64.powf(p.gain.clamp(0.0, 30.0) / 20.0), gout: 10f64.powf(p.output.clamp(-24.0, 12.0) / 20.0), drive: p.gain.clamp(0.0, 30.0) / 30.0,
            eq: eq.into_iter().map(|b| [b, b]).collect(), os: [Os4::new(), Os4::new()], dc: [(0.0, 0.0); 2], iron: [[Iron::default(); 2]; 2], ik: iron_k(sr / 4.0) }
    }
    /// Nouveau réglage sans clic : mêmes filtres → seuls les coefficients changent ; sinon les filtres sont refaits
    pub fn set(&mut self, p: &Pre73Params, sr: f64) {
        let n = Pre73::new(p, sr);
        self.gin = n.gin; self.gout = n.gout; self.drive = n.drive;
        if n.eq.len() == self.eq.len() {
            for (a, b) in self.eq.iter_mut().zip(n.eq) { a[0].retune(b[0]); a[1].retune(b[1]); }
        } else { self.eq = n.eq; }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let d = self.drive;
        let a2 = 0.08 + 0.35 * d;
        let k = 1.0 + 0.3 * d;
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let v = x[ch] * self.gin;
            let (eq, dc, iron) = (&mut self.eq, &mut self.dc[ch], &mut self.iron[ch]);
            let y = self.os[ch].run(v, |u| {
                // transfo d'entrée (sature dans les graves), puis préampli : étage classe A (harmonique 2, qui monte avec le gain)
                let u = iron[0].run(u * HR73, iw, il, IRON73);
                let c = u + a2 * u * u;
                let mut y = (c * k).tanh() / k / HR73;
                // le zéro décalé par l'harmonique 2 est retiré (condensateur de liaison)
                let o = y - dc.0 + 0.99988 * dc.1;
                *dc = (y, o);
                y = o;
                for b in eq.iter_mut() { y = b[ch].tick(y); }
                // transfo de sortie : arrondit les crêtes (harmonique 3) et alourdit le grave
                iron[1].run((1.05 * y * HR73).tanh() / 1.05, iw, il, IRON73) / HR73
            });
            x[ch] = y * self.gout;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f64 = 48_000.0;
    fn run(p: &Fet76Params, amp: f64, f: f64, n: usize) -> (Vec<f64>, Fet76) {
        let mut c = Fet76::new(p, SR);
        let out = (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
        (out, c)
    }
    fn peak_db(s: &[f64]) -> f64 { 20.0 * s.iter().fold(0f64, |a, v| a.max(v.abs())).log10() }
    fn harm(s: &[f64], f: f64, k: usize) -> f64 {
        let (mut c, mut si) = (0.0, 0.0);
        for (i, v) in s.iter().enumerate() { let a = 2.0 * PI * f * k as f64 * i as f64 / SR; c += v * a.cos(); si += v * a.sin(); }
        (c * c + si * si).sqrt()
    }

    #[test]
    fn sous_le_seuil_presque_transparent() {
        let (o, _) = run(&Fet76Params::default(), 10f64.powf(-30.0 / 20.0), 1000.0, 48_000);
        let lvl = peak_db(&o[24_000..]);
        assert!((lvl + 30.0).abs() < 0.3, "−30 dB sous le seuil : sortie {lvl:.2} dB");
    }

    #[test]
    fn ratios_comme_la_machine() {
        // 20 dB au-dessus du seuil : 4:1 → ~5 dB au-dessus, 20:1 → ~1 dB ; « tous enfoncés » écrase encore plus
        let amp = 10f64.powf((FET_THR + 20.0) / 20.0);
        let mut prev = f64::MAX;
        for r in [4.0, 8.0, 12.0, 20.0, 0.0] {
            let (o, c) = run(&Fet76Params { ratio: r, attack: 7.0, release: 4.0, ..Default::default() }, amp, 1000.0, 48_000);
            let over = 20.0 - c.reduction();
            if r > 0.0 { assert!((over - 20.0 / r).abs() < 1.0, "ratio {r} : {over:.2} dB au-dessus du seuil (attendu {:.2})", 20.0 / r); }
            assert!(over < prev, "ratio {r} doit écraser plus que le précédent ({over:.2} / {prev:.2})");
            prev = over;
            let _ = o;
        }
    }

    #[test]
    fn attaque_rapide_plus_vite_que_lente() {
        let amp = 10f64.powf((FET_THR + 20.0) / 20.0);
        let t63 = |att: f64| {
            let mut c = Fet76::new(&Fet76Params { attack: att, ratio: 20.0, ..Default::default() }, SR);
            // réduction d'équilibre à 20 dB au-dessus du seuil : 20 × (1 − 1/20)
            let target = 20.0 * (1.0 - 1.0 / 20.0) * 0.63;
            (0..48_000).position(|i| { let mut x = [amp * (2.0 * PI * 1000.0 * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); c.reduction() >= target }).unwrap()
        };
        let (fast, slow) = (t63(7.0), t63(1.0));
        assert!(fast < slow, "attaque 7 ({fast} éch.) doit être plus rapide que 1 ({slow} éch.)");
        assert!(slow as f64 / SR < 0.01, "même l'attaque la plus lente reste sous 10 ms ({slow} éch.)");
    }

    #[test]
    fn plus_ca_compresse_plus_ca_colore() {
        // harmonique 2 par rapport à la note : bien plus présente quand la machine réduit fort
        let h2 = |input: f64| { let (o, _) = run(&Fet76Params { input, ratio: 4.0, ..Default::default() }, 0.05, 200.0, 48_000);
            let s = &o[24_000..48_000]; 20.0 * (harm(s, 200.0, 2) / harm(s, 200.0, 1)).log10() };
        let (calme, fort) = (h2(24.0), h2(48.0));
        assert!(fort > calme + 6.0, "harmonique 2 : {calme:.1} dB sans réduction, {fort:.1} dB en réduisant fort");
        assert!(calme < -40.0, "sans réduction la couleur reste discrète ({calme:.1} dB)");
    }

    #[test]
    fn pas_de_parasites_aigus() {
        // 7 kHz poussé fort : rien de replié sous la note (le suréchantillonnage fait son travail)
        let (o, _) = run(&Fet76Params { input: 48.0, ratio: 0.0, attack: 7.0, release: 7.0, ..Default::default() }, 0.5, 7000.0, 48_000);
        let s = &o[24_000..48_000];
        let note = harm(s, 7000.0, 1);
        // fréquences repliées typiques d'un 7 kHz saturé à 48 kHz : 48-3×7 = 27 → 21 kHz, 48-5×7 = 13 kHz, 7×7 = 49 → 1 kHz
        let alias = [13000.0, 1000.0].iter().map(|f| harm(s, *f, 1)).fold(0f64, f64::max);
        assert!(20.0 * (alias / note).log10() < -60.0, "parasites repliés à {:.1} dB", 20.0 * (alias / note).log10());
    }

    fn run73(p: &Pre73Params, amp: f64, f: f64, n: usize) -> Vec<f64> {
        let mut c = Pre73::new(p, SR);
        (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect()
    }
    fn gain_at(p: &Pre73Params, f: f64) -> f64 { let o = run73(p, 0.01, f, 48_000); 20.0 * (harm(&o[24_000..48_000], f, 1) / (0.01 * 12_000.0)).log10() }

    #[test]
    fn pre73_neutre_quand_tout_est_a_zero() {
        for f in [100.0, 1000.0, 10_000.0, 18_000.0] {
            let g = gain_at(&Pre73Params::default(), f);
            assert!(g.abs() < 0.3, "à plat : {g:.2} dB à {f} Hz");
        }
    }

    #[test]
    fn pre73_eq_aux_frequences_de_la_machine() {
        let m = gain_at(&Pre73Params { mid: 12.0, mid_f: 3, ..Default::default() }, 3200.0);
        assert!((m - 12.0).abs() < 1.0, "médiums +12 à 3,2 kHz : {m:.2} dB");
        let l = gain_at(&Pre73Params { low: 10.0, low_f: 2, ..Default::default() }, 40.0);
        assert!(l > 8.0, "graves +10 (110 Hz) : {l:.2} dB à 40 Hz");
        let h = gain_at(&Pre73Params { high: 10.0, ..Default::default() }, 18_000.0);
        assert!(h > 7.5, "aigus +10 : {h:.2} dB à 18 kHz");
        let cut = gain_at(&Pre73Params { hpf: Some(2), ..Default::default() }, 40.0);
        assert!(cut < -20.0, "coupe-bas 160 Hz : {cut:.2} dB à 40 Hz");
        let off = gain_at(&Pre73Params { mid: 12.0, eq: false, ..Default::default() }, 1600.0);
        assert!(off.abs() < 0.3, "EQ hors service : {off:.2} dB");
    }

    #[test]
    fn pre73_le_gain_colore() {
        let h = |gain: f64| { let o = run73(&Pre73Params { gain, output: -gain, ..Default::default() }, 0.2, 200.0, 48_000);
            let s = &o[24_000..48_000]; (20.0 * (harm(s, 200.0, 2) / harm(s, 200.0, 1)).log10(), 20.0 * (harm(s, 200.0, 3) / harm(s, 200.0, 1)).log10()) };
        let (c2, c3) = h(0.0);
        let (f2, f3) = h(24.0);
        assert!(f2 > c2 + 6.0 && f3 > c3 + 6.0, "gain 0 : h2 {c2:.1} h3 {c3:.1} ; gain 24 : h2 {f2:.1} h3 {f3:.1}");
        assert!(c2 < -35.0, "gain 0 : couleur discrète (h2 {c2:.1} dB)");
    }

    /// Le fer des transfos : à même niveau, l'harmonique 3 est bien plus forte dans le grave profond (20 Hz) que dans les médiums (1 kHz)
    #[test]
    fn pre73_le_fer_sature_dans_les_graves() {
        let h3 = |f: f64| { let o = run73(&Pre73Params::default(), 0.5, f, 96_000);
            let s = &o[48_000..96_000]; 20.0 * (harm(s, f, 3) / harm(s, f, 1)).log10() };
        let (lo, mid) = (h3(20.0), h3(1000.0));
        assert!(lo > mid + 6.0, "h3 à 20 Hz {lo:.1} dB, à 1 kHz {mid:.1} dB");
    }

    /// « Tous enfoncés » : au-delà d'un point, pousser plus fort fait BAISSER le son (comme la machine)
    #[test]
    fn tous_enfonces_le_son_plonge() {
        let out = |db: f64| { let (o, _) = run(&Fet76Params { ratio: 0.0, attack: 5.0, release: 4.0, ..Default::default() }, 10f64.powf((FET_THR + db) / 20.0), 1000.0, 48_000);
            let s = &o[24_000..48_000]; (s.iter().map(|v| v * v).sum::<f64>() / s.len() as f64).sqrt() };
        let (a, b) = (out(12.0), out(30.0));
        assert!(b < a, "tous enfoncés : +30 dB sort à {b:.4}, +12 dB à {a:.4}");
        let (r4a, r4b) = { let o = |db: f64| { let (o, _) = run(&Fet76Params { ratio: 4.0, attack: 5.0, release: 4.0, ..Default::default() }, 10f64.powf((FET_THR + db) / 20.0), 1000.0, 48_000);
            let s = &o[24_000..48_000]; (s.iter().map(|v| v * v).sum::<f64>() / s.len() as f64).sqrt() }; (o(12.0), o(30.0)) };
        assert!(r4b > r4a, "ratio 4 : le son continue de monter");
    }
}
