//! cargo run --release --example pitch_fichier entree.wav sortie.wav demi-tons formant — Pitch « voix fidèle » sur un fichier (banc)
//! Entrée : WAV mono 16/24/32 bits. Sortie : WAV mono flottant 32 bits, retard retiré.
use std::io::{Read, Write};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut raw = Vec::new(); std::fs::File::open(&a[1]).unwrap().read_to_end(&mut raw).unwrap();
    let f = raw.windows(4).position(|w| w == b"fmt ").unwrap();
    let bits = u16::from_le_bytes([raw[f + 22], raw[f + 23]]) as usize; let sr = u32::from_le_bytes(raw[f + 12..f + 16].try_into().unwrap()) as f64;
    let k = raw.windows(4).position(|w| w == b"data").unwrap(); let n = u32::from_le_bytes(raw[k + 4..k + 8].try_into().unwrap()) as usize;
    let d = &raw[k + 8..(k + 8 + n).min(raw.len())]; let bb = bits / 8;
    let x: Vec<f64> = d.chunks_exact(bb).map(|c| match bits {
        16 => i16::from_le_bytes([c[0], c[1]]) as f64 / 32768.0,
        24 => (((c[0] as i32) << 8 | (c[1] as i32) << 16 | (c[2] as i32) << 24) >> 8) as f64 / 8388608.0,
        _ => f32::from_le_bytes(c.try_into().unwrap()) as f64 }).collect();
    let p = pulse_engine::model::PitchParams { semi: a.get(3).and_then(|v| v.parse().ok()), formant: a.get(4).and_then(|v| v.parse().ok()), mix: None };
    let mut pt = pulse_engine::pitch::Pitch::new(&p, sr);
    let lat = pt.latency(); let mut y = Vec::with_capacity(x.len());
    let t = std::time::Instant::now();
    for i in 0..x.len() + lat { let mut s = [if i < x.len() { x[i] } else { 0.0 }, 0.0]; pt.tick(&mut s, 1); if i >= lat { y.push(s[0] as f32); } }
    let el = t.elapsed().as_secs_f64();
    let mut out = Vec::new(); let len = (y.len() * 4) as u32;
    out.extend_from_slice(b"RIFF"); out.extend_from_slice(&(36 + len).to_le_bytes()); out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); out.extend_from_slice(&3u16.to_le_bytes()); out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(sr as u32).to_le_bytes()); out.extend_from_slice(&(sr as u32 * 4).to_le_bytes()); out.extend_from_slice(&4u16.to_le_bytes()); out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data"); out.extend_from_slice(&len.to_le_bytes()); for v in &y { out.extend_from_slice(&v.to_le_bytes()); }
    std::fs::File::create(&a[2]).unwrap().write_all(&out).unwrap();
    println!("OK {:.1} s en {:.2} s ({:.1} % du temps réel), retard {:.1} ms", x.len() as f64 / sr, el, el / (x.len() as f64 / sr) * 100.0, lat as f64 / sr * 1000.0);
}
