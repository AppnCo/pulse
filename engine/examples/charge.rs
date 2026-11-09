//! Mesure de puissance : N pistes stéréo avec une chaîne d'effets lourde, rendues par blocs comme en lecture.
//! cargo run --release --example charge [-- pistes secondes]
use pulse_engine::{render::{render_blocks, RenderOptions, Source, Media}, model::Project};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let n: usize = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(48);
    let secs: f64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(20.0);
    let sr = 48_000u32;
    let mut media = Media::new();
    let len = (secs as usize) * sr as usize;
    let mut seed = 1u32;
    let mut noise = || { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); (seed >> 8) as f32 / 16777216.0 - 0.5 };
    let l: Vec<f32> = (0..len).map(|_| noise() * 0.3).collect();
    let r: Vec<f32> = (0..len).map(|_| noise() * 0.3).collect();
    media.insert("s".into(), Source::new(sr, vec![l, r]));
    // PULSE_FX="eq,comp" : chaîne choisie (par défaut eq, comp, sat, reverb)
    let list = std::env::var("PULSE_FX").unwrap_or("eq,comp,sat,reverb".into());
    let fx = format!(r#""effects":[{}],"effectParams":{{"eq":{{"low":3,"mid":-2,"high":4}},"reverb":{{"wet":20}}}}"#, list.split(',').filter(|x| !x.is_empty()).map(|x| format!("\"{x}\"")).collect::<Vec<_>>().join(","));
    let tracks: Vec<String> = (0..n).map(|i| format!(r#"{{"volume":70,"pan":{},"clips":[{{"id":"s","start":0,"duration":{secs}}}],{fx}}}"#, (i as i32 % 9 - 4) * 20)).collect();
    let p: Project = serde_json::from_str(&format!(r#"{{"tracks":[{}]}}"#, tracks.join(","))).unwrap();
    let t0 = std::time::Instant::now();
    let (out, _) = render_blocks(&p, &media, &RenderOptions { range: Some((0.0, secs)), ..Default::default() }, 512);
    let dt = t0.elapsed().as_secs_f64();
    println!("[{list}] {n} pistes, {secs} s : rendu en {dt:.2} s → {:.1}× le temps réel (charge en lecture ≈ {:.0} %), {} échantillons", secs / dt, dt / secs * 100.0, out.len());
}
