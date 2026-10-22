//! Pulse — moteur audio natif (v0.1 : lecture .pulse + mixage hors-ligne).
pub mod file;
pub mod fx;
pub mod model;
pub mod player;
pub mod render;

#[cfg(test)]
mod tests {
    use crate::model::{Bus, Clip, Project, Track};
    use crate::render::{render, Media, RenderOptions, Source};
    use std::f64::consts::FRAC_1_SQRT_2;

    const SR: u32 = 48_000;

    /// Rampe : la valeur d'un échantillon donne sa position dans la source (t / 10 s).
    fn ramp_media() -> Media {
        let n = SR as usize * 10;
        let data: Vec<f32> = (0..n).map(|i| i as f32 / n as f32).collect();
        Media::from([("a".to_owned(), Source { sample_rate: SR, channels: vec![data] })])
    }
    fn clip(start: f64, duration: f64, offset: f64) -> Clip {
        Clip { id: "a".into(), start, duration, offset: Some(offset), ..Default::default() }
    }
    fn project(clips: Vec<Clip>) -> Project {
        Project { tracks: vec![Track { volume: Some(100.0), clips, ..Default::default() }], ..Default::default() }
    }
    fn opts() -> RenderOptions {
        RenderOptions { master_volume: 1.0, ..Default::default() }
    }
    /// Valeur (canal gauche) à `t`, ramenée au niveau source (pan centre = 1/√2).
    fn at(p: &Project, o: &RenderOptions, t: f64) -> f64 {
        let (l, _) = render(p, &ramp_media(), o);
        l[(t * SR as f64).round() as usize] as f64 / FRAC_1_SQRT_2
    }
    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 2e-3, "{a} != {b}");
    }

    #[test]
    fn offset_dans_la_source() {
        let p = project(vec![clip(1.0, 2.0, 3.0)]);
        close(at(&p, &opts(), 1.5), 0.35);
        close(at(&p, &opts(), 0.5), 0.0);
        let (l, _) = render(&p, &ramp_media(), &opts());
        assert_eq!(l.len(), 3 * SR as usize);
    }

    #[test]
    fn repetition_reboucle_sur_la_portion() {
        let mut c = clip(0.0, 1.0, 2.0);
        c.loop_end = Some(3.5);
        close(at(&project(vec![c]), &opts(), 2.25), 0.225);
    }

    #[test]
    fn fondus_et_gain() {
        let mut c = clip(0.0, 2.0, 5.0);
        c.fade_in = Some(1.0);
        c.fade_out = Some(1.0);
        c.gain = Some(0.5);
        let p = project(vec![c]);
        close(at(&p, &opts(), 0.5), 0.55 * 0.5 * 0.5);
        close(at(&p, &opts(), 1.5), 0.65 * 0.5 * 0.5);
    }

    #[test]
    fn fondu_arrondi() {
        let mut c = clip(0.0, 2.0, 5.0);
        c.fade_in = Some(1.0);
        c.fade_in_curve = Some(2.0); // niveau = p^2 : plus doux au début
        let p = project(vec![c]);
        // x = 0,5 s → p = 0,5 → 0,25 (au lieu de 0,5 droit)
        close(at(&p, &opts(), 0.5), 0.55 * 0.25);
    }

    #[test]
    fn plage_seule() {
        let p = project(vec![clip(0.0, 4.0, 0.0)]);
        let o = RenderOptions { range: Some((1.0, 2.0)), master_volume: 1.0, ..Default::default() };
        let (l, _) = render(&p, &ramp_media(), &o);
        assert_eq!(l.len(), SR as usize);
        close(l[SR as usize / 2] as f64 / FRAC_1_SQRT_2, 0.15);
    }

    #[test]
    fn groupes_chaines_et_mute() {
        let mut p = project(vec![clip(0.0, 2.0, 5.0)]);
        p.tracks[0].output = Some("g".into());
        p.buses = vec![
            Bus { id: "g".into(), output: Some("m2".into()), volume: Some(50.0), ..Default::default() },
            Bus { id: "m2".into(), output: Some("master".into()), volume: Some(50.0), ..Default::default() },
        ];
        close(at(&p, &opts(), 1.0), 0.6 * 0.25);
        // Un stem ignore les groupes
        let stem = RenderOptions { only_track: Some(0), ..opts() };
        close(at(&p, &stem, 1.0), 0.6);
        p.buses[0].muted = true;
        close(at(&p, &opts(), 1.0), 0.0);
    }

    #[test]
    fn mute_et_solo() {
        let mut p = project(vec![clip(0.0, 1.0, 0.0)]);
        p.tracks.push(p.tracks[0].clone());
        close(at(&p, &opts(), 0.5), 0.1);
        p.tracks[0].muted = true;
        close(at(&p, &opts(), 0.5), 0.05);
        p.tracks[0].muted = false;
        p.tracks[1].solo = true;
        close(at(&p, &opts(), 0.5), 0.05);
    }

    /// Gain (dB) de la chaîne d'une piste sur un sinus à `freq`, d'amplitude `amp`.
    fn gain_db(track: &Track, freq: f64, amp: f64) -> f64 {
        let n = 2 * SR as usize;
        let mut buf: Vec<f32> = (0..n).map(|i| (amp * (2.0 * std::f64::consts::PI * freq * i as f64 / SR as f64).sin()) as f32).collect();
        crate::fx::Chain::for_track(track, SR as f64, 90.0).process(&mut buf, &mut [], true);
        let rms = |x: &[f32]| (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt();
        20.0 * (rms(&buf[n / 2..]) / (amp / 2f64.sqrt())).log10()
    }
    fn eq_gain_db(track: &Track, freq: f64) -> f64 {
        gain_db(track, freq, 0.25)
    }

    /// Mêmes chiffres que tests/scenarios/deesser-groupe.mjs : le navigateur et Rust doivent sonner pareil.
    #[test]
    fn deesser_comme_le_navigateur() {
        let t: Track = serde_json::from_str(r#"{"effects":["deess"],"effectParams":{"deess":{"amount":60}}}"#).unwrap();
        assert!((gain_db(&t, 7500.0, 0.3) + 6.97).abs() < 0.2, "sifflante : {}", gain_db(&t, 7500.0, 0.3));
        assert!((gain_db(&t, 7500.0, 0.03) + 6.99).abs() < 0.2, "sifflante faible : {}", gain_db(&t, 7500.0, 0.03));
        assert!(gain_db(&t, 150.0, 0.4).abs() < 0.05, "grave intact : {}", gain_db(&t, 150.0, 0.4));
    }

    /// Valeurs mesurées dans Chrome (export d'une piste : 0,1 s de La 440 à 0,5 puis silence).
    #[test]
    fn reverb_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut burst = vec![0.0f32; sr];
        for (i, v) in burst.iter_mut().take(4800).enumerate() {
            *v = (0.5 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / SR as f64).sin()) as f32;
        }
        media.insert("clap".into(), Source { channels: vec![burst], sample_rate: SR });
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let run = |extra: &str| {
            let json = format!(r#"{{"tracks":[{{"volume":100,"clips":[{{"id":"clap","start":0,"duration":1}}]{extra}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() })
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 2e-5, "{v} au lieu de {want}");

        let (l, r) = run(r#","effects":["reverb"],"effectParams":{"reverb":{"wet":22,"size":1.92}}"#);
        assert_eq!(l.len(), (3.5 * SR as f64) as usize, "queue de 2,5 s");
        near(rms(&l, 0.0, 0.1), 0.203809);
        near(rms(&l, 0.3, 0.9), 0.009684);
        near(rms(&r, 0.3, 0.9), 0.018137);

        let (l, r) = run(r#","pan":-50,"effects":["reverb"],"effectParams":{"reverb":{"wet":60,"size":3.2}}"#);
        near(rms(&l, 0.0, 0.1), 0.219652);
        near(rms(&l, 0.3, 0.9), 0.224099);
        near(rms(&r, 0.3, 0.9), 0.143765);
        near(rms(&l, 1.5, 2.5), 0.005723);
    }

    /// Deux pistes dans un groupe « Grande salle » (compresseur + reverb), lui-même dans un groupe sans effet.
    /// Valeurs mesurées dans Chrome sur l'export complet.
    #[test]
    fn groupe_avec_effets_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut burst = vec![0.0f32; sr];
        for (i, v) in burst.iter_mut().take(4800).enumerate() {
            *v = (0.5 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / SR as f64).sin()) as f32;
        }
        media.insert("clap".into(), Source { channels: vec![burst], sample_rate: SR });
        let p: Project = serde_json::from_str(r#"{"buses":[
            {"id":"voix","output":"mix","volume":50,"effects":["comp","reverb"],"effectParams":{"comp":{"ratio":2.18,"threshold":-16,"attack":10,"release":50},"reverb":{"wet":19,"size":1.84}}},
            {"id":"mix","output":"master","volume":80}],
            "tracks":[{"volume":100,"pan":-50,"output":"voix","clips":[{"id":"clap","start":0,"duration":1}]},
                      {"volume":60,"output":"voix","clips":[{"id":"clap","start":0.05,"duration":0.9}]}]}"#).unwrap();
        let (l, r) = render(&p, &media, &RenderOptions::default()); // master à 80 %, comme le navigateur
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.015, "{v} au lieu de {want}");
        assert_eq!(l.len(), (3.5 * SR as f64) as usize);
        near(rms(&l, 0.06, 0.1), 0.100054);
        near(rms(&r, 0.06, 0.1), 0.060533);
        near(rms(&l, 0.3, 0.9), 0.002814);
        near(rms(&r, 0.3, 0.9), 0.007228);
    }

    /// Écho calé sur le rythme : à 120 BPM, ½ temps = 0,25 s. Valeurs mesurées dans Chrome.
    #[test]
    fn echo_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut burst = vec![0.0f32; sr];
        for (i, v) in burst.iter_mut().take(4800).enumerate() {
            *v = (0.5 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / SR as f64).sin()) as f32;
        }
        media.insert("clap".into(), Source { channels: vec![burst], sample_rate: SR });
        let run = |bpm: f64, delay: &str| {
            let json = format!(r#"{{"bpm":{bpm},"tracks":[{{"volume":100,"clips":[{{"id":"clap","start":0,"duration":1}}],"effects":["delay"],"effectParams":{{"delay":{delay}}}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() }).0
        };
        let rms = |x: &[f32], a: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, ((a + 0.1) * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 1e-5, "{v} au lieu de {want}");
        let l = run(120.0, r#"{"wet":25,"feedback":38,"beats":0.5}"#);
        assert_eq!(l.len(), 5 * sr, "queue de 4 s");
        near(rms(&l, 0.0), 0.24999);
        near(rms(&l, 0.25), 0.06249);
        near(rms(&l, 0.5), 0.02360);
        near(rms(&l, 0.75), 0.00891);
        near(rms(&l, 0.12), 0.0);
        // Le tempo change : l'écho suit
        let l = run(60.0, r#"{"wet":25,"feedback":38,"beats":0.5}"#);
        near(rms(&l, 0.25), 0.0);
        near(rms(&l, 0.5), 0.06249);
        // En millisecondes : le tempo ne compte plus
        let l = run(120.0, r#"{"wet":25,"feedback":38,"ms":400}"#);
        near(rms(&l, 0.25), 0.0);
        near(rms(&l, 0.4), 0.06249);
    }

    /// Envois de base (Rev Long, Del 1/4) : valeurs mesurées dans Chrome sur l'export complet à 120 BPM.
    #[test]
    fn envois_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut burst = vec![0.0f32; sr];
        for (i, v) in burst.iter_mut().take(4800).enumerate() {
            *v = (0.5 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / SR as f64).sin()) as f32;
        }
        media.insert("clap".into(), Source { channels: vec![burst], sample_rate: SR });
        let run = |sends: &str, extra: &str| {
            let json = format!(r#"{{"bpm":120,"sends":[{{"id":"revlong","type":"reverb","size":3.2,"pre":0,"volume":100}},{{"id":"del14","type":"delay","beats":1,"feedback":35,"volume":100}}],
                "tracks":[{{"volume":100,"clips":[{{"id":"clap","start":0,"duration":1}}],"sends":{sends}{extra}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions::default()).0
        };
        let rms = |x: &[f32], a: f64, len: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, ((a + len) * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.015 + 1e-5, "{v} au lieu de {want}");
        let l = run(r#"{"del14":50}"#, "");
        assert_eq!(l.len(), 5 * sr);
        near(rms(&l, 0.0, 0.1), 0.19863);
        near(rms(&l, 0.25, 0.1), 0.0);
        near(rms(&l, 0.5, 0.1), 0.09931);
        near(rms(&l, 1.0, 0.1), 0.03454);
        let l = run(r#"{"revlong":40}"#, "");
        assert_eq!(l.len(), (3.5 * SR as f64) as usize);
        near(rms(&l, 0.0, 0.1), 0.20226);
        near(rms(&l, 0.3, 0.5), 0.02686);
        near(rms(&l, 1.5, 0.5), 0.00126);
        // Piste coupée : plus rien dans l'envoi
        let l = run(r#"{"del14":50}"#, r#","muted":true"#);
        near(rms(&l, 0.5, 0.1), 0.0);
    }

    /// Chemin complet du modèle de base : Instru → Mix Bus 1 (finition « Fort ») → Mix Bus 2 (limiteur) → sortie.
    /// Valeurs mesurées dans Chrome (tests/scenarios/finition.mjs).
    #[test]
    fn premaster_comme_le_navigateur() {
        let n = 2 * SR as usize;
        let w = |f: f64, i: usize| (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin();
        let l: Vec<f32> = (0..n).map(|i| (0.25 * w(60.0, i) + 0.1 * w(1000.0, i)) as f32).collect();
        let r: Vec<f32> = (0..n).map(|i| (0.25 * w(60.0, i) + 0.1 * w(12000.0, i)) as f32).collect();
        let mut media = Media::new();
        media.insert("mix".into(), Source { channels: vec![l, r], sample_rate: SR });
        let p: Project = serde_json::from_str(r#"{"bpm":90,"buses":[
            {"id":"mixbus1","output":"mixbus2","effects":["master"],"effectParams":{"master":{"body":0.8,"air":1.75,"glue":50,"warm":15,"width":1.06,"push":6}}},
            {"id":"mixbus2","output":"master","effects":["limit"]}],
            "tracks":[{"volume":100,"output":"mixbus1","clips":[{"id":"mix","start":0,"duration":2}]}]}"#).unwrap();
        let (l, r) = render(&p, &media, &RenderOptions::default());
        let a = SR as usize / 2;
        let rms = (l[a..a + SR as usize].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / SR as f64).sqrt();
        let pk = l.iter().chain(r.iter()).fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((rms - 0.384).abs() < 0.384 * 0.02, "niveau {rms} au lieu de 0,384");
        assert!((pk as f64 - 0.713).abs() < 0.713 * 0.03, "crête {pk} au lieu de 0,713");
    }

    /// Déplacer un effet change le son : valeurs mesurées dans Chrome (tests/scenarios/inspecteur.mjs).
    #[test]
    fn ordre_des_effets_comme_le_navigateur() {
        let run = |order: &str| {
            let json = format!(r#"{{"effects":["eq","comp"],"effectParams":{{"eq":{{"hpf":400,"midGain":0,"presence":0,"air":0}},"comp":{{"ratio":8,"threshold":-30,"attack":5,"release":50}}}},"fxOrder":{order}}}"#);
            let t: Track = serde_json::from_str(&json).unwrap();
            // 0,6 d'amplitude, puis pan au centre d'une piste mono (÷ √2) comme à l'export
            let db = gain_db(&t, 150.0, 0.6);
            0.6 / 2f64.sqrt() * 10f64.powf(db / 20.0) * FRAC_1_SQRT_2
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.02, "{v} au lieu de {want}");
        near(run("[]"), 0.05921);
        near(run(r#"["eq","comp"]"#), 0.05921);
        near(run(r#"["comp","eq"]"#), 0.01186);
    }

    /// Trois pistes trop fortes : sans limiteur la crête serait à 1,61 ; le navigateur sort 0,966 (plafond à -0,3 dB).
    #[test]
    fn limiteur_comme_le_navigateur() {
        let n = 2 * SR as usize;
        let tone: Vec<f32> = (0..n).map(|i| (0.95 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / SR as f64).sin()) as f32).collect();
        let mut media = Media::new();
        media.insert("fort".into(), Source { channels: vec![tone], sample_rate: SR });
        let t = r#"{"volume":100,"clips":[{"id":"fort","start":0,"duration":2}]}"#;
        let p: Project = serde_json::from_str(&format!(r#"{{"tracks":[{t},{t},{t}]}}"#)).unwrap();
        let (l, _) = render(&p, &media, &RenderOptions::default());
        let pk = l.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((pk - 0.966).abs() < 0.003, "crête {pk}");
    }

    #[test]
    fn compresseur_comme_le_navigateur() {
        let t: Track = serde_json::from_str(r#"{"effects":["comp"],"effectParams":{"comp":{"ratio":3.08,"threshold":-20,"attack":10,"release":50}}}"#).unwrap();
        assert!((gain_db(&t, 300.0, 0.03) - 4.7).abs() < 0.2, "voix faible : {}", gain_db(&t, 300.0, 0.03));
        assert!((gain_db(&t, 300.0, 0.3) + 0.4).abs() < 0.3, "voix normale : {}", gain_db(&t, 300.0, 0.3));
        assert!((gain_db(&t, 300.0, 0.7) + 5.1).abs() < 0.3, "voix forte : {}", gain_db(&t, 300.0, 0.7));
    }

    /// Mêmes chiffres que tests/scenarios/comp-genou.mjs (mesurés dans Chrome).
    #[test]
    fn compresseur_genou_et_rattrapage() {
        let mk = |knee: f64, makeup: f64| -> Track {
            serde_json::from_str(&format!(r#"{{"effects":["comp"],"effectParams":{{"comp":{{"threshold":-20,"ratio":4,"attack":10,"release":50,"knee":{knee},"makeup":{makeup}}}}}}}"#)).unwrap()
        };
        let g = |t: &Track, amp: f64| gain_db(t, 300.0, amp);
        assert!(g(&mk(0.0, 0.0), 0.1).abs() < 0.05, "au seuil, genou net : {}", g(&mk(0.0, 0.0), 0.1));
        assert!((g(&mk(24.0, 0.0), 0.1) + 1.70).abs() < 0.05, "au seuil, genou doux : {}", g(&mk(24.0, 0.0), 0.1));
        assert!((g(&mk(0.0, 0.0), 0.5) + 8.80).abs() < 0.05, "voix forte : {}", g(&mk(0.0, 0.0), 0.5));
        assert!((g(&mk(0.0, 6.0), 0.5) + 2.80).abs() < 0.05, "rattrapage +6 dB : {}", g(&mk(0.0, 6.0), 0.5));
    }

    /// Caractères du compresseur (Propre, Opto, FET, Bus) : compression et harmoniques ajoutées,
    /// mêmes chiffres que tests/scenarios/comp-genou.mjs (Chrome, export WAV).
    #[test]
    fn compresseur_caracteres() {
        let sr = SR as f64;
        let run = |mode: Option<u8>| -> Vec<f32> {
            let mut buf: Vec<f32> = (0..2 * SR as usize).map(|i| (0.5 * (2.0 * std::f64::consts::PI * 300.0 * i as f64 / sr).sin()) as f32).collect();
            if let Some(m) = mode {
                let t: Track = serde_json::from_str(&format!(r#"{{"effects":["comp"],"effectParams":{{"comp":{{"threshold":-20,"ratio":4,"attack":10,"release":50,"knee":0,"makeup":0,"mode":{m}}}}}}}"#)).unwrap();
                crate::fx::Chain::for_track(&t, sr, 90.0).process(&mut buf, &mut [], true);
            }
            buf
        };
        let amp = |x: &[f32], f: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for i in SR as usize..(SR as f64 * 1.8) as usize {
                let a = 2.0 * std::f64::consts::PI * f * i as f64 / sr;
                re += x[i] as f64 * a.cos();
                im += x[i] as f64 * a.sin();
            }
            (re * re + im * im).sqrt()
        };
        let r = amp(&run(None), 300.0);
        {
            let t: Track = serde_json::from_str(r#"{"effects":["comp"],"effectParams":{"comp":{"threshold":-20,"ratio":4,"attack":10,"release":50,"knee":0,"makeup":0,"mode":3,"autoRel":1}}}"#).unwrap();
            let mut buf: Vec<f32> = (0..2 * SR as usize).map(|i| (0.5 * (2.0 * std::f64::consts::PI * 300.0 * i as f64 / sr).sin()) as f32).collect();
            crate::fx::Chain::for_track(&t, sr, 90.0).process(&mut buf, &mut [], true);
            let g = 20.0 * (amp(&buf, 300.0) / r).log10();
            assert!((g + 10.63).abs() < 0.05, "bus, relâchement auto : {g}");
        }
        // (mode, compression dB, harmonique 2 dB, harmonique 3 dB) ; les harmoniques sous -70 dB ne sont pas comparées (bruit du WAV 16 bits de l'export)
        for (m, g, h2, h3) in [(0u8, -8.80, -120.0, -52.2), (1, -10.59, -41.2, -78.7), (2, -9.79, -103.9, -47.5), (3, -10.57, -102.0, -89.4)] {
            let x = run(Some(m));
            let f = amp(&x, 300.0);
            let db = |v: f64| 20.0 * v.log10();
            assert!((db(f / r) - g).abs() < 0.05, "caractère {m} : compression {}", db(f / r));
            for (h, want) in [(600.0, h2), (900.0, h3)] {
                let got = db(amp(&x, h) / f);
                if want > -70.0 { assert!((got - want).abs() < 0.5, "caractère {m} : harmonique {h} Hz {got}"); } else { assert!(got < -70.0, "caractère {m} : harmonique {h} Hz {got}"); }
            }
        }
    }

    #[test]
    fn compresseur_parallele() {
        let mk = |mix: f64| -> Track {
            serde_json::from_str(&format!(r#"{{"effects":["comp"],"effectParams":{{"comp":{{"ratio":3.08,"threshold":-20,"attack":10,"release":50,"mix":{mix}}}}}}}"#)).unwrap()
        };
        assert!(gain_db(&mk(0.0), 300.0, 0.7).abs() < 0.2, "mélange 0 % = son d'origine : {}", gain_db(&mk(0.0), 300.0, 0.7));
        assert!((gain_db(&mk(50.0), 300.0, 0.7) + 2.2).abs() < 0.4, "mélange 50 % : {}", gain_db(&mk(50.0), 300.0, 0.7));
        assert!((gain_db(&mk(100.0), 300.0, 0.7) + 5.1).abs() < 0.3, "mélange 100 % : {}", gain_db(&mk(100.0), 300.0, 0.7));
    }

    #[test]
    fn eq_voix_lead() {
        let t = Track { effects: vec!["eq".into()], ..Default::default() };
        assert!(eq_gain_db(&t, 30.0) < -12.0, "le coupe-bas 80 Hz doit atténuer 30 Hz : {}", eq_gain_db(&t, 30.0));
        assert!((eq_gain_db(&t, 300.0) + 2.0).abs() < 0.6, "-2 dB à 300 Hz : {}", eq_gain_db(&t, 300.0));
        assert!((eq_gain_db(&t, 4000.0) - 2.0).abs() < 0.8, "+2 dB à 4 kHz : {}", eq_gain_db(&t, 4000.0));
        assert!(eq_gain_db(&t, 1000.0).abs() < 1.0, "1 kHz presque intact : {}", eq_gain_db(&t, 1000.0));
    }

    /// EQ libre : les bandes de l'ancienne chaîne fixe donnent exactement le même son que `bands`.
    #[test]
    fn eq_libre_equivaut_a_la_chaine_fixe() {
        let fixe = Track { effects: vec!["eq".into()], ..Default::default() };
        let json = r#"{"effects":["eq"],"effectParams":{"eq":{"bands":[
            {"type":"hpf","freq":80,"q":1.0839},{"type":"bell","freq":300,"gain":-2,"q":1},
            {"type":"bell","freq":4000,"gain":2,"q":0.7},{"type":"highshelf","freq":10000,"gain":1}]}}}"#;
        let libre: Track = serde_json::from_str(json).unwrap();
        for f in [30.0, 80.0, 300.0, 1000.0, 4000.0, 12000.0] {
            let (a, b) = (eq_gain_db(&fixe, f), eq_gain_db(&libre, f));
            assert!((a - b).abs() < 0.05, "{} Hz : fixe {} / libre {}", f, a, b);
        }
    }

    /// Bandes à volonté : cloche étroite, étagère basse, coupe-haut ; une bande coupée n'agit pas.
    #[test]
    fn eq_libre_bandes() {
        let json = r#"{"effects":["eq"],"effectParams":{"eq":{"bands":[
            {"type":"bell","freq":1000,"gain":6,"q":2},{"type":"lowshelf","freq":200,"gain":-4},
            {"type":"lpf","freq":8000,"q":1},{"type":"bell","freq":3000,"gain":12,"q":1,"on":false}]}}}"#;
        let t: Track = serde_json::from_str(json).unwrap();
        assert!((eq_gain_db(&t, 1000.0) - 6.0).abs() < 0.6, "+6 dB à 1 kHz : {}", eq_gain_db(&t, 1000.0));
        assert!((eq_gain_db(&t, 40.0) + 4.0).abs() < 0.8, "-4 dB dans les graves : {}", eq_gain_db(&t, 40.0));
        assert!(eq_gain_db(&t, 16000.0) < -6.0, "coupe-haut 8 kHz : {}", eq_gain_db(&t, 16000.0));
        assert!(eq_gain_db(&t, 3000.0).abs() < 1.0, "bande coupée sans effet : {}", eq_gain_db(&t, 3000.0));
    }

    /// Filtre : coupe-bas / coupe-haut Butterworth. -3 dB à la coupure, 12 puis 24 dB par octave ; éteint = transparent.
    /// Mêmes valeurs que tests/scenarios/filtre.mjs (navigateur).
    #[test]
    fn filtre_coupe_bas_et_haut() {
        let t12: Track = serde_json::from_str(r#"{"effects":["filter"],"effectParams":{"filter":{"hpf":200,"lpf":5000,"slope":12}}}"#).unwrap();
        assert!((eq_gain_db(&t12, 200.0) + 3.0).abs() < 0.5, "coupure bas -3 dB : {}", eq_gain_db(&t12, 200.0));
        assert!((eq_gain_db(&t12, 100.0) + 13.0).abs() < 1.5, "12 dB/oct vers le bas : {}", eq_gain_db(&t12, 100.0));
        assert!((eq_gain_db(&t12, 5000.0) + 3.0).abs() < 0.5, "coupure haut -3 dB : {}", eq_gain_db(&t12, 5000.0));
        assert!(eq_gain_db(&t12, 1000.0).abs() < 0.5, "milieu intact : {}", eq_gain_db(&t12, 1000.0));
        let t24: Track = serde_json::from_str(r#"{"effects":["filter"],"effectParams":{"filter":{"hpf":200,"slope":24}}}"#).unwrap();
        assert!((eq_gain_db(&t24, 200.0) + 3.0).abs() < 0.5, "24 dB : coupure -3 dB : {}", eq_gain_db(&t24, 200.0));
        assert!(eq_gain_db(&t24, 100.0) < -22.0, "24 dB/oct vers le bas : {}", eq_gain_db(&t24, 100.0));
        let off: Track = serde_json::from_str(r#"{"effects":["filter"],"effectParams":{"filter":{"hpf":20,"lpf":20000}}}"#).unwrap();
        assert!(eq_gain_db(&off, 30.0).abs() < 0.01 && eq_gain_db(&off, 12000.0).abs() < 0.01, "éteint = transparent");
    }

    /// Gate : un son sous le seuil est baissé de `reduction` dB, un son au-dessus passe intact (voir tests/scenarios/gate.mjs).
    #[test]
    fn gate_coupe_sous_le_seuil() {
        let t: Track = serde_json::from_str(r#"{"effects":["gate"],"effectParams":{"gate":{"threshold":-35,"release":50,"reduction":24}}}"#).unwrap();
        assert!(gain_db(&t, 440.0, 0.3).abs() < 0.1, "au-dessus du seuil : {}", gain_db(&t, 440.0, 0.3));
        assert!((gain_db(&t, 440.0, 0.01) + 24.0).abs() < 0.5, "sous le seuil : {}", gain_db(&t, 440.0, 0.01));
    }

    /// Effets de mouvement : niveau (dB) d'un La 440 puis d'un 1 kHz à 0,25 après chaque effet réglé par défaut.
    /// Les mêmes chiffres sont vérifiés dans le navigateur par tests/scenarios/mouvement.mjs.
    #[test]
    fn mouvement_comme_le_navigateur() {
        let refs = [("chorus", -3.501, -2.838), ("flanger", 0.860, -3.512), ("phaser", -2.256, -4.896), ("tremolo", -2.264, -2.264),
            ("doubler", -2.365, -3.127), ("slapback", -4.868, 0.291), ("crush", -0.005, 0.045), ("util", 0.0, 0.0)];
        for (fx, a, b) in refs {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["{fx}"]}}"#)).unwrap();
            let (x, y) = (gain_db(&t, 440.0, 0.25), gain_db(&t, 1000.0, 0.25));
            assert!((x - a).abs() < 0.05 && (y - b).abs() < 0.05, "{fx} : {x:.3} / {y:.3} au lieu de {a} / {b}");
        }
    }

    /// Largeur (milieu / côtés) et Utilitaire (mono, phase, volume) sur une piste stéréo.
    #[test]
    fn largeur_et_utilitaire_en_stereo() {
        let run = |json: &str, l: f32, r: f32| {
            let t: Track = serde_json::from_str(json).unwrap();
            let (mut a, mut b) = (vec![l; 64], vec![r; 64]);
            crate::fx::Chain::for_track(&t, SR as f64, 90.0).process(&mut a, &mut b, false);
            (a[63] as f64, b[63] as f64)
        };
        let (l, r) = run(r#"{"effects":["width"],"effectParams":{"width":{"width":0}}}"#, 0.5, -0.5);
        assert!(l.abs() < 1e-6 && r.abs() < 1e-6, "largeur 0 : deux canaux opposés s'annulent ({l}, {r})");
        let (l, r) = run(r#"{"effects":["width"],"effectParams":{"width":{"width":200}}}"#, 0.4, 0.0);
        assert!((l - 0.6).abs() < 1e-6 && (r + 0.2).abs() < 1e-6, "largeur 200 % : {l} {r}");
        let (l, r) = run(r#"{"effects":["util"],"effectParams":{"util":{"mono":1,"gain":6.0206}}}"#, 0.4, 0.0);
        assert!((l - 0.4).abs() < 1e-3 && (r - 0.4).abs() < 1e-3, "mono + 6 dB : {l} {r}");
        let (l, r) = run(r#"{"effects":["util"],"effectParams":{"util":{"invert":1}}}"#, 0.3, -0.1);
        assert!((l + 0.3).abs() < 1e-6 && (r - 0.1).abs() < 1e-6, "phase inversée : {l} {r}");
    }

    #[test]
    fn telephone_coupe_les_aigus() {
        let json = r#"{"effects":["eq","sat"],"effectParams":{"eq":{"hpf":400,"midGain":3,"presence":2,"air":-6,"lpf":3200},"sat":{"drive":35}}}"#;
        let t: Track = serde_json::from_str(json).unwrap();
        assert!(eq_gain_db(&t, 12000.0) < -15.0);
        assert!(eq_gain_db(&t, 100.0) < -15.0);
    }

    #[test]
    fn courbe_de_volume_sur_un_groupe() {
        let mut p = project(vec![clip(0.0, 4.0, 5.0)]);
        p.tracks[0].output = Some("g".into());
        let b: Bus = serde_json::from_str(r#"{"id":"g","volume":50,"output":"master",
            "automation":{"volume":{"points":[{"t":0,"v":1},{"t":2,"v":1},{"t":4,"v":0}]}}}"#).unwrap();
        p.buses = vec![b];
        close(at(&p, &opts(), 1.0), 0.5 * 0.6);
        close(at(&p, &opts(), 3.0), 0.5 * 0.5 * 0.8);
    }

    #[test]
    fn fader_au_dessus_de_zero_db() {
        let mut p = project(vec![clip(0.0, 2.0, 5.0)]);
        p.tracks[0].volume = Some(100.0);
        let un = at(&p, &opts(), 1.0);
        p.tracks[0].volume = Some(200.0);
        let deux = at(&p, &opts(), 1.0);
        close(deux, 2.0 * un);
    }

    #[test]
    fn courbe_de_volume() {
        let json = r#"{"volume":100,"clips":[{"id":"a","start":0,"duration":8,"offset":0}],
                       "automation":{"volume":{"points":[{"t":0,"v":1},{"t":4,"v":1},{"t":6,"v":0}]}}}"#;
        let t: Track = serde_json::from_str(json).unwrap();
        let p = Project { tracks: vec![t], ..Default::default() };
        close(at(&p, &opts(), 2.0), 0.2);
        close(at(&p, &opts(), 5.0), 0.5 * 0.5);
        close(at(&p, &opts(), 7.0), 0.0);
    }

    #[test]
    fn pan_et_envois_sur_un_groupe() {
        // Un groupe a son gauche / droite, comme une piste
        let mut p = project(vec![clip(0.0, 1.0, 5.0)]);
        p.tracks[0].output = Some("g".into());
        p.buses = vec![serde_json::from_str::<Bus>(r#"{"id":"g","volume":100,"output":"master"}"#).unwrap()];
        let (cl, cr) = render(&p, &ramp_media(), &opts());
        let n = SR as usize / 2;
        p.buses[0].pan = Some(100.0);
        let (l, r) = render(&p, &ramp_media(), &opts());
        assert!(l[n].abs() < 1e-4, "gauche = {}", l[n]);
        close(r[n] as f64, (cl[n] + cr[n]) as f64);
        // Un envoi de groupe ajoute de l'écho après la fin du son
        let mut q = project(vec![clip(0.0, 1.0, 5.0)]);
        q.tracks[0].output = Some("g".into());
        q.buses = vec![serde_json::from_str::<Bus>(r#"{"id":"g","volume":100,"output":"master","sends":{"d":100}}"#).unwrap()];
        q.sends = vec![serde_json::from_str(r#"{"id":"d","type":"delay","ms":300,"feedback":0,"volume":100}"#).unwrap()];
        let (el, _) = render(&q, &ramp_media(), &opts());
        let after = (1.15 * SR as f64) as usize;   // 0,15 s après la fin du clip : l'écho de 300 ms joue encore
        assert!(el[after].abs() > 1e-3, "pas d'écho : {}", el[after]);
        q.buses[0].sends.clear();
        let (sl, _) = render(&q, &ramp_media(), &opts());
        assert!(sl.get(after).map_or(true, |v| v.abs() < 1e-6), "écho sans envoi");
    }

    #[test]
    fn pan_puissance_constante() {
        let mut p = project(vec![clip(0.0, 1.0, 5.0)]);
        p.tracks[0].pan = Some(100.0);
        let (l, r) = render(&p, &ramp_media(), &opts());
        let n = SR as usize / 2;
        assert!(l[n].abs() < 1e-4);
        close(r[n] as f64, 0.55);
    }

    #[test]
    fn piste_forcee_en_mono() {
        // Source stéréo : gauche 0,2 / droite 0,6. En mono, les deux côtés se mélangent (0,4) avant le pan.
        let n = SR as usize * 2;
        let media = Media::from([("a".to_owned(), Source { sample_rate: SR, channels: vec![vec![0.2; n], vec![0.6; n]] })]);
        let mut p = project(vec![clip(0.0, 1.0, 0.0)]);
        let k = SR as usize / 2;
        let (l, r) = render(&p, &media, &opts());
        close(l[k] as f64, 0.2);
        close(r[k] as f64, 0.6);
        p.tracks[0].mono = Some(true);
        let (l, r) = render(&p, &media, &opts());
        let attendu = 0.4 * std::f64::consts::FRAC_1_SQRT_2;
        close(l[k] as f64, attendu);
        close(r[k] as f64, attendu);
    }
}
