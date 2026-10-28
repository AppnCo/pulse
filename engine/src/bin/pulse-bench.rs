//! Banc d'essai du mixeur au fil de l'eau : un gros projet fictif (N pistes de 3 min, effets lourds, groupes, envois)
//! mixé par blocs de 1024 comme dans l'appli. Affiche la vitesse (× temps réel) et le pire bloc (en % de sa durée).
//! Usage : pulse-bench [pistes=16] [secondes=180]
use pulse_engine::model::Project;
use pulse_engine::render::{Media, RenderOptions, Renderer, Source};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let n: usize = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(16);
    let secs: f64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(180.0);
    let sr = 48_000u32;
    let len = (secs * sr as f64) as usize;
    let mut seed = 1u32;
    let mut noise = || { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; (seed as f32 / u32::MAX as f32 - 0.5) * 0.3 };
    let l: Vec<f32> = (0..len).map(|i| (i as f32 * 0.0577).sin() * 0.2 + noise()).collect();
    let r: Vec<f32> = (0..len).map(|i| (i as f32 * 0.0411).sin() * 0.2 + noise()).collect();
    let media = Media::from([("a".to_owned(), Source { sample_rate: sr, channels: vec![l, r] })]);
    let fx = [r#""effects":["eq","comp","deess","sat","delay","reverb","chorus","limit"],"effectParams":{"reverb":{"wet":20},"delay":{"wet":15},"chorus":{"wet":20},"sat":{"drive":30}}"#,
              r#""effects":["eq","comp","phaser","util"],"effectParams":{}"#];
    let tracks: Vec<String> = (0..n).map(|i| format!(r#"{{"volume":70,"pan":{},"output":"{}","sends":{{"rv":20}},{},"clips":[{{"id":"a","start":0,"duration":{secs},"offset":0}}]}}"#,
        (i as i32 % 7 - 3) * 20, if i % 2 == 0 { "g1" } else { "master" }, fx[i % 2])).collect();
    let json = format!(r#"{{"bpm":120,"sends":[{{"id":"rv","name":"Rev","type":"reverb","size":3,"volume":100}}],
        "buses":[{{"id":"g1","isGroup":true,"output":"master","volume":90,"effects":["comp","eq","reverb"],"effectParams":{{"reverb":{{"wet":15}}}}}}],
        "tracks":[{}]}}"#, tracks.join(","));
    let p: Project = serde_json::from_str(&json).expect("projet");
    let t0 = std::time::Instant::now();
    let mut ren = Renderer::new(&p, &media, &RenderOptions { sample_rate: sr, ..Default::default() });
    let setup = t0.elapsed().as_secs_f64();
    let (mut bl, mut br) = (vec![0.0f32; 1024], vec![0.0f32; 1024]);
    let block_s = 1024.0 / sr as f64;
    let (mut worst, mut total, mut blocks) = (0.0f64, 0.0f64, 0usize);
    while !ren.is_done() {
        let t = std::time::Instant::now();
        ren.process(&media, &mut bl, &mut br);
        let d = t.elapsed().as_secs_f64();
        worst = worst.max(d);
        total += d;
        blocks += 1;
    }
    let audio = blocks as f64 * block_s;
    println!("{n} pistes × {secs} s (+ queue) : préparation {:.1} ms, mixage {:.2} s pour {:.0} s de son = {:.1}× le temps réel ; pire bloc {:.2} ms sur {:.1} ms ({:.0} %)",
        setup * 1000.0, total, audio, audio / total, worst * 1000.0, block_s * 1000.0, worst / block_s * 100.0);
}
