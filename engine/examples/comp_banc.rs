//! cargo run --release --example comp_banc — Banc du compresseur : repliement (aigus), distorsion des graves, par caractère.
use pulse_engine::fx::Compressor;
use pulse_engine::model::CompParams;
use std::f64::consts::PI;
fn amp(y: &[f64], f: f64, sr: f64) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    let n = y.len();
    for (i, v) in y.iter().enumerate() { let w = 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos(); let a = 2.0 * PI * f * i as f64 / sr; re += v * w * a.cos(); im += v * w * a.sin(); }
    (re * re + im * im).sqrt() * 4.0 / n as f64
}
fn run(p: &CompParams, f: f64, a: f64, sr: f64) -> Vec<f64> {
    let mut c = Compressor::new(p, sr);
    let n = (sr * 1.5) as usize;
    let mut y = Vec::new();
    for i in 0..n { let mut s = [a * (2.0 * PI * f * i as f64 / sr).sin(), 0.0]; c.tick(&mut s, 1); if i >= (sr * 0.5) as usize { y.push(s[0]); } }
    y
}
fn db(x: f64) -> f64 { 20.0 * x.max(1e-12).log10() }
fn main() {
    let sr = 48000.0;
    let names = ["Propre", "Opto", "FET", "Bus"];
    for m in 0..4 {
        let p = CompParams { threshold: Some(-24.0), ratio: Some(4.0), attack: Some(3.0), release: Some(60.0), mode: Some(m as f64), makeup: Some(0.0), ..Default::default() };
        // repliement : sinus 11 kHz → l'harmonique 3 (33 kHz) retombe à 15 kHz, la 5 (55 kHz) à 7 kHz
        let y = run(&p, 11000.0, 0.7, sr);
        let f0 = amp(&y, 11000.0, sr);
        let al = amp(&y, 15000.0, sr).max(amp(&y, 7000.0, sr));
        // graves : sinus 60 Hz, harmoniques 2 et 3 (distorsion due au gain qui suit l'onde + saturation voulue)
        let p2 = CompParams { attack: Some(1.0), release: Some(30.0), ..p.clone() };
        let y2 = run(&p2, 60.0, 0.7, sr);
        let g0 = amp(&y2, 60.0, sr);
        let (h2, h3) = (amp(&y2, 120.0, sr), amp(&y2, 180.0, sr));
        // voix : sinus 220 Hz, mêmes réglages que par défaut
        let y3 = run(&p, 220.0, 0.7, sr);
        let v0 = amp(&y3, 220.0, sr);
        let (v2, v3) = (amp(&y3, 440.0, sr), amp(&y3, 660.0, sr));
        println!("{:7} repliement {:6.1} dB | 60 Hz h2 {:6.1} h3 {:6.1} dB | 220 Hz h2 {:6.1} h3 {:6.1} dB",
            names[m], db(al / f0), db(h2 / g0), db(h3 / g0), db(v2 / v0), db(v3 / v0));
    }
}
