//! EQ Horizon : égaliseur de mastering moderne (esprit « Air/Earth »), dans la gamme Pulse.
//! - 5 bandes : cloche, cloche serrée (pour corriger précisément), plateau (bandes 1 et 5) ; fréquence 10 Hz-30 kHz, gain ±18 dB, largeur Q 0,1-7 ;
//!   chacune sur le son entier, le Centre ou les Côtés.
//! - Coupe-bas et coupe-haut de 6 à 36 dB/oct.
//! - Terre (un bouton : le grave profond, comme un bon transfo, mais propre) et Ciel (un bouton : l'aigu ouvert, sans dureté).
//! - Caractère de −1 (Eau : le sommet des courbes s'arrondit) à +1 (Feu : l'énergie se resserre sur la fréquence), 0 = Neutre.
//! - Force 0-150 % : dose tout l'EQ (les gains, donc pas de « phasing » d'un mélange), entrée et sortie.
//! Tout est linéaire, sans retard (pas de suréchantillonnage). Même calcul que `horizonCoefs` / worklet `pulse-horizon` (audio.js).
use crate::fx::{eq_matched, Biquad};

#[derive(Clone, Debug)]
pub struct HBand { pub on: bool, pub typ: usize, pub f: f64, pub g: f64, pub q: f64, pub ch: usize }
#[derive(Clone, Debug)]
pub struct HorizonParams {
    pub b: [HBand; 5],
    pub hp_on: bool, pub hp_f: f64, pub hp_s: usize,
    pub lp_on: bool, pub lp_f: f64, pub lp_s: usize,
    pub earth: f64, pub air: f64, pub character: f64, pub strength: f64, pub input: f64, pub output: f64,
}
pub const H_DEF_F: [f64; 5] = [60.0, 250.0, 1_000.0, 4_000.0, 12_000.0];
impl Default for HorizonParams {
    fn default() -> Self {
        let b = |i: usize| HBand { on: true, typ: if i == 0 || i == 4 { 2 } else { 0 }, f: H_DEF_F[i], g: 0.0, q: 0.7, ch: 0 };
        Self { b: [b(0), b(1), b(2), b(3), b(4)], hp_on: false, hp_f: 30.0, hp_s: 1, lp_on: false, lp_f: 20_000.0, lp_s: 1, earth: 0.0, air: 0.0, character: 0.0, strength: 100.0, input: 0.0, output: 0.0 }
    }
}
impl From<&crate::model::HorizonJson> for HorizonParams {
    fn from(j: &crate::model::HorizonJson) -> Self {
        let mut p = Self::default();
        if let Some(m) = &j.0 { for (k, v) in m { if let Some(v) = v.as_f64() { p.set_key(k, v); } } }
        p
    }
}
impl HorizonParams {
    /// clés : on1…on5, typ1…, f1…, g1…, q1…, ch1… ; hpOn, hpF, hpS, lpOn, lpF, lpS, earth, air, char, strength, input, output
    pub fn set_key(&mut self, k: &str, v: f64) -> bool {
        let ix = |v: f64, m: usize| (v.round().max(0.0) as usize).min(m);
        match k {
            "hpOn" => self.hp_on = v >= 0.5, "hpF" => self.hp_f = v, "hpS" => self.hp_s = ix(v, 4), "lpOn" => self.lp_on = v >= 0.5, "lpF" => self.lp_f = v, "lpS" => self.lp_s = ix(v, 4),
            "earth" => self.earth = v, "air" => self.air = v, "char" => self.character = v, "strength" => self.strength = v, "input" => self.input = v, "output" => self.output = v,
            _ => {
                let (name, n) = k.split_at(k.len().saturating_sub(1));
                let Ok(i) = n.parse::<usize>() else { return false };
                if !(1..=5).contains(&i) { return false; }
                let b = &mut self.b[i - 1];
                match name { "on" => b.on = v >= 0.5, "typ" => b.typ = ix(v, 2), "f" => b.f = v, "g" => b.g = v, "q" => b.q = v, "ch" => b.ch = ix(v, 2), _ => return false }
            }
        }
        true
    }
}
/// Pentes des filtres : 6, 12, 18, 24, 36 dB/oct → filtres du 1er ordre et sections du 2e ordre (Butterworth)
const H_SLOPE_Q: [&[f64]; 5] = [&[], &[0.707_106_781], &[1.0], &[0.541_196_1, 1.306_563], &[0.517_638_1, 0.707_106_781, 1.931_851_6]];

/// Les filtres de l'EQ (mêmes que horizonCoefs dans audio.js) : (filtre, 0 = partout · 1 = centre · 2 = côtés)
pub fn horizon_filters(p: &HorizonParams, sr: f64) -> Vec<(Biquad, usize)> {
    let mut out: Vec<(Biquad, usize)> = Vec::new();
    for (on, f, s, hp) in [(p.hp_on, p.hp_f, p.hp_s, true), (p.lp_on, p.lp_f, p.lp_s, false)] {
        if !on { continue; }
        let f = f.clamp(10.0, 30_000.0).min(sr * 0.45);
        if s == 0 || s == 2 { out.push((Biquad::first_order(hp, f, sr), 0)); }
        for q in H_SLOPE_Q[s.min(4)] { out.push((eq_matched(if hp { "highpass" } else { "lowpass" }, f, *q, 0.0, sr), 0)); }
    }
    let k = (p.strength.clamp(0.0, 150.0)) / 100.0;
    let c = p.character.clamp(-1.0, 1.0);
    for (i, b) in p.b.iter().enumerate() {
        let g = b.g.clamp(-18.0, 18.0) * k;
        if !b.on || g.abs() < 1e-6 { continue; }
        let f = b.f.clamp(10.0, 30_000.0).min(sr * 0.45);
        let q = b.q.clamp(0.1, 7.0);
        let shelf = b.typ == 2 && (i == 0 || i == 4);
        if shelf {
            // Feu : plateau plus franc (petite bosse) ; Eau : plateau plus doux
            let sq = (0.707 * (1.0 + 0.4 * c)).max(0.4);
            out.push((eq_matched(if i == 0 { "lowshelf" } else { "highshelf" }, f, sq, g, sr), b.ch));
        } else {
            let q = if b.typ == 1 { q * 4.0 } else { q };
            if c >= 0.0 {
                // Feu : l'énergie se resserre autour de la fréquence
                out.push((eq_matched("peaking", f, q * (1.0 + c), g, sr), b.ch));
            } else {
                // Eau : deux cloches à moitié, un peu écartées : le sommet s'arrondit
                let r = 1.0 + 0.35 * (-c);
                let g1 = g * (1.0 + c * 0.5);
                if g1.abs() > 1e-9 { out.push((eq_matched("peaking", f, q, g1, sr), b.ch)); }
                let g2 = (g - g1) / 2.0;
                out.push((eq_matched("peaking", f / r, q * 1.2, g2, sr), b.ch));
                out.push((eq_matched("peaking", f * r, q * 1.2, g2, sr), b.ch));
            }
        }
    }
    // Terre : plateau grave à 45 Hz, une pointe de bosse (le « poids » d'un transfo), jusqu'à +9 dB ; Ciel : plateau très doux à 14 kHz, jusqu'à +8 dB
    let e = p.earth.clamp(0.0, 10.0) * 0.9 * k;
    if e > 1e-6 { out.push((eq_matched("lowshelf", 45.0, 0.9, e, sr), 0)); }
    let a = p.air.clamp(0.0, 10.0) * 0.8 * k;
    if a > 1e-6 { out.push((eq_matched("highshelf", 14_000.0_f64.min(sr * 0.4), 0.5, a, sr), 0)); }
    out
}

pub struct Horizon {
    sr: f64,
    f: Vec<(Biquad, Biquad, usize)>,
    gin: f64,
    gout: f64,
}
impl Horizon {
    pub fn new(p: &HorizonParams, sr: f64) -> Self { let mut s = Self { sr, f: Vec::new(), gin: 1.0, gout: 1.0 }; s.set(p); s }
    pub fn set(&mut self, p: &HorizonParams) {
        let n = horizon_filters(p, self.sr);
        if n.len() == self.f.len() && n.iter().zip(&self.f).all(|(a, b)| a.1 == b.2) {
            for (o, (b, _)) in self.f.iter_mut().zip(n) { o.0.retune(b); o.1.retune(b); }
        } else { self.f = n.into_iter().map(|(b, c)| (b, b, c)).collect(); }
        self.gin = 10f64.powf(p.input.clamp(-18.0, 18.0) / 20.0);
        self.gout = 10f64.powf(p.output.clamp(-18.0, 18.0) / 20.0);
    }
    pub fn tick(&mut self, x: &mut [f64; 2], nc: usize) {
        if nc < 2 {
            let mut m = x[0] * self.gin;
            for (b, _, c) in self.f.iter_mut() { if *c != 2 { m = b.tick(m); } }
            x[0] = m * self.gout;
            return;
        }
        // centre et côtés : chaque filtre agit sur l'un, l'autre ou les deux
        let (l, r) = (x[0] * self.gin, x[1] * self.gin);
        let (mut m, mut s) = ((l + r) * 0.5, (l - r) * 0.5);
        for (bm, bs, c) in self.f.iter_mut() {
            if *c != 2 { m = bm.tick(m); }
            if *c != 1 { s = bs.tick(s); }
        }
        x[0] = (m + s) * self.gout;
        x[1] = (m - s) * self.gout;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;
    const SR: f64 = 48_000.0;
    fn lv(p: &HorizonParams, f: f64) -> f64 {
        let mut h = Horizon::new(p, SR);
        let n = 48_000;
        let (mut a, mut b) = (0.0, 0.0);
        for i in 0..n { let v = 0.1 * (2.0 * PI * f * i as f64 / SR).sin(); let mut x = [v, v]; h.tick(&mut x, 2); if i >= n / 2 { a += x[0] * x[0]; b += v * v; } }
        10.0 * (a / b).log10()
    }
    #[test]
    fn horizon_bandes_terre_ciel_force() {
        let mut p = HorizonParams::default();
        assert!(lv(&p, 1000.0).abs() < 0.01, "à plat");
        p.b[2].g = 6.0; p.b[2].f = 1000.0;
        assert!((lv(&p, 1000.0) - 6.0).abs() < 0.2, "+6 à 1 kHz : {:.2}", lv(&p, 1000.0));
        let mut half = p.clone(); half.strength = 50.0;
        assert!((lv(&half, 1000.0) - 3.0).abs() < 0.2, "Force 50 % : {:.2}", lv(&half, 1000.0));
        let mut fire = p.clone(); fire.character = 1.0;
        let mut water = p.clone(); water.character = -1.0;
        assert!(lv(&fire, 1600.0) < lv(&p, 1600.0) - 1.0, "Feu plus resserré");
        // Eau : le sommet s'aplatit (à 1,3 kHz on garde une plus grande part du gain du centre)
        assert!(lv(&water, 1300.0) / lv(&water, 1000.0) > lv(&p, 1300.0) / lv(&p, 1000.0) + 0.03, "Eau plus arrondie : {:.3} contre {:.3}", lv(&water, 1300.0) / lv(&water, 1000.0), lv(&p, 1300.0) / lv(&p, 1000.0));
        let mut e = HorizonParams::default(); e.earth = 10.0;
        assert!(lv(&e, 30.0) > 7.0 && lv(&e, 500.0) < 0.5, "Terre : {:.1} dB à 30 Hz, {:.2} à 500 Hz", lv(&e, 30.0), lv(&e, 500.0));
        let mut a = HorizonParams::default(); a.air = 10.0;
        assert!(lv(&a, 18_000.0) > 5.0 && lv(&a, 1000.0) < 0.3, "Ciel");
        let mut hp = HorizonParams::default(); hp.hp_on = true; hp.hp_f = 100.0; hp.hp_s = 4;
        assert!(lv(&hp, 50.0) < -30.0, "coupe-bas 36 dB/oct : {:.1}", lv(&hp, 50.0));
    }
    /// Centre / Côtés : un son identique des deux côtés (tout au centre) n'est pas touché par une bande sur les Côtés
    #[test]
    fn horizon_centre_cotes() {
        let mut p = HorizonParams::default(); p.b[2].g = 10.0; p.b[2].ch = 2;
        assert!(lv(&p, 1000.0).abs() < 0.01, "bande sur les côtés, son au centre : rien");
        p.b[2].ch = 1;
        assert!((lv(&p, 1000.0) - 10.0).abs() < 0.3, "bande au centre : +10");
    }
}
