//! cargo run --release --example limit_banc — Banc du limiteur : écrêtage résiduel, pic réel, distorsion, par style.
use pulse_engine::fx::Limiter;
use pulse_engine::model::LimitParams;
use std::f64::consts::PI;
fn main() {
    let sr = 48000.0;
    // batterie de synthèse : coups (bruit qui décroît vite) + basse 55 Hz, +8 dB au-dessus du plafond
    let n = (sr * 4.0) as usize;
    let mut seed = 1u32; let mut rnd = || { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); seed as f64 / 4294967296.0 * 2.0 - 1.0 };
    // bruit coupé vers 16 kHz (moyenne de 3 tirages décalés : zéro à 16 kHz et au-delà, comme une vraie musique)
    let mut z = [0.0f64; 2];
    let x: Vec<f64> = (0..n).map(|i| { let t = i as f64 / sr; let b = (t * 4.0).fract(); let r = rnd(); let w = (r + z[0] + z[1]) / 3.0 * 1.7; z[1] = z[0]; z[0] = r; 0.9 * w * (-b * 40.0).exp() + 0.5 * (2.0 * PI * 55.0 * t).sin() + 0.3 * (2.0 * PI * 3000.0 * t).sin() * (-b * 20.0).exp() }).collect();
    // MIX=fichier brut f64 (44,1 kHz) : vraie musique à la place de la batterie de synthèse
    let (x, sr) = if let Ok(f) = std::env::var("MIX") { let b = std::fs::read(f).unwrap(); (b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect::<Vec<f64>>(), 44100.0) } else { (x, sr) };
    let n = x.len();
    for (sty, tp) in [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (2.0, 1.0)] {
        let p = LimitParams { ceiling: Some(-1.0), gain: Some(8.0), style: Some(sty), tp: Some(tp), ..Default::default() };
        let mut l = Limiter::with(&p, -1.0, sr);
        let thr = 10f64.powf(-1.0 / 20.0);
        let mut y = Vec::with_capacity(n);
        let mut clamped = 0usize; let thr_c = thr * 0.99999;
        for &v in &x { let mut s = [v, v]; let pre = { let lat = 0; lat }; let _ = pre; l.tick(&mut s); if s[0].abs() > thr_c { clamped += 1; } y.push(s[0]); }
        // pic réel (×8 par interpolation sinc fenêtrée)
        let mut tpk = 0.0f64;
        for i in 32..n - 32 { for k in 1..8 { let f = k as f64 / 8.0; let mut s = 0.0; for j in -16i64..=16 { let d = j as f64 - f; let w = 0.5 + 0.5 * (PI * d / 17.0).cos(); s += y[(i as i64 + j) as usize] * (PI * d).sin() / (PI * d) * w; } tpk = tpk.max(s.abs()); } }
        println!("style {sty} pic réel {tp} : échantillons écrêtés {:.3} % | pic réel {:+.2} dB / plafond", clamped as f64 / n as f64 * 100.0, 20.0 * (tpk / thr).log10());
    }
}
