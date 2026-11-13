//! Banc « craquements » : tourne chaque réglage de chaque plugin PENDANT la lecture, comme une main sur un bouton,
//! et mesure les clics (sauts dans le son) par rapport au même plugin laissé tranquille.
//! cargo run --release --example zipper -- defs.json [effet] [réglage]
//! defs.json = { effet: [{ key, min, max, def, log, choices, toggle }] } (tiré de FX_PANEL_DEFS, voir tests/zipper.sh)
//! Trois chemins mesurés, ceux de l'appli :
//!   direct  = Renderer::fx_live (réglage envoyé au plugin qui joue)
//!   échange = nouveau mixeur + fondu enchaîné (player::start_fade), pour les réglages que le direct ne sait pas suivre
//!   mix     = Renderer::mix_from (fader, pan, mute, dose d'envoi, envoi mis à 0 / remis)
use pulse_engine::{model::Project, player, render::{Media, RenderOptions, Renderer, Source}};
use serde_json::{json, Value};
use std::sync::Arc;

const SR: u32 = 48_000;
const BLOCK: usize = 1024;
const SECS: f64 = 4.0;

fn project(fx: &str, params: &Value, volume: f64, pan: f64, muted: bool) -> Project {
    let mut ep = serde_json::Map::new();
    ep.insert(fx.to_string(), params.clone());
    let list: Vec<&str> = if fx.is_empty() { vec![] } else { vec![fx] };
    serde_json::from_value(json!({ "tracks": [{ "volume": volume, "pan": pan, "muted": muted,
        "clips": [{ "id": "s", "start": 0, "duration": SECS }], "effects": list, "effectParams": ep }] })).unwrap()
}

/// Une piste qui part dans un envoi d'écho (dose en %), pour mesurer la dose tournée en lecture
fn project_send(level: f64) -> Project {
    serde_json::from_value(json!({ "bpm": 120, "sends": [{ "id": "d", "type": "delay", "beats": 0.25, "feedback": 0, "volume": 100 }],
        "tracks": [{ "volume": 80, "clips": [{ "id": "s", "start": 0, "duration": SECS }], "sends": { "d": level } }] })).unwrap()
}

fn opts() -> RenderOptions { RenderOptions { sample_rate: SR, range: Some((0.0, SECS)), ..Default::default() } }

/// Plus grand saut (dérivée seconde) entre 0,9 s et 2,6 s : un sinus grave en a très peu, un clic en a beaucoup
fn click(l: &[f32], r: &[f32]) -> f64 {
    let (a, b) = ((0.9 * SR as f64) as usize, ((2.6 * SR as f64) as usize).min(l.len()));
    let mut m = 0.0f64;
    for ch in [l, r] {
        for i in a.max(2)..b.min(ch.len()) { m = m.max((ch[i] as f64 - 2.0 * ch[i - 1] as f64 + ch[i - 2] as f64).abs()); }
    }
    m
}

fn val(min: f64, max: f64, log: bool, n: f64) -> f64 { if log && min > 0.0 { min * (max / min).powf(n) } else { min + n * (max - min) } }

/// Position du bouton (0..1) au bloc `b` : immobile, puis aller-retour min → max → min entre 1 s et 2 s, puis immobile
fn knob(b: usize, start: f64) -> Option<f64> {
    let t = (b * BLOCK) as f64 / SR as f64;
    if !(1.0..2.0).contains(&t) { return None; }
    let x = (t - 1.0) * 2.0;
    let tri = if x < 1.0 { x } else { 2.0 - x };
    // on part de la valeur de départ, on va au max, au min, puis on revient
    Some((start + tri).rem_euclid(2.0)).map(|v| if v > 1.0 { 2.0 - v } else { v })
}

fn run_static(p: &Project, media: &Media) -> (Vec<f32>, Vec<f32>) {
    let mut r = Renderer::new(p, media, &opts());
    let (mut l, mut rr) = (vec![0.0f32; BLOCK], vec![0.0f32; BLOCK]);
    let (mut ol, mut or) = (Vec::new(), Vec::new());
    loop { let n = r.process(media, &mut l, &mut rr); if n == 0 { break; } ol.extend_from_slice(&l[..n]); or.extend_from_slice(&rr[..n]); }
    (ol, or)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let defs: Value = serde_json::from_str(&std::fs::read_to_string(a.get(1).expect("defs.json")).unwrap()).unwrap();
    let (only_fx, only_key) = (a.get(2).cloned(), a.get(3).cloned());
    let sig = std::env::var("ZIP_SIG").unwrap_or("sin".into());
    let mut media = Media::new();
    let n = (SECS * SR as f64) as usize;
    let s: Vec<f32> = (0..n).map(|i| {
        let t = i as f64 / SR as f64;
        // sinus grave (le moindre saut s'entend et se mesure) ; « voix » = quelques harmoniques
        let x = if sig == "voix" { 0.5 * (t * 220.0 * std::f64::consts::TAU).sin() + 0.25 * (t * 440.0 * std::f64::consts::TAU).sin() + 0.12 * (t * 660.0 * std::f64::consts::TAU).sin() } else { (t * 220.0 * std::f64::consts::TAU).sin() };
        (0.25 * x) as f32 }).collect();
    media.insert("s".into(), Source::new(SR, vec![s]));
    let media = Arc::new(media);
    let seuil: f64 = std::env::var("ZIP_SEUIL").ok().and_then(|s| s.parse().ok()).unwrap_or(3.0);
    let mut bad = 0;
    println!("{:<8} {:<10} {:<8} {:>9} {:>9} {:>7}  verdict", "effet", "réglage", "chemin", "repos", "bougé", "×");

    // --- mix : fader, pan, mute ---
    if only_fx.is_none() || only_fx.as_deref() == Some("mix") {
        for what in ["volume", "pan", "mute", "envoi", "envoi0"] {
            let p0 = if what.starts_with("envoi") { project_send(50.0) } else { project("", &json!({}), 80.0, 0.0, false) };
            let base = click(&run_static(&p0, &media).0, &[]).max(1e-9);
            let mut r = Renderer::new(&p0, &media, &opts());
            let (mut l, mut rr) = (vec![0.0f32; BLOCK], vec![0.0f32; BLOCK]);
            let (mut ol, mut or) = (Vec::new(), Vec::new());
            let mut b = 0;
            loop {
                if let Some(k) = knob(b, 0.5) {
                    let p = match what { "envoi" => project_send(k * 100.0), "envoi0" => project_send(if b % 8 < 4 { 0.0 } else { 50.0 }), "volume" => project("", &json!({}), k * 100.0, 0.0, false), "pan" => project("", &json!({}), 80.0, -100.0 + 200.0 * k, false), _ => project("", &json!({}), 80.0, 0.0, b % 8 < 4) };
                    r.mix_from(&p, &media);
                }
                let n = r.process(&media, &mut l, &mut rr); if n == 0 { break; }
                ol.extend_from_slice(&l[..n]); or.extend_from_slice(&rr[..n]); b += 1;
            }
            let c = click(&ol, &or);
            let ratio = c / base;
            if ratio > seuil { bad += 1; }
            println!("{:<8} {:<10} {:<8} {:>9.6} {:>9.6} {:>7.1}  {}", "mix", what, "mix", base, c, ratio, if ratio > seuil { "CLIC" } else { "ok" });
        }
    }

    let Some(map) = defs.as_object() else { return };
    for (fx, list) in map {
        if only_fx.as_ref().is_some_and(|f| f != fx) { continue; }
        let list = list.as_array().unwrap();
        let mut base_p = serde_json::Map::new();
        for d in list { if let Some(v) = d["def"].as_f64() { base_p.insert(d["key"].as_str().unwrap().into(), json!(v)); } }
        // effets qui ne s'allument qu'avec une quantité > 0
        if fx == "sat" { base_p.insert("drive".into(), json!(40.0)); }
        for d in list {
            let key = d["key"].as_str().unwrap();
            if only_key.as_ref().is_some_and(|k| k != key) { continue; }
            if d["choices"].as_bool() == Some(true) || d["toggle"].as_bool() == Some(true) { continue; }
            let (Some(min), Some(max)) = (d["min"].as_f64(), d["max"].as_f64()) else { continue };
            let log = d["log"].as_bool() == Some(true);
            let def = d["def"].as_f64().unwrap_or(min);
            let start = if log && min > 0.0 { ((def / min).ln() / (max / min).ln()).clamp(0.0, 1.0) } else { ((def - min) / (max - min)).clamp(0.0, 1.0) };
            let with = |v: f64| { let mut p = base_p.clone(); p.insert(key.into(), json!(v)); Value::Object(p) };
            // repos : le pire des trois réglages immobiles (le plugin a ses propres harmoniques, son souffle…)
            let mut base = 1e-9f64;
            let mut statics = Vec::new();
            for n in [0.0, 0.5, 1.0] { let o = run_static(&project(fx, &with(val(min, max, log, n)), 80.0, 0.0, false), &media); base = base.max(click(&o.0, &o.1)); statics.push(o); }
            let o_def = run_static(&project(fx, &with(def), 80.0, 0.0, false), &media);
            base = base.max(click(&o_def.0, &o_def.1));

            // direct
            let mut r = Renderer::new(&project(fx, &with(def), 80.0, 0.0, false), &media, &opts());
            let (mut l, mut rr) = (vec![0.0f32; BLOCK], vec![0.0f32; BLOCK]);
            let (mut ol, mut or) = (Vec::new(), Vec::new());
            let mut b = 0;
            loop {
                if let Some(k) = knob(b, start) { r.fx_live_from(false, 0, fx, key, val(min, max, log, k), Some(def)); }
                let n = r.process(&media, &mut l, &mut rr); if n == 0 { break; }
                ol.extend_from_slice(&l[..n]); or.extend_from_slice(&rr[..n]); b += 1;
            }
            let same = ol.iter().zip(&o_def.0).all(|(x, y)| (x - y).abs() < 1e-7) && or.iter().zip(&o_def.1).all(|(x, y)| (x - y).abs() < 1e-7);
            if !same {
                let c = click(&ol, &or);
                let ratio = c / base;
                if ratio > seuil { bad += 1; }
                println!("{:<8} {:<10} {:<8} {:>9.6} {:>9.6} {:>7.1}  {}", fx, key, "direct", base, c, ratio, if ratio > seuil { "CLIC" } else { "ok" });
            }

            // échange (fondu enchaîné vers un mixeur neuf), tous les 3 blocs comme la page (≈ 70 ms)
            let mut r = Box::new(Renderer::new(&project(fx, &with(def), 80.0, 0.0, false), &media, &opts()));
            let (mut ol, mut or) = (Vec::new(), Vec::new());
            let (mut xl, mut xr) = (vec![0.0f32; BLOCK], vec![0.0f32; BLOCK]);
            let mut fading: Option<player::Fade> = None;
            let mut b = 0;
            let mut worst = 0.0f64;
            loop {
                if b % 3 == 0 {
                    if let Some(k) = knob(b, start) {
                        let t0 = std::time::Instant::now();
                        let mut nr = Box::new(Renderer::new(&project(fx, &with(val(min, max, log, k)), 80.0, 0.0, false), &media, &opts()));
                        let old = std::mem::replace(&mut r, nr.clone_placeholder());
                        { let t = old.time(); player::prewarm(&mut nr, &media, || t - 0.2); }
                        fading = Some(player::start_fade(&mut nr, &media, old, media.clone()));
                        r = nr;
                        worst = worst.max(t0.elapsed().as_secs_f64());
                    }
                }
                let n = r.process(&media, &mut l, &mut rr); if n == 0 { break; }
                if let Some(f) = &mut fading { if !f.mix(n, &mut l, &mut rr, &mut xl, &mut xr) { fading = None; } }
                ol.extend_from_slice(&l[..n]); or.extend_from_slice(&rr[..n]); b += 1;
            }
            let c = click(&ol, &or);
            let ratio = c / base;
            let tag = if same { "échange" } else { "(échange)" };
            if same && ratio > seuil { bad += 1; }
            println!("{:<8} {:<10} {:<8} {:>9.6} {:>9.6} {:>7.1}  {}  [{:.1} ms]", fx, key, tag, base, c, ratio, if ratio > seuil { "CLIC" } else { "ok" }, worst * 1e3);
        }
    }
    println!("\n{bad} réglage(s) qui craquent (seuil ×{seuil})");
}

trait Placeholder { fn clone_placeholder(&self) -> Box<Renderer>; }
impl Placeholder for Box<Renderer> {
    /// Mixeur vide le temps de l'échange (std::mem::replace a besoin d'une valeur)
    fn clone_placeholder(&self) -> Box<Renderer> {
        let p: Project = serde_json::from_value(json!({ "tracks": [] })).unwrap();
        Box::new(Renderer::new(&p, &Media::new(), &RenderOptions { sample_rate: SR, range: Some((0.0, 0.1)), ..Default::default() }))
    }
}
