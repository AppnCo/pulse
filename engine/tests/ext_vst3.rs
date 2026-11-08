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
    ext::insert("vst#test", ext::Inst::Vst(std::sync::Arc::new(std::sync::Mutex::new(p))));
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
        let gg = sh.lock().unwrap();
        let ext::Inst::Vst(inner) = &*gg else { panic!() };
        let mut g = inner.lock().unwrap();
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

#[test]
fn proq4_phase_lineaire_compensee() {
    if !std::path::Path::new(PROQ).exists() { return; }
    let sr = 48_000u32;
    let mut p = vst3_host::simple::load_plugin(PROQ).expect("chargement");
    p.reconfigure(sr as f64, ext::MAX_BLOCK).expect("fréquence");
    let params = p.get_parameters().unwrap();
    let modes: Vec<String> = params.iter().filter(|q| q.name.to_lowercase().contains("phase") || q.name.to_lowercase().contains("processing")).map(|q| format!("{}={}", q.name, q.id)).collect();
    println!("réglages de phase : {modes:?}");
    let pm = params.iter().find(|q| q.name.to_lowercase().contains("phase mode") || q.name.to_lowercase().contains("processing mode")).map(|q| (q.id, q.step_count));
    let Some((pid, steps)) = pm else { println!("pas de mode de phase trouvé"); return };
    // un point allumé (sinon le linéaire ne fait rien) + mode linéaire (dernier cran)
    let id = |name: &str| params.iter().find(|q| q.name == name).map(|q| q.id).unwrap();
    p.set_parameter(id("Band 1 Used"), 1.0).unwrap(); p.set_parameter(id("Band 1 Gain"), 0.5).unwrap();   // point à 0 dB : le son ressort tel quel, seulement retardé
    p.set_parameter(pid, if steps > 0 { 1.0 } else { 1.0 }).unwrap();
    p.start_processing().unwrap();
    // la latence est annoncée après un premier passage
    let mut b = vst3_host::AudioBuffers::new(2, 2, ext::MAX_BLOCK, sr as f64); for _ in 0..4 { p.process_audio(&mut b).unwrap(); }
    let _ = p.service_host_requests();
    let lat = p.latency_samples();
    println!("latence annoncée : {lat} échantillons");
    ext::insert("vst#lin", ext::Inst::Vst(std::sync::Arc::new(std::sync::Mutex::new(p))));
    // une impulsion à 1 s
    let n = sr as usize * 3; let mut s = vec![0.0f32; n]; s[sr as usize] = 0.9;
    let mut media = render::Media::new(); media.insert("c".into(), render::Source::new(sr, vec![s.clone(), s]));
    let json = r#"{"bpm":120,"tracks":[{"name":"V","type":"audio","volume":100,"clips":[{"id":"c","start":0,"duration":3,"offset":0}],"effects":["vst#lin"]},{"name":"Ref","type":"audio","volume":100,"clips":[],"effects":[]}]}"#;
    let project: Project = serde_json::from_str(json).unwrap();
    let (l, _) = render::render_blocks(&project, &media, &render::RenderOptions { sample_rate: sr, ..Default::default() }, 512);
    let pk = |x: &[f32]| x.iter().enumerate().max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap()).map(|(i, _)| i).unwrap() as i64;
    // référence : le même projet sans plugin (le limiteur du Master retarde tout le mix pareil, c'est normal)
    let reference: Project = serde_json::from_str(&json.replace(r#""effects":["vst#lin"]"#, r#""effects":[]"#)).unwrap();
    let (l0, _) = render::render_blocks(&reference, &media, &render::RenderOptions { sample_rate: sr, ..Default::default() }, 512);
    let (a, b) = (pk(&l0), pk(&l));
    println!("impulsion sans plugin à {a}, avec Pro-Q linéaire à {b} (écart {})", b - a);
    assert!(lat > 0, "le mode linéaire doit annoncer une latence");
    assert!((b - a).abs() <= 2, "la latence de Pro-Q doit être compensée : écart {}", b - a);
}

#[test]
fn proq4_automation() {
    if !std::path::Path::new(PROQ).exists() { return; }
    let sr = 48_000u32;
    let mut p = vst3_host::simple::load_plugin(PROQ).expect("chargement");
    p.reconfigure(sr as f64, ext::MAX_BLOCK).unwrap();
    let params = p.get_parameters().unwrap();
    let id = |name: &str| params.iter().find(|q| q.name == name).map(|q| q.id).unwrap();
    p.set_parameter(id("Band 1 Used"), 1.0).unwrap();
    let gain = id("Band 1 Gain");
    p.start_processing().unwrap();
    ext::insert("vst#auto", ext::Inst::Vst(std::sync::Arc::new(std::sync::Mutex::new(p))));
    let n = sr as usize * 2;
    let s: Vec<f32> = (0..n).map(|i| 0.2 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / sr as f32).sin()).collect();
    let mut media = render::Media::new(); media.insert("c".into(), render::Source::new(sr, vec![s.clone(), s]));
    let json = format!(r#"{{"bpm":120,"tracks":[{{"name":"V","type":"audio","volume":100,"clips":[{{"id":"c","start":0,"duration":2,"offset":0}}],"effects":["vst#auto"],"automation":{{"fx:vst#auto:{gain}":{{"points":[{{"t":0,"v":0.5}},{{"t":2,"v":0.85}}]}}}}}}]}}"#);
    let project: Project = serde_json::from_str(&json).expect("projet");
    let (l, _) = render::render_blocks(&project, &media, &render::RenderOptions { sample_rate: sr, ..Default::default() }, 512);
    let w = sr as usize / 10;
    let (a, b) = (rms(&l[w..2 * w]), rms(&l[n - 2 * w..n - w]));
    println!("début {a:.4}, fin {b:.4} (×{:.2})", b / a);
    assert!(b / a > 2.0, "la courbe doit monter le gain du point : {a} → {b}");
}

/// Audio Unit avec retard (Pro-L 2 : anticipation) : retard lu et compensé comme un VST3
#[cfg(target_os = "macos")]
#[test]
fn au_pro_l2_latence_compensee() {
    use pulse_engine::ext::rack::{PluginInstance, PluginScanner};
    let sc = pulse_engine::ext::rack::au::AudioUnitScanner::new().unwrap();
    let Some(info) = sc.scan().unwrap().into_iter().find(|i| i.name.contains("Pro-L 2")) else { eprintln!("Pro-L 2 absent"); return };
    let sr = 48_000u32;
    let mut p = sc.load(&info).unwrap();
    p.initialize(sr as f64, ext::MAX_BLOCK).unwrap();
    let lat = p.latency_samples();
    println!("Pro-L 2 (AU) : latence {lat} échantillons");
    ext::insert("vst#aul", ext::Inst::Au(Box::new(p), vec![0.0; ext::MAX_BLOCK], vec![0.0; ext::MAX_BLOCK]));
    let n = sr as usize * 3; let mut s = vec![0.0f32; n]; for i in 0..2400 { s[sr as usize + i] = 0.3 * ((i as f32) * 0.2).sin(); }
    let mut media = render::Media::new(); media.insert("c".into(), render::Source::new(sr, vec![s.clone(), s]));
    let json = r#"{"bpm":120,"tracks":[{"name":"V","type":"audio","volume":100,"clips":[{"id":"c","start":0,"duration":3,"offset":0}],"effects":["vst#aul"]}]}"#;
    let project: Project = serde_json::from_str(json).unwrap();
    let reference: Project = serde_json::from_str(&json.replace(r#""effects":["vst#aul"]"#, r#""effects":[]"#)).unwrap();
    let opts = render::RenderOptions { sample_rate: sr, ..Default::default() };
    let onset = |x: &[f32]| x.iter().position(|v| v.abs() > 0.01).unwrap_or(0) as i64;
    let (a, b) = (onset(&render::render_blocks(&reference, &media, &opts, 512).0), onset(&render::render_blocks(&project, &media, &opts, 512).0));
    println!("début du son sans plugin {a}, avec Pro-L 2 {b} (écart {})", b - a);
    assert!(lat > 0, "Pro-L 2 doit annoncer un retard");
    assert!((b - a).abs() <= 48, "retard compensé : écart {}", b - a);
}
