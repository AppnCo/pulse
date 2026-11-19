//! cargo run --release --example livetune_fichier entree.wav sortie.wav [vitesse 0–1] [bloc] — PulseTune en direct sur un fichier (banc)
use std::io::{Read, Write};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut raw = Vec::new(); std::fs::File::open(&a[1]).unwrap().read_to_end(&mut raw).unwrap();
    let k = raw.windows(4).position(|w| w == b"data").unwrap(); let n = u32::from_le_bytes(raw[k + 4..k + 8].try_into().unwrap()) as usize;
    let mut x: Vec<f32> = raw[k + 8..k + 8 + n].chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
    let sp: f64 = a.get(3).and_then(|v| v.parse().ok()).unwrap_or(1.0); let blk: usize = a.get(4).and_then(|v| v.parse().ok()).unwrap_or(64);
    let mut lt = pulse_engine::livetune::LiveTune::new(48000.0, [true; 12], sp);
    let t = std::time::Instant::now();
    for c in x.chunks_mut(blk) { lt.process(c); }
    let el = t.elapsed().as_secs_f64();
    let mut out = Vec::new(); out.extend_from_slice(&raw[..k + 8]); for v in &x { out.extend_from_slice(&v.to_le_bytes()); }
    std::fs::File::create(&a[2]).unwrap().write_all(&out).unwrap();
    println!("OK {:.1} s de voix en {:.3} s de calcul ({:.2} % du temps réel), retard {:.1} ms", n as f64 / 4.0 / 48000.0, el, el / (n as f64 / 4.0 / 48000.0) * 100.0, lt.latency() / 48.0);
}
