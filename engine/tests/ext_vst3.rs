//! Plugin externe (VST3) dans le vrai moteur : un projet avec FabFilter Pro-Q 4 sur une piste.
//! Mac seulement, si le plugin est installé ; lancer avec `cargo test --features ext --test ext_vst3`.
#![cfg(feature = "ext")]
use pulse_engine::{ext, model::Project, render};

const PROQ: &str = "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 4.vst3";

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt() }

#[test]
fn proq4_dans_le_moteur() {
    if !std::path::Path::new(PROQ).exists() { eprintln!("Pro-Q 4 absent : test sauté"); return; }
    let sr = 48_000u32;
    let mut p = vst3_host::simple::load_plugin(PROQ).expect("chargement");
    p.reconfigure(sr as f64, ext::MAX_BLOCK).expect("fréquence");
    p.start_processing().expect("démarrage");
    ext::insert("vst#test", p);
    // un son de 2 s : sinus 1 kHz
    let n = sr as usize * 2;
    let s: Vec<f32> = (0..n).map(|i| 0.3 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / sr as f32).sin()).collect();
    let mut media = render::Media::new();
    media.insert("c".into(), render::Source::new(sr, vec![s.clone(), s.clone()]));
    let json = r#"{"bpm":120,"tracks":[{"name":"Voix","type":"audio","volume":100,"clips":[{"id":"c","mediaId":"son","start":0,"duration":2,"offset":0}],"effects":["vst#test"],"effectParams":{"vst#test":{"path":"x"}}}]}"#;
    let project: Project = serde_json::from_str(json).expect("projet");
    let opts = render::RenderOptions { sample_rate: sr, ..Default::default() };
    let (l0, _) = render::render_blocks(&project, &media, &opts, 512);
    // Pro-Q neutre : le son passe à l'identique (au volume de la piste près)
    let a = rms(&l0[sr as usize / 2..sr as usize * 3 / 2]);
    // point 1 : allumé, cloche à 1 kHz +12 dB environ → le niveau monte nettement
    {
        let sh = ext::get("vst#test").unwrap();
        let mut g = sh.lock().unwrap();
        let params = g.get_parameters().unwrap();
        let id = |name: &str| params.iter().find(|q| q.name == name).map(|q| q.id).expect(name);
        g.set_parameter(id("Band 1 Used"), 1.0).unwrap();
        g.set_parameter(id("Band 1 Enabled"), 1.0).unwrap();
        g.set_parameter(id("Band 1 Gain"), 0.85).unwrap();
        println!("fréquence par défaut : {}", g.format_parameter(id("Band 1 Frequency"), g.get_parameter(id("Band 1 Frequency")).unwrap()).unwrap_or_default());
        println!("gain : {}", g.format_parameter(id("Band 1 Gain"), 0.85).unwrap_or_default());
    }
    let (l1, _) = render::render_blocks(&project, &media, &opts, 512);
    let b = rms(&l1[sr as usize / 2..sr as usize * 3 / 2]);
    println!("niveau sans point {a:.4}, avec point {b:.4} (×{:.2})", b / a);
    assert!(a > 0.05, "le son doit passer : {a}");
    assert!((b / a - 1.0).abs() > 0.2, "le point de l'EQ doit changer le son : {a} → {b}");
}
