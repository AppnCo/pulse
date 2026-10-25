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

    /// Saturation multibande : mêmes chiffres que tests/scenarios/msat-parite.mjs (Chrome).
    #[test]
    fn saturation_multibande_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let v: Vec<f32> = (0..sr).map(|i| { let t = i as f64 / SR as f64; ((0.4 * (2.0 * std::f64::consts::PI * 200.0 * t).sin()
            + 0.15 * (2.0 * std::f64::consts::PI * 3000.0 * t).sin()) * if t < 0.5 { 1.0 } else { 0.3 }) as f32 }).collect();
        media.insert("ms".into(), Source { channels: vec![v], sample_rate: SR });
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let check = |mp: &str, want: [f64; 3], nom: &str| {
            let json = format!(r#"{{"tracks":[{{"volume":100,"clips":[{{"id":"ms","start":0,"duration":1}}],"effects":["msat"],"effectParams":{{"msat":{mp}}}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            let l = render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() }).0;
            let hf = ((4800..19200).map(|i| { let d = l[i] as f64 - 2.0 * l[i - 1] as f64 + l[i - 2] as f64; d * d }).sum::<f64>() / 14400.0).sqrt();
            let got = [rms(&l, 0.1, 0.4), rms(&l, 0.6, 0.9), hf];
            for k in 0..3 { assert!((got[k] - want[k]).abs() < want[k] * 0.01 + 2e-5, "{nom} : {got:?} au lieu de {want:?}"); }
        };
        check(r#"{"bands":[{"base":true,"sty":"bande","va":1,"heat":50}]}"#, [0.159609, 0.073363, 0.008539], "base");
        check(r#"{"bands":[{"base":true,"sty":"lampe","va":1,"heat":40},{"lo":2000,"hi":6000,"sty":"ampli","va":2,"heat":60,"dyn":20,"fb":30,"hi2":3,"mix":70,"out":-2}]}"#, [0.175589, 0.075585, 0.022301], "libre");
        check(r#"{"bands":[{"lo":100,"hi":400,"sty":"repli","va":1,"heat":80,"slope":48}]}"#, [0.211164, 0.06407, 0.011453], "sansbase");
        check(r#"{"bands":[{"base":true,"sty":"lofi","va":1,"heat":30}],"mix":60,"out":-3}"#, [0.131526, 0.048781, 0.019729], "lofi");
        check(r#"{"bands":[{"base":true,"sty":"transfo","va":0,"heat":50},{"lo":2000,"hi":6000,"sty":"bande","va":0,"heat":20,"solo":true,"dyn":-30}]}"#, [0.060186, 0.013669, 0.009164], "solo");
        check(r#"{"bands":[{"base":true,"sty":"bande","va":1,"heat":50}],"ag":false}"#, [0.523942, 0.240843, 0.028031], "sansag");
    }

    /// Multibande à bandes libres : mêmes chiffres que tests/scenarios/mband-parite.mjs (Chrome).
    #[test]
    fn multibande_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let v: Vec<f32> = (0..sr).map(|i| { let t = i as f64 / SR as f64; (0.4 * (2.0 * std::f64::consts::PI * 100.0 * t).sin()
            + if t > 0.5 && t < 0.8 { 0.2 * (2.0 * std::f64::consts::PI * 3000.0 * t).sin() } else { 0.0 }) as f32 }).collect();
        media.insert("mb".into(), Source { channels: vec![v], sample_rate: SR });
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let run = |mp: &str| {
            let json = format!(r#"{{"tracks":[{{"volume":100,"clips":[{{"id":"mb","start":0,"duration":1}}],"effects":["mband"],"effectParams":{{"mband":{mp}}}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() }).0
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 2e-5, "{v} au lieu de {want}");
        let l = run(r#"{"bands":[{"lo":60,"hi":200,"thr":0,"range":-8}]}"#);
        near(rms(&l, 0.2, 0.45), 0.199987); near(rms(&l, 0.55, 0.78), 0.223593);
        let b1 = r#"{"lo":60,"hi":200,"thr":-20,"range":-8,"att":5,"rel":80}"#;
        let b2 = r#"{"lo":2000,"hi":5000,"thr":-30,"range":6,"out":-2}"#;
        let l = run(&format!(r#"{{"bands":[{b1},{b2}]}}"#));
        near(rms(&l, 0.2, 0.45), 0.121393); near(rms(&l, 0.55, 0.78), 0.187453);
        let l = run(&format!(r#"{{"bands":[{b1},{{"lo":2000,"hi":5000,"thr":-30,"range":6,"out":-2,"solo":true}}]}}"#));
        assert!(rms(&l, 0.2, 0.45) < 1e-4, "solo : rien hors de la bande"); near(rms(&l, 0.55, 0.78), 0.118899);
        let l = run(&format!(r#"{{"bands":[{{"lo":60,"hi":200,"thr":-20,"range":-8,"att":5,"rel":80,"mute":true}},{b2}]}}"#));
        near(rms(&l, 0.2, 0.45), 0.06976); near(rms(&l, 0.55, 0.78), 0.158958);
    }

    /// Nouveau De-esser (seuil, plage, zone) : mêmes chiffres que tests/scenarios/deess-parite.mjs (Chrome).
    /// Automation des nouvelles façades (De-esser, Limiteur) : mêmes chiffres que tests/scenarios/auto-faces-parite.mjs (Chrome).
    #[test]
    fn automation_des_facades_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut v = vec![0.0f32; 2 * sr];
        let mut r: u64 = 7;
        for (i, x) in v.iter_mut().enumerate() {
            let t = i as f64 / SR as f64;
            r = (r * 16807) % 2147483647;
            *x = (0.6 * (2.0 * std::f64::consts::PI * 300.0 * t).sin() + 0.25 * (r as f64 / 1073741823.5 - 1.0)) as f32;
        }
        media.insert("vs".into(), Source { channels: vec![v], sample_rate: SR });
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let run = |fx: &str, fp: &str, auto: &str| {
            let json = format!(r#"{{"tracks":[{{"volume":100,"clips":[{{"id":"vs","start":0,"duration":2}}],"effects":["{fx}"],"effectParams":{{"{fx}":{fp}}},"automation":{auto}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() }).0
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 2e-5, "{v} au lieu de {want}");
        let up = r#"{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]}"#;
        let l = run("deess", r#"{"thr":-40,"range":12}"#, &format!(r#"{{"fx:deess:range":{up}}}"#));
        near(rms(&l, 0.2, 0.8), 0.316891); near(rms(&l, 1.2, 1.8), 0.301667);
        let l = run("deess", r#"{"thr":-40,"range":12}"#, r#"{"fx:deess:thr":{"points":[{"t":0,"v":1},{"t":1,"v":1},{"t":1.01,"v":0}]}}"#);
        near(rms(&l, 0.2, 0.8), 0.316891); near(rms(&l, 1.2, 1.8), 0.30316);
        let l = run("limit", r#"{"ceiling":-1,"release":120}"#, r#"{"fx:limit:ceiling":{"points":[{"t":0,"v":1},{"t":1,"v":1},{"t":1.01,"v":0.5}]}}"#);
        near(rms(&l, 0.2, 0.8), 0.448215); near(rms(&l, 1.2, 1.8), 0.266919);
        let l = run("limit", r#"{"ceiling":-6,"release":120}"#, &format!(r#"{{"fx:limit:release":{up}}}"#));
        near(rms(&l, 0.2, 0.8), 0.282765); near(rms(&l, 1.2, 1.8), 0.265037);
        let l = run("limit", r#"{"ceiling":-3}"#, &format!(r#"{{"fx:limit:gain":{up}}}"#));
        near(rms(&l, 0.2, 0.8), 0.377228); near(rms(&l, 1.2, 1.8), 0.377038);
        let lim = r#"{"points":[{"t":0,"v":0.3},{"t":2,"v":0.6}]}"#;
        let l = run("mband", r#"{"bands":[{"lo":200,"hi":2000,"thr":-40,"range":-12}]}"#, &format!(r#"{{"fx:mband:b0-lo":{lim},"fx:mband:b0-hi":{up}}}"#));
        near(rms(&l, 0.2, 0.8), 0.29141); near(rms(&l, 1.2, 1.8), 0.303305);
        let l = run("msat", r#"{"bands":[{"base":true,"sty":"bande","va":1,"heat":10},{"lo":200,"hi":2000,"sty":"ampli","va":1,"heat":60,"fb":30}]}"#, &format!(r#"{{"fx:msat:b1-lo":{lim},"fx:msat:b1-hi":{up}}}"#));
        near(rms(&l, 0.2, 0.8), 0.281544); near(rms(&l, 1.2, 1.8), 0.278487);
        let l = run("gate", r#"{"threshold":-20,"reduction":40,"ratio":2,"release":150}"#, r#"{"fx:gate:ratio":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":0.6}]},"fx:gate:knee":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]},"fx:gate:attack":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]},"fx:gate:hold":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]}}"#);
        near(rms(&l, 0.2, 0.8), 0.316891); near(rms(&l, 1.2, 1.8), 0.317399);
        let l = run("mband", r#"{"bands":[{"lo":20,"hi":400,"thr":-40,"range":-12},{"lo":400,"hi":20000,"thr":-40,"range":-6}]}"#, r#"{"fx:mband:b0-range":{"points":[{"t":0,"v":0.5},{"t":1,"v":0.5},{"t":1.01,"v":0}]},"fx:mband:b1-out":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]},"fx:mband:b0-att":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]},"fx:mband:b1-thr":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]}}"#);
        near(rms(&l, 0.2, 0.8), 0.349343); near(rms(&l, 1.2, 1.8), 0.493388);
        let l = run("msat", r#"{"bands":[{"base":true,"sty":"bande","va":1,"heat":30},{"lo":200,"hi":2000,"sty":"lampe","va":1,"heat":20}],"mix":100}"#, r#"{"fx:msat:b1-heat":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]},"fx:msat:b0-hi2":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]},"fx:msat:b1-out":{"points":[{"t":0,"v":0.6667},{"t":1,"v":0.6667},{"t":1.01,"v":0.3}]},"fx:msat:mix":{"points":[{"t":0,"v":1},{"t":1.5,"v":0.4}]},"fx:msat:b0-dyn":{"points":[{"t":0,"v":0},{"t":1,"v":0},{"t":1.01,"v":1}]}}"#);
        near(rms(&l, 0.2, 0.8), 0.202777); near(rms(&l, 1.2, 1.8), 0.204685);
    }

    #[test]
    fn deesser_v2_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut v = vec![0.0f32; sr];
        let mut r: u64 = 7;
        for (i, x) in v.iter_mut().enumerate() {
            let t = i as f64 / SR as f64;
            r = (r * 16807) % 2147483647;
            let s = (t > 0.3 && t < 0.4) || (t > 0.7 && t < 0.75);
            *x = (0.3 * (2.0 * std::f64::consts::PI * 300.0 * t).sin() + if s { 0.25 * (r as f64 / 1073741823.5 - 1.0) } else { 0.0 }) as f32;
        }
        media.insert("vs".into(), Source { channels: vec![v], sample_rate: SR });
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let run = |dp: &str| {
            let json = format!(r#"{{"tracks":[{{"volume":100,"clips":[{{"id":"vs","start":0,"duration":1}}],"effects":["deess"],"effectParams":{{"deess":{dp}}}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() }).0
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 2e-5, "{v} au lieu de {want}");
        let l = run(r#"{"thr":-30,"range":12,"lo":4000,"hi":12000}"#);
        near(rms(&l, 0.1, 0.2), 0.149985); near(rms(&l, 0.31, 0.39), 0.156845); near(rms(&l, 0.71, 0.74), 0.157646);
        let l = run(r#"{"thr":-30,"range":12,"lo":4000,"hi":12000,"wide":true}"#);
        near(rms(&l, 0.31, 0.39), 0.045775); near(rms(&l, 0.71, 0.74), 0.046511);
        let l = run(r#"{"thr":-12,"range":8,"lo":5000,"hi":11000,"rel":true}"#);
        near(rms(&l, 0.31, 0.39), 0.17565); near(rms(&l, 0.71, 0.74), 0.17756);
    }

    /// Écho avec EQ des répétitions (la voix d'origine n'y passe pas) : mêmes chiffres que tests/scenarios/echo-eq.mjs (Chrome).
    #[test]
    fn echo_eq_comme_le_navigateur() {
        let sr = SR as usize;
        let mut media = Media::new();
        let mut burst = vec![0.0f32; sr];
        let mut r: u64 = 1;
        for v in burst.iter_mut().take(4800) {
            r = (r * 16807) % 2147483647;
            *v = (0.5 * (r as f64 / 1073741823.5 - 1.0)) as f32;
        }
        media.insert("clap".into(), Source { channels: vec![burst], sample_rate: SR });
        let rms = |x: &[f32], a: f64, z: f64| {
            let (a, z) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
            (x[a..z].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (z - a) as f64).sqrt()
        };
        let run = |dp: &str| {
            let json = format!(r#"{{"bpm":120,"tracks":[{{"volume":100,"clips":[{{"id":"clap","start":0,"duration":1}}],"effects":["delay"],"effectParams":{{"delay":{dp}}}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() })
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 2e-5, "{v} au lieu de {want}");
        let eq = r#""eq":[{"type":"hpf","freq":400,"gain":0,"q":0.7071,"slope":24},{"type":"bell","freq":2000,"gain":6,"q":1},{"type":"lpf","freq":6000,"gain":0,"q":0.7071,"slope":12}]"#;
        let (l, r) = run(&format!(r#"{{"wet":50,"feedback":40,"beats":0.5,{eq}}}"#));
        near(rms(&l, 0.0, 0.1), 0.20249);
        near(rms(&l, 0.25, 0.35), 0.069415);
        near(rms(&l, 0.5, 0.6), 0.02198);
        near(rms(&r, 0.5, 0.6), 0.02198);
        let (l, r) = run(&format!(r#"{{"wet":50,"feedback":40,"beats":0.5,"pp":1,{eq}}}"#));
        near(rms(&l, 0.0, 0.1), 0.28637);
        near(rms(&l, 0.25, 0.35), 0.098173);
        near(rms(&r, 0.5, 0.6), 0.03109);
        assert!(rms(&l, 0.5, 0.6) < 1e-4, "ping-pong : la 2e répétition est à droite");
    }

    /// Reverb avec EQ intégré (sur l'effet seulement), brillance et largeur : mêmes chiffres que tests/scenarios/reverb-eq.mjs (Chrome).
    #[test]
    fn reverb_eq_comme_le_navigateur() {
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
        let run = |rp: &str| {
            let json = format!(r#"{{"tracks":[{{"volume":100,"clips":[{{"id":"clap","start":0,"duration":1}}],"effects":["reverb"],"effectParams":{{"reverb":{rp}}}}}]}}"#);
            let p: Project = serde_json::from_str(&json).unwrap();
            render(&p, &media, &RenderOptions { only_track: Some(0), ..opts() })
        };
        let near = |v: f64, want: f64| assert!((v - want).abs() < want * 0.01 + 2e-5, "{v} au lieu de {want}");
        let (l, r) = run(r#"{"wet":60,"size":2.4,"bright":80,"width":130,"eq":[{"type":"hpf","freq":300,"gain":0,"q":0.7071,"slope":24},{"type":"bell","freq":3000,"gain":-6,"q":1},{"type":"highshelf","freq":8000,"gain":4,"q":0.7},{"type":"bell","freq":500,"gain":9,"q":1,"on":false}]}"#);
        near(rms(&l, 0.0, 0.1), 0.095269);
        near(rms(&l, 0.3, 0.9), 0.049152);
        near(rms(&r, 0.3, 0.9), 0.089921);
        near(rms(&l, 1.5, 2.5), 0.000104);
        let (l, r) = run(r#"{"wet":60,"size":2.4,"width":0}"#);
        assert!((rms(&l, 0.3, 0.9) - 0.052947).abs() < 0.0005 && (rms(&r, 0.3, 0.9) - 0.052947).abs() < 0.0005, "largeur 0 = mono");
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
        near(rms(&l, 0.06, 0.1), 0.085491);
        near(rms(&r, 0.06, 0.1), 0.051931);
        near(rms(&l, 0.3, 0.9), 0.002423);
        near(rms(&r, 0.3, 0.9), 0.006155);
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
        assert!((rms - 0.32635).abs() < 0.32635 * 0.02, "niveau {rms} au lieu de 0,32635");
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
        near(run("[]"), 0.052015);
        near(run(r#"["eq","comp"]"#), 0.052015);
        near(run(r#"["comp","eq"]"#), 0.009986);
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
        assert!((gain_db(&t, 300.0, 0.3) + 1.72).abs() < 0.1, "voix normale : {}", gain_db(&t, 300.0, 0.3));
        assert!((gain_db(&t, 300.0, 0.7) + 6.69).abs() < 0.1, "voix forte : {}", gain_db(&t, 300.0, 0.7));
    }

    /// Mêmes chiffres que tests/scenarios/comp-genou.mjs (mesurés dans Chrome).
    #[test]
    fn compresseur_genou_et_rattrapage() {
        let mk = |knee: f64, makeup: f64| -> Track {
            serde_json::from_str(&format!(r#"{{"effects":["comp"],"effectParams":{{"comp":{{"threshold":-20,"ratio":4,"attack":10,"release":50,"knee":{knee},"makeup":{makeup}}}}}}}"#)).unwrap()
        };
        let g = |t: &Track, amp: f64| gain_db(t, 300.0, amp);
        assert!(g(&mk(0.0, 0.0), 0.1).abs() < 0.05, "au seuil, genou net : {}", g(&mk(0.0, 0.0), 0.1));
        assert!((g(&mk(24.0, 0.0), 0.1) + 2.25).abs() < 0.05, "au seuil, genou doux : {}", g(&mk(24.0, 0.0), 0.1));
        assert!((g(&mk(0.0, 0.0), 0.5) + 10.48).abs() < 0.05, "voix forte : {}", g(&mk(0.0, 0.0), 0.5));
        assert!((g(&mk(0.0, 6.0), 0.5) + 4.48).abs() < 0.05, "rattrapage +6 dB : {}", g(&mk(0.0, 6.0), 0.5));
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
        for (m, g, h2, h3) in [(0u8, -10.48, -120.0, -120.0), (1, -10.59, -41.2, -78.7), (2, -9.79, -103.9, -47.5), (3, -10.57, -102.0, -89.4)] {
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
        assert!((gain_db(&mk(50.0), 300.0, 0.7) + 2.72).abs() < 0.1, "mélange 50 % : {}", gain_db(&mk(50.0), 300.0, 0.7));
        assert!((gain_db(&mk(100.0), 300.0, 0.7) + 6.69).abs() < 0.1, "mélange 100 % : {}", gain_db(&mk(100.0), 300.0, 0.7));
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

    /// EQ « pro » : pentes raides, encoche, pente (tilt), gain de sortie — mêmes valeurs que tests/scenarios/eq-pro.mjs.
    #[test]
    fn eq_pro_formes() {
        let json = r#"{"effects":["eq"],"effectParams":{"eq":{"out":3,"bands":[
            {"type":"hpf","freq":80,"q":0.71,"slope":48},{"type":"notch","freq":300,"q":2},
            {"type":"tilt","freq":3200,"gain":2.5,"q":1}]}}}"#;
        let t: Track = serde_json::from_str(json).unwrap();
        // 48 dB/oct : une octave sous la coupure, on perd ~48 dB (12 dB/oct en perdrait ~12)
        assert!((eq_gain_db(&t, 40.0) + 46.43).abs() < 1.0, "48 dB/oct à 40 Hz : {}", eq_gain_db(&t, 40.0));
        assert!(eq_gain_db(&t, 300.0) < -30.0, "encoche à 300 Hz : {}", eq_gain_db(&t, 300.0));
        // chiffres relevés dans le navigateur (eqBandDb) : tilt +2,5 dB + sortie +3 dB
        assert!((eq_gain_db(&t, 15000.0) - 4.24).abs() < 0.3, "aigus : {}", eq_gain_db(&t, 15000.0));
        assert!((eq_gain_db(&t, 1000.0) - 1.66).abs() < 0.15, "1 kHz : {}", eq_gain_db(&t, 1000.0));
    }

    /// Point dynamique : il ne creuse que quand sa zone dépasse le seuil — mêmes chiffres que tests/scenarios/eq-dynamique.mjs.
    #[test]
    fn eq_point_dynamique() {
        let t: Track = serde_json::from_str(r#"{"effects":["eq"],"effectParams":{"eq":{"bands":[
            {"type":"bell","freq":1000,"gain":0,"q":1,"dyn":-12,"thr":-30}]}}}"#).unwrap();
        let fort = gain_db(&t, 1000.0, 0.5);
        let faible = gain_db(&t, 1000.0, 0.005);
        let loin = gain_db(&t, 100.0, 0.5);
        println!("dynamique : fort {fort:.2} / faible {faible:.2} / 100 Hz {loin:.2}");
        assert!(fort < -10.0, "fort : creuse presque toute la plage : {fort}");
        assert!(faible.abs() < 0.5, "faible : sous le seuil, rien ne bouge : {faible}");
        assert!(loin.abs() < 1.0, "loin de la zone : intact : {loin}");
    }

    /// Ducking (écho, reverb) : l'effet se pousse pendant la voix et ressort dans le trou — mêmes chiffres que tests/scenarios/ducking.mjs.
    #[test]
    fn ducking_echo_et_reverb() {
        // 1 s de voix (300 Hz à 0,5), puis 2 s de silence ; on mesure l'effet seul (dry 0 / wet 100)
        let lvl = |json: &str, a: f64, b: f64| {
            let t: Track = serde_json::from_str(json).unwrap();
            let n = 3 * SR as usize;
            let mut l: Vec<f32> = (0..n).map(|i| if i < SR as usize { (0.5 * (2.0 * std::f64::consts::PI * 300.0 * i as f64 / SR as f64).sin()) as f32 } else { 0.0 }).collect();
            let mut r = l.clone();
            crate::fx::Chain::for_track(&t, SR as f64, 120.0).process(&mut l, &mut r, false);
            let (i0, i1) = ((a * SR as f64) as usize, (b * SR as f64) as usize);
            20.0 * ((l[i0..i1].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (i1 - i0) as f64).sqrt() + 1e-12).log10()
        };
        let e = |duck: f64| format!(r#"{{"effects":["delay"],"effectParams":{{"delay":{{"beats":1,"feedback":50,"wet":100,"dry":0,"duck":{duck},"hpf":150,"lpf":6000}}}}}}"#);
        let rv = |duck: f64| format!(r#"{{"effects":["reverb"],"effectParams":{{"reverb":{{"wet":100,"size":2.4,"pre":20,"low":150,"high":8000,"duck":{duck}}}}}}}"#);
        let (e0p, e8p, e0a, e8a) = (lvl(&e(0.0), 0.6, 0.95), lvl(&e(80.0), 0.6, 0.95), lvl(&e(0.0), 1.55, 1.95), lvl(&e(80.0), 1.55, 1.95));
        let (r0p, r8p, r0a, r8a) = (lvl(&rv(0.0), 0.5, 0.95), lvl(&rv(80.0), 0.5, 0.95), lvl(&rv(0.0), 1.4, 1.9), lvl(&rv(80.0), 1.4, 1.9));
        println!("ducking écho pendant {:.2} → {:.2} / après {:.2} → {:.2} ; reverb pendant {:.2} → {:.2} / après {:.2} → {:.2}", e0p, e8p, e0a, e8a, r0p, r8p, r0a, r8a);
        assert!(e8p < e0p - 10.0, "écho poussé pendant la voix : {e0p} → {e8p}");
        assert!((e8a - e0a).abs() < 3.0, "écho revenu dans le trou : {e0a} → {e8a}");
        assert!(r8p < r0p - 10.0, "reverb poussée pendant la voix : {r0p} → {r8p}");
        assert!((r8a - r0a).abs() < 4.0, "reverb revenue : {r0a} → {r8a}");
    }

    /// EQ calé sur l'analogique : mêmes chiffres que tests/scenarios/eq-analogique.mjs (export du navigateur).
    #[test]
    fn eq_cale_analogique() {
        for (f0, g, q, f, attendu) in [(12000.0, 6.0, 0.7, 18000.0, 4.62), (16000.0, 6.0, 0.7, 8000.0, 3.02), (8000.0, -6.0, 0.7, 12000.0, -4.50), (1000.0, 6.0, 1.0, 1500.0, 3.52)] {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["eq"],"effectParams":{{"eq":{{"bands":[{{"type":"bell","freq":{f0},"gain":{g},"q":{q}}}]}}}}}}"#)).unwrap();
            let m = eq_gain_db(&t, f);
            assert!((m - attendu).abs() < 0.05, "cloche {g} dB à {f0}, mesurée à {f} : {m} (navigateur {attendu})");
        }
    }

    /// Saturation suréchantillonnée ×4 : mêmes chiffres que tests/scenarios/saturation-propre.mjs.
    #[test]
    fn saturation_sans_parasites() {
        let sr = SR as usize;
        let run = |f: f64, a: f64, drive: f64| {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["sat"],"effectParams":{{"sat":{{"drive":{drive}}}}}}}"#)).unwrap();
            let mut l: Vec<f32> = (0..sr).map(|i| (a * (2.0 * std::f64::consts::PI * f * i as f64 / SR as f64).sin()) as f32).collect();
            let mut r = l.clone();
            crate::fx::Chain::for_track(&t, SR as f64, 120.0).process(&mut l, &mut r, false);
            l
        };
        let goertzel = |x: &[f32], f: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for i in sr / 4..sr * 3 / 4 {
                let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * (i - sr / 4) as f64 / (sr / 2) as f64).cos();
                let ph = 2.0 * std::f64::consts::PI * f * i as f64 / SR as f64;
                re += x[i] as f64 * w * ph.cos(); im += x[i] as f64 * w * ph.sin();
            }
            (re * re + im * im).sqrt()
        };
        let x = run(7000.0, 0.5, 100.0);
        let f0 = goertzel(&x, 7000.0);
        let db = |f: f64| 20.0 * (goertzel(&x, f) / f0 + 1e-12).log10();
        let (p13, p1, h3) = (db(13000.0), db(1000.0), db(21000.0));
        let g = run(1000.0, 0.25, 50.0);
        let gain = 10.0 * (g[sr / 2..].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (sr / 2) as f64 / (0.25f64.powi(2) / 2.0)).log10();
        println!("saturation : parasite 13 kHz {p13:.1} / 1 kHz {p1:.1} / 3e harmonique {h3:.1} / gain {gain:.2}");
        assert!(p13 < -90.0 && p1 < -90.0, "parasites : {p13} / {p1}");
        assert!((h3 + 17.3).abs() < 0.3, "3e harmonique comme le navigateur (−17,3) : {h3}");
        assert!((gain - 4.02).abs() < 0.05, "gain comme le navigateur (4,02) : {gain}");
    }

    /// Compresseur Propre : maintien des crêtes du détecteur — une basse rapide ne se déforme plus.
    /// Avant : 3e harmonique à 60 Hz = −18 / −25 / −36 dB (attaque / relâchement 0,1/5, 1/20, 10/50 ms) ; même mesure que tests/scenarios/comp-parite.mjs.
    #[test]
    fn comp_basses_sans_distorsion() {
        let n = 2 * SR as usize;
        for (att, rel) in [(0.1, 5.0), (1.0, 20.0), (10.0, 50.0)] {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["comp"],"effectParams":{{"comp":{{"threshold":-30,"ratio":8,"attack":{att},"release":{rel},"makeup":0,"mode":0}}}}}}"#)).unwrap();
            let mut l: Vec<f32> = (0..n).map(|i| (0.7 * (2.0 * std::f64::consts::PI * 60.0 * i as f64 / SR as f64).sin()) as f32).collect();
            let mut r = l.clone();
            crate::fx::Chain::for_track(&t, SR as f64, 120.0).process(&mut l, &mut r, false);
            let goertzel = |fr: f64| {
                let (mut re, mut im) = (0.0, 0.0);
                for i in SR as usize / 2..n {
                    let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * (i - SR as usize / 2) as f64 / (n - SR as usize / 2) as f64).cos();
                    let ph = 2.0 * std::f64::consts::PI * fr * i as f64 / SR as f64;
                    re += l[i] as f64 * w * ph.cos(); im += l[i] as f64 * w * ph.sin();
                }
                (re * re + im * im).sqrt()
            };
            let h3 = 20.0 * (goertzel(180.0) / goertzel(60.0) + 1e-12).log10();
            assert!(h3 < -90.0, "3e harmonique à 60 Hz, attaque {att} / relâchement {rel} : {h3} dB");
        }
    }

    /// Limiteur : gain d'entrée, relâchement, pic réel — mêmes chiffres que tests/scenarios/limiteur-reglages.mjs.
    /// 12 kHz décalé d'un huitième : les échantillons tombent 3 dB sous les vraies crêtes, seul le pic réel les voit.
    #[test]
    fn limiteur_reglages() {
        let sr = SR as usize;
        let run = |json: &str| {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["limit"],"effectParams":{{"limit":{json}}}}}"#)).unwrap();
            let mut l: Vec<f32> = (0..sr).map(|i| (0.3 * (2.0 * std::f64::consts::PI * 12000.0 * i as f64 / SR as f64 + std::f64::consts::FRAC_PI_4).sin()) as f32).collect();
            let mut r = l.clone();
            crate::fx::Chain::for_track(&t, SR as f64, 120.0).process(&mut l, &mut r, false);
            let rms = (l[sr / 2..].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (sr / 2) as f64).sqrt();
            (20.0 * rms.log10(), l[sr / 2..].iter().fold(0.0f32, |m, v| m.max(v.abs())))
        };
        let (a, pa) = run(r#"{"gain":12,"ceiling":-1,"release":50}"#);
        let (b, pb) = run(r#"{"gain":12,"ceiling":-1,"release":50,"tp":1}"#);
        let (c, _) = run(r#"{"ceiling":-1}"#);
        println!("limiteur : sans pic réel {a:.2} ({pa:.3}) / avec {b:.2} ({pb:.3}) / gain 0 {c:.2}");
        assert!((a + 1.47).abs() < 0.05 && (pa - 0.845).abs() < 0.005, "sans pic réel (navigateur −1,47 dB, crête 0,845) : {a} / {pa}");
        assert!((b + 3.84).abs() < 0.05 && (pb - 0.643).abs() < 0.005, "pic réel (navigateur −3,84 dB, crête 0,643) : {b} / {pb}");
        assert!((c + 13.47).abs() < 0.05, "gain 0 : rien ne bouge (−13,47) : {c}");
    }

    /// Délai de piste : le son est décalé, pas les régions — mêmes chiffres que tests/scenarios/delai-piste.mjs.
    #[test]
    fn delai_de_piste() {
        let sr = SR as usize;
        let pic = |delay: f64| {
            let p: Project = serde_json::from_str(&format!(r#"{{"bpm":120,"tracks":[{{"volume":100,"delayMs":{delay},"clips":[{{"id":"clic","start":1,"duration":1}}]}}]}}"#)).unwrap();
            let mut buf = vec![0.0f32; sr]; buf[100] = 0.8;
            let media = Media::from([("clic".to_owned(), Source { sample_rate: SR, channels: vec![buf] })]);
            let (l, _) = render(&p, &media, &RenderOptions { sample_rate: SR, only_track: Some(0), ..Default::default() });
            l.iter().enumerate().fold((0, 0.0f32), |(k, m), (i, v)| if v.abs() > m { (i, v.abs()) } else { (k, m) }).0
        };
        let v = [pic(0.0), pic(10.0), pic(-10.0)];
        println!("délai de piste : {v:?}");
        assert_eq!(v, [48100, 48580, 47620], "navigateur : 48 100 / 48 580 / 47 620");
    }

    /// Limiteur : styles Transparent / Doux / Franc — mêmes chiffres que tests/scenarios/limiteur-styles.mjs.
    #[test]
    fn limiteur_styles() {
        let sr = SR as usize;
        let run = |json: &str| {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["limit"],"effectParams":{{"limit":{json}}}}}"#)).unwrap();
            let mut l: Vec<f32> = (0..sr).map(|i| ((if i < sr / 4 { 0.9 } else { 0.05 }) * (2.0 * std::f64::consts::PI * 100.0 * i as f64 / SR as f64).sin()) as f32).collect();
            let mut r = l.clone();
            crate::fx::Chain::for_track(&t, SR as f64, 120.0).process(&mut l, &mut r, false);
            let rms = |a: f64, z: f64| {
                let (i0, i1) = ((a * SR as f64).round() as usize, (z * SR as f64).round() as usize);
                20.0 * ((l[i0..i1].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (i1 - i0) as f64).sqrt() + 1e-9).log10()
            };
            let pk = l.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            [rms(0.05, 0.25), rms(0.26, 0.30), rms(0.40, 0.50), pk as f64]
        };
        let base = r#""gain":6,"ceiling":-3,"release":120"#;
        let got = [run(&format!("{{{base}}}")), run(&format!("{{{base},\"style\":1}}")), run(&format!("{{{base},\"style\":2}}"))];
        println!("limiteur styles : {got:.2?}");
        let want = [[-6.01, -30.79, -25.09, 0.708], [-6.01, -31.12, -30.58, 0.708], [-6.01, -29.54, -23.30, 0.708]];
        for (g, w) in got.iter().zip(want.iter()) {
            for k in 0..3 { assert!((g[k] - w[k]).abs() < 0.1, "limiteur style : {g:?} (navigateur {w:?})"); }
            assert!((g[3] - w[3]).abs() < 0.005, "crête : {g:?} (navigateur {w:?})");
        }
    }

    /// Gate : ratio (expandeur), genou, attaque, maintien, filtre du déclencheur — mêmes chiffres que tests/scenarios/gate-reglages.mjs.
    #[test]
    fn gate_reglages() {
        let sr = SR as usize;
        let lvl = |sig: &dyn Fn(usize) -> f64, gate: &str, a: f64, z: f64| {
            let t: Track = serde_json::from_str(&format!(r#"{{"effects":["gate"],"effectParams":{{"gate":{gate}}}}}"#)).unwrap();
            let mut l: Vec<f32> = (0..sr).map(|i| sig(i) as f32).collect();
            let mut r = l.clone();
            crate::fx::Chain::for_track(&t, SR as f64, 120.0).process(&mut l, &mut r, false);
            let (i0, i1) = ((a * SR as f64) as usize, (z * SR as f64) as usize);
            20.0 * ((l[i0..i1].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (i1 - i0) as f64).sqrt() + 1e-12).log10()
        };
        let tau = 2.0 * std::f64::consts::PI;
        let voix = |i: usize| (if i < sr / 2 { 0.5 } else { 0.01 }) * (tau * 300.0 * i as f64 / SR as f64).sin();
        let grave = |i: usize| 0.1 * (tau * 50.0 * i as f64 / SR as f64).sin();
        let exp = r#"{"threshold":-30,"reduction":30,"ratio":4,"knee":6,"attack":2,"hold":20,"release":80}"#;
        let v = [lvl(&voix, r#"{"threshold":-30}"#, 0.7, 0.95), lvl(&voix, exp, 0.7, 0.95), lvl(&voix, exp, 0.1, 0.45),
                 lvl(&grave, r#"{"threshold":-30}"#, 0.5, 0.95), lvl(&grave, r#"{"threshold":-30,"hp":200}"#, 0.5, 0.95)];
        println!("gate : {v:.2?}");
        for (got, want) in v.iter().zip([-53.58, -62.22, -9.03, -23.01, -55.83]) {
            // sous −50 dB, l'export WAV 16 bits du navigateur arrondit un peu : 0,2 dB de marge
            assert!((got - want).abs() < if want < -50.0 { 0.2 } else { 0.1 }, "gate : {got} (navigateur {want})");
        }
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
    fn courbe_de_pan_sur_une_piste() {
        // Pan automatisé : tout à gauche au début, tout à droite à la fin (même calcul que le StereoPanner)
        let json = r#"{"volume":100,"clips":[{"id":"a","start":0,"duration":8,"offset":0}],
                       "automation":{"pan":{"points":[{"t":0,"v":0},{"t":2,"v":0},{"t":6,"v":1}]}}}"#;
        let t: Track = serde_json::from_str(json).unwrap();
        let p = Project { tracks: vec![t], ..Default::default() };
        let (l, r) = render(&p, &ramp_media(), &opts());
        let i = |s: f64| (s * SR as f64).round() as usize;
        assert!(l[i(1.0)].abs() > 0.01 && r[i(1.0)].abs() < 1e-4, "début à gauche : {} / {}", l[i(1.0)], r[i(1.0)]);
        assert!(r[i(7.0)].abs() > 0.01 && l[i(7.0)].abs() < 1e-4, "fin à droite : {} / {}", l[i(7.0)], r[i(7.0)]);
    }

    #[test]
    fn courbe_d_envoi_remplace_la_dose() {
        // L'envoi suit sa courbe (0 au début, plein à la fin) même si la dose fixe est à 0
        let mk = |auto: &str| -> Project {
            let t: Track = serde_json::from_str(&format!(r#"{{"volume":100,"clips":[{{"id":"a","start":0,"duration":8,"offset":0}}],"automation":{{{auto}}}}}"#)).unwrap();
            let sd: crate::model::Send = serde_json::from_str(r#"{"id":"rv","name":"Rev","type":"reverb","size":2,"volume":100}"#).unwrap();
            Project { tracks: vec![t], sends: vec![sd], ..Default::default() }
        };
        let sans = render(&mk(""), &ramp_media(), &opts()).0;
        let avec = render(&mk(r#""send:rv":{"points":[{"t":0,"v":0},{"t":3,"v":0},{"t":4,"v":1}]}"#), &ramp_media(), &opts()).0;
        let i = |s: f64| (s * SR as f64).round() as usize;
        assert!((avec[i(2.0)] - sans[i(2.0)]).abs() < 1e-6, "avant la courbe : pas d'envoi");
        let diff: f32 = (i(5.0)..i(6.0)).map(|n| (avec[n] - sans[n]).abs()).sum();
        assert!(diff > 1.0, "après la courbe : la reverb s'entend ({diff})");
    }

    #[test]
    fn envoi_vers_un_groupe() {
        // Aux : la piste sort au master ET envoie 50 % vers un groupe à 50 % → 1 + 0,25 du signal
        let mut p = project(vec![clip(0.0, 4.0, 5.0)]);
        let base = at(&p, &opts(), 1.0);
        let b: Bus = serde_json::from_str(r#"{"id":"g","volume":50,"output":"master"}"#).unwrap();
        p.buses = vec![b];
        p.tracks[0].bus_sends.insert("g".into(), 50.0);
        close(at(&p, &opts(), 1.0), base * 1.25);
        // Courbe d'envoi : 0 au début, la dose fixe ne compte plus
        p.tracks[0].automation = serde_json::from_str(r#"{"busSend:g":{"points":[{"t":0,"v":0}]}}"#).unwrap();
        close(at(&p, &opts(), 1.0), base);
    }

    #[test]
    fn automation_d_un_reglage_d_effet() {
        // Gain de l'utilitaire automatisé : -24 dB au début, 0 dB ensuite (v = 0,5 au milieu de -24..24)
        let json = r#"{"volume":100,"clips":[{"id":"a","start":0,"duration":8,"offset":0}],"effects":["util"],"effectParams":{"util":{"gain":0}},
                       "automation":{"fx:util:gain":{"points":[{"t":0,"v":0},{"t":3,"v":0},{"t":3.01,"v":0.5}]}}}"#;
        let t: Track = serde_json::from_str(json).unwrap();
        let p = Project { tracks: vec![t], ..Default::default() };
        let sans = { let mut q = p.clone(); q.tracks[0].automation = Default::default(); q };
        close(at(&p, &opts(), 2.0), at(&sans, &opts(), 2.0) * 10f64.powf(-24.0 / 20.0));
        close(at(&p, &opts(), 5.0), at(&sans, &opts(), 5.0));
    }

    #[test]
    fn automation_d_une_bande_d_eq() {
        // Gain d'une bande d'EQ automatisé : la courbe change le son (même réglage fixe dans les deux cas)
        let mk = |auto: &str| -> Project {
            let t: Track = serde_json::from_str(&format!(r#"{{"volume":100,"clips":[{{"id":"a","start":0,"duration":8,"offset":0}}],"effects":["eq"],
                "effectParams":{{"eq":{{"bands":[{{"type":"lowshelf","freq":2000,"gain":0,"q":1}}]}}}},"automation":{{{auto}}}}}"#)).unwrap();
            Project { tracks: vec![t], ..Default::default() }
        };
        let fixe = mk("");
        let auto = mk(r#""fx:eq:b0-gain":{"points":[{"t":0,"v":1}]}"#);
        let (a, b) = (at(&auto, &opts(), 4.0), at(&fixe, &opts(), 4.0));
        assert!((a - b).abs() > 0.05, "la bande automatisée (+18 dB) change le son : {a} / {b}");
    }

    #[test]
    fn bus_d_envoi_comme_un_retour() {
        // Un ancien retour Reverb (envoi fermé) et le bus d'envoi qui le remplace (reverb 100 %, sortie -9,54 dB) : même son.
        // Deux pistes envoient dans le même bus, comme tests/scenarios/bus-envoi.mjs.
        let tr = |sends: &str, start: f64| format!(r#"{{"volume":100,"output":"master","clips":[{{"id":"a","start":{start},"duration":0.5,"offset":4}}],{sends}}}"#);
        let retour: Project = serde_json::from_str(&format!(r#"{{"bpm":120,"sends":[{{"id":"rv","name":"Rev","type":"reverb","size":3.2,"volume":100}}],
            "tracks":[{},{}]}}"#, tr(r#""sends":{"rv":40}"#, 0.0), tr(r#""sends":{"rv":20}"#, 0.25))).unwrap();
        let bus: Project = serde_json::from_str(&format!(r#"{{"bpm":120,"buses":[{{"id":"aux","isGroup":true,"output":"master","volume":100,"effects":["reverb"],
            "effectParams":{{"reverb":{{"size":3.2,"pre":0,"wet":100,"out":-9.54}}}}}}],
            "tracks":[{},{}]}}"#, tr(r#""busSends":{"aux":40}"#, 0.0), tr(r#""busSends":{"aux":20}"#, 0.25))).unwrap();
        let rms = |p: &Project, a: f64, b: f64| {
            let (l, r) = render(p, &ramp_media(), &opts());
            let (i0, i1) = ((a * SR as f64) as usize, (b * SR as f64) as usize);
            ((i0..i1).map(|n| (l[n] as f64).powi(2) + (r[n] as f64).powi(2)).sum::<f64>() / (2 * (i1 - i0)) as f64).sqrt()
        };
        for (a, b) in [(0.1, 0.5), (0.8, 1.6), (1.6, 3.0)] {
            let (x, y) = (rms(&retour, a, b), rms(&bus, a, b));
            let db = 20.0 * (y / x).log10();
            println!("{a}-{b} s : retour {x:.5} / bus {y:.5} ({db:+.3} dB)");
            assert!(db.abs() < 0.05, "le bus d'envoi sonne comme le retour ({a}-{b} s : {db:+.3} dB)");
        }
    }

    #[test]
    fn envoi_avant_le_fader() {
        // Pre : fader à 0 → l'envoi vers le groupe passe quand même (Post : plus rien)
        let mut p = project(vec![clip(0.0, 4.0, 5.0)]);
        let base = at(&p, &opts(), 1.0);
        let b: Bus = serde_json::from_str(r#"{"id":"g","volume":100,"output":"master"}"#).unwrap();
        p.buses = vec![b];
        p.tracks[0].bus_sends.insert("g".into(), 100.0);
        p.tracks[0].volume = Some(0.0);
        close(at(&p, &opts(), 1.0), 0.0);
        p.tracks[0].pre_sends.insert("busSend:g".into(), true);
        // avant le pan : le signal mono arrive tel quel des deux côtés (sans les -3 dB du pan centré, comme le navigateur)
        close(at(&p, &opts(), 1.0), base * std::f64::consts::SQRT_2);
    }

    #[test]
    fn effet_sur_une_region() {
        // Deux régions côte à côte ; seule la 2e a un effet (utilitaire -6 dB) : la 1re ne bouge pas
        let mk = |fx: &str| -> Project {
            let t: Track = serde_json::from_str(&format!(r#"{{"volume":100,"clips":[{{"id":"a","start":0,"duration":2,"offset":0}},{{"id":"a","start":2,"duration":2,"offset":2{fx}}}]}}"#)).unwrap();
            Project { tracks: vec![t], ..Default::default() }
        };
        let sans = mk("");
        let avec = mk(r#","fx":{"effects":["util"],"effectParams":{"util":{"gain":-6}}}"#);
        close(at(&avec, &opts(), 1.0), at(&sans, &opts(), 1.0));
        close(at(&avec, &opts(), 3.0), at(&sans, &opts(), 3.0) * 10f64.powf(-6.0 / 20.0));
    }

    #[test]
    fn echo_d_une_region_deborde_apres_sa_fin() {
        // Écho sur une région de 1 s : ses répétitions continuent après la fin de la région
        let t: Track = serde_json::from_str(r#"{"volume":100,"clips":[{"id":"a","start":0,"duration":1,"offset":0,
            "fx":{"effects":["delay"],"effectParams":{"delay":{"ms":250,"feedback":50,"wet":100,"dry":100}}}}]}"#).unwrap();
        let p = Project { tracks: vec![t], ..Default::default() };
        let (l, _) = render(&p, &ramp_media(), &opts());
        let i = |s: f64| (s * SR as f64).round() as usize;
        let queue: f32 = (i(1.05)..i(1.6)).map(|n| l[n].abs()).sum();
        assert!(queue > 1.0, "l'écho s'entend après la région : {queue}");
    }

    #[test]
    fn automation_des_autres_effets() {
        // Trémolo, bitcrusher, pitch : la courbe à 0 = son d'origine, à fond = son changé
        let mk = |fx: &str, params: &str, key: &str, v: f64| -> Project {
            let t: Track = serde_json::from_str(&format!(r#"{{"volume":100,"clips":[{{"id":"a","start":0,"duration":8,"offset":0}}],"effects":["{fx}"],
                "effectParams":{{"{fx}":{params}}},"automation":{{"fx:{fx}:{key}":{{"points":[{{"t":0,"v":{v}}}]}}}}}}"#)).unwrap();
            Project { tracks: vec![t], ..Default::default() }
        };
        let base = Project { tracks: vec![serde_json::from_str(r#"{"volume":100,"clips":[{"id":"a","start":0,"duration":8,"offset":0}]}"#).unwrap()], ..Default::default() };
        let diff = |p: &Project| { let (a, _) = render(p, &ramp_media(), &opts()); let (b, _) = render(&base, &ramp_media(), &opts()); (SR as usize..3 * SR as usize).map(|n| (a[n] - b[n]).abs()).sum::<f32>() };
        for (fx, params, key, full) in [("tremolo", r#"{"rate":5,"depth":50}"#, "depth", 1.0), ("crush", r#"{"bits":4,"down":8,"mix":50}"#, "mix", 1.0)] {
            let zero = diff(&mk(fx, params, key, 0.0));
            let fort = diff(&mk(fx, params, key, full));
            assert!(zero < 1.0 && fort > 10.0, "{fx} : courbe à zéro {zero} / à fond {fort}");
        }
        // Pitch (il retarde toujours un peu le son) : 0 demi-ton et +12 ne donnent pas le même son
        let (a, _) = render(&mk("pitch", r#"{"semi":0,"mix":100}"#, "semi", 0.5), &ramp_media(), &opts());
        let (b, _) = render(&mk("pitch", r#"{"semi":0,"mix":100}"#, "semi", 1.0), &ramp_media(), &opts());
        let d: f32 = (SR as usize..3 * SR as usize).map(|n| (a[n] - b[n]).abs()).sum();
        assert!(d > 10.0, "pitch automatisé : {d}");
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
