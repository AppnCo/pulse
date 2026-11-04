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
    /// 0 Noir (moderne, propre, rapide), 1 Argent « bande bleue » (le premier modèle : plus de grain, aigus plus doux,
    /// attaque un peu plus lente), 2 Graphite (version de mastering : encore plus propre)
    pub variant: usize,
}
impl From<&crate::model::Fet76Json> for Fet76Params {
    fn from(j: &crate::model::Fet76Json) -> Self {
        let d = Self::default();
        Self { input: j.input.unwrap_or(d.input), output: j.output.unwrap_or(d.output), attack: j.attack.unwrap_or(d.attack),
            release: j.release.unwrap_or(d.release), ratio: j.ratio.unwrap_or(d.ratio), mix: j.mix.unwrap_or(d.mix),
            variant: j.variant.map_or(0, |v| (v.round().max(0.0) as usize).min(2)) }
    }
}
impl Fet76Params {
    /// Un réglage changé en direct (automation), unités de la façade
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "input" => self.input = v, "output" => self.output = v, "attack" => self.attack = v, "release" => self.release = v,
            "ratio" => self.ratio = v, "mix" => self.mix = v, "variant" => self.variant = (v.round().max(0.0) as usize).min(2), _ => return false }
        true
    }
}
impl Default for Fet76Params {
    fn default() -> Self { Self { input: 24.0, output: 24.0, attack: 3.0, release: 5.0, ratio: 4.0, mix: 100.0, variant: 0 } }
}

/// Variantes du 76 : attaque (×), grain du FET (×), fer (×), coupure douce des aigus (Hz, 0 = aucune)
const FET_VARIANTS: [[f64; 4]; 3] = [[1.0, 1.0, 1.0, 0.0], [1.4, 1.8, 1.6, 16_000.0], [1.0, 0.5, 0.5, 0.0]];
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
    /// variante : grain du FET, force du fer, coupure des aigus (coefficient, 1 = aucune) et sa mémoire
    vfet: f64,
    viron: f64,
    lpa: f64,
    lp: [f64; 2],
    os: [Os4; 2],
    dc: [(f64, f64); 2],
    /// son d'origine retardé comme la partie suréchantillonnée
    dry: [[f64; 40]; 2],
}

impl Fet76 {
    pub fn new(p: &Fet76Params, sr: f64) -> Self {
        let mut s = Self { sr, gin: 1.0, gout: 1.0, ratio: 4.0, knee: 6.0, all: false, att: 0.0, rel_fast: 0.0, rel_slow: 0.0, mix: 1.0,
            gr: 0.0, gr_slow: 0.0, ff: 0.0, iron: [Iron::default(); 2], ik: iron_k(sr), vfet: 1.0, viron: 1.0, lpa: 1.0, lp: [0.0; 2], os: [Os4::new(), Os4::new()], dc: [(0.0, 0.0); 2], dry: [[0.0; 40]; 2] };
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
        let v = FET_VARIANTS[p.variant.min(2)];
        (self.vfet, self.viron) = (v[1], v[2]);
        self.lpa = if v[3] > 0.0 { 1.0 - (-2.0 * PI * v[3] / sr).exp() } else { 1.0 };
        let att_s = 800e-6 * (20e-6f64 / 800e-6).powf(a) * if self.all { 2.5 } else { 1.0 } * v[0];
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
        let fet = (0.04 + 0.5 * (1.0 - g)) * if self.all { 2.2 } else { 1.0 } * self.vfet;
        let ib = IRON76 * self.viron;
        for ch in 0..nc {
            let v = x[ch] * self.gin;
            let iron = &mut self.iron[ch];
            let mut y = self.os[ch].run(v, |u| {
                // marge de la machine : 0 dBFS est à 12 dB sous le point où l'étage de sortie sature
                let c = u * g * HR76;
                let c = c + fet * c * c;
                // étage de sortie classe A puis transfo de sortie (sature dans les graves)
                iron.run((1.15 * c).tanh() / 1.15, iw, il, ib) / HR76
            });
            // l'harmonique 2 décale un peu le zéro : on le retire (comme le condensateur de sortie)
            let (xp, yp) = self.dc[ch];
            let o = y - xp + 0.9995 * yp;
            self.dc[ch] = (y, o);
            self.lp[ch] += (o - self.lp[ch]) * self.lpa;
            y = self.lp[ch] * self.gout;
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
    /// 0 = 73 (noir), 1 = 84 (gris-bleu : 4 bandes, aigus 10/12/16 kHz, médiums « Q serré »), 2 = 73 Vintage (transfos fatigués)
    pub variant: usize,
    /// 84 : bas-médiums (dB, ±16) et leur fréquence (index dans PRE84_LMID), fréquence des aigus (index dans PRE84_HF), Q serré
    pub lmid: f64,
    pub lmid_f: usize,
    pub high_f: usize,
    pub hiq: bool,
}
/// 84 : bas-médiums 220 · 360 · 700 Hz · 1,6 kHz ; aigus « 10 / 12 / 16 kHz » (plein du plateau, comme le 73 : début plus bas)
pub const PRE84_LMID: [f64; 4] = [220.0, 360.0, 700.0, 1600.0];
pub const PRE84_HF: [f64; 3] = [7_000.0, 8_500.0, 11_500.0];
impl From<&crate::model::Pre73Json> for Pre73Params {
    fn from(j: &crate::model::Pre73Json) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { gain: j.gain.unwrap_or(d.gain), output: j.output.unwrap_or(d.output), high: j.high.unwrap_or(0.0), mid: j.mid.unwrap_or(0.0),
            mid_f: idx(j.mid_f, d.mid_f, 5), low: j.low.unwrap_or(0.0), low_f: idx(j.low_f, d.low_f, 3),
            hpf: j.hpf.filter(|v| *v >= -0.5).map(|v| (v.round() as usize).min(3)), eq: j.eq.unwrap_or(1.0) >= 0.5,
            variant: idx(j.variant, 0, 2), lmid: j.lmid.unwrap_or(0.0), lmid_f: idx(j.lmid_f, 1, 3), high_f: idx(j.high_f, 1, 2), hiq: j.hiq.unwrap_or(0.0) >= 0.5 }
    }
}
impl Pre73Params {
    /// Un réglage changé en direct (automation), unités de la façade
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "gain" => self.gain = v, "output" => self.output = v, "high" => self.high = v, "mid" => self.mid = v, "low" => self.low = v,
            "midF" => self.mid_f = (v.round().max(0.0) as usize).min(5), "lowF" => self.low_f = (v.round().max(0.0) as usize).min(3),
            "hpf" => self.hpf = (v >= -0.5).then(|| (v.round() as usize).min(3)), "eq" => self.eq = v >= 0.5,
            "variant" => self.variant = (v.round().max(0.0) as usize).min(2), "lmid" => self.lmid = v, "lmidF" => self.lmid_f = (v.round().max(0.0) as usize).min(3),
            "highF" => self.high_f = (v.round().max(0.0) as usize).min(2), "hiq" => self.hiq = v >= 0.5, _ => return false }
        true
    }
}
impl Default for Pre73Params {
    fn default() -> Self { Self { gain: 0.0, output: 0.0, high: 0.0, mid: 0.0, mid_f: 2, low: 0.0, low_f: 1, hpf: None, eq: true, variant: 0, lmid: 0.0, lmid_f: 1, high_f: 1, hiq: false } }
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
    /// Vintage : harmonique 2 en plus, fer ×2
    va2: f64,
    vir: f64,
    ik: (f64, f64),
}

impl Pre73 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &Pre73Params, sr: f64) -> Self {
        let sr = sr * 4.0;
        let mut eq: Vec<Biquad> = Vec::new();
        if let Some(i) = p.hpf { for q in [1.0, 0.5] { eq.push(eq_matched("highpass", PRE73_HPF[i.min(3)], q, 0.0, sr)); } eq.push(Biquad::highpass(sr, PRE73_HPF[i.min(3)], 0.0)); }
        let v84 = p.variant == 1;
        if p.eq {
            if p.low.abs() > 1e-6 { eq.push(eq_matched("lowshelf", PRE73_LOW[p.low_f.min(3)], 0.9, p.low.clamp(-16.0, 16.0), sr)); }
            // 84 : une bande de plus, les bas-médiums (cloche large)
            if v84 && p.lmid.abs() > 1e-6 { eq.push(eq_matched("peaking", PRE84_LMID[p.lmid_f.min(3)], 0.8 + 0.02 * p.lmid.abs(), p.lmid.clamp(-16.0, 16.0), sr)); }
            // cloche large et un peu plus serrée quand on pousse fort (bobine de la machine) ; 84 « Q serré » = deux fois plus étroite
            if p.mid.abs() > 1e-6 { eq.push(eq_matched("peaking", PRE73_MID[p.mid_f.min(5)], (0.7 + 0.02 * p.mid.abs()) * if v84 && p.hiq { 2.0 } else { 1.0 }, p.mid.clamp(-18.0, 18.0), sr)); }
            // « 12 kHz » sur la façade : le plateau atteint son plein vers 12-16 kHz ; 84 : 10 / 12 / 16 kHz au choix
            let hf = if v84 { PRE84_HF[p.high_f.min(2)] } else { 8_500.0 };
            if p.high.abs() > 1e-6 { eq.push(eq_matched("highshelf", hf, 0.7, p.high.clamp(-16.0, 16.0), sr)); }
        }
        // Vintage : les transfos fatigués arrondissent l'aigu (−3 dB vers 14 kHz)
        if p.variant == 2 { eq.push(Biquad::lowpass(sr, 14_000.0, -3.0)); }
        let (va2, vir) = if p.variant == 2 { (0.06, 2.0) } else { (0.0, 1.0) };
        Self { gin: 10f64.powf(p.gain.clamp(0.0, 30.0) / 20.0), gout: 10f64.powf(p.output.clamp(-24.0, 12.0) / 20.0), drive: p.gain.clamp(0.0, 30.0) / 30.0, va2, vir,
            eq: eq.into_iter().map(|b| [b, b]).collect(), os: [Os4::new(), Os4::new()], dc: [(0.0, 0.0); 2], iron: [[Iron::default(); 2]; 2], ik: iron_k(sr / 4.0) }
    }
    /// Nouveau réglage sans clic : mêmes filtres → seuls les coefficients changent ; sinon les filtres sont refaits
    pub fn set(&mut self, p: &Pre73Params, sr: f64) {
        let n = Pre73::new(p, sr);
        self.gin = n.gin; self.gout = n.gout; self.drive = n.drive; self.va2 = n.va2; self.vir = n.vir;
        if n.eq.len() == self.eq.len() {
            for (a, b) in self.eq.iter_mut().zip(n.eq) { a[0].retune(b[0]); a[1].retune(b[1]); }
        } else { self.eq = n.eq; }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let d = self.drive;
        let a2 = 0.08 + 0.35 * d + self.va2;
        let k = 1.0 + 0.3 * d;
        let (iw, il) = self.ik;
        let ib = IRON73 * self.vir;
        for ch in 0..nc {
            let v = x[ch] * self.gin;
            let (eq, dc, iron) = (&mut self.eq, &mut self.dc[ch], &mut self.iron[ch]);
            let y = self.os[ch].run(v, |u| {
                // transfo d'entrée (sature dans les graves), puis préampli : étage classe A (harmonique 2, qui monte avec le gain)
                let u = iron[0].run(u * HR73, iw, il, ib);
                let c = u + a2 * u * u;
                let mut y = (c * k).tanh() / k / HR73;
                // le zéro décalé par l'harmonique 2 est retiré (condensateur de liaison)
                let o = y - dc.0 + 0.99988 * dc.1;
                *dc = (y, o);
                y = o;
                for b in eq.iter_mut() { y = b[ch].tick(y); }
                // transfo de sortie : arrondit les crêtes (harmonique 3) et alourdit le grave
                iron[1].run((1.05 * y * HR73).tanh() / 1.05, iw, il, ib) / HR73
            });
            x[ch] = y * self.gout;
        }
    }
}

// ===== Optique 2A : compresseur à cellule optique et lampes (esprit « 2A ») =====
// Comme la machine : un bouton Gain (sortie, avant l'étage à lampe : il colore aussi), un bouton Réduction (Peak Reduction),
// Compression / Limitation, l'accentuation des aigus du détecteur (à l'arrière de la machine). La cellule optique fait tout le son :
// attaque ~10 ms, relâchement en deux temps (moitié en ~60 ms, le reste en 0,5 à 5 s), et une MÉMOIRE : plus elle a travaillé
// longtemps, plus elle relâche lentement. Contre-réaction (le détecteur écoute la sortie), comme le 76.
// Trois variantes, comme les séries de la machine : Gris (la plus ancienne, sombre, lente, grasse), Argent (la classique),
// Noir (plus claire, plus rapide, plus de mordant).

/// Réglages de l'Optique 2A (unités de la façade)
#[derive(Clone, Debug)]
pub struct Opto2AParams {
    /// Gain de sortie 0 à 100 (40 = gain unité) — avant l'étage à lampe : plus on monte, plus ça colore
    pub gain: f64,
    /// Réduction (Peak Reduction) 0 à 100 : plus on tourne, plus ça compresse
    pub peak: f64,
    /// Limitation (sinon Compression)
    pub limit: bool,
    /// Accentuation des aigus du détecteur 0 à 100 (les « s » et les aigus font plus réagir la cellule)
    pub emph: f64,
    /// 0 Gris, 1 Argent, 2 Noir
    pub variant: usize,
    /// Mélange avec le son d'origine (%)
    pub mix: f64,
}
impl Default for Opto2AParams {
    fn default() -> Self { Self { gain: 40.0, peak: 40.0, limit: false, emph: 0.0, variant: 1, mix: 100.0 } }
}
impl From<&crate::model::Opto2AJson> for Opto2AParams {
    fn from(j: &crate::model::Opto2AJson) -> Self {
        let d = Self::default();
        Self { gain: j.gain.unwrap_or(d.gain), peak: j.peak.unwrap_or(d.peak), limit: j.limit.unwrap_or(0.0) >= 0.5, emph: j.emph.unwrap_or(0.0),
            variant: j.variant.map_or(1, |v| (v.round().max(0.0) as usize).min(2)), mix: j.mix.unwrap_or(100.0) }
    }
}
impl Opto2AParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "gain" => self.gain = v, "peak" => self.peak = v, "emph" => self.emph = v, "mix" => self.mix = v,
            "limit" => self.limit = v >= 0.5, "variant" => self.variant = (v.round().max(0.0) as usize).min(2), _ => return false }
        true
    }
}
/// Ce qui change d'une variante à l'autre : attaque, relâchement (rapide, lent sans / avec mémoire), harmonique 2, mordant (3),
/// coupure des aigus de sortie (Hz, 0 = aucune), fer
const OPTO_VARIANTS: [[f64; 8]; 3] = [
    [0.012, 0.080, 1.0, 8.0, 0.20, 1.25, 12_000.0, 0.07],
    [0.010, 0.060, 0.5, 5.0, 0.12, 1.15, 18_000.0, 0.05],
    [0.007, 0.045, 0.3, 3.0, 0.06, 1.35, 0.0, 0.04],
];
/// Part rapide de la cellule : 65 % de la réduction repart en ~90 ms, le reste lentement
const OPTO_FAST: f64 = 0.65;
/// Marge de l'étage à lampe (−14 dB)
const HR2A: f64 = 0.199_526_231_496_888;

pub struct Opto2A {
    sr: f64,
    gout: f64,
    thr: f64,
    ratio: f64,
    knee: f64,
    emph: f64,
    att: f64,
    rf: f64,
    rs_min: f64,
    rs_max: f64,
    a2: f64,
    k: f64,
    lpa: f64,
    iron_b: f64,
    mix: f64,
    /// réduction : partie rapide et partie lente (mélangées par OPTO_FAST), mémoire de la cellule (0 à 1)
    gr_f: f64,
    gr_s: f64,
    mem: f64,
    scl: [f64; 2],
    lp: [f64; 2],
    os: [Os4; 2],
    iron: [Iron; 2],
    ik: (f64, f64),
    dc: [(f64, f64); 2],
    dry: [[f64; 40]; 2],
    co_mem_up: f64,
    co_mem_down: f64,
    a1k: f64,
}

impl Opto2A {
    pub const LATENCY: usize = 31;
    pub fn new(p: &Opto2AParams, sr: f64) -> Self {
        let mut s = Self { sr, gout: 1.0, thr: -20.0, ratio: 3.0, knee: 12.0, emph: 0.0, att: 0.0, rf: 0.0, rs_min: 0.0, rs_max: 0.0, a2: 0.0, k: 1.0, lpa: 1.0, iron_b: 0.0, mix: 1.0,
            gr_f: 0.0, gr_s: 0.0, mem: 0.0, scl: [0.0; 2], lp: [0.0; 2], os: [Os4::new(), Os4::new()], iron: [Iron::default(); 2], ik: iron_k(sr), dc: [(0.0, 0.0); 2], dry: [[0.0; 40]; 2],
            co_mem_up: 1.0 - (-1.0 / (3.0 * sr)).exp(), co_mem_down: 1.0 - (-1.0 / (20.0 * sr)).exp(), a1k: 1.0 - (-2.0 * PI * 1000.0 / sr).exp() };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &Opto2AParams) {
        let sr = self.sr;
        let v = OPTO_VARIANTS[p.variant.min(2)];
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        self.gout = 10f64.powf((p.gain.clamp(0.0, 100.0) - 40.0) * 0.5 / 20.0);
        self.thr = -0.48 * p.peak.clamp(0.0, 100.0);
        (self.ratio, self.knee) = if p.limit { (10.0, 6.0) } else { (3.0, 12.0) };
        self.emph = p.emph.clamp(0.0, 100.0) / 100.0 * 3.0;
        self.att = co(v[0]); self.rf = co(v[1]); self.rs_min = co(v[2]); self.rs_max = co(v[3]);
        self.a2 = v[4]; self.k = v[5];
        self.lpa = if v[6] > 0.0 { 1.0 - (-2.0 * PI * v[6] / sr).exp() } else { 1.0 };
        self.iron_b = v[7];
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    fn curve(&self, lvl: f64) -> f64 {
        let over = lvl - self.thr;
        let (k, s) = (self.knee, self.ratio - 1.0);
        if over <= -k / 2.0 { 0.0 } else if over >= k / 2.0 { over * s } else { s * (over + k / 2.0).powi(2) / (2.0 * k) }
    }
    /// Réduction en cours (dB), pour l'aiguille
    pub fn reduction(&self) -> f64 { OPTO_FAST * self.gr_f + (1.0 - OPTO_FAST) * self.gr_s }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        // détecteur : les aigus accentués si demandé (filtre 1 kHz), niveau crête des deux canaux
        let mut pk = 0.0f64;
        for ch in 0..nc {
            self.scl[ch] += (x[ch] - self.scl[ch]) * self.a1k;
            pk = pk.max((x[ch] + self.emph * (x[ch] - self.scl[ch])).abs());
        }
        let gr = self.reduction();
        let want = self.curve(20.0 * (pk + 1e-12).log10() - gr);
        if want > gr {
            let d = (want - gr) * self.att / self.ratio;
            self.gr_f += d; self.gr_s += d;
        } else {
            // relâchement en deux temps ; la partie lente dépend de la mémoire de la cellule
            let rs = self.rs_min + (self.rs_max - self.rs_min) * self.mem;
            self.gr_f += (want - self.gr_f) * self.rf;
            self.gr_s += (want - self.gr_s) * rs;
        }
        let gr = self.reduction();
        let m = (gr / 12.0).clamp(0.0, 1.0);
        self.mem += (m - self.mem) * if m > self.mem { self.co_mem_up } else { self.co_mem_down };
        let g = 10f64.powf(-gr / 20.0) * self.gout;
        let (a2, k, (iw, il), ib) = (self.a2, self.k, self.ik, self.iron_b);
        for ch in 0..nc {
            let iron = &mut self.iron[ch];
            let mut y = self.os[ch].run(x[ch], |u| {
                // cellule (atténuation passive) puis gain, étage à lampe (harmonique 2, mordant), transfo de sortie
                let c = u * g * HR2A;
                let c = c + a2 * c * c;
                iron.run((k * c).tanh() / k, iw, il, ib) / HR2A
            });
            let (xp, yp) = self.dc[ch];
            let o = y - xp + 0.9995 * yp;
            self.dc[ch] = (y, o);
            self.lp[ch] += (o - self.lp[ch]) * self.lpa;
            y = self.lp[ch];
            let d = &mut self.dry[ch];
            d.copy_within(0..39, 1);
            d[0] = x[ch];
            x[ch] = if self.mix < 1.0 { d[Self::LATENCY] + (y - d[Self::LATENCY]) * self.mix } else { y };
        }
    }
}

// ===== Égaliseur passif P1 (esprit « P1 », l'égaliseur passif à lampes) =====
// Comme la machine : grave à 20 / 30 / 60 / 100 Hz avec DEUX boutons, Pousser et Atténuer, qu'on peut monter ensemble
// (le « truc » : le grave gonfle et un creux se forme juste au-dessus, le bas reste serré) ; aigus poussés en cloche
// (3 à 16 kHz, largeur réglable) et atténués en plateau (5 / 10 / 20 kHz). Passif : l'étage à lampe derrière rattrape le niveau
// et colore un peu, avec ses transfos.
pub const P1_LF: [f64; 4] = [20.0, 30.0, 60.0, 100.0];
pub const P1_HFB: [f64; 7] = [3_000.0, 4_000.0, 5_000.0, 8_000.0, 10_000.0, 12_000.0, 16_000.0];
pub const P1_HFA: [f64; 3] = [5_000.0, 10_000.0, 20_000.0];

#[derive(Clone, Debug)]
pub struct EqP1Params {
    /// fréquence du grave (index P1_LF), Pousser / Atténuer 0-10
    pub low_f: usize,
    pub low_boost: f64,
    pub low_atten: f64,
    /// aigus poussés : fréquence (index P1_HFB), 0-10, largeur 0 (large) à 10 (serrée)
    pub high_f: usize,
    pub high_boost: f64,
    pub bw: f64,
    /// aigus atténués : fréquence (index P1_HFA), 0-10
    pub atten_f: usize,
    pub high_atten: f64,
    /// sortie (dB, ±12), en service
    pub output: f64,
    pub on: bool,
}
impl Default for EqP1Params {
    fn default() -> Self { Self { low_f: 2, low_boost: 0.0, low_atten: 0.0, high_f: 4, high_boost: 0.0, bw: 5.0, atten_f: 1, high_atten: 0.0, output: 0.0, on: true } }
}
impl From<&crate::model::EqP1Json> for EqP1Params {
    fn from(j: &crate::model::EqP1Json) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { low_f: idx(j.low_f, d.low_f, 3), low_boost: j.low_boost.unwrap_or(0.0), low_atten: j.low_atten.unwrap_or(0.0),
            high_f: idx(j.high_f, d.high_f, 6), high_boost: j.high_boost.unwrap_or(0.0), bw: j.bw.unwrap_or(d.bw),
            atten_f: idx(j.atten_f, d.atten_f, 2), high_atten: j.high_atten.unwrap_or(0.0), output: j.output.unwrap_or(0.0), on: j.on.unwrap_or(1.0) >= 0.5 }
    }
}
impl EqP1Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "lowBoost" => self.low_boost = v, "lowAtten" => self.low_atten = v, "highBoost" => self.high_boost = v, "bw" => self.bw = v,
            "highAtten" => self.high_atten = v, "output" => self.output = v, "lowF" => self.low_f = ix(v, 3), "highF" => self.high_f = ix(v, 6),
            "attenF" => self.atten_f = ix(v, 2), "on" => self.on = v >= 0.5, _ => return false }
        true
    }
}
/// Marge de l'étage à lampe du P1 (−16 dB) et force de son fer
const HRP1: f64 = 0.158_489_319_246_111_35;
const IRONP1: f64 = 0.05;

pub struct EqP1 {
    gout: f64,
    eq: Vec<[Biquad; 2]>,
    os: [Os4; 2],
    iron: [[Iron; 2]; 2],
    ik: (f64, f64),
    dc: [(f64, f64); 2],
}
impl EqP1 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &EqP1Params, sr: f64) -> Self {
        let s4 = sr * 4.0;
        let mut eq: Vec<Biquad> = Vec::new();
        if p.on {
            let f = P1_LF[p.low_f.min(3)];
            let (b, a) = (p.low_boost.clamp(0.0, 10.0), p.low_atten.clamp(0.0, 10.0));
            // Pousser : plateau grave un peu résonant (+13,5 dB au maximum) ; Atténuer : plateau doux qui commence 2 octaves plus haut (−6 dB) :
            // les deux à fond à 60 Hz ≈ +7 dB à 20 Hz, à plat vers 65 Hz, creux de −4,6 dB vers 120 Hz (la courbe publiée de la machine)
            if b > 1e-6 { eq.push(eq_matched("lowshelf", f, 0.9, b * 1.35, s4)); }
            if a > 1e-6 { eq.push(eq_matched("lowshelf", f * 4.0, 0.5, -a * 0.6, s4)); }
            let hb = p.high_boost.clamp(0.0, 10.0);
            if hb > 1e-6 { eq.push(eq_matched("peaking", P1_HFB[p.high_f.min(6)], 0.4 + 0.25 * p.bw.clamp(0.0, 10.0), hb * 1.8, s4)); }
            let ha = p.high_atten.clamp(0.0, 10.0);
            if ha > 1e-6 { eq.push(eq_matched("highshelf", P1_HFA[p.atten_f.min(2)] * 0.75, 0.6, -ha * 1.6, s4)); }
        }
        Self { gout: 10f64.powf(p.output.clamp(-12.0, 12.0) / 20.0), eq: eq.into_iter().map(|b| [b, b]).collect(), os: [Os4::new(), Os4::new()],
            iron: [[Iron::default(); 2]; 2], ik: iron_k(sr), dc: [(0.0, 0.0); 2] }
    }
    /// Nouveau réglage sans clic : mêmes filtres → seuls les coefficients changent
    pub fn set(&mut self, p: &EqP1Params, sr: f64) {
        let n = EqP1::new(p, sr);
        self.gout = n.gout;
        if n.eq.len() == self.eq.len() { for (a, b) in self.eq.iter_mut().zip(n.eq) { a[0].retune(b[0]); a[1].retune(b[1]); } } else { self.eq = n.eq; }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let (eq, dc, iron) = (&mut self.eq, &mut self.dc[ch], &mut self.iron[ch]);
            let y = self.os[ch].run(x[ch], |u| {
                // transfo d'entrée, EQ passif, étage à lampe qui rattrape le niveau (un peu d'harmonique 2), transfo de sortie
                let mut y = iron[0].run(u * HRP1, iw, il, IRONP1);
                for b in eq.iter_mut() { y = b[ch].tick(y); }
                let c = y + 0.05 * y * y;
                let o = c - dc.0 + 0.99988 * dc.1;
                *dc = (c, o);
                iron[1].run((1.1 * o).tanh() / 1.1, iw, il, IRONP1) / HRP1
            });
            x[ch] = y * self.gout;
        }
    }
}

// ===== Bus G : compresseur de bus de console (esprit « G ») =====
// Comme la machine : Seuil, Ratio 2 / 4 / 10, Attaque 0,1 · 0,3 · 1 · 3 · 10 · 30 ms, Relâchement 0,1 · 0,3 · 0,6 · 1,2 s ou Auto,
// Gain de compensation ; et la touche Pulse : coupe-bas du détecteur (le grave ne fait plus pomper) et Mélange.
// Compresseur à VCA « en avant » (le détecteur écoute l'entrée), stéréo liée. Auto : relâchement rapide sur les coups,
// lent quand la réduction dure (la « colle » de la machine).
// Variantes : Gris (la classique, propre) et Noir (plus agressive : genou plus franc, l'étage de sortie qui chauffe).
pub const BUSG_ATT: [f64; 6] = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03];
pub const BUSG_REL: [f64; 4] = [0.1, 0.3, 0.6, 1.2];
pub const BUSG_HPF: [f64; 4] = [0.0, 60.0, 90.0, 150.0];

#[derive(Clone, Debug)]
pub struct BusGParams {
    /// seuil (dBFS, −30 à 0)
    pub thr: f64,
    /// 2, 4 ou 10
    pub ratio: f64,
    /// index BUSG_ATT
    pub attack: usize,
    /// index BUSG_REL, 4 = Auto
    pub release: usize,
    /// gain de compensation (dB, 0 à 15)
    pub makeup: f64,
    /// coupe-bas du détecteur (index BUSG_HPF, 0 = éteint)
    pub sc_hpf: usize,
    pub mix: f64,
    /// 0 Gris, 1 Noir
    pub variant: usize,
}
impl Default for BusGParams {
    fn default() -> Self { Self { thr: -10.0, ratio: 4.0, attack: 3, release: 4, makeup: 0.0, sc_hpf: 0, mix: 100.0, variant: 0 } }
}
impl From<&crate::model::BusGJson> for BusGParams {
    fn from(j: &crate::model::BusGJson) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { thr: j.thr.unwrap_or(d.thr), ratio: j.ratio.unwrap_or(d.ratio), attack: idx(j.attack, d.attack, 5), release: idx(j.release, d.release, 4),
            makeup: j.makeup.unwrap_or(0.0), sc_hpf: idx(j.sc_hpf, 0, 3), mix: j.mix.unwrap_or(100.0), variant: idx(j.variant, 0, 1) }
    }
}
impl BusGParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "thr" => self.thr = v, "ratio" => self.ratio = v, "makeup" => self.makeup = v, "mix" => self.mix = v,
            "attack" => self.attack = ix(v, 5), "release" => self.release = ix(v, 4), "scHpf" => self.sc_hpf = ix(v, 3), "variant" => self.variant = ix(v, 1), _ => return false }
        true
    }
}
/// Marge de l'étage de sortie de la console (−18 dB)
const HRG: f64 = 0.125_892_541_179_416_72;

pub struct BusG {
    sr: f64,
    thr: f64,
    slope: f64,
    knee: f64,
    att: f64,
    rel: f64,
    auto: bool,
    rel_fast: f64,
    rel_slow: f64,
    gmk: f64,
    mix: f64,
    drive: f64,
    h3: f64,
    /// réduction (dB) ; en Auto : enveloppes rapide et lente
    gr: f64,
    slow: f64,
    hp: [(f64, f64); 2],
    hpa: f64,
    os: [Os4; 2],
    dry: [[f64; 40]; 2],
}
impl BusG {
    pub const LATENCY: usize = 31;
    pub fn new(p: &BusGParams, sr: f64) -> Self {
        let mut s = Self { sr, thr: -10.0, slope: 0.75, knee: 6.0, att: 0.0, rel: 0.0, auto: true, rel_fast: 0.0, rel_slow: 0.0, gmk: 1.0, mix: 1.0, drive: 1.0, h3: 0.0,
            gr: 0.0, slow: 0.0, hp: [(0.0, 0.0); 2], hpa: 0.0, os: [Os4::new(), Os4::new()], dry: [[0.0; 40]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &BusGParams) {
        let sr = self.sr;
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        let noir = p.variant == 1;
        self.thr = p.thr.clamp(-30.0, 0.0);
        let r = match p.ratio.round() as i64 { r if r <= 2 => 2.0, r if r <= 4 => 4.0, _ => 10.0 };
        self.slope = 1.0 - 1.0 / r;
        self.knee = (if r <= 2.0 { 10.0 } else if r <= 4.0 { 6.0 } else { 4.0 }) * if noir { 0.5 } else { 1.0 };
        self.att = co(BUSG_ATT[p.attack.min(5)]);
        self.auto = p.release >= 4;
        self.rel = co(BUSG_REL[p.release.min(3)]);
        self.rel_fast = co(0.1);
        self.rel_slow = co(1.2);
        self.gmk = 10f64.powf(p.makeup.clamp(0.0, 15.0) / 20.0);
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
        (self.drive, self.h3) = if noir { (1.6, 1.0) } else { (1.05, 0.0) };
        let f = BUSG_HPF[p.sc_hpf.min(3)];
        self.hpa = if f > 0.0 { (-2.0 * PI * f / sr).exp() } else { 0.0 };
    }
    fn curve(&self, lvl: f64) -> f64 {
        let over = lvl - self.thr;
        let k = self.knee;
        if over <= -k / 2.0 { 0.0 } else if over >= k / 2.0 { over * self.slope } else { self.slope * (over + k / 2.0).powi(2) / (2.0 * k) }
    }
    pub fn reduction(&self) -> f64 { self.gr }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        // détecteur : coupe-bas (1er ordre) si demandé, crête liée des deux canaux
        let mut pk = 0.0f64;
        for ch in 0..nc {
            let v = if self.hpa > 0.0 { let (xp, yp) = self.hp[ch]; let y = self.hpa * (yp + x[ch] - xp); self.hp[ch] = (x[ch], y); y } else { x[ch] };
            pk = pk.max(v.abs());
        }
        let want = self.curve(20.0 * (pk + 1e-12).log10());
        if want > self.gr { self.gr += (want - self.gr) * self.att; }
        else if self.auto {
            // Auto : la part de réduction qui dure repart lentement, le reste vite
            let rel = if self.slow > 0.7 * self.gr { self.rel_slow } else { self.rel_fast };
            self.gr += (want - self.gr) * rel;
        } else { self.gr += (want - self.gr) * self.rel; }
        self.slow += (self.gr - self.slow) * self.rel_slow * 0.5;
        let g = 10f64.powf(-self.gr / 20.0) * self.gmk;
        let (dr, h3) = (self.drive, self.h3);
        for ch in 0..nc {
            let y = self.os[ch].run(x[ch] * g, |u| {
                // étage de sortie de la console : propre en Gris, il chauffe (harmonique 3) en Noir
                let c = u * HRG * dr;
                let c = c - h3 * 0.04 * c * c * c;
                c.tanh() / dr / HRG
            });
            let d = &mut self.dry[ch];
            d.copy_within(0..39, 1);
            d[0] = x[ch];
            x[ch] = if self.mix < 1.0 { d[Self::LATENCY] + (y - d[Self::LATENCY]) * self.mix } else { y };
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

    fn run2a(p: &Opto2AParams, amp: f64, f: f64, n: usize) -> (Vec<f64>, Opto2A) {
        let mut c = Opto2A::new(p, SR);
        let out = (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
        (out, c)
    }
    /// Optique 2A : Réduction à 0 = presque transparent ; tournée = ça compresse (≈ 3:1 en Compression, plus en Limitation)
    #[test]
    fn opto_reduction_et_ratio() {
        let amp = 10f64.powf(-6.0 / 20.0);
        let (_, c0) = run2a(&Opto2AParams { peak: 0.0, ..Default::default() }, amp, 1000.0, 96_000);
        assert!(c0.reduction() < 1.0, "Réduction 0 : {:.2} dB", c0.reduction());
        let (_, cc) = run2a(&Opto2AParams { peak: 60.0, ..Default::default() }, amp, 1000.0, 96_000);
        let (_, cl) = run2a(&Opto2AParams { peak: 60.0, limit: true, ..Default::default() }, amp, 1000.0, 96_000);
        // seuil à −28,8 dB, crête à −6 : 22,8 dB au-dessus → 3:1 ≈ 15,2 dB de réduction, 10:1 ≈ 20,5 dB
        assert!((cc.reduction() - 15.2).abs() < 2.0, "Compression : {:.1} dB", cc.reduction());
        assert!(cl.reduction() > cc.reduction() + 3.0, "Limitation {:.1} > Compression {:.1}", cl.reduction(), cc.reduction());
    }
    /// La cellule : attaque ~10 ms, moitié du relâchement vite, le reste lentement ; et plus elle a travaillé, plus elle traîne
    #[test]
    fn opto_releve_en_deux_temps_avec_memoire() {
        let amp = 10f64.powf(-6.0 / 20.0);
        let p = Opto2AParams { peak: 60.0, ..Default::default() };
        let rel = |hold: usize| {
            let mut c = Opto2A::new(&p, SR);
            for i in 0..hold { let mut x = [amp * (2.0 * PI * 1000.0 * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); }
            let g0 = c.reduction();
            let mut t50 = 0; let mut t90 = 0;
            for i in 0..(10.0 * SR) as usize { let mut x = [0.0, 0.0]; c.tick(&mut x, 1); let r = c.reduction(); if t50 == 0 && r < g0 * 0.5 { t50 = i; } if t90 == 0 && r < g0 * 0.1 { t90 = i; break; } }
            (t50 as f64 / SR, t90 as f64 / SR)
        };
        let (a50, a90) = rel(24_000);
        let (b50, b90) = rel(480_000);
        assert!(a50 < 0.15, "moitié du relâchement en {a50:.3} s");
        assert!(a90 > 5.0 * a50, "le reste traîne : 90 % en {a90:.2} s");
        assert!(b90 > a90 * 1.5, "après 10 s de compression la cellule traîne plus ({b90:.2} s contre {a90:.2} s)");
        let _ = b50;
    }
    /// Les variantes sonnent différemment : Gris plus sombre et plus grasse (h2), Noir plus claire
    #[test]
    fn opto_variantes() {
        let amp = 10f64.powf(-8.0 / 20.0);
        let m = |v: usize| { let (o, _) = run2a(&Opto2AParams { peak: 30.0, gain: 60.0, variant: v, ..Default::default() }, amp, 200.0, 48_000);
            let s = &o[24_000..48_000]; 20.0 * (harm(s, 200.0, 2) / harm(s, 200.0, 1)).log10() };
        let (g, a, n) = (m(0), m(1), m(2));
        assert!(g > a + 2.0 && a > n + 2.0, "harmonique 2 : Gris {g:.1}, Argent {a:.1}, Noir {n:.1}");
        let hf = |v: usize| { let (o, _) = run2a(&Opto2AParams { peak: 0.0, variant: v, ..Default::default() }, 0.1, 15_000.0, 24_000);
            peak_db(&o[12_000..]) };
        assert!(hf(0) < hf(2) - 1.0, "15 kHz : Gris {:.1} dB, Noir {:.1} dB", hf(0), hf(2));
    }

    /// Variantes du 76 : Argent plus granuleux et plus doux dans l'aigu que Noir ; Graphite plus propre que Noir
    #[test]
    fn fet_variantes() {
        let amp = 10f64.powf((FET_THR + 14.0) / 20.0);
        let h2 = |v: usize| { let (o, _) = run(&Fet76Params { ratio: 8.0, variant: v, ..Default::default() }, amp, 200.0, 48_000);
            let s = &o[24_000..48_000]; 20.0 * (harm(s, 200.0, 2) / harm(s, 200.0, 1)).log10() };
        let (n, a, g) = (h2(0), h2(1), h2(2));
        assert!(a > n + 3.0 && n > g + 3.0, "harmonique 2 : Argent {a:.1}, Noir {n:.1}, Graphite {g:.1}");
        let hf = |v: usize| { let (o, _) = run(&Fet76Params { variant: v, ..Default::default() }, 0.05, 15_000.0, 24_000); peak_db(&o[12_000..]) };
        assert!(hf(1) < hf(0) - 1.0, "15 kHz : Argent {:.1}, Noir {:.1}", hf(1), hf(0));
    }

    /// 84 : la bande en plus (bas-médiums) agit à sa fréquence ; Vintage : plus de grain et un aigu arrondi
    #[test]
    fn pre73_variantes() {
        let lvl = |p: &Pre73Params, f: f64| { let o = run73(p, 0.05, f, 48_000); 20.0 * (harm(&o[24_000..], f, 1) / harm(&run73(&Pre73Params::default(), 0.05, f, 48_000)[24_000..], f, 1)).log10() };
        let p84 = Pre73Params { variant: 1, lmid: 8.0, lmid_f: 2, ..Default::default() };
        assert!((lvl(&p84, 700.0) - 8.0).abs() < 1.0, "84 : +8 dB à 700 Hz ({:.1})", lvl(&p84, 700.0));
        let p73 = Pre73Params { variant: 0, lmid: 8.0, lmid_f: 2, ..Default::default() };
        assert!(lvl(&p73, 700.0).abs() < 0.3, "73 : pas de bas-médiums ({:.1})", lvl(&p73, 700.0));
        let v = Pre73Params { variant: 2, ..Default::default() };
        assert!(lvl(&v, 16_000.0) < -2.0, "Vintage : aigu arrondi ({:.1} dB à 16 kHz)", lvl(&v, 16_000.0));
        let h2 = |p: &Pre73Params| { let o = run73(p, 0.3, 200.0, 48_000); let s = &o[24_000..]; 20.0 * (harm(s, 200.0, 2) / harm(s, 200.0, 1)).log10() };
        assert!(h2(&Pre73Params { variant: 2, gain: 12.0, output: -12.0, ..Default::default() }) > h2(&Pre73Params { gain: 12.0, output: -12.0, ..Default::default() }) + 2.0, "Vintage : plus de grain");
    }

    fn runp1(p: &EqP1Params, amp: f64, f: f64, n: usize) -> Vec<f64> {
        let mut c = EqP1::new(p, SR);
        (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect()
    }
    /// P1 : tout à 0 = à plat ; Pousser + Atténuer au même grave = le grave gonfle et un creux se forme au-dessus
    #[test]
    fn p1_le_truc_du_grave() {
        let gain = |p: &EqP1Params, f: f64| { let n = (SR * 0.6) as usize; let o = runp1(p, 0.05, f, n); let r = runp1(&EqP1Params::default(), 0.05, f, n);
            20.0 * (harm(&o[n / 2..], f, 1) / harm(&r[n / 2..], f, 1)).log10() };
        let flat = EqP1Params::default();
        let o = runp1(&flat, 0.05, 1000.0, 24_000); let inp: Vec<f64> = (0..24_000).map(|i| 0.05 * (2.0 * PI * 1000.0 * i as f64 / SR).sin()).collect();
        assert!((harm(&o[12_000..], 1000.0, 1) / harm(&inp[12_000..], 1000.0, 1) - 1.0).abs() < 0.03, "à plat : même niveau");
        let t = EqP1Params { low_boost: 10.0, low_atten: 10.0, ..Default::default() };
        let (g40, g250) = (gain(&t, 40.0), gain(&t, 250.0));
        assert!(g40 > 3.0, "le grave gonfle ({g40:.1} dB à 40 Hz)");
        assert!(g250 < -1.0, "creux au-dessus ({g250:.1} dB à 250 Hz)");
        let hb = EqP1Params { high_boost: 8.0, high_f: 4, ..Default::default() };
        assert!((gain(&hb, 10_000.0) - 14.4).abs() < 1.5, "aigus poussés à 10 kHz : {:.1} dB", gain(&hb, 10_000.0));
    }

    fn rung(p: &BusGParams, amp: f64, f: f64, n: usize) -> (Vec<f64>, BusG) {
        let mut c = BusG::new(p, SR);
        let o = (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
        (o, c)
    }
    /// Bus G : ratios 2 / 4 / 10 à 12 dB au-dessus du seuil ; le coupe-bas du détecteur laisse passer le grave sans pomper ;
    /// Noir chauffe plus que Gris
    #[test]
    fn busg_ratios_detecteur_variantes() {
        let a: f64 = 0.6;
        for (r, want) in [(2.0, 6.0), (4.0, 9.0), (10.0, 10.8)] {
            let lvl = 20.0 * a.log10();
            let (_, c) = rung(&BusGParams { ratio: r, thr: lvl - 12.0, release: 3, ..Default::default() }, a, 1000.0, 48_000);
            assert!((c.reduction() - want).abs() < 1.0, "ratio {r} : {:.1} dB (attendu {want})", c.reduction());
        }
        let (_, c0) = rung(&BusGParams { thr: -20.0, ..Default::default() }, 0.5, 40.0, 48_000);
        let (_, c1) = rung(&BusGParams { thr: -20.0, sc_hpf: 3, ..Default::default() }, 0.5, 40.0, 48_000);
        assert!(c1.reduction() < c0.reduction() - 6.0, "coupe-bas du détecteur : {:.1} contre {:.1} dB", c1.reduction(), c0.reduction());
        let h3 = |v: usize| { let (o, _) = rung(&BusGParams { thr: 0.0, variant: v, ..Default::default() }, 0.7, 200.0, 48_000); let s = &o[24_000..]; 20.0 * (harm(s, 200.0, 3) / harm(s, 200.0, 1)).log10() };
        assert!(h3(1) > h3(0) + 6.0, "Noir {:.1} dB, Gris {:.1} dB", h3(1), h3(0));
    }
}
