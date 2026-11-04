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

// ===== Bande 80 : magnétophone à bande (esprit « 80 ») =====
// Ce que fait une bande : elle sature en douceur (surtout l'harmonique 3, avec un peu de « mémoire » magnétique),
// les têtes font une bosse dans le grave (plus haut à 30 qu'à 15), l'aigu s'arrondit, il y a un léger souffle et la bande
// pleure un peu (vitesse qui bouge : lent = pleurage, rapide = scintillement). Polarisation (bias) : sous-polarisée = plus brillante
// et plus sale, sur-polarisée = plus sombre et plus propre.
// Machines : ½ pouce (brillante, nette), 2 pouces (grasse, grosse bosse), Cassette (lo-fi : bande étroite, souffle, pleurage).
/// Retard : suréchantillonnage (31) + ligne du pleurage (48 échantillons de marge)
pub const TAPE_WOW_BASE: usize = 48;

#[derive(Clone, Debug)]
pub struct TapeParams {
    /// entrée (dB, −12 à +18) : plus on pousse, plus la bande sature
    pub input: f64,
    /// sortie (dB, ±12)
    pub output: f64,
    /// 0 = 15, 1 = 30 (pouces par seconde)
    pub speed: usize,
    /// 0 = ½ pouce, 1 = 2 pouces, 2 = cassette
    pub machine: usize,
    /// polarisation −100 (sous) à +100 (sur)
    pub bias: f64,
    /// souffle 0-100, pleurage 0-100 (50 = celui de la machine), mélange %
    pub noise: f64,
    pub wow: f64,
    pub mix: f64,
}
impl Default for TapeParams {
    fn default() -> Self { Self { input: 0.0, output: 0.0, speed: 0, machine: 0, bias: 0.0, noise: 20.0, wow: 50.0, mix: 100.0 } }
}
impl From<&crate::model::TapeJson> for TapeParams {
    fn from(j: &crate::model::TapeJson) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { input: j.input.unwrap_or(0.0), output: j.output.unwrap_or(0.0), speed: idx(j.speed, 0, 1), machine: idx(j.machine, 0, 2),
            bias: j.bias.unwrap_or(0.0), noise: j.noise.unwrap_or(d.noise), wow: j.wow.unwrap_or(d.wow), mix: j.mix.unwrap_or(100.0) }
    }
}
impl TapeParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "input" => self.input = v, "output" => self.output = v, "bias" => self.bias = v, "noise" => self.noise = v, "wow" => self.wow = v, "mix" => self.mix = v,
            "speed" => self.speed = ix(v, 1), "machine" => self.machine = ix(v, 2), _ => return false }
        true
    }
}
/// Marge de la bande (−12 dB : 0 dBFS pousse déjà un peu la bande)
const HRT: f64 = 0.251_188_643_150_958;

pub struct Tape {
    sr: f64,
    gin: f64,
    gout: f64,
    k: f64,
    hyst: f64,
    mix: f64,
    eq: Vec<[Biquad; 2]>,
    os: [Os4; 2],
    mem: [f64; 2],
    /// souffle : niveau, filtre, générateur (le même dans le navigateur)
    hiss: f64,
    hlp: f64,
    hs: [f64; 2],
    rng: u32,
    /// pleurage : profondeurs (échantillons) et phases, ligne de retard
    dw: f64,
    df: f64,
    pw: f64,
    pf: f64,
    line: [[f64; 128]; 2],
    li: usize,
    dry: [[f64; 128]; 2],
}
impl Tape {
    pub const LATENCY: usize = 31 + TAPE_WOW_BASE;
    pub fn new(p: &TapeParams, sr: f64) -> Self {
        let mut s = Self { sr, gin: 1.0, gout: 1.0, k: 1.0, hyst: 0.0, mix: 1.0, eq: Vec::new(), os: [Os4::new(), Os4::new()], mem: [0.0; 2],
            hiss: 0.0, hlp: 0.0, hs: [0.0; 2], rng: 0x1234_5678, dw: 0.0, df: 0.0, pw: 0.0, pf: 0.0, line: [[0.0; 128]; 2], li: 0, dry: [[0.0; 128]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &TapeParams) {
        let (sr, s4) = (self.sr, self.sr * 4.0);
        let m = p.machine.min(2);
        let fast = p.speed >= 1 && m < 2;
        let b = (p.bias / 100.0).clamp(-1.0, 1.0);
        self.gin = 10f64.powf(p.input.clamp(-12.0, 18.0) / 20.0);
        self.gout = 10f64.powf(p.output.clamp(-12.0, 12.0) / 20.0);
        // sature plus en 2 pouces et en cassette, et quand la bande est sous-polarisée
        self.k = [1.0, 1.15, 1.6][m] * (1.0 - 0.25 * b);
        self.hyst = 0.08 * (1.0 - 0.5 * b);
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
        let mut eq: Vec<Biquad> = Vec::new();
        // bosse des têtes et coupe du grave en dessous
        let (fb, gb) = match (m, fast) { (2, _) => (80.0, 1.5), (1, false) => (50.0, 3.0), (1, true) => (100.0, 2.5), (_, false) => (50.0, 2.0), (_, true) => (100.0, 1.5) };
        eq.push(eq_matched("peaking", fb, 1.0, gb, s4));
        eq.push(eq_matched("highpass", if m == 2 { 40.0 } else if fast { 35.0 } else { 20.0 }, 0.7, 0.0, s4));
        // aigus : arrondis selon la machine et la vitesse ; la polarisation éclaircit (sous) ou assombrit (sur)
        let lp = match (m, fast) { (2, _) => 12_000.0, (1, false) => 18_000.0, (1, true) => 21_000.0, (_, false) => 20_000.0, (_, true) => 23_000.0 };
        eq.push(eq_matched("lowpass", lp, if m == 2 { 0.6 } else { 0.707 }, 0.0, s4));
        if b.abs() > 1e-6 { eq.push(eq_matched("highshelf", 8_000.0, 0.7, -2.5 * b, s4)); }
        if self.eq.len() == eq.len() { for (a, n) in self.eq.iter_mut().zip(eq) { a[0].retune(n); a[1].retune(n); } } else { self.eq = eq.into_iter().map(|q| [q, q]).collect(); }
        // souffle : ½ et 2 pouces de −80 à −60 dBFS, cassette de −70 à −50
        let n = p.noise.clamp(0.0, 100.0) / 100.0;
        self.hiss = if n > 0.0 { 10f64.powf((if m == 2 { -70.0 } else { -80.0 } + 20.0 * n) / 20.0) } else { 0.0 };
        self.hlp = 1.0 - (-2.0 * PI * if m == 2 { 5_000.0 } else { 8_000.0 } / sr).exp();
        // pleurage (0,5 Hz) et scintillement (6,3 Hz) : écart de vitesse → écart de temps = écart / (2π f)
        let w = p.wow.clamp(0.0, 100.0) / 50.0;
        let (ww, ff) = if m == 2 { (0.0012, 0.0006) } else { (0.0002, 0.0002) };
        self.dw = (ww * w * sr / (2.0 * PI * 0.5)).min(40.0);
        self.df = (ff * w * sr / (2.0 * PI * 6.3)).min(6.0);
    }
    fn rand(&mut self) -> f64 {
        self.rng = self.rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (self.rng >> 8) as f64 / 16_777_216.0 * 2.0 - 1.0
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (k, h) = (self.k, self.hyst);
        // pleurage : position de lecture dans la ligne de retard (au centre : TAPE_WOW_BASE)
        self.pw += 2.0 * PI * 0.5 / self.sr; if self.pw > 2.0 * PI { self.pw -= 2.0 * PI; }
        self.pf += 2.0 * PI * 6.3 / self.sr; if self.pf > 2.0 * PI { self.pf -= 2.0 * PI; }
        let dly = TAPE_WOW_BASE as f64 + self.dw * self.pw.sin() + self.df * self.pf.sin();
        let noise = if self.hiss > 0.0 { self.rand() } else { 0.0 };
        self.li = (self.li + 1) % 128;
        for ch in 0..nc {
            let (eq, mem) = (&mut self.eq, &mut self.mem[ch]);
            let y = self.os[ch].run(x[ch] * self.gin, |u| {
                // bande : saturation douce avec un peu de mémoire magnétique (hystérésis), puis têtes (bosse, aigus)
                let v = u * HRT;
                let s = (k * (v + h * *mem)).tanh() / k;
                *mem = s;
                let mut y = s;
                for q in eq.iter_mut() { y = q[ch].tick(y); }
                y / HRT
            });
            // souffle (filtré), puis la ligne du pleurage (lecture interpolée)
            self.hs[ch] += (noise - self.hs[ch]) * self.hlp;
            let y = y + self.hs[ch] * self.hiss;
            let l = &mut self.line[ch];
            l[self.li] = y;
            let pos = self.li as f64 + 128.0 - dly;
            let i0 = pos.floor();
            let fr = pos - i0;
            let a = l[(i0 as usize) % 128];
            let bb = l[(i0 as usize + 1) % 128];
            let out = (a + (bb - a) * fr) * self.gout;
            let d = &mut self.dry[ch];
            d[self.li] = x[ch];
            let dd = d[(self.li + 128 - Self::LATENCY) % 128];
            x[ch] = if self.mix < 1.0 { dd + (out - dd) * self.mix } else { out };
        }
    }
}

// ===== Lampe 670 : compresseur à lampes « variable-mu » (esprit « 670 ») =====
// Le gain est réduit par des lampes dont l'amplification baisse quand on les polarise : le ratio n'est pas fixe, il grandit avec
// le niveau (doux sur les nuances, ferme sur les crêtes) — la « colle » épaisse des disques soul et des masters. Push-pull :
// surtout des harmoniques impaires, qui montent quand ça compresse ; de gros transfos. Contre-réaction (détecteur sur la sortie).
// Comme la machine : Entrée, Seuil (0-10), Constante de temps 1 à 6 (attaque / relâchement liés ; 5 et 6 = relâchement
// automatique en plusieurs temps), Sortie ; et la touche Pulse : Mélange.
/// Constantes de temps : attaque (s), relâchement (s) ; 5 et 6 : relâchements rapide / lent (le lent quand la réduction dure)
pub const L670_TC: [[f64; 3]; 6] = [[0.0002, 0.3, 0.3], [0.0002, 0.8, 0.8], [0.0004, 2.0, 2.0], [0.0008, 5.0, 5.0], [0.0002, 2.0, 10.0], [0.0004, 0.3, 10.0]];

#[derive(Clone, Debug)]
pub struct L670Params {
    /// entrée (dB, −10 à +20) : pousse les lampes
    pub input: f64,
    /// seuil 0 (rien) à 10 (beaucoup)
    pub thr: f64,
    /// constante de temps 1 à 6 (index 0-5)
    pub tc: usize,
    /// sortie (dB, ±20), mélange %
    pub output: f64,
    pub mix: f64,
}
impl Default for L670Params {
    fn default() -> Self { Self { input: 0.0, thr: 4.0, tc: 1, output: 0.0, mix: 100.0 } }
}
impl From<&crate::model::L670Json> for L670Params {
    fn from(j: &crate::model::L670Json) -> Self {
        let d = Self::default();
        Self { input: j.input.unwrap_or(0.0), thr: j.thr.unwrap_or(d.thr), tc: j.tc.map_or(d.tc, |v| (v.round().max(0.0) as usize).min(5)),
            output: j.output.unwrap_or(0.0), mix: j.mix.unwrap_or(100.0) }
    }
}
impl L670Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "input" => self.input = v, "thr" => self.thr = v, "output" => self.output = v, "mix" => self.mix = v,
            "tc" => self.tc = (v.round().max(0.0) as usize).min(5), _ => return false }
        true
    }
}
/// Marge des lampes (−16 dB) et force des transfos
const HR670: f64 = 0.158_489_319_246_111_35;
const IRON670: f64 = 0.08;

pub struct L670 {
    sr: f64,
    gin: f64,
    gout: f64,
    thr: f64,
    att: f64,
    rel: f64,
    rel_slow: f64,
    auto: bool,
    mix: f64,
    gr: f64,
    slow: f64,
    os: [Os4; 2],
    iron: [[Iron; 2]; 2],
    ik: (f64, f64),
    dry: [[f64; 40]; 2],
}
impl L670 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &L670Params, sr: f64) -> Self {
        let mut s = Self { sr, gin: 1.0, gout: 1.0, thr: -12.0, att: 0.0, rel: 0.0, rel_slow: 0.0, auto: false, mix: 1.0, gr: 0.0, slow: 0.0,
            os: [Os4::new(), Os4::new()], iron: [[Iron::default(); 2]; 2], ik: iron_k(sr), dry: [[0.0; 40]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &L670Params) {
        let sr = self.sr;
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        let tc = L670_TC[p.tc.min(5)];
        self.gin = 10f64.powf(p.input.clamp(-10.0, 20.0) / 20.0);
        self.gout = 10f64.powf(p.output.clamp(-20.0, 20.0) / 20.0);
        self.thr = -3.0 * p.thr.clamp(0.0, 10.0);
        self.att = co(tc[0]);
        self.rel = co(tc[1]);
        self.rel_slow = co(tc[2]);
        self.auto = p.tc >= 4;
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    /// Réduction demandée pour un dépassement de sortie (dB) : genou très doux (12 dB), ratio qui grandit avec le niveau
    /// (≈ 2:1 au début, beaucoup plus sur les grosses crêtes)
    fn curve(&self, lvl: f64) -> f64 {
        let over = lvl - self.thr;
        let o = 6.0 * (1.0 + (over / 6.0).exp()).ln();
        if o < 1e-9 { 0.0 } else { o + 0.12 * o * o }
    }
    pub fn reduction(&self) -> f64 { self.gr }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let mut pk = 0.0f64;
        for ch in 0..nc { pk = pk.max((x[ch] * self.gin).abs()); }
        let want = self.curve(20.0 * (pk + 1e-12).log10() - self.gr);
        // la boucle accélère l'attaque d'environ 2 (ratio de départ) : on la ralentit d'autant
        if want > self.gr { self.gr += (want - self.gr) * self.att * 0.5; }
        else if self.auto {
            let rel = if self.slow > 0.7 * self.gr { self.rel_slow } else { self.rel };
            self.gr += (want - self.gr) * rel;
        } else { self.gr += (want - self.gr) * self.rel; }
        self.slow += (self.gr - self.slow) * self.rel_slow * 0.5;
        let g = 10f64.powf(-self.gr / 20.0);
        // harmoniques impaires du push-pull, qui montent avec la réduction (la lampe travaille hors de sa zone droite)
        let h3 = 0.02 + 0.06 * (1.0 - g);
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let iron = &mut self.iron[ch];
            let y = self.os[ch].run(x[ch] * self.gin, |u| {
                let v = iron[0].run(u * HR670, iw, il, IRON670) * g;
                let c = v - h3 * v * v * v / (HR670 * HR670) * 0.05;
                iron[1].run((1.1 * c).tanh() / 1.1, iw, il, IRON670) / HR670
            }) * self.gout;
            let d = &mut self.dry[ch];
            d.copy_within(0..39, 1);
            d[0] = x[ch];
            x[ch] = if self.mix < 1.0 { d[Self::LATENCY] + (y - d[Self::LATENCY]) * self.mix } else { y };
        }
    }
}

// ===== Détresse : le compresseur couteau suisse (esprit « Détresse ») =====
// Comme la machine : Entrée et Sortie de 0 à 10, Attaque et Relâchement de 0 à 10, huit ratios : 1:1 (pas de compression,
// juste la couleur), 2, 3, 4, 6, 10, 20 et « Nuke » (tout écraser). Les petits ratios ont un genou très doux (façon optique),
// les grands sont francs (façon FET). Détecteur : coupe-bas (le grave ne déclenche plus) et accentuation des aigus (dé-esseur).
// Distorsion : Propre, « 2 » (lampe, harmonique 2), « 3 » (bande, harmonique 3) — elle monte avec l'entrée.
pub const DTR_RATIO: [f64; 8] = [1.0, 2.0, 3.0, 4.0, 6.0, 10.0, 20.0, 60.0];
const DTR_KNEE: [f64; 8] = [0.0, 15.0, 15.0, 8.0, 8.0, 4.0, 2.0, 1.0];

#[derive(Clone, Debug)]
pub struct DtrParams {
    pub input: f64,
    pub output: f64,
    pub attack: f64,
    pub release: f64,
    /// index DTR_RATIO (0 = 1:1, 7 = Nuke)
    pub ratio: usize,
    /// détecteur : coupe-bas, accentuation des aigus
    pub det_hp: bool,
    pub det_band: bool,
    /// distorsion : 0 propre, 1 « 2 », 2 « 3 »
    pub dist: usize,
    pub mix: f64,
}
impl Default for DtrParams {
    fn default() -> Self { Self { input: 5.0, output: 5.0, attack: 5.0, release: 5.0, ratio: 3, det_hp: false, det_band: false, dist: 0, mix: 100.0 } }
}
impl From<&crate::model::DtrJson> for DtrParams {
    fn from(j: &crate::model::DtrJson) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { input: j.input.unwrap_or(d.input), output: j.output.unwrap_or(d.output), attack: j.attack.unwrap_or(d.attack), release: j.release.unwrap_or(d.release),
            ratio: idx(j.ratio, d.ratio, 7), det_hp: j.det_hp.unwrap_or(0.0) >= 0.5, det_band: j.det_band.unwrap_or(0.0) >= 0.5, dist: idx(j.dist, 0, 2), mix: j.mix.unwrap_or(100.0) }
    }
}
impl DtrParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "input" => self.input = v, "output" => self.output = v, "attack" => self.attack = v, "release" => self.release = v, "mix" => self.mix = v,
            "ratio" => self.ratio = ix(v, 7), "detHp" => self.det_hp = v >= 0.5, "detBand" => self.det_band = v >= 0.5, "dist" => self.dist = ix(v, 2), _ => return false }
        true
    }
}
/// Seuil fixe (dBFS, Entrée à 5) et marge de l'étage de distorsion (−12 dB)
const DTR_THR: f64 = -18.0;
const HRD: f64 = 0.251_188_643_150_958;

pub struct Dtr {
    sr: f64,
    gin: f64,
    gout: f64,
    slope: f64,
    knee: f64,
    nuke: bool,
    att: f64,
    rel: f64,
    mix: f64,
    a2: f64,
    h3: f64,
    drive: f64,
    gr: f64,
    hp: [(f64, f64); 2],
    hpa: f64,
    band: [Biquad; 2],
    use_band: bool,
    os: [Os4; 2],
    dc: [(f64, f64); 2],
    dry: [[f64; 40]; 2],
}
impl Dtr {
    pub const LATENCY: usize = 31;
    pub fn new(p: &DtrParams, sr: f64) -> Self {
        let b = eq_matched("peaking", 6_000.0, 1.0, 10.0, sr);
        let mut s = Self { sr, gin: 1.0, gout: 1.0, slope: 0.0, knee: 0.0, nuke: false, att: 0.0, rel: 0.0, mix: 1.0, a2: 0.0, h3: 0.0, drive: 1.0, gr: 0.0,
            hp: [(0.0, 0.0); 2], hpa: (-2.0 * PI * 100.0 / sr).exp(), band: [b, b], use_band: false, os: [Os4::new(), Os4::new()], dc: [(0.0, 0.0); 2], dry: [[0.0; 40]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &DtrParams) {
        let sr = self.sr;
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        self.gin = 10f64.powf((p.input.clamp(0.0, 10.0) * 3.0 - 15.0) / 20.0);
        self.gout = 10f64.powf((p.output.clamp(0.0, 10.0) - 5.0) * 3.0 / 20.0);
        let r = p.ratio.min(7);
        self.slope = 1.0 - 1.0 / DTR_RATIO[r];
        self.knee = DTR_KNEE[r];
        self.nuke = r == 7;
        // attaque 0 (50 µs) à 10 (30 ms), relâchement 0 (50 ms) à 10 (3,5 s), en logarithmique
        self.att = co(50e-6 * (30e-3f64 / 50e-6).powf(p.attack.clamp(0.0, 10.0) / 10.0) * if self.nuke { 0.5 } else { 1.0 });
        self.rel = co(0.05 * (3.5f64 / 0.05).powf(p.release.clamp(0.0, 10.0) / 10.0));
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
        // la distorsion monte avec l'entrée
        let d = (p.input.clamp(0.0, 10.0) / 10.0).powi(2);
        (self.a2, self.h3) = match p.dist.min(2) { 1 => (0.05 + 0.5 * d, 0.0), 2 => (0.0, 0.05 + 0.5 * d), _ => (0.02, 0.0) };
        self.drive = 1.0 + 0.5 * d;
        self.use_band = p.det_band;
        if !p.det_hp { self.hpa = 0.0; } else { self.hpa = (-2.0 * PI * 100.0 / sr).exp(); }
    }
    fn curve(&self, lvl: f64) -> f64 {
        if self.slope <= 0.0 { return 0.0; }
        let over = lvl - DTR_THR;
        let k = self.knee;
        let gr = if over <= -k / 2.0 { 0.0 } else if over >= k / 2.0 { over * self.slope } else { self.slope * (over + k / 2.0).powi(2) / (2.0 * k) };
        // Nuke : un peu plus que tout écraser
        if self.nuke { gr * 1.08 } else { gr }
    }
    pub fn reduction(&self) -> f64 { self.gr }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let mut pk = 0.0f64;
        for ch in 0..nc {
            let mut v = x[ch] * self.gin;
            if self.hpa > 0.0 { let (xp, yp) = self.hp[ch]; let y = self.hpa * (yp + v - xp); self.hp[ch] = (v, y); v = y; }
            if self.use_band { v = self.band[ch].tick(v); }
            pk = pk.max(v.abs());
        }
        let want = self.curve(20.0 * (pk + 1e-12).log10());
        self.gr += (want - self.gr) * if want > self.gr { self.att } else { self.rel };
        let g = 10f64.powf(-self.gr / 20.0);
        let (a2, h3, dr) = (self.a2, self.h3, self.drive);
        for ch in 0..nc {
            let mut y = self.os[ch].run(x[ch] * self.gin * g, |u| {
                let c = u * HRD * dr;
                let c = c + a2 * c * c - h3 * c * c * c;
                (c.tanh()) / dr / HRD
            });
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

// ===== Tranche E : tranche de console complète (esprit « E ») =====
// Comme une voie de la console : filtres coupe-bas (18 dB/oct, 16-350 Hz) et coupe-haut (12 dB/oct, 3-22 kHz), EQ 4 bandes
// (graves 30-450 Hz plateau ou cloche, bas-médiums 200-2,5 k et hauts-médiums 0,6-7 k avec leur largeur, aigus 1,5-16 k plateau
// ou cloche), compresseur (seuil, ratio jusqu'à l'infini, relâchement, attaque rapide) et gate (seuil, profondeur, relâchement),
// la dynamique avant ou après l'EQ. Variantes : Brun (l'EQ doux, largeur fixe) et Noir (les cloches se resserrent quand on pousse).
#[derive(Clone, Debug)]
pub struct StripEParams {
    pub hpf: f64,
    pub lpf: f64,
    pub lf: f64, pub lf_f: f64, pub lf_bell: bool,
    pub lmf: f64, pub lmf_f: f64, pub lmf_q: f64,
    pub hmf: f64, pub hmf_f: f64, pub hmf_q: f64,
    pub hf: f64, pub hf_f: f64, pub hf_bell: bool,
    pub eq: bool,
    pub variant: usize,
    pub cthr: f64, pub cratio: f64, pub crel: f64, pub cfast: bool,
    pub gthr: f64, pub grange: f64, pub grel: f64,
    pub dyn_pre: bool,
    pub output: f64,
}
impl Default for StripEParams {
    fn default() -> Self { Self { hpf: 0.0, lpf: 22.0, lf: 0.0, lf_f: 100.0, lf_bell: false, lmf: 0.0, lmf_f: 600.0, lmf_q: 1.0, hmf: 0.0, hmf_f: 2500.0, hmf_q: 1.0,
        hf: 0.0, hf_f: 8000.0, hf_bell: false, eq: true, variant: 0, cthr: 10.0, cratio: 1.0, crel: 0.3, cfast: false, gthr: -80.0, grange: 20.0, grel: 0.3, dyn_pre: false, output: 0.0 } }
}
impl From<&crate::model::StripEJson> for StripEParams {
    fn from(j: &crate::model::StripEJson) -> Self {
        let d = Self::default();
        let b = |v: Option<f64>, def: bool| v.map_or(def, |v| v >= 0.5);
        Self { hpf: j.hpf.unwrap_or(d.hpf), lpf: j.lpf.unwrap_or(d.lpf), lf: j.lf.unwrap_or(0.0), lf_f: j.lf_f.unwrap_or(d.lf_f), lf_bell: b(j.lf_bell, false),
            lmf: j.lmf.unwrap_or(0.0), lmf_f: j.lmf_f.unwrap_or(d.lmf_f), lmf_q: j.lmf_q.unwrap_or(d.lmf_q), hmf: j.hmf.unwrap_or(0.0), hmf_f: j.hmf_f.unwrap_or(d.hmf_f), hmf_q: j.hmf_q.unwrap_or(d.hmf_q),
            hf: j.hf.unwrap_or(0.0), hf_f: j.hf_f.unwrap_or(d.hf_f), hf_bell: b(j.hf_bell, false), eq: b(j.eq, true), variant: j.variant.map_or(0, |v| (v.round().max(0.0) as usize).min(1)),
            cthr: j.cthr.unwrap_or(d.cthr), cratio: j.cratio.unwrap_or(d.cratio), crel: j.crel.unwrap_or(d.crel), cfast: b(j.cfast, false),
            gthr: j.gthr.unwrap_or(d.gthr), grange: j.grange.unwrap_or(d.grange), grel: j.grel.unwrap_or(d.grel), dyn_pre: b(j.dyn_pre, false), output: j.output.unwrap_or(0.0) }
    }
}
impl StripEParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k {
            "hpf" => self.hpf = v, "lpf" => self.lpf = v, "lf" => self.lf = v, "lfF" => self.lf_f = v, "lfBell" => self.lf_bell = v >= 0.5,
            "lmf" => self.lmf = v, "lmfF" => self.lmf_f = v, "lmfQ" => self.lmf_q = v, "hmf" => self.hmf = v, "hmfF" => self.hmf_f = v, "hmfQ" => self.hmf_q = v,
            "hf" => self.hf = v, "hfF" => self.hf_f = v, "hfBell" => self.hf_bell = v >= 0.5, "eq" => self.eq = v >= 0.5, "variant" => self.variant = (v.round().max(0.0) as usize).min(1),
            "cthr" => self.cthr = v, "cratio" => self.cratio = v, "crel" => self.crel = v, "cfast" => self.cfast = v >= 0.5,
            "gthr" => self.gthr = v, "grange" => self.grange = v, "grel" => self.grel = v, "dynPre" => self.dyn_pre = v >= 0.5, "output" => self.output = v,
            _ => return false }
        true
    }
}
/// Marge de la voie de console (−20 dB : elle ne chauffe qu'à peine, comme la vraie)
const HRE: f64 = 0.1;

pub struct StripE {
    sr: f64,
    filt: Vec<[Biquad; 2]>,
    eq: Vec<[Biquad; 2]>,
    dyn_pre: bool,
    // compresseur
    cthr: f64, cslope: f64, catt: f64, crel: f64, cgr: f64, con: bool,
    // gate
    gthr: f64, gfloor: f64, grel: f64, gatt: f64, gg: f64, gon: bool, ghold: usize, gcount: usize,
    gout: f64,
    os: [Os4; 2],
}
impl StripE {
    pub const LATENCY: usize = 31;
    pub fn new(p: &StripEParams, sr: f64) -> Self {
        let mut s = Self { sr, filt: Vec::new(), eq: Vec::new(), dyn_pre: false, cthr: 10.0, cslope: 0.0, catt: 0.0, crel: 0.0, cgr: 0.0, con: false,
            gthr: -80.0, gfloor: 1.0, grel: 0.0, gatt: 0.0, gg: 1.0, gon: false, ghold: 0, gcount: 0, gout: 1.0, os: [Os4::new(), Os4::new()] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &StripEParams) {
        let sr = self.sr;
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        let mut filt: Vec<Biquad> = Vec::new();
        if p.hpf >= 16.0 { let f = p.hpf.min(350.0); filt.push(eq_matched("highpass", f, 1.0, 0.0, sr)); filt.push(Biquad::highpass(sr, f, 0.0)); }
        if p.lpf < 21.9 { filt.push(eq_matched("lowpass", p.lpf.clamp(3.0, 22.0) * 1000.0, 0.707, 0.0, sr)); }
        let mut eq: Vec<Biquad> = Vec::new();
        if p.eq {
            let noir = p.variant == 1;
            // Noir : largeur proportionnelle (plus on pousse, plus la cloche se resserre)
            let pq = |q: f64, g: f64| if noir { q * (1.0 + g.abs() / 10.0) } else { q };
            if p.lf.abs() > 1e-6 { let f = p.lf_f.clamp(30.0, 450.0); let g = p.lf.clamp(-16.5, 16.5); eq.push(if p.lf_bell { eq_matched("peaking", f, pq(0.8, g), g, sr) } else { eq_matched("lowshelf", f, 0.7, g, sr) }); }
            if p.lmf.abs() > 1e-6 { let g = p.lmf.clamp(-15.0, 15.0); eq.push(eq_matched("peaking", p.lmf_f.clamp(200.0, 2500.0), pq(p.lmf_q.clamp(0.5, 2.5), g), g, sr)); }
            if p.hmf.abs() > 1e-6 { let g = p.hmf.clamp(-15.0, 15.0); eq.push(eq_matched("peaking", p.hmf_f.clamp(600.0, 7000.0), pq(p.hmf_q.clamp(0.5, 2.5), g), g, sr)); }
            if p.hf.abs() > 1e-6 { let f = p.hf_f.clamp(1500.0, 16000.0); let g = p.hf.clamp(-16.5, 16.5); eq.push(if p.hf_bell { eq_matched("peaking", f, pq(0.8, g), g, sr) } else { eq_matched("highshelf", f, 0.7, g, sr) }); }
        }
        let keep = |old: &mut Vec<[Biquad; 2]>, new: Vec<Biquad>| { if old.len() == new.len() { for (a, n) in old.iter_mut().zip(new) { a[0].retune(n); a[1].retune(n); } } else { *old = new.into_iter().map(|b| [b, b]).collect(); } };
        keep(&mut self.filt, filt);
        keep(&mut self.eq, eq);
        self.dyn_pre = p.dyn_pre;
        // compresseur : ratio 1 (rien) à 20 (au bout : l'infini)
        let r = p.cratio.clamp(1.0, 20.0);
        self.con = r > 1.0 + 1e-6 && p.cthr < 10.0;
        self.cslope = if r >= 19.99 { 1.0 } else { 1.0 - 1.0 / r };
        self.cthr = p.cthr.clamp(-30.0, 10.0);
        self.catt = co(if p.cfast { 0.001 } else { 0.003 });
        self.crel = co(p.crel.clamp(0.1, 4.0));
        // gate : seuil (−80 = éteint), profondeur (dB), relâchement ; attaque 0,1 ms, maintien 20 ms
        self.gon = p.gthr > -79.9;
        self.gthr = 10f64.powf(p.gthr.clamp(-80.0, 0.0) / 20.0);
        self.gfloor = 10f64.powf(-p.grange.clamp(0.0, 40.0) / 20.0);
        self.grel = co(p.grel.clamp(0.1, 4.0));
        self.gatt = co(0.0001);
        self.ghold = (0.02 * sr) as usize;
        self.gout = 10f64.powf(p.output.clamp(-20.0, 20.0) / 20.0);
    }
    pub fn reduction(&self) -> f64 { self.cgr }
    fn dynamics(&mut self, x: &mut [f64; 2], nc: usize) {
        let mut pk = 0.0f64;
        for ch in 0..nc { pk = pk.max(x[ch].abs()); }
        if self.gon {
            if pk > self.gthr { self.gcount = self.ghold; }
            let target = if self.gcount > 0 { self.gcount -= 1; 1.0 } else { self.gfloor };
            self.gg += (target - self.gg) * if target > self.gg { self.gatt } else { self.grel };
        } else { self.gg = 1.0; }
        if self.con {
            let over = 20.0 * (pk + 1e-12).log10() - self.cthr;
            // genou doux de 6 dB
            let want = if over <= -3.0 { 0.0 } else if over >= 3.0 { over * self.cslope } else { self.cslope * (over + 3.0).powi(2) / 12.0 };
            self.cgr += (want - self.cgr) * if want > self.cgr { self.catt } else { self.crel };
        } else { self.cgr = 0.0; }
        let g = self.gg * 10f64.powf(-self.cgr / 20.0);
        for ch in 0..nc { x[ch] *= g; }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        if self.dyn_pre { self.dynamics(x, nc); }
        for ch in 0..nc {
            let mut v = x[ch];
            for b in self.filt.iter_mut() { v = b[ch].tick(v); }
            for b in self.eq.iter_mut() { v = b[ch].tick(v); }
            x[ch] = v;
        }
        if !self.dyn_pre { self.dynamics(x, nc); }
        for ch in 0..nc {
            // étage de sortie de la voie : très propre, il n'arrondit que les crêtes extrêmes
            x[ch] = self.os[ch].run(x[ch], |u| (u * HRE).tanh() / HRE) * self.gout;
        }
    }
}

// ===== EQ 550 : égaliseur à crans 3 bandes (esprit « 550 ») =====
// Comme la machine : trois bandes à crans de 2 dB (±12), fréquences fixes, graves et aigus en plateau ou en cloche, filtre de bande
// (coupe-bas 50 Hz + coupe-haut 15 kHz). Largeur « proportionnelle » : douce quand on touche à peine, serrée quand on pousse fort
// — c'est le son « américain », punchy, des médiums en avant. L'ampli de sortie (discret) colore un peu.
pub const E550_LF: [f64; 5] = [50.0, 100.0, 200.0, 300.0, 400.0];
pub const E550_MF: [f64; 5] = [400.0, 800.0, 1_500.0, 3_000.0, 5_000.0];
pub const E550_HF: [f64; 6] = [2_500.0, 5_000.0, 7_500.0, 10_000.0, 12_500.0, 15_000.0];

#[derive(Clone, Debug)]
pub struct Eq550Params {
    pub lf: f64, pub lf_f: usize, pub lf_peak: bool,
    pub mf: f64, pub mf_f: usize,
    pub hf: f64, pub hf_f: usize, pub hf_peak: bool,
    pub band: bool,
    pub on: bool,
    pub output: f64,
}
impl Default for Eq550Params {
    fn default() -> Self { Self { lf: 0.0, lf_f: 1, lf_peak: false, mf: 0.0, mf_f: 2, hf: 0.0, hf_f: 3, hf_peak: false, band: false, on: true, output: 0.0 } }
}
impl From<&crate::model::Eq550Json> for Eq550Params {
    fn from(j: &crate::model::Eq550Json) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        let b = |v: Option<f64>, def: bool| v.map_or(def, |v| v >= 0.5);
        Self { lf: j.lf.unwrap_or(0.0), lf_f: idx(j.lf_f, d.lf_f, 4), lf_peak: b(j.lf_peak, false), mf: j.mf.unwrap_or(0.0), mf_f: idx(j.mf_f, d.mf_f, 4),
            hf: j.hf.unwrap_or(0.0), hf_f: idx(j.hf_f, d.hf_f, 5), hf_peak: b(j.hf_peak, false), band: b(j.band, false), on: b(j.on, true), output: j.output.unwrap_or(0.0) }
    }
}
impl Eq550Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "lf" => self.lf = v, "mf" => self.mf = v, "hf" => self.hf = v, "output" => self.output = v, "lfF" => self.lf_f = ix(v, 4), "mfF" => self.mf_f = ix(v, 4),
            "hfF" => self.hf_f = ix(v, 5), "lfPeak" => self.lf_peak = v >= 0.5, "hfPeak" => self.hf_peak = v >= 0.5, "band" => self.band = v >= 0.5, "on" => self.on = v >= 0.5, _ => return false }
        true
    }
}
/// Marge de l'ampli discret (−16 dB) et son fer
const HR550: f64 = 0.158_489_319_246_111_35;
const IRON550: f64 = 0.04;

pub struct Eq550 {
    gout: f64,
    eq: Vec<[Biquad; 2]>,
    os: [Os4; 2],
    iron: [Iron; 2],
    ik: (f64, f64),
    dc: [(f64, f64); 2],
    sr: f64,
}
impl Eq550 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &Eq550Params, sr: f64) -> Self {
        let mut s = Self { gout: 1.0, eq: Vec::new(), os: [Os4::new(), Os4::new()], iron: [Iron::default(); 2], ik: iron_k(sr), dc: [(0.0, 0.0); 2], sr };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &Eq550Params) {
        let sr = self.sr;
        // largeur proportionnelle : Q = 0,5 à peine touché … ≈ 1,9 à ±12
        let q = |g: f64| 0.5 + 0.12 * g.abs();
        let mut eq: Vec<Biquad> = Vec::new();
        if p.on {
            let g = p.lf.clamp(-12.0, 12.0);
            if g.abs() > 1e-6 { let f = E550_LF[p.lf_f.min(4)]; eq.push(if p.lf_peak { eq_matched("peaking", f, q(g), g, sr) } else { eq_matched("lowshelf", f, 0.7, g, sr) }); }
            let g = p.mf.clamp(-12.0, 12.0);
            if g.abs() > 1e-6 { eq.push(eq_matched("peaking", E550_MF[p.mf_f.min(4)], q(g), g, sr)); }
            let g = p.hf.clamp(-12.0, 12.0);
            if g.abs() > 1e-6 { let f = E550_HF[p.hf_f.min(5)]; eq.push(if p.hf_peak { eq_matched("peaking", f, q(g), g, sr) } else { eq_matched("highshelf", f, 0.7, g, sr) }); }
            if p.band { eq.push(eq_matched("highpass", 50.0, 0.707, 0.0, sr)); eq.push(eq_matched("lowpass", 15_000.0, 0.707, 0.0, sr)); }
        }
        if self.eq.len() == eq.len() { for (a, n) in self.eq.iter_mut().zip(eq) { a[0].retune(n); a[1].retune(n); } } else { self.eq = eq.into_iter().map(|b| [b, b]).collect(); }
        self.gout = 10f64.powf(p.output.clamp(-12.0, 12.0) / 20.0);
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let mut v = x[ch];
            for b in self.eq.iter_mut() { v = b[ch].tick(v); }
            let (iron, dc) = (&mut self.iron[ch], &mut self.dc[ch]);
            let y = self.os[ch].run(v, |u| {
                // ampli discret : un peu d'harmonique 2 et 3 (le « punch »), transfo de sortie
                let c = u * HR550;
                let c = c + 0.03 * c * c / HR550 * 0.1;
                iron.run((1.2 * c).tanh() / 1.2, iw, il, IRON550) / HR550
            });
            let o = y - dc.0 + 0.9998 * dc.1;
            *dc = (y, o);
            x[ch] = o * self.gout;
        }
    }
}

// ===== Comp 25 : compresseur de bus « américain » (esprit « 25 ») =====
// Comme la machine : Seuil, sept ratios (1,5 à l'infini), attaques 0,03 à 30 ms, relâchements 0,05 à 2 s ou Variable,
// Genou (franc, moyen, doux), Poussée (le grave fait de moins en moins réagir le détecteur : le mix pompe moins et garde son poids),
// Type : en avant (moderne, net) ou en contre-réaction (ancien, plus doux), Gain ; et la touche Pulse : Mélange.
pub const C25_RATIO: [f64; 7] = [1.5, 2.0, 3.0, 4.0, 6.0, 10.0, 60.0];
pub const C25_ATT: [f64; 7] = [0.00003, 0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03];
pub const C25_REL: [f64; 6] = [0.05, 0.1, 0.2, 0.5, 1.0, 2.0];

#[derive(Clone, Debug)]
pub struct Comp25Params {
    pub thr: f64,
    pub ratio: usize,
    pub attack: usize,
    /// index C25_REL, 6 = Variable (rel_var en s)
    pub release: usize,
    pub rel_var: f64,
    /// 0 franc, 1 moyen, 2 doux
    pub knee: usize,
    /// 0 normale, 1 moyenne, 2 forte
    pub thrust: usize,
    /// en contre-réaction (sinon en avant)
    pub feedback: bool,
    pub makeup: f64,
    pub mix: f64,
}
impl Default for Comp25Params {
    fn default() -> Self { Self { thr: -10.0, ratio: 3, attack: 3, release: 3, rel_var: 0.3, knee: 1, thrust: 1, feedback: false, makeup: 0.0, mix: 100.0 } }
}
impl From<&crate::model::Comp25Json> for Comp25Params {
    fn from(j: &crate::model::Comp25Json) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        Self { thr: j.thr.unwrap_or(d.thr), ratio: idx(j.ratio, d.ratio, 6), attack: idx(j.attack, d.attack, 6), release: idx(j.release, d.release, 6), rel_var: j.rel_var.unwrap_or(d.rel_var),
            knee: idx(j.knee, d.knee, 2), thrust: idx(j.thrust, d.thrust, 2), feedback: j.feedback.unwrap_or(0.0) >= 0.5, makeup: j.makeup.unwrap_or(0.0), mix: j.mix.unwrap_or(100.0) }
    }
}
impl Comp25Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "thr" => self.thr = v, "makeup" => self.makeup = v, "mix" => self.mix = v, "relVar" => self.rel_var = v, "ratio" => self.ratio = ix(v, 6), "attack" => self.attack = ix(v, 6),
            "release" => self.release = ix(v, 6), "knee" => self.knee = ix(v, 2), "thrust" => self.thrust = ix(v, 2), "feedback" => self.feedback = v >= 0.5, _ => return false }
        true
    }
}

pub struct Comp25 {
    sr: f64,
    thr: f64,
    ratio: f64,
    knee: f64,
    att: f64,
    rel: f64,
    fb: bool,
    tk: f64,
    gmk: f64,
    mix: f64,
    gr: f64,
    lp: [f64; 2],
    lpa: f64,
    os: [Os4; 2],
    iron: [Iron; 2],
    ik: (f64, f64),
    dc: [(f64, f64); 2],
    dry: [[f64; 40]; 2],
}
impl Comp25 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &Comp25Params, sr: f64) -> Self {
        let mut s = Self { sr, thr: -10.0, ratio: 3.0, knee: 6.0, att: 0.0, rel: 0.0, fb: false, tk: 0.0, gmk: 1.0, mix: 1.0, gr: 0.0, lp: [0.0; 2],
            lpa: 1.0 - (-2.0 * PI * 200.0 / sr).exp(), os: [Os4::new(), Os4::new()], iron: [Iron::default(); 2], ik: iron_k(sr), dc: [(0.0, 0.0); 2], dry: [[0.0; 40]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &Comp25Params) {
        let sr = self.sr;
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        self.thr = p.thr.clamp(-20.0, 10.0);
        self.ratio = C25_RATIO[p.ratio.min(6)];
        self.knee = [0.0, 6.0, 12.0][p.knee.min(2)];
        self.att = co(C25_ATT[p.attack.min(6)]);
        self.rel = co(if p.release >= 6 { p.rel_var.clamp(0.05, 3.0) } else { C25_REL[p.release] });
        self.fb = p.feedback;
        self.tk = [0.0, 0.5, 0.85][p.thrust.min(2)];
        self.gmk = 10f64.powf(p.makeup.clamp(0.0, 20.0) / 20.0);
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    /// réduction voulue pour un dépassement : en avant pente 1 − 1/r ; en contre-réaction (r − 1) × dépassement de sortie
    fn curve(&self, over: f64) -> f64 {
        let s = if self.fb { self.ratio - 1.0 } else { 1.0 - 1.0 / self.ratio };
        let k = self.knee;
        if k <= 0.0 { return over.max(0.0) * s; }
        if over <= -k / 2.0 { 0.0 } else if over >= k / 2.0 { over * s } else { s * (over + k / 2.0).powi(2) / (2.0 * k) }
    }
    pub fn reduction(&self) -> f64 { self.gr }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        // détecteur : la Poussée retire une part du grave (sous 200 Hz) avant de mesurer
        let mut pk = 0.0f64;
        for ch in 0..nc {
            self.lp[ch] += (x[ch] - self.lp[ch]) * self.lpa;
            pk = pk.max((x[ch] - self.tk * self.lp[ch]).abs());
        }
        let lvl = 20.0 * (pk + 1e-12).log10() - if self.fb { self.gr } else { 0.0 };
        let want = self.curve(lvl - self.thr);
        let a = if self.fb { self.att / self.ratio } else { self.att };
        self.gr += (want - self.gr) * if want > self.gr { a } else { self.rel };
        let g = 10f64.powf(-self.gr / 20.0) * self.gmk;
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let iron = &mut self.iron[ch];
            let y = self.os[ch].run(x[ch] * g, |u| {
                let c = u * HR550;
                let c = c + 0.03 * c * c / HR550 * 0.1;
                iron.run((1.2 * c).tanh() / 1.2, iw, il, IRON550) / HR550
            });
            let (xp, yp) = self.dc[ch];
            let o = y - xp + 0.9998 * yp;
            self.dc[ch] = (y, o);
            let d = &mut self.dry[ch];
            d.copy_within(0..39, 1);
            d[0] = x[ch];
            x[ch] = if self.mix < 1.0 { d[Self::LATENCY] + (o - d[Self::LATENCY]) * self.mix } else { o };
        }
    }
}

// ===== Bus 33 : compresseur-limiteur de bus à pont de diodes (esprit « 33 ») =====
// Comme la machine : une partie Compresseur (seuil, ratios 1,5 à 6, retour 100 ms à 1,5 s ou Auto A1 / A2) et une partie
// Limiteur (seuil, retour, attaque rapide), chacune en service ou non, et le gain. Le pont de diodes ajoute de l'harmonique 3
// quand il réduit ; les transfos donnent le grave rond. Rond, le mix tient sans se voir.
pub const B33_RATIO: [f64; 5] = [1.5, 2.0, 3.0, 4.0, 6.0];
/// retours : 0,1 / 0,4 / 0,8 / 1,5 s, A1 (40 ms → 2 s), A2 (150 ms → 5 s)
pub const B33_REC: [f64; 4] = [0.1, 0.4, 0.8, 1.5];
pub const B33_LREC: [f64; 4] = [0.05, 0.1, 0.2, 0.8];

#[derive(Clone, Debug)]
pub struct Bus33Params {
    pub con: bool, pub cthr: f64, pub cratio: usize, pub crec: usize,
    pub lon: bool, pub lthr: f64, pub lrec: usize,
    pub makeup: f64, pub mix: f64,
}
impl Default for Bus33Params {
    fn default() -> Self { Self { con: true, cthr: -10.0, cratio: 1, crec: 4, lon: false, lthr: -2.0, lrec: 1, makeup: 0.0, mix: 100.0 } }
}
impl From<&crate::model::Bus33Json> for Bus33Params {
    fn from(j: &crate::model::Bus33Json) -> Self {
        let d = Self::default();
        let idx = |v: Option<f64>, def: usize, max: usize| v.map_or(def, |v| (v.round().max(0.0) as usize).min(max));
        let b = |v: Option<f64>, def: bool| v.map_or(def, |v| v >= 0.5);
        Self { con: b(j.con, true), cthr: j.cthr.unwrap_or(d.cthr), cratio: idx(j.cratio, d.cratio, 4), crec: idx(j.crec, d.crec, 5),
            lon: b(j.lon, false), lthr: j.lthr.unwrap_or(d.lthr), lrec: idx(j.lrec, d.lrec, 5), makeup: j.makeup.unwrap_or(0.0), mix: j.mix.unwrap_or(100.0) }
    }
}
impl Bus33Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k { "cthr" => self.cthr = v, "lthr" => self.lthr = v, "makeup" => self.makeup = v, "mix" => self.mix = v, "con" => self.con = v >= 0.5, "lon" => self.lon = v >= 0.5,
            "cratio" => self.cratio = ix(v, 4), "crec" => self.crec = ix(v, 5), "lrec" => self.lrec = ix(v, 5), _ => return false }
        true
    }
}
const HR33: f64 = 0.158_489_319_246_111_35;

pub struct Bus33 {
    sr: f64,
    con: bool, cthr: f64, cratio: f64, catt: f64, crf: f64, crs: f64, cauto: bool, cgr: f64, cslow: f64,
    lon: bool, lthr: f64, latt: f64, lrf: f64, lrs: f64, lauto: bool, lgr: f64, lslow: f64,
    gmk: f64, mix: f64,
    os: [Os4; 2],
    iron: [[Iron; 2]; 2],
    ik: (f64, f64),
    dc: [(f64, f64); 2],
    dry: [[f64; 40]; 2],
}
impl Bus33 {
    pub const LATENCY: usize = 31;
    pub fn new(p: &Bus33Params, sr: f64) -> Self {
        let mut s = Self { sr, con: true, cthr: -10.0, cratio: 2.0, catt: 0.0, crf: 0.0, crs: 0.0, cauto: true, cgr: 0.0, cslow: 0.0,
            lon: false, lthr: -2.0, latt: 0.0, lrf: 0.0, lrs: 0.0, lauto: false, lgr: 0.0, lslow: 0.0, gmk: 1.0, mix: 1.0,
            os: [Os4::new(), Os4::new()], iron: [[Iron::default(); 2]; 2], ik: iron_k(sr), dc: [(0.0, 0.0); 2], dry: [[0.0; 40]; 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &Bus33Params) {
        let sr = self.sr;
        let co = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        let rec = |i: usize, tab: &[f64; 4]| -> (f64, f64, bool) { match i { 4 => (0.04, 2.0, true), 5 => (0.15, 5.0, true), _ => (tab[i.min(3)], tab[i.min(3)], false) } };
        self.con = p.con; self.cthr = p.cthr.clamp(-20.0, 10.0); self.cratio = B33_RATIO[p.cratio.min(4)];
        self.catt = co(0.005);
        let (f, sl, a) = rec(p.crec, &B33_REC); self.crf = co(f); self.crs = co(sl); self.cauto = a;
        self.lon = p.lon; self.lthr = p.lthr.clamp(-12.0, 0.0); self.latt = co(0.002);
        let (f, sl, a) = rec(p.lrec, &B33_LREC); self.lrf = co(f); self.lrs = co(sl); self.lauto = a;
        self.gmk = 10f64.powf(p.makeup.clamp(0.0, 20.0) / 20.0);
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    pub fn reduction(&self) -> f64 { self.cgr + self.lgr }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let mut pk = 0.0f64;
        for ch in 0..nc { pk = pk.max(x[ch].abs()); }
        let lin = 20.0 * (pk + 1e-12).log10();
        // compresseur : contre-réaction, genou doux 8 dB
        if self.con {
            let over = lin - self.cgr - self.cthr;
            let s = self.cratio - 1.0;
            let want = if over <= -4.0 { 0.0 } else if over >= 4.0 { over * s } else { s * (over + 4.0).powi(2) / 16.0 };
            if want > self.cgr { self.cgr += (want - self.cgr) * self.catt / self.cratio; }
            else { let r = if self.cauto && self.cslow > 0.7 * self.cgr { self.crs } else { self.crf }; self.cgr += (want - self.cgr) * r; }
            self.cslow += (self.cgr - self.cslow) * self.crs * 0.5;
        } else { self.cgr = 0.0; }
        // limiteur : en avant, presque tout écraser au-dessus de son seuil (après le compresseur)
        if self.lon {
            let over = lin - self.cgr - self.lthr;
            let want = if over > 0.0 { over * 0.95 } else { 0.0 };
            if want > self.lgr { self.lgr += (want - self.lgr) * self.latt; }
            else { let r = if self.lauto && self.lslow > 0.7 * self.lgr { self.lrs } else { self.lrf }; self.lgr += (want - self.lgr) * r; }
            self.lslow += (self.lgr - self.lslow) * self.lrs * 0.5;
        } else { self.lgr = 0.0; }
        let gr = self.cgr + self.lgr;
        let g = 10f64.powf(-gr / 20.0);
        let h3 = 0.03 + 0.12 * (1.0 - g);
        let gm = self.gmk;
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let iron = &mut self.iron[ch];
            let y = self.os[ch].run(x[ch], |u| {
                // transfo d'entrée, pont de diodes (harmonique 3 qui monte avec la réduction), gain, transfo de sortie
                let v = iron[0].run(u * HR33, iw, il, 0.05) * g;
                let c = v - h3 * v * v * v / (HR33 * HR33) * 0.05;
                iron[1].run((1.1 * c * gm).tanh() / 1.1, iw, il, 0.05) / HR33
            });
            let (xp, yp) = self.dc[ch];
            let o = y - xp + 0.9998 * yp;
            self.dc[ch] = (y, o);
            let d = &mut self.dry[ch];
            d.copy_within(0..39, 1);
            d[0] = x[ch];
            x[ch] = if self.mix < 1.0 { d[Self::LATENCY] + (o - d[Self::LATENCY]) * self.mix } else { o };
        }
    }
}

// ===== EQ Massif : égaliseur à lampes de mastering (esprit « Massif ») =====
// Comme la machine : quatre bandes très larges qui se chevauchent (1 : 22 Hz-1 kHz, 2 : 82 Hz-3,9 kHz, 3 : 220 Hz-10 kHz, 4 : 560 Hz-27 kHz),
// chacune avec gain (±20 dB), fréquence et largeur ; les bandes 1 et 4 en plateau ou en cloche (le plateau fait une petite bosse :
// passif). Coupe-bas (22/39/68/120 Hz) et coupe-haut (18/12/8,2/6,8 kHz), étage à lampe pour rattraper le niveau. L'air du mastering.
pub const MAS_RANGE: [(f64, f64); 4] = [(22.0, 1_000.0), (82.0, 3_900.0), (220.0, 10_000.0), (560.0, 27_000.0)];
pub const MAS_HPF: [f64; 4] = [22.0, 39.0, 68.0, 120.0];
pub const MAS_LPF: [f64; 4] = [18_000.0, 12_000.0, 8_200.0, 6_800.0];

#[derive(Clone, Debug)]
pub struct MassifParams {
    /// par bande : gain (dB), fréquence (Hz), largeur 0 (large) à 10 (serrée), plateau (bandes 1 et 4)
    pub g: [f64; 4],
    pub f: [f64; 4],
    pub bw: [f64; 4],
    pub shelf1: bool,
    pub shelf4: bool,
    /// coupe-bas / coupe-haut : −1 = éteint, sinon index
    pub hpf: i32,
    pub lpf: i32,
    pub on: bool,
    pub output: f64,
}
impl Default for MassifParams {
    fn default() -> Self { Self { g: [0.0; 4], f: [100.0, 500.0, 2_500.0, 12_000.0], bw: [5.0; 4], shelf1: true, shelf4: true, hpf: -1, lpf: -1, on: true, output: 0.0 } }
}
impl From<&crate::model::MassifJson> for MassifParams {
    fn from(j: &crate::model::MassifJson) -> Self {
        let d = Self::default();
        let o = |v: Option<f64>, def: f64| v.unwrap_or(def);
        let b = |v: Option<f64>, def: bool| v.map_or(def, |v| v >= 0.5);
        Self { g: [o(j.g1, 0.0), o(j.g2, 0.0), o(j.g3, 0.0), o(j.g4, 0.0)], f: [o(j.f1, d.f[0]), o(j.f2, d.f[1]), o(j.f3, d.f[2]), o(j.f4, d.f[3])],
            bw: [o(j.bw1, 5.0), o(j.bw2, 5.0), o(j.bw3, 5.0), o(j.bw4, 5.0)], shelf1: b(j.shelf1, true), shelf4: b(j.shelf4, true),
            hpf: j.hpf.map_or(-1, |v| (v.round() as i32).clamp(-1, 3)), lpf: j.lpf.map_or(-1, |v| (v.round() as i32).clamp(-1, 3)), on: b(j.on, true), output: o(j.output, 0.0) }
    }
}
impl MassifParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let n = |s: &str| s[1..].parse::<usize>().ok().filter(|i| (1..=4).contains(i)).map(|i| i - 1);
        match k {
            "shelf1" => self.shelf1 = v >= 0.5, "shelf4" => self.shelf4 = v >= 0.5, "on" => self.on = v >= 0.5, "output" => self.output = v,
            "hpf" => self.hpf = (v.round() as i32).clamp(-1, 3), "lpf" => self.lpf = (v.round() as i32).clamp(-1, 3),
            _ if k.starts_with('g') && n(k).is_some() => self.g[n(k).unwrap()] = v,
            _ if k.starts_with('f') && n(k).is_some() => self.f[n(k).unwrap()] = v,
            _ if k.starts_with("bw") && k[1..].starts_with('w') => { if let Ok(i) = k[2..].parse::<usize>() { if (1..=4).contains(&i) { self.bw[i - 1] = v; } } }
            _ => return false }
        true
    }
}
const HRM: f64 = 0.125_892_541_179_416_72;

pub struct Massif {
    sr: f64,
    eq: Vec<[Biquad; 2]>,
    gout: f64,
    os: [Os4; 2],
    iron: [Iron; 2],
    ik: (f64, f64),
    dc: [(f64, f64); 2],
}
impl Massif {
    pub const LATENCY: usize = 31;
    pub fn new(p: &MassifParams, sr: f64) -> Self {
        let mut s = Self { sr, eq: Vec::new(), gout: 1.0, os: [Os4::new(), Os4::new()], iron: [Iron::default(); 2], ik: iron_k(sr), dc: [(0.0, 0.0); 2] };
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &MassifParams) {
        let sr = self.sr;
        let mut eq: Vec<Biquad> = Vec::new();
        if p.hpf >= 0 { eq.push(eq_matched("highpass", MAS_HPF[p.hpf as usize], 0.707, 0.0, sr)); }
        if p.lpf >= 0 { eq.push(eq_matched("lowpass", MAS_LPF[p.lpf as usize], 0.707, 0.0, sr)); }
        if p.on {
            for i in 0..4 {
                let g = p.g[i].clamp(-20.0, 20.0);
                if g.abs() < 1e-6 { continue; }
                let (lo, hi) = MAS_RANGE[i];
                let f = p.f[i].clamp(lo, hi);
                let bw = p.bw[i].clamp(0.0, 10.0);
                let shelf = (i == 0 && p.shelf1) || (i == 3 && p.shelf4);
                eq.push(if shelf {
                    // plateau passif : un peu de bosse (Q > 0,7) qui grandit quand on serre la largeur
                    eq_matched(if i == 0 { "lowshelf" } else { "highshelf" }, f, 0.6 + 0.06 * bw, g, sr)
                } else { eq_matched("peaking", f, 0.3 * 10f64.powf(bw / 10.0), g, sr) });
            }
        }
        if self.eq.len() == eq.len() { for (a, n) in self.eq.iter_mut().zip(eq) { a[0].retune(n); a[1].retune(n); } } else { self.eq = eq.into_iter().map(|b| [b, b]).collect(); }
        self.gout = 10f64.powf(p.output.clamp(-12.0, 12.0) / 20.0);
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (iw, il) = self.ik;
        for ch in 0..nc {
            let mut v = x[ch];
            for b in self.eq.iter_mut() { v = b[ch].tick(v); }
            let (iron, dc) = (&mut self.iron[ch], &mut self.dc[ch]);
            let y = self.os[ch].run(v, |u| {
                let c = u * HRM;
                let c = c + 0.08 * c * c;
                iron.run((1.1 * c).tanh() / 1.1, iw, il, 0.03) / HRM
            });
            let o = y - dc.0 + 0.9998 * dc.1;
            *dc = (y, o);
            x[ch] = o * self.gout;
        }
    }
}

// ===== Plaque 140 : réverbe à plaque (esprit « 140 ») =====
// Une plaque d'acier tendue qui vibre : départ très dense, brillant, sans « pièce » ; le registre (amortisseur) règle la durée.
// Algorithme de J. Dattorro (« Effect Design », 1997), pensé justement d'après une plaque : diffuseurs d'entrée puis un réservoir
// à deux branches croisées (diffuseurs modulés, retards, amortissement des aigus). Réglages : Durée (0,4-6 s), Pré-délai,
// Brillance, Coupe-bas d'entrée, Largeur, Mélange ; variantes Claire (plaque neuve) et Chaude (plaque ancienne, aigus plus amortis).
const PLATE_FS: f64 = 29_761.0;
#[derive(Clone, Debug)]
pub struct PlateParams { pub decay: f64, pub pre: f64, pub bright: f64, pub lowcut: f64, pub width: f64, pub mix: f64, pub variant: usize }
impl Default for PlateParams {
    fn default() -> Self { Self { decay: 2.0, pre: 20.0, bright: 60.0, lowcut: 100.0, width: 100.0, mix: 25.0, variant: 0 } }
}
impl From<&crate::model::PlateJson> for PlateParams {
    fn from(j: &crate::model::PlateJson) -> Self {
        let d = Self::default();
        Self { decay: j.decay.unwrap_or(d.decay), pre: j.pre.unwrap_or(d.pre), bright: j.bright.unwrap_or(d.bright), lowcut: j.lowcut.unwrap_or(d.lowcut),
            width: j.width.unwrap_or(d.width), mix: j.mix.unwrap_or(d.mix), variant: j.variant.map_or(0, |v| (v.round().max(0.0) as usize).min(1)) }
    }
}
impl PlateParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "decay" => self.decay = v, "pre" => self.pre = v, "bright" => self.bright = v, "lowcut" => self.lowcut = v, "width" => self.width = v, "mix" => self.mix = v,
            "variant" => self.variant = (v.round().max(0.0) as usize).min(1), _ => return false }
        true
    }
}
/// Ligne de retard circulaire (lecture entière ou interpolée)
#[derive(Clone)]
struct Dl { b: Vec<f64>, i: usize }
impl Dl {
    fn new(n: usize) -> Self { Self { b: vec![0.0; n.max(2)], i: 0 } }
    fn push(&mut self, v: f64) { self.i = (self.i + 1) % self.b.len(); self.b[self.i] = v; }
    /// valeur d'il y a `d` échantillons (0 = la dernière écrite)
    fn at(&self, d: usize) -> f64 { let n = self.b.len(); self.b[(self.i + n - d.min(n - 1)) % n] }
    fn atf(&self, d: f64) -> f64 { let d = d.clamp(0.0, (self.b.len() - 2) as f64); let i0 = d.floor(); let f = d - i0; let a = self.at(i0 as usize); let b = self.at(i0 as usize + 1); a + (b - a) * f }
}
/// Passe-tout de Schroeder : sortie = −g·x + retard ; retard ← x + g·sortie
#[derive(Clone)]
struct Ap { d: Dl, n: usize }
impl Ap {
    fn new(n: usize) -> Self { Self { d: Dl::new(n + 2), n } }
    fn run(&mut self, x: f64, g: f64) -> f64 { let z = self.d.at(self.n - 1); let w = x + g * z; let y = z - g * w; self.d.push(w); y }
    fn run_mod(&mut self, x: f64, g: f64, dm: f64) -> f64 { let z = self.d.atf(self.n as f64 - 1.0 + dm); let w = x + g * z; let y = z - g * w; self.d.push(w); y }
    fn tap(&self, k: usize) -> f64 { self.d.at(k) }
}
pub struct Plate {
    sr: f64, sc: f64,
    pre: Dl, pre_n: usize,
    hp: (f64, f64), hpa: f64,
    bw: f64, bwz: f64,
    ap_in: [Ap; 4],
    lap1: Ap, ld1: Dl, lap2: Ap, ld2: Dl, ldz: f64,
    rap1: Ap, rd1: Dl, rap2: Ap, rd2: Dl, rdz: f64,
    decay: f64, damp: f64, ph: f64, exc: f64,
    width: f64, mix: f64,
    lfb: f64, rfb: f64,
}
impl Plate {
    pub fn new(p: &PlateParams, sr: f64) -> Self {
        let sc = sr / PLATE_FS;
        let n = |v: f64| (v * sc).round() as usize;
        let mut s = Self { sr, sc, pre: Dl::new((0.25 * sr) as usize + 4), pre_n: 0, hp: (0.0, 0.0), hpa: 0.0, bw: 0.9995, bwz: 0.0,
            ap_in: [Ap::new(n(142.0)), Ap::new(n(107.0)), Ap::new(n(379.0)), Ap::new(n(277.0))],
            lap1: Ap::new(n(672.0) + 40), ld1: Dl::new(n(4453.0) + 2), lap2: Ap::new(n(1800.0)), ld2: Dl::new(n(3720.0) + 2), ldz: 0.0,
            rap1: Ap::new(n(908.0) + 40), rd1: Dl::new(n(4217.0) + 2), rap2: Ap::new(n(2656.0)), rd2: Dl::new(n(3163.0) + 2), rdz: 0.0,
            decay: 0.5, damp: 0.0005, ph: 0.0, exc: 16.0 * sc, width: 1.0, mix: 0.25, lfb: 0.0, rfb: 0.0 };
        // longueur « vraie » des passe-tout modulés (la marge sert à la modulation)
        s.lap1.n = n(672.0); s.rap1.n = n(908.0);
        s.set(p);
        s
    }
    pub fn set(&mut self, p: &PlateParams) {
        let sr = self.sr;
        self.pre_n = ((p.pre.clamp(0.0, 200.0) / 1000.0) * sr) as usize;
        let f = p.lowcut.clamp(20.0, 500.0);
        self.hpa = (-2.0 * PI * f / sr).exp();
        // durée → gain par passage : un tour de branche ≈ 0,358 s à la cadence de Dattorro, deux gains « decay » par tour
        let loop_s = (4453.0 + 3720.0 + 672.0 + 1800.0) / PLATE_FS;
        self.decay = 10f64.powf(-3.0 * loop_s / (2.0 * p.decay.clamp(0.4, 6.0))).min(0.98);
        // brillance : amortissement des aigus dans le réservoir (Chaude = plus amortie)
        let b = (p.bright.clamp(0.0, 100.0) / 100.0) * if p.variant == 1 { 0.75 } else { 1.0 };
        self.damp = 0.7 * (1.0 - b) + 0.0005;
        self.bw = if p.variant == 1 { 0.75 } else { 0.9995 };
        self.width = p.width.clamp(0.0, 150.0) / 100.0;
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let sc = self.sc;
        let n = |v: f64| (v * sc).round() as usize;
        let inp = if nc > 1 { 0.5 * (x[0] + x[1]) } else { x[0] };
        // pré-délai, coupe-bas (1er ordre), bande passante d'entrée
        self.pre.push(inp);
        let v = self.pre.at(self.pre_n);
        let (xp, yp) = self.hp; let h = self.hpa * (yp + v - xp); self.hp = (v, h);
        self.bwz += (h - self.bwz) * self.bw;
        let mut d = self.bwz;
        d = self.ap_in[0].run(d, 0.75); d = self.ap_in[1].run(d, 0.75); d = self.ap_in[2].run(d, 0.625); d = self.ap_in[3].run(d, 0.625);
        // réservoir : deux branches croisées, diffuseurs modulés (excursion lente, ≈ 1 Hz)
        self.ph += 2.0 * PI * 1.0 / self.sr; if self.ph > 2.0 * PI { self.ph -= 2.0 * PI; }
        let m = self.exc * self.ph.sin();
        let (dec, dmp) = (self.decay, self.damp);
        // branche gauche
        let a = self.lap1.run_mod(d + self.rfb * dec, -0.7, m);
        self.ld1.push(a);
        let b = self.ld1.at(n(4453.0) - 1);
        self.ldz += (b - self.ldz) * (1.0 - dmp);
        let c = self.lap2.run(self.ldz * dec, 0.5);
        self.ld2.push(c);
        let lout = self.ld2.at(n(3720.0) - 1);
        // branche droite
        let a2 = self.rap1.run_mod(d + self.lfb * dec, -0.7, -m);
        self.rd1.push(a2);
        let b2 = self.rd1.at(n(4217.0) - 1);
        self.rdz += (b2 - self.rdz) * (1.0 - dmp);
        let c2 = self.rap2.run(self.rdz * dec, 0.5);
        self.rd2.push(c2);
        let rout = self.rd2.at(n(3163.0) - 1);
        self.lfb = lout; self.rfb = rout;
        // prises de sortie (Dattorro)
        let yl = self.rd1.at(n(266.0)) + self.rd1.at(n(2974.0)) - self.rap2.tap(n(1913.0)) + self.rd2.at(n(1996.0)) - self.ld1.at(n(1990.0)) - self.lap2.tap(n(187.0)) - self.ld2.at(n(1066.0));
        let yr = self.ld1.at(n(353.0)) + self.ld1.at(n(3627.0)) - self.lap2.tap(n(1228.0)) + self.ld2.at(n(2673.0)) - self.rd1.at(n(2111.0)) - self.rap2.tap(n(335.0)) - self.rd2.at(n(121.0));
        let (yl, yr) = (yl * 0.3, yr * 0.3);
        // largeur : 0 = mono, 1 = la plaque telle quelle, 1,5 = plus large
        let (mm, ss) = ((yl + yr) * 0.5, (yl - yr) * 0.5 * self.width);
        let (wl, wr) = (mm + ss, mm - ss);
        let (dl, dr) = if nc > 1 { (x[0], x[1]) } else { (x[0], x[0]) };
        x[0] = dl * (1.0 - self.mix) + wl * self.mix;
        x[1] = dr * (1.0 - self.mix) + wr * self.mix;
    }
}

// ===== Salle 80 : réverbe numérique des années 80 (esprit « 224 / 480 ») =====
// Ce qui fait le son de ces machines : entrée stéréo vraie (gauche et droite entrent à deux endroits d'un même anneau de retards),
// bande passante limitée par les convertisseurs de l'époque (≈ 10 kHz : la queue reste douce, jamais sifflante), « multiplicateur
// de graves » (les graves tiennent plus ou moins longtemps que les médiums, autour d'un point de croisement), aigus qui meurent
// plus vite, et retards qui « flottent » doucement (chorus lent) : la queue est vivante, sans résonance métallique.
// Anneau de 4 sections (passe-tout modulé → retard → aigus → graves × → passe-tout → retard), gain par section calé sur sa longueur
// pour une Durée juste. Variantes : Salle (grande salle), Chambre (petite pièce dense), Riche (plus grande, plus de mouvement, plus sombre).
pub const H80_IN: [f64; 4] = [4.77, 3.59, 12.73, 9.30];
pub const H80_SEC: [[f64; 4]; 4] = [[22.58, 149.6, 60.48, 125.0], [30.51, 125.0, 89.24, 106.3], [26.83, 141.7, 64.28, 94.0], [33.47, 118.3, 74.65, 112.9]];
pub const H80_VAR: [[f64; 3]; 3] = [[1.0, 1.0, 10_000.0], [0.55, 0.5, 12_000.0], [1.15, 2.0, 9_000.0]]; // taille, mouvement, bande passante
pub const H80_RATES: [f64; 4] = [0.83, 1.07, 0.71, 1.31];
#[derive(Clone, Debug)]
pub struct Hall80Params { pub decay: f64, pub pre: f64, pub size: f64, pub bass: f64, pub xover: f64, pub treble: f64, pub diffusion: f64, pub spin: f64, pub width: f64, pub mix: f64, pub variant: usize }
impl Default for Hall80Params {
    fn default() -> Self { Self { decay: 2.5, pre: 30.0, size: 100.0, bass: 1.2, xover: 400.0, treble: 6000.0, diffusion: 70.0, spin: 40.0, width: 100.0, mix: 25.0, variant: 0 } }
}
impl From<&crate::model::Hall80Json> for Hall80Params {
    fn from(j: &crate::model::Hall80Json) -> Self {
        let d = Self::default();
        Self { decay: j.decay.unwrap_or(d.decay), pre: j.pre.unwrap_or(d.pre), size: j.size.unwrap_or(d.size), bass: j.bass.unwrap_or(d.bass), xover: j.xover.unwrap_or(d.xover),
            treble: j.treble.unwrap_or(d.treble), diffusion: j.diffusion.unwrap_or(d.diffusion), spin: j.spin.unwrap_or(d.spin), width: j.width.unwrap_or(d.width), mix: j.mix.unwrap_or(d.mix),
            variant: j.variant.map_or(0, |v| (v.round().max(0.0) as usize).min(2)) }
    }
}
impl Hall80Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "decay" => self.decay = v, "pre" => self.pre = v, "size" => self.size = v, "bass" => self.bass = v, "xover" => self.xover = v, "treble" => self.treble = v,
            "diffusion" => self.diffusion = v, "spin" => self.spin = v, "width" => self.width = v, "mix" => self.mix = v,
            "variant" => self.variant = (v.round().max(0.0) as usize).min(2), _ => return false }
        true
    }
}
struct H80Sec { ap1: Ap, d1: Dl, ap2: Ap, d2: Dl, n1: usize, n2: usize, tz: f64, lz: f64, ghi: f64, glo: f64, ph: f64 }
pub struct Hall80 {
    sr: f64, pre: Dl, pre_n: usize,
    inz: [f64; 2], ina: f64, din: [[Ap; 4]; 2],
    sec: Vec<H80Sec>, fb: [f64; 4],
    ta: f64, xa: f64, g1: f64, g2: f64, gi: [f64; 2], exc: f64, rate: f64, wph: f64,
    oz: [[f64; 4]; 2], ob: [f64; 5], width: f64, mix: f64,
}
impl Hall80 {
    pub fn new(p: &Hall80Params, sr: f64) -> Self {
        let mx = |ms: f64| (ms * 1.8 * sr / 1000.0) as usize + 8;
        let marg = (0.002 * sr) as usize + 8;
        let din = |k: f64| [Ap::new(mx(H80_IN[0] * k)), Ap::new(mx(H80_IN[1] * k)), Ap::new(mx(H80_IN[2] * k)), Ap::new(mx(H80_IN[3] * k))];
        let sec = H80_SEC.iter().enumerate().map(|(k, s)| H80Sec { ap1: Ap::new(mx(s[0]) + marg), d1: Dl::new(mx(s[1])), ap2: Ap::new(mx(s[2])), d2: Dl::new(mx(s[3])),
            n1: 2, n2: 2, tz: 0.0, lz: 0.0, ghi: 0.0, glo: 0.0, ph: k as f64 * 1.3 }).collect();
        let mut h = Self { sr, pre: Dl::new((0.5 * sr) as usize + 8), pre_n: 0, inz: [0.0; 2], ina: 1.0, din: [din(1.0), din(1.07)], sec, fb: [0.0; 4],
            ta: 1.0, xa: 0.0, g1: 0.6, g2: 0.5, gi: [0.75, 0.625], exc: 0.0, rate: 1.0, wph: 0.0, oz: [[0.0; 4]; 2], ob: [1.0, 0.0, 0.0, 0.0, 0.0], width: 1.0, mix: 0.25 };
        h.set(p);
        h
    }
    pub fn set(&mut self, p: &Hall80Params) {
        let sr = self.sr;
        let v = H80_VAR[p.variant.min(2)];
        let f = (p.size.clamp(50.0, 150.0) / 100.0) * v[0];
        let smp = |ms: f64| ((ms * f * sr / 1000.0).round() as usize).max(2);
        self.pre_n = ((p.pre.clamp(0.0, 200.0) / 1000.0) * sr) as usize;
        for (c, k) in [(0usize, 1.0f64), (1, 1.07)] { for i in 0..4 { self.din[c][i].n = ((H80_IN[i] * k * f * sr / 1000.0).round() as usize).max(2); } }
        let rt = p.decay.clamp(0.3, 20.0);
        let bm = p.bass.clamp(0.5, 2.5);
        for (s, l) in self.sec.iter_mut().zip(H80_SEC.iter()) {
            s.ap1.n = smp(l[0]); s.n1 = smp(l[1]); s.ap2.n = smp(l[2]); s.n2 = smp(l[3]);
            let t = (s.ap1.n + s.n1 + s.ap2.n + s.n2) as f64 / sr;
            s.ghi = 10f64.powf(-3.0 * t / rt).min(0.999);
            s.glo = 10f64.powf(-3.0 * t / (rt * bm)).min(0.999);
        }
        let oc = |fc: f64| 1.0 - (-2.0 * PI * fc / sr).exp();
        self.ta = oc(p.treble.clamp(1000.0, 16_000.0).min(0.45 * sr));
        self.xa = oc(p.xover.clamp(100.0, 1500.0));
        self.ina = oc(v[2].min(0.45 * sr));
        // filtre de sortie des convertisseurs : passe-bas 2e ordre (Butterworth) à la bande passante de la variante
        let w = 2.0 * PI * v[2].min(0.45 * sr) / sr; let al = w.sin() / (2.0 * std::f64::consts::FRAC_1_SQRT_2); let cw = w.cos(); let a0 = 1.0 + al;
        self.ob = [(1.0 - cw) / 2.0 / a0, (1.0 - cw) / a0, (1.0 - cw) / 2.0 / a0, -2.0 * cw / a0, (1.0 - al) / a0];
        let d = p.diffusion.clamp(0.0, 100.0) / 100.0;
        self.gi = [0.75 * d, 0.625 * d]; self.g1 = 0.4 + 0.3 * d; self.g2 = 0.5 * d;
        let sp = p.spin.clamp(0.0, 100.0) / 100.0;
        self.exc = sp * 0.0008 * sr * v[1]; self.rate = 0.5 + sp;
        self.width = p.width.clamp(0.0, 150.0) / 100.0;
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (dl, dr) = if nc > 1 { (x[0], x[1]) } else { (x[0], x[0]) };
        // pré-délai (stéréo : la droite est relue dans le même tampon décalé d'un échantillon par paire)
        self.pre.push(dl); self.pre.push(dr);
        let il = self.pre.at(2 * self.pre_n + 1); let ir = self.pre.at(2 * self.pre_n);
        // convertisseurs d'époque : bande passante limitée, puis diffusion d'entrée
        let mut inj = [0.0; 2];
        for (c, v) in [il, ir].into_iter().enumerate() {
            self.inz[c] += (v - self.inz[c]) * self.ina;
            let mut d = self.inz[c];
            let (a, b) = (self.gi[0], self.gi[1]);
            d = self.din[c][0].run(d, a); d = self.din[c][1].run(d, a); d = self.din[c][2].run(d, b); d = self.din[c][3].run(d, b);
            inj[c] = d;
        }
        // flottement lent des retards (chaque section à sa vitesse) + dérive très lente commune
        self.wph += 2.0 * PI * 0.13 / self.sr; if self.wph > 2.0 * PI { self.wph -= 2.0 * PI; }
        let wander = 0.5 * self.wph.sin();
        let (g1, g2, ta, xa, exc, step) = (self.g1, self.g2, self.ta, self.xa, self.exc, 2.0 * PI * self.rate / self.sr);
        let mut out = [0.0; 4];
        for k in 0..4 {
            let s = &mut self.sec[k];
            s.ph += step * H80_RATES[k]; if s.ph > 2.0 * PI { s.ph -= 2.0 * PI; }
            let m = exc * (s.ph.sin() + wander) * if k % 2 == 0 { 1.0 } else { -1.0 };
            let u = self.fb[(k + 3) % 4] + if k == 0 { inj[0] } else if k == 2 { inj[1] } else { 0.0 };
            let a = s.ap1.run_mod(u, -g1, m);
            s.d1.push(a);
            let b = s.d1.at(s.n1 - 1);
            s.tz += (b - s.tz) * ta;
            s.lz += (s.tz - s.lz) * xa;
            let y = s.lz * s.glo + (s.tz - s.lz) * s.ghi;
            let c = s.ap2.run(y, g2);
            s.d2.push(c);
            out[k] = s.d2.at(s.n2 - 1);
        }
        self.fb = out;
        let tp = |s: &H80Sec, two: bool, fr: f64| if two { s.d2.at((s.n2 as f64 * fr).round() as usize) } else { s.d1.at((s.n1 as f64 * fr).round() as usize) };
        let sc = &self.sec;
        let yl = tp(&sc[0], false, 0.11) + tp(&sc[0], false, 0.67) - tp(&sc[1], true, 0.45) + tp(&sc[2], false, 0.33) - tp(&sc[3], true, 0.71) + tp(&sc[0], true, 0.21) - tp(&sc[3], false, 0.52);
        let yr = tp(&sc[2], false, 0.13) + tp(&sc[2], false, 0.61) - tp(&sc[3], true, 0.39) + tp(&sc[0], false, 0.29) - tp(&sc[1], true, 0.77) + tp(&sc[2], true, 0.17) - tp(&sc[1], false, 0.48);
        let b = self.ob;
        let mut o = [0.0; 2];
        for (c, v) in [yl * 0.35, yr * 0.35].into_iter().enumerate() {
            let z = &mut self.oz[c];
            let y = b[0] * v + b[1] * z[0] + b[2] * z[1] - b[3] * z[2] - b[4] * z[3];
            *z = [v, z[0], y, z[2]]; o[c] = y;
        }
        let (mm, ss) = ((o[0] + o[1]) * 0.5, (o[0] - o[1]) * 0.5 * self.width);
        x[0] = dl * (1.0 - self.mix) + (mm + ss) * self.mix;
        x[1] = dr * (1.0 - self.mix) + (mm - ss) * self.mix;
    }
}

// ===== Harmoniseur 910 : transpositeur à lignes de retard des années 70 (esprit « H910 / H949 ») =====
// Le principe de ces machines : le son est écrit dans une mémoire, deux têtes de lecture la relisent plus vite (plus aigu) ou
// plus lentement (plus grave), chacune repart en arrière quand elle rattrape l'écriture ; on passe de l'une à l'autre en fondu.
// Deux voix (gauche, droite) avec chacune sa transposition, retard (0-120 ms) et réinjection (les répétitions montent ou
// descendent encore d'un cran). Variantes : 910 (fenêtre courte à bords francs, bande 8 kHz, le « grain » d'époque) et
// 949 (fondu doux, bande 12 kHz, plus propre). Le bouton Micro (façade) règle le doublage classique ±9 centièmes.
#[derive(Clone, Debug)]
pub struct H910Params { pub pitch_l: f64, pub pitch_r: f64, pub delay: f64, pub feedback: f64, pub mix: f64, pub variant: usize }
impl Default for H910Params {
    fn default() -> Self { Self { pitch_l: 0.09, pitch_r: -0.09, delay: 12.0, feedback: 0.0, mix: 35.0, variant: 0 } }
}
impl From<&crate::model::H910Json> for H910Params {
    fn from(j: &crate::model::H910Json) -> Self {
        let d = Self::default();
        Self { pitch_l: j.pitch_l.unwrap_or(d.pitch_l), pitch_r: j.pitch_r.unwrap_or(d.pitch_r), delay: j.delay.unwrap_or(d.delay), feedback: j.feedback.unwrap_or(d.feedback),
            mix: j.mix.unwrap_or(d.mix), variant: j.variant.map_or(0, |v| (v.round().max(0.0) as usize).min(1)) }
    }
}
impl H910Params {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "pitchL" => self.pitch_l = v, "pitchR" => self.pitch_r = v, "delay" => self.delay = v, "feedback" => self.feedback = v, "mix" => self.mix = v,
            "variant" => self.variant = (v.round().max(0.0) as usize).min(1), _ => return false }
        true
    }
}
struct H910Voice { buf: Dl, ph: f64, step: f64, fb: f64, lp: f64 }
pub struct H910 {
    sr: f64, v: [H910Voice; 2], win: f64, d0: f64, fb: f64, mix: f64, lpa: f64, edge: f64,
}
impl H910 {
    pub fn new(p: &H910Params, sr: f64) -> Self {
        let n = (0.3 * sr) as usize + 8;
        let mk = || H910Voice { buf: Dl::new(n), ph: 0.0, step: 0.0, fb: 0.0, lp: 0.0 };
        let mut h = Self { sr, v: [mk(), mk()], win: 1.0, d0: 0.0, fb: 0.0, mix: 0.35, lpa: 1.0, edge: 0.5 };
        h.set(p);
        h
    }
    pub fn set(&mut self, p: &H910Params) {
        let sr = self.sr;
        let v1 = p.variant == 1;
        // fenêtre : 910 courte (≈ 30 ms) à fondus courts, 949 plus longue (≈ 45 ms) en fondu complet
        self.win = (if v1 { 0.045 } else { 0.030 }) * sr;
        self.edge = if v1 { 0.5 } else { 0.04 };
        self.d0 = (p.delay.clamp(0.0, 120.0) / 1000.0) * sr;
        self.fb = p.feedback.clamp(0.0, 90.0) / 100.0;
        self.mix = (p.mix / 100.0).clamp(0.0, 1.0);
        self.lpa = 1.0 - (-2.0 * PI * (if v1 { 12_000.0f64 } else { 8_000.0 }).min(0.45 * sr) / sr).exp();
        for (vc, st) in self.v.iter_mut().zip([p.pitch_l, p.pitch_r]) {
            let r = 2f64.powf(st.clamp(-12.0, 12.0) / 12.0);
            vc.step = (1.0 - r) / self.win;
        }
    }
    fn gain(&self, q: f64) -> f64 {
        // les deux têtes se partagent toujours le son (somme = 1) : 949 en fondu sinus², 910 en fondu court au quart de tour
        if self.edge >= 0.5 { let s = (PI * q).sin(); s * s } else { (0.5 + (0.25 - (q - 0.5).abs()) / (2.0 * self.edge)).clamp(0.0, 1.0) }
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (dl, dr) = if nc > 1 { (x[0], x[1]) } else { (x[0], x[0]) };
        let mut o = [0.0; 2];
        for c in 0..2 {
            let inp = if c == 0 { dl } else { dr };
            let fbv = self.v[c].fb;
            let (win, d0, lpa) = (self.win, self.d0, self.lpa);
            let vc = &mut self.v[c];
            vc.lp += (inp + fbv * self.fb - vc.lp) * lpa;
            vc.buf.push(vc.lp);
            vc.ph += vc.step; if vc.ph >= 1.0 { vc.ph -= 1.0; } else if vc.ph < 0.0 { vc.ph += 1.0; }
            let (p1, p2) = (vc.ph, (vc.ph + 0.5) % 1.0);
            let (a, b) = (vc.buf.atf(d0 + p1 * win), vc.buf.atf(d0 + p2 * win));
            let y = a * self.gain(p1) + b * self.gain(p2);
            self.v[c].fb = y;
            o[c] = y;
        }
        x[0] = dl * (1.0 - self.mix) + o[0] * self.mix;
        x[1] = dr * (1.0 - self.mix) + o[1] * self.mix;
    }
}

// ===== Dimension : chorus d'espace à lignes « BBD » (esprit « Dimension D » et chorus d'ensemble des synthés) =====
// Le son mono entre dans deux lignes de retard modulées par un triangle lent, en opposition ; chaque côté reçoit sa ligne moins
// une part de l'autre : l'image s'élargit sans qu'on entende la modulation (et ça reste juste en mono). Lignes analogiques :
// bande passante ≈ 9 kHz, légère saturation. 4 boutons de mode (profondeur, vitesse). Variantes : Dimension (subtil, ne s'entend
// pas, ça élargit) et Ensemble (le chorus des synthés des années 80, plus profond et plus rapide).
pub const DIM_MODES: [[[f64; 3]; 4]; 2] = [
    [[6.0, 0.30, 0.25], [6.5, 0.45, 0.25], [7.0, 0.60, 0.25], [7.5, 0.80, 0.50]],   // centre (ms), profondeur (ms), vitesse (Hz)
    [[3.5, 1.60, 0.50], [3.5, 1.80, 0.83], [3.0, 1.20, 4.50], [3.5, 2.20, 0.65]]];
#[derive(Clone, Debug)]
pub struct DimParams { pub mode: usize, pub mix: f64, pub width: f64, pub variant: usize }
impl Default for DimParams { fn default() -> Self { Self { mode: 1, mix: 100.0, width: 100.0, variant: 0 } } }
impl From<&crate::model::DimJson> for DimParams {
    fn from(j: &crate::model::DimJson) -> Self {
        let d = Self::default();
        Self { mode: j.mode.map_or(d.mode, |v| (v.round().max(0.0) as usize).min(3)), mix: j.mix.unwrap_or(d.mix), width: j.width.unwrap_or(d.width),
            variant: j.variant.map_or(0, |v| (v.round().max(0.0) as usize).min(1)) }
    }
}
impl DimParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "mode" => self.mode = (v.round().max(0.0) as usize).min(3), "mix" => self.mix = v, "width" => self.width = v,
            "variant" => self.variant = (v.round().max(0.0) as usize).min(1), _ => return false }
        true
    }
}
pub struct Dim { sr: f64, buf: Dl, ph: f64, step: f64, c: f64, dep: f64, g: f64, x: f64, lpa: f64, z: [f64; 3] }
impl Dim {
    pub fn new(p: &DimParams, sr: f64) -> Self {
        let mut d = Self { sr, buf: Dl::new((0.02 * sr) as usize + 8), ph: 0.0, step: 0.0, c: 0.0, dep: 0.0, g: 0.0, x: 0.0, lpa: 1.0, z: [0.0; 3] };
        d.set(p);
        d
    }
    pub fn set(&mut self, p: &DimParams) {
        let m = DIM_MODES[p.variant.min(1)][p.mode.min(3)];
        self.c = m[0] / 1000.0 * self.sr; self.dep = m[1] / 1000.0 * self.sr; self.step = m[2] / self.sr;
        self.g = (p.mix / 100.0).clamp(0.0, 1.0) * if p.variant == 1 { 0.7 } else { 0.5 };
        self.x = 0.45 * (p.width.clamp(0.0, 150.0) / 100.0);
        self.lpa = 1.0 - (-2.0 * PI * 9000.0f64.min(0.45 * self.sr) / self.sr).exp();
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let (dl, dr) = if nc > 1 { (x[0], x[1]) } else { (x[0], x[0]) };
        // entrée des lignes : mono, passe-bas d'anti-repliement
        self.z[0] += ((dl + dr) * 0.5 - self.z[0]) * self.lpa;
        self.buf.push(self.z[0]);
        self.ph += self.step; if self.ph >= 1.0 { self.ph -= 1.0; }
        let tri = 4.0 * (self.ph - 0.5).abs() - 1.0;
        let a = self.buf.atf(self.c + self.dep * tri);
        let b = self.buf.atf(self.c - self.dep * tri);
        // sortie des lignes : passe-bas + légère saturation
        self.z[1] += (a - self.z[1]) * self.lpa; self.z[2] += (b - self.z[2]) * self.lpa;
        let (ya, yb) = ((self.z[1] * 1.2).tanh() / 1.2, (self.z[2] * 1.2).tanh() / 1.2);
        let n = 1.0 / (1.0 + self.g * (1.0 - self.x));
        x[0] = (dl + self.g * (ya - self.x * yb)) * n;
        x[1] = (dr + self.g * (yb - self.x * ya)) * n;
    }
}

// ===== Écho à bande (esprit « 201 ») : trois têtes de lecture, bande en boucle, ressort =====
// Comme la machine : Mode (quelles têtes lisent : 1, 2, 3, 1+2, 2+3, 1+3, 1+2+3), Vitesse (la bande ralentit ou accélère —
// les répétitions s'écartent et le son « pleure » quand on tourne), Intensité (combien ça revient ; au-delà de 100 ça s'emballe),
// Grave / Aigu des répétitions, Écho, Ressort (la réverbe à ressort intégrée), Entrée (pousse la bande). Chaque passage sur la bande
// sature un peu et perd de l'aigu ; la bande pleure légèrement.
pub const TE_HEADS: [f64; 3] = [0.12, 0.24, 0.36];
pub const TE_MODES: [[bool; 3]; 7] = [[true, false, false], [false, true, false], [false, false, true], [true, true, false], [false, true, true], [true, false, true], [true, true, true]];

#[derive(Clone, Debug)]
pub struct TapeEchoParams { pub mode: usize, pub rate: f64, pub intensity: f64, pub bass: f64, pub treble: f64, pub echo: f64, pub spring: f64, pub input: f64, pub wow: f64 }
impl Default for TapeEchoParams {
    fn default() -> Self { Self { mode: 1, rate: 1.0, intensity: 40.0, bass: 0.0, treble: 0.0, echo: 40.0, spring: 0.0, input: 0.0, wow: 50.0 } }
}
impl From<&crate::model::TapeEchoJson> for TapeEchoParams {
    fn from(j: &crate::model::TapeEchoJson) -> Self {
        let d = Self::default();
        Self { mode: j.mode.map_or(d.mode, |v| (v.round().max(0.0) as usize).min(6)), rate: j.rate.unwrap_or(d.rate), intensity: j.intensity.unwrap_or(d.intensity),
            bass: j.bass.unwrap_or(0.0), treble: j.treble.unwrap_or(0.0), echo: j.echo.unwrap_or(d.echo), spring: j.spring.unwrap_or(0.0), input: j.input.unwrap_or(0.0), wow: j.wow.unwrap_or(d.wow) }
    }
}
impl TapeEchoParams {
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        match k { "mode" => self.mode = (v.round().max(0.0) as usize).min(6), "rate" => self.rate = v, "intensity" => self.intensity = v, "bass" => self.bass = v, "treble" => self.treble = v,
            "echo" => self.echo = v, "spring" => self.spring = v, "input" => self.input = v, "wow" => self.wow = v, _ => return false }
        true
    }
}
pub struct TapeEcho {
    sr: f64,
    tape: Dl,
    heads: [bool; 3],
    rate_t: f64, rate: f64, glide: f64,
    fb: f64, gin: f64, echo: f64, spring_v: f64,
    tone: [Biquad; 3],
    hfz: f64, hfa: f64,
    pw: f64, pf: f64, ww: f64, wf: f64,
    // ressort : deux ressorts (gauche / droite) = passe-tout dispersifs dans une boucle
    sp: [(Vec<Ap>, Dl, f64); 2],
}
impl TapeEcho {
    pub fn new(p: &TapeEchoParams, sr: f64) -> Self {
        let n = |v: f64| (v * sr).round() as usize;
        let mk = |d: f64, k: usize| ((0..8).map(|i| Ap::new(((1.0 + i as f64 * 0.37 + k as f64 * 0.11) * sr / 8000.0).round().max(2.0) as usize)).collect::<Vec<_>>(), Dl::new(n(d) + 2), 0.0);
        let mut s = Self { sr, tape: Dl::new(n(TE_HEADS[2] * 2.2) + 64), heads: [false; 3], rate_t: 1.0, rate: 1.0, glide: 1.0 - (-1.0 / (0.25 * sr)).exp(),
            fb: 0.0, gin: 1.0, echo: 0.0, spring_v: 0.0, tone: [Biquad::first_order(true, 20.0, sr); 3], hfz: 0.0, hfa: 1.0 - (-2.0 * PI * 5_000.0 / sr).exp(),
            pw: 0.0, pf: 0.0, ww: 0.0, wf: 0.0, sp: [mk(0.037, 0), mk(0.043, 1)] };
        s.set(p);
        s.rate = s.rate_t;
        s
    }
    pub fn set(&mut self, p: &TapeEchoParams) {
        let sr = self.sr;
        self.heads = TE_MODES[p.mode.min(6)];
        self.rate_t = p.rate.clamp(0.5, 2.0);
        // plusieurs têtes reviennent ensemble : l'intensité est partagée (100 = au bord de l'emballement, quel que soit le mode)
        let nh = self.heads.iter().filter(|h| **h).count().max(1) as f64;
        self.fb = p.intensity.clamp(0.0, 120.0) / 100.0 / nh;
        self.gin = 10f64.powf(p.input.clamp(-12.0, 12.0) / 20.0);
        self.echo = p.echo.clamp(0.0, 100.0) / 100.0;
        self.spring_v = p.spring.clamp(0.0, 100.0) / 100.0;
        // couleur des répétitions (seuls les coefficients changent : pas de clic quand on tourne)
        let t = [eq_matched("lowshelf", 200.0, 0.7, p.bass.clamp(-12.0, 12.0), sr), eq_matched("highshelf", 3_000.0, 0.7, p.treble.clamp(-12.0, 12.0), sr), eq_matched("highpass", 80.0, 0.707, 0.0, sr)];
        for (a, b) in self.tone.iter_mut().zip(t) { a.retune(b); }
        let w = p.wow.clamp(0.0, 100.0) / 50.0;
        self.ww = (0.0015 * w * sr / (2.0 * PI * 0.7)).min(60.0);
        self.wf = (0.0006 * w * sr / (2.0 * PI * 7.0)).min(8.0);
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        let sr = self.sr;
        let dry_l = x[0];
        let dry_r = if nc > 1 { x[1] } else { x[0] };
        let inp = if nc > 1 { 0.5 * (dry_l + dry_r) } else { dry_l } * self.gin;
        // la bande change de vitesse doucement (inertie du moteur)
        self.rate += (self.rate_t - self.rate) * self.glide;
        self.pw += 2.0 * PI * 0.7 / sr; if self.pw > 2.0 * PI { self.pw -= 2.0 * PI; }
        self.pf += 2.0 * PI * 7.0 / sr; if self.pf > 2.0 * PI { self.pf -= 2.0 * PI; }
        let wobble = self.ww * self.pw.sin() + self.wf * self.pf.sin();
        let mut sum = 0.0;
        for h in 0..3 { if self.heads[h] { sum += self.tape.atf(TE_HEADS[h] * sr / self.rate + wobble); } }
        // les répétitions : grave / aigu, coupe-bas, perte d'aigu de la bande
        let mut e = sum;
        for b in self.tone.iter_mut() { e = b.tick(e); }
        self.hfz += (e - self.hfz) * self.hfa;
        let e = self.hfz;
        // écriture sur la bande : l'entrée + ce qui revient, saturé par la bande
        let w = inp + e * self.fb;
        self.tape.push((w * 0.8).tanh() / 0.8);
        // ressort : deux ressorts nourris par l'entrée et l'écho
        let feed = inp * 0.5 + e * 0.5;
        let mut out = [0.0; 2];
        for (k, (aps, dl, z)) in self.sp.iter_mut().enumerate() {
            let mut v = feed + *z * 0.72;
            for a in aps.iter_mut() { v = a.run(v, 0.62); }
            dl.push(v);
            let o = dl.at(dl.b.len() - 3);
            *z = o;
            out[k] = o;
        }
        x[0] = dry_l + e * self.echo + out[0] * self.spring_v * 0.6;
        x[1] = dry_r + e * self.echo + out[1] * self.spring_v * 0.6;
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

    fn runt(p: &TapeParams, amp: f64, f: f64, n: usize) -> Vec<f64> {
        let mut c = Tape::new(p, SR);
        (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect()
    }
    /// Bande 80 : bosse du grave (15 : 50 Hz), cassette qui coupe l'aigu, pousser l'entrée = plus d'harmonique 3
    #[test]
    fn bande_bosse_aigus_saturation() {
        let quiet = TapeParams { noise: 0.0, wow: 0.0, ..Default::default() };
        let rel = |p: &TapeParams, f: f64| { let n = 48_000; let o = runt(p, 0.05, f, n); let r: Vec<f64> = (0..n).map(|i| 0.05 * (2.0 * PI * f * i as f64 / SR).sin()).collect();
            20.0 * (harm(&o[n / 2..], f, 1) / harm(&r[n / 2..], f, 1)).log10() };
        assert!(rel(&quiet, 50.0) > rel(&quiet, 1000.0) + 1.0, "bosse à 50 Hz : {:.1} / {:.1}", rel(&quiet, 50.0), rel(&quiet, 1000.0));
        let cas = TapeParams { machine: 2, ..quiet.clone() };
        assert!(rel(&cas, 15_000.0) < -4.0, "cassette : aigus coupés ({:.1} dB à 15 kHz)", rel(&cas, 15_000.0));
        let h3 = |inp: f64| { let o = runt(&TapeParams { input: inp, output: -inp, ..quiet.clone() }, 0.3, 200.0, 48_000); let s = &o[24_000..]; 20.0 * (harm(s, 200.0, 3) / harm(s, 200.0, 1)).log10() };
        assert!(h3(12.0) > h3(0.0) + 8.0, "pousser la bande : h3 {:.1} → {:.1}", h3(0.0), h3(12.0));
    }

    fn run670(p: &L670Params, amp: f64, f: f64, n: usize) -> (Vec<f64>, L670) {
        let mut c = L670::new(p, SR);
        let o = (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
        (o, c)
    }
    /// Lampe 670 : le ratio grandit avec le niveau ; constante 1 relâche plus vite que 4 ; harmoniques impaires > paires
    #[test]
    fn l670_variable_mu() {
        let p = L670Params { thr: 6.0, tc: 0, ..Default::default() };
        let gr = |db: f64| run670(&p, 10f64.powf(db / 20.0), 1000.0, 48_000).1.reduction();
        let (a, b, c) = (gr(-12.0), gr(-6.0), gr(0.0));
        assert!(c - b > b - a, "le ratio grandit : {a:.1} → {b:.1} → {c:.1} dB de réduction");
        let rel = |tc: usize| { let mut l = L670::new(&L670Params { thr: 6.0, tc, ..Default::default() }, SR);
            for i in 0..24_000 { let mut x = [0.5 * (2.0 * PI * 1000.0 * i as f64 / SR).sin(), 0.0]; l.tick(&mut x, 1); }
            let g0 = l.reduction(); let mut t = 0; for i in 0..(20.0 * SR) as usize { let mut x = [0.0, 0.0]; l.tick(&mut x, 1); if l.reduction() < g0 * 0.5 { t = i; break; } } t };
        assert!(rel(0) < rel(3) / 4, "constante 1 : {} éch., constante 4 : {} éch.", rel(0), rel(3));
        let (o, _) = run670(&L670Params { thr: 8.0, input: 10.0, output: -10.0, tc: 1, ..Default::default() }, 0.5, 200.0, 48_000);
        let s2 = &o[24_000..];
        assert!(harm(s2, 200.0, 3) > harm(s2, 200.0, 2) * 2.0, "push-pull : h3 > h2");
    }

    fn rundtr(p: &DtrParams, amp: f64, f: f64, n: usize) -> (Vec<f64>, Dtr) {
        let mut c = Dtr::new(p, SR);
        let o = (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
        (o, c)
    }
    /// Détresse : 1:1 ne compresse pas ; les ratios écrasent dans l'ordre jusqu'à Nuke ; le coupe-bas du détecteur ignore le grave ;
    /// « 2 » ajoute de l'harmonique 2, « 3 » de l'harmonique 3
    #[test]
    fn detresse_ratios_detecteur_distorsion() {
        let a = 10f64.powf(-6.0 / 20.0);
        let mut prev = -1.0;
        for r in 0..8 {
            let (_, c) = rundtr(&DtrParams { ratio: r, attack: 2.0, release: 3.0, ..Default::default() }, a, 1000.0, 48_000);
            if r == 0 { assert!(c.reduction() < 0.01, "1:1 : {:.2}", c.reduction()); }
            assert!(c.reduction() > prev, "ratio {r} : {:.1} dB (avant {prev:.1})", c.reduction());
            prev = c.reduction();
        }
        let (_, lo) = rundtr(&DtrParams { ratio: 5, ..Default::default() }, 0.5, 40.0, 48_000);
        let (_, lohp) = rundtr(&DtrParams { ratio: 5, det_hp: true, ..Default::default() }, 0.5, 40.0, 48_000);
        assert!(lohp.reduction() < lo.reduction() - 4.0, "coupe-bas du détecteur : {:.1} contre {:.1}", lohp.reduction(), lo.reduction());
        let h = |dist: usize, k: usize| { let (o, _) = rundtr(&DtrParams { ratio: 0, input: 8.0, output: 2.0, dist, ..Default::default() }, 0.3, 200.0, 48_000); let s = &o[24_000..]; 20.0 * (harm(s, 200.0, k) / harm(s, 200.0, 1)).log10() };
        assert!(h(1, 2) > h(0, 2) + 6.0, "« 2 » : h2 {:.1} contre {:.1}", h(1, 2), h(0, 2));
        assert!(h(2, 3) > h(0, 3) + 6.0, "« 3 » : h3 {:.1} contre {:.1}", h(2, 3), h(0, 3));
    }

    fn rune(p: &StripEParams, amp: f64, f: f64, n: usize) -> (Vec<f64>, StripE) {
        let mut c = StripE::new(p, SR);
        let o = (0..n).map(|i| { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
        (o, c)
    }
    /// Tranche E : à plat = transparente ; EQ à sa fréquence ; Noir plus serrée que Brun ; compresseur au ratio ; gate qui ferme
    #[test]
    fn tranche_e() {
        let lv = |p: &StripEParams, f: f64| { let (o, _) = rune(p, 0.05, f, 48_000); let r: Vec<f64> = (0..48_000).map(|i| 0.05 * (2.0 * PI * f * i as f64 / SR).sin()).collect(); 20.0 * (harm(&o[24_000..], f, 1) / harm(&r[24_000..], f, 1)).log10() };
        let flat = StripEParams::default();
        assert!(lv(&flat, 1000.0).abs() < 0.1, "à plat : {:.2} dB", lv(&flat, 1000.0));
        let b = StripEParams { hmf: 12.0, hmf_f: 3000.0, ..Default::default() };
        assert!((lv(&b, 3000.0) - 12.0).abs() < 0.6, "HMF +12 à 3 kHz : {:.1}", lv(&b, 3000.0));
        let n = StripEParams { variant: 1, ..b.clone() };
        assert!(lv(&n, 4500.0) < lv(&b, 4500.0) - 1.0, "Noir plus serrée : {:.1} contre {:.1} dB à 4,5 kHz", lv(&n, 4500.0), lv(&b, 4500.0));
        let (_, c) = rune(&StripEParams { cthr: -20.0, cratio: 4.0, ..Default::default() }, 10f64.powf(-8.0 / 20.0), 1000.0, 48_000);
        assert!((c.reduction() - 9.0).abs() < 1.0, "4:1, 12 dB au-dessus : {:.1} dB de réduction", c.reduction());
        let (o, _) = rune(&StripEParams { gthr: -30.0, grange: 30.0, grel: 0.1, ..Default::default() }, 0.003, 1000.0, 48_000);
        let rms = (o[24_000..].iter().map(|v| v * v).sum::<f64>() / 24_000.0).sqrt();
        assert!(rms < 0.003 / 2f64.sqrt() * 0.05, "gate fermée : {rms:.6}");
    }

    /// EQ 550 : à plat = transparent ; +12 à 1,5 kHz ; largeur proportionnelle (à +4 bien plus large qu'à +12, en proportion)
    #[test]
    fn eq550_crans_et_largeur() {
        let lv = |p: &Eq550Params, f: f64| { let mut c = Eq550::new(p, SR); let n = 48_000;
            let o: Vec<f64> = (0..n).map(|i| { let mut x = [0.05 * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
            let r: Vec<f64> = (0..n).map(|i| 0.05 * (2.0 * PI * f * i as f64 / SR).sin()).collect(); 20.0 * (harm(&o[24_000..], f, 1) / harm(&r[24_000..], f, 1)).log10() };
        assert!(lv(&Eq550Params::default(), 1000.0).abs() < 0.15, "à plat");
        let p12 = Eq550Params { mf: 12.0, mf_f: 2, ..Default::default() };
        assert!((lv(&p12, 1500.0) - 12.0).abs() < 0.6, "+12 à 1,5 kHz : {:.1}", lv(&p12, 1500.0));
        let p4 = Eq550Params { mf: 4.0, mf_f: 2, ..Default::default() };
        // une octave au-dessus : la cloche de +4 garde une plus grande part de son gain que celle de +12
        assert!(lv(&p4, 3000.0) / 4.0 > lv(&p12, 3000.0) / 12.0 + 0.1, "largeur proportionnelle : {:.2} / {:.2}", lv(&p4, 3000.0) / 4.0, lv(&p12, 3000.0) / 12.0);
    }

    fn run25(p: &Comp25Params, amp: f64, f: f64, n: usize) -> Comp25 {
        let mut c = Comp25::new(p, SR);
        for i in 0..n { let mut x = [amp * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); }
        c
    }
    /// Comp 25 : ratio 4 → pente 3/4 (en avant comme en contre-réaction à l'équilibre) ; la Poussée réduit la réaction au grave
    #[test]
    fn comp25_ratio_poussee() {
        let a = 10f64.powf(-2.0 / 20.0) * 2f64.sqrt() * 0.5; // crête ≈ −5 dBFS
        let lvl = 20.0 * a.log10();
        for fb in [false, true] {
            let c = run25(&Comp25Params { thr: lvl - 12.0, ratio: 3, knee: 0, thrust: 0, feedback: fb, attack: 2, release: 2, ..Default::default() }, a, 1000.0, 48_000);
            assert!((c.reduction() - 9.0).abs() < 1.0, "ratio 4 ({}) : {:.1} dB", if fb { "contre-réaction" } else { "en avant" }, c.reduction());
        }
        let lo = |t: usize| run25(&Comp25Params { thr: -20.0, thrust: t, ..Default::default() }, 0.5, 60.0, 48_000).reduction();
        assert!(lo(2) < lo(0) - 3.0, "Poussée forte : {:.1} contre {:.1} dB sur le grave", lo(2), lo(0));
    }

    /// Bus 33 : ratio 2 → pente 1/2 ; le limiteur tient la crête ; la réduction ajoute de l'harmonique 3
    #[test]
    fn bus33_comp_limiteur() {
        let a = 0.5f64; let lvl = 20.0 * a.log10();
        let mut c = Bus33::new(&Bus33Params { cthr: lvl - 12.0, cratio: 1, crec: 1, ..Default::default() }, SR);
        for i in 0..48_000 { let mut x = [a * (2.0 * PI * 1000.0 * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); }
        assert!((c.reduction() - 6.0).abs() < 1.0, "ratio 2, 12 dB au-dessus : {:.1} dB", c.reduction());
        let mut l = Bus33::new(&Bus33Params { con: false, lon: true, lthr: -12.0, lrec: 1, ..Default::default() }, SR);
        let mut pk = 0f64;
        for i in 0..48_000 { let mut x = [a * (2.0 * PI * 1000.0 * i as f64 / SR).sin(), 0.0]; l.tick(&mut x, 1); if i > 24_000 { pk = pk.max(x[0].abs()); } }
        assert!(20.0 * pk.log10() < -10.0, "limiteur : crête à {:.1} dBFS", 20.0 * pk.log10());
        let h3 = |thr: f64| { let mut b = Bus33::new(&Bus33Params { cthr: thr, cratio: 3, ..Default::default() }, SR);
            let o: Vec<f64> = (0..48_000).map(|i| { let mut x = [0.4 * (2.0 * PI * 200.0 * i as f64 / SR).sin(), 0.0]; b.tick(&mut x, 1); x[0] }).collect();
            let s = &o[24_000..]; 20.0 * (harm(s, 200.0, 3) / harm(s, 200.0, 1)).log10() };
        assert!(h3(-25.0) > h3(10.0) + 3.0, "la réduction ajoute de l'harmonique 3 : {:.1} contre {:.1}", h3(-25.0), h3(10.0));
    }

    /// EQ Massif : à plat transparent ; cloche à sa fréquence ; largeur serrée = cloche plus étroite ; plateau aigu
    #[test]
    fn massif_bandes() {
        let lv = |p: &MassifParams, f: f64| { let mut c = Massif::new(p, SR); let n = 48_000;
            let o: Vec<f64> = (0..n).map(|i| { let mut x = [0.05 * (2.0 * PI * f * i as f64 / SR).sin(), 0.0]; c.tick(&mut x, 1); x[0] }).collect();
            let r: Vec<f64> = (0..n).map(|i| 0.05 * (2.0 * PI * f * i as f64 / SR).sin()).collect(); 20.0 * (harm(&o[24_000..], f, 1) / harm(&r[24_000..], f, 1)).log10() };
        assert!(lv(&MassifParams::default(), 1000.0).abs() < 0.15, "à plat");
        let mut p = MassifParams::default(); p.g[2] = 8.0; p.f[2] = 2_000.0; p.bw[2] = 2.0;
        assert!((lv(&p, 2000.0) - 8.0).abs() < 0.6, "bande 3 : +8 à 2 kHz ({:.1})", lv(&p, 2000.0));
        let mut q = p.clone(); q.bw[2] = 9.0;
        assert!(lv(&q, 4000.0) < lv(&p, 4000.0) - 2.0, "largeur serrée : {:.1} contre {:.1} dB à 4 kHz", lv(&q, 4000.0), lv(&p, 4000.0));
        let mut a = MassifParams::default(); a.g[3] = 6.0; a.f[3] = 10_000.0;
        assert!(lv(&a, 18_000.0) > 4.0, "air : {:.1} dB à 18 kHz", lv(&a, 18_000.0));
    }

    /// Plaque : une impulsion → une queue stéréo qui décroît en à peu près la Durée réglée ; plus longue si Durée plus grande
    #[test]
    fn plaque_queue() {
        let rt = |dec: f64| {
            let mut p = Plate::new(&PlateParams { decay: dec, pre: 0.0, mix: 100.0, ..Default::default() }, SR);
            let n = (8.0 * SR) as usize; let mut e = vec![0.0f64; n];
            let mut side = 0.0;
            for i in 0..n { let mut x = [if i == 0 { 1.0 } else { 0.0 }, 0.0]; p.tick(&mut x, 1); e[i] = x[0] * x[0] + x[1] * x[1]; side += (x[0] - x[1]).powi(2); }
            // énergie restante (intégrale à rebours) : temps pour perdre 30 dB après le début, ×2 = RT60
            let mut acc = vec![0.0; n + 1]; for i in (0..n).rev() { acc[i] = acc[i + 1] + e[i]; }
            let t0 = (0.05 * SR) as usize; let ref0 = acc[t0];
            let t30 = (t0..n).find(|&i| acc[i] < ref0 * 1e-3).unwrap_or(n);
            (2.0 * (t30 - t0) as f64 / SR, side)
        };
        let (a, side) = rt(1.5);
        let (b, _) = rt(4.0);
        assert!(side > 1e-3, "queue stéréo");
        assert!(b > a * 1.8, "durée plus grande = queue plus longue ({a:.2} s → {b:.2} s)");
        assert!((a - 1.5).abs() < 0.8, "Durée 1,5 s : RT60 ≈ {a:.2} s");
    }

    /// Dimension : le son direct reste, l'image s'élargit (G ≠ D), le niveau ne bouge presque pas, en mono (G + D) la modulation se tient
    #[test]
    fn dimension_large_et_mono() {
        for v in 0..2 { for m in 0..4 {
            let mut d = Dim::new(&DimParams { mode: m, variant: v, ..Default::default() }, SR);
            let n = SR as usize; let (mut e_in, mut e_out, mut side) = (0.0, 0.0, 0.0);
            for i in 0..n { let s = 0.4 * (2.0 * PI * 330.0 * i as f64 / SR).sin(); let mut x = [s, 0.0]; d.tick(&mut x, 1);
                if i > 4800 { e_in += s * s; e_out += 0.5 * (x[0] * x[0] + x[1] * x[1]); side += (x[0] - x[1]).powi(2); } }
            let r = (e_out / e_in).sqrt();
            assert!(r > 0.75 && r < 1.3, "variante {v} mode {m} : niveau {r:.2}");
            assert!(side / e_in > 0.005, "variante {v} mode {m} : stéréo");
        } }
    }

    /// Harmoniseur : +12 → une octave au-dessus, −12 → une octave en dessous (passages par zéro), Micro garde le niveau, réinjection stable
    #[test]
    fn harmoniseur_octaves() {
        let run = |p: H910Params| {
            let mut h = H910::new(&H910Params { mix: 100.0, ..p }, SR);
            (0..(SR as usize)).map(|i| { let mut x = [0.5 * (2.0 * PI * 440.0 * i as f64 / SR).sin(), 0.0]; h.tick(&mut x, 1); x }).collect::<Vec<_>>()
        };
        let zc = |o: &Vec<[f64; 2]>, c: usize| o.windows(2).skip(4800).filter(|w| w[0][c] <= 0.0 && w[1][c] > 0.0).count() as f64 / ((o.len() - 4801) as f64 / SR);
        for v in 0..2 {
            let o = run(H910Params { pitch_l: 12.0, pitch_r: -12.0, delay: 0.0, variant: v, ..Default::default() });
            let (fl, fr) = (zc(&o, 0), zc(&o, 1));
            assert!((fl - 880.0).abs() < 60.0, "variante {v} : +12 → {fl:.0} Hz");
            assert!((fr - 220.0).abs() < 30.0, "variante {v} : −12 → {fr:.0} Hz");
        }
        let o = run(H910Params::default());
        let rms = |c: usize| (o.iter().skip(4800).map(|x| x[c] * x[c]).sum::<f64>() / (o.len() - 4800) as f64).sqrt();
        assert!((rms(0) / (0.5 / 2f64.sqrt()) - 1.0).abs() < 0.15, "Micro garde le niveau ({:.3})", rms(0));
        let o = run(H910Params { pitch_l: 3.0, pitch_r: -5.0, feedback: 90.0, delay: 80.0, ..Default::default() });
        assert!(o.iter().all(|x| x[0].is_finite() && x[0].abs() < 5.0 && x[1].abs() < 5.0), "réinjection stable");
    }

    /// Salle 80 : queue stéréo, Durée respectée, graves × qui allonge les graves, bande passante limitée (peu d'aigus au-dessus de 12 kHz)
    #[test]
    fn salle80_queue_graves_bande() {
        let ir = |p: Hall80Params| {
            let mut h = Hall80::new(&Hall80Params { pre: 0.0, mix: 100.0, ..p }, SR);
            let n = (8.0 * SR) as usize;
            (0..n).map(|i| { let mut x = [if i == 0 { 1.0 } else { 0.0 }, 0.0]; h.tick(&mut x, 1); x }).collect::<Vec<_>>()
        };
        let rt = |o: &Vec<[f64; 2]>| {
            let n = o.len(); let mut acc = vec![0.0; n + 1];
            for i in (0..n).rev() { acc[i] = acc[i + 1] + o[i][0] * o[i][0] + o[i][1] * o[i][1]; }
            let t0 = (0.1 * SR) as usize; let r = acc[t0];
            2.0 * ((t0..n).find(|&i| acc[i] < r * 1e-3).unwrap_or(n) - t0) as f64 / SR
        };
        let a = ir(Hall80Params { decay: 1.5, spin: 0.0, ..Default::default() });
        let b = ir(Hall80Params { decay: 4.0, spin: 0.0, ..Default::default() });
        let (ra, rb) = (rt(&a), rt(&b));
        assert!((ra - 1.5).abs() < 0.6, "Durée 1,5 s : RT60 ≈ {ra:.2}");
        assert!(rb > ra * 2.0, "{ra:.2} → {rb:.2}");
        let side: f64 = a.iter().map(|x| (x[0] - x[1]).powi(2)).sum();
        assert!(side > 1e-3, "queue stéréo");
        // graves × : énergie basse (< 200 Hz) de la fin de queue plus forte avec bass = 2,5 qu'avec 0,5
        let low_tail = |o: &Vec<[f64; 2]>| { let mut z = 0.0; let k = 1.0 - (-2.0 * PI * 150.0 / SR).exp(); let mut e = 0.0;
            for (i, x) in o.iter().enumerate() { z += (x[0] - z) * k; if i > (2.0 * SR) as usize { e += z * z; } } e };
        let lo = ir(Hall80Params { decay: 2.0, bass: 0.5, spin: 0.0, ..Default::default() });
        let hi = ir(Hall80Params { decay: 2.0, bass: 2.5, spin: 0.0, ..Default::default() });
        assert!(low_tail(&hi) > 4.0 * low_tail(&lo), "graves ×");
        // bande passante : pas d'aigus au-delà de ~14 kHz (différence d'échantillons = filtre passe-haut grossier)
        let hf: f64 = a.iter().skip(4800).take(48000).map(|x| x[0]).collect::<Vec<_>>().windows(2).map(|w| (w[1] - w[0]).powi(2)).sum();
        let all: f64 = a.iter().skip(4800).take(48000).map(|x| x[0] * x[0]).sum();
        assert!(hf < 0.7 * all, "queue douce ({:.3})", hf / all);
        // stabilité sur 20 s avec Durée max et mouvement max
        let mut h = Hall80::new(&Hall80Params { decay: 20.0, bass: 2.5, spin: 100.0, variant: 2, mix: 100.0, ..Default::default() }, SR);
        let mut mx = 0.0f64;
        for i in 0..(20.0 * SR) as usize { let mut x = [if i < 4800 { 0.3 * ((i as f64) * 0.05).sin() } else { 0.0 }, 0.0]; h.tick(&mut x, 1); mx = mx.max(x[0].abs()); }
        assert!(mx.is_finite() && mx < 2.0, "stable ({mx})");
    }

    /// Écho à bande : la tête 2 répète à 0,24 s à vitesse 1, à 0,48 s à vitesse 0,5 ; chaque répétition est plus sombre et plus faible
    #[test]
    fn echo_a_bande_tetes_vitesse() {
        let first = |rate: f64| {
            let mut e = TapeEcho::new(&TapeEchoParams { mode: 1, rate, intensity: 50.0, echo: 100.0, spring: 0.0, wow: 0.0, ..Default::default() }, SR);
            let n = (1.5 * SR) as usize; let mut o = vec![0.0f64; n];
            for i in 0..n { let mut x = [if i < 48 { 0.5 } else { 0.0 }, 0.0]; e.tick(&mut x, 1); o[i] = x[0]; }
            // première répétition : le plus grand pic après 50 ms
            let (i, _) = o.iter().enumerate().skip((0.05 * SR) as usize).fold((0, 0.0), |(bi, bv), (i, v)| if v.abs() > bv { (i, v.abs()) } else { (bi, bv) });
            (i as f64 / SR, o)
        };
        let (t1, o) = first(1.0);
        assert!((t1 - 0.24).abs() < 0.01, "tête 2 à vitesse 1 : {t1:.3} s");
        let (t2, _) = first(0.5);
        assert!((t2 - 0.48).abs() < 0.02, "vitesse 0,5 : {t2:.3} s");
        let pk = |a: f64, b: f64| o[(a * SR) as usize..(b * SR) as usize].iter().fold(0f64, |m, v| m.max(v.abs()));
        assert!(pk(0.45, 0.53) < pk(0.2, 0.28) * 0.8, "la 2e répétition est plus faible");
    }
}
