//! cargo run --release --example eq_banc — Écart (dB) entre chaque filtre de l'EQ et le filtre analogique visé, jusqu'à 20 kHz.
use pulse_engine::fx::eq_matched;
use std::f64::consts::PI;
fn main() {
    let sr = 48000.0;
    let cases: &[(&str, f64, f64, f64)] = &[("peaking", 1000.0, 1.0, 12.0), ("peaking", 8000.0, 1.0, 12.0), ("peaking", 12000.0, 2.0, -12.0), ("peaking", 16000.0, 0.7, 9.0),
        ("peaking", 18000.0, 4.0, -15.0), ("lowshelf", 100.0, 0.7071, 6.0), ("highshelf", 10000.0, 0.7071, 6.0), ("highshelf", 16000.0, 0.7071, -8.0),
        ("highpass", 80.0, 0.7071, 0.0), ("lowpass", 12000.0, 0.7071, 0.0), ("lowpass", 18000.0, 1.5, 0.0)];
    for &(k, f0, q, g) in cases {
        let mut b = eq_matched(k, f0, q, g, sr);
        let n = 1 << 15;
        let h: Vec<f64> = (0..n).map(|i| b.tick(if i == 0 { 1.0 } else { 0.0 })).collect();
        let mut worst: (f64, f64) = (0.0, 0.0);
        let mut f = 20.0;
        while f <= 20000.0 {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, v) in h.iter().enumerate() { let a = 2.0 * PI * f * i as f64 / sr; re += v * a.cos(); im -= v * a.sin(); }
            let dig = 10.0 * (re * re + im * im).log10();
            // analogique visé
            let w = f / f0;
            let (nr, ni, dr, di) = match k {
                "peaking" => { let a = 10f64.powf(g / 40.0); (1.0 - w * w, w * a / q, 1.0 - w * w, w / (a * q)) }
                "lowshelf" => { let a = 10f64.powf(g / 40.0); let sa = a.sqrt(); (a * (a - w * w), a * w * sa / q, 1.0 - a * w * w, w * sa / q) }
                "highshelf" => { let a = 10f64.powf(g / 40.0); let sa = a.sqrt(); (a * (1.0 - a * w * w), a * w * sa / q, a - w * w, w * sa / q) }
                "highpass" => (-w * w, 0.0, 1.0 - w * w, w / q),
                _ => (1.0, 0.0, 1.0 - w * w, w / q),
            };
            let ana = 10.0 * ((nr * nr + ni * ni) / (dr * dr + di * di)).log10();
            let e = dig - ana;
            if e.abs() > worst.0.abs() && ana > -40.0 { worst = (e, f); }
            f *= 1.02;
        }
        println!("{:9} {:6} Hz Q {:4} {:+5} dB : écart max {:+6.2} dB à {:6.0} Hz", k, f0, q, g, worst.0, worst.1);
    }
}
