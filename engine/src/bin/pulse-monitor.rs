//! Essai du retour casque direct sur ce poste : ouvre micro + casque à la taille de tampon demandée,
//! volume du retour à ZÉRO (aucun larsen possible), puis affiche ce que le système a donné.
//! Usage : pulse-monitor [tampon=64] [secondes=2] [nom du micro] — PULSE_MON_TRACK='{"track":…}' pour essayer des effets
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let buffer = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(64);
    let secs: f64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(2.0);
    let dev = a.get(3).cloned();
    let m = pulse_engine::monitor::Monitor::new();
    m.set_gain(0.0);
    if let Ok(j) = std::env::var("PULSE_MON_TRACK") { if let Err(e) = m.set_track(&j) { eprintln!("piste : {e}"); std::process::exit(1); } }
    let dev = dev.filter(|d| !d.is_empty());
    let i = m.start(dev, 0, buffer);
    if let Some(e) = &i.error { eprintln!("échec : {e}"); std::process::exit(1); }
    std::thread::sleep(std::time::Duration::from_secs_f64(secs));
    println!("{}", serde_json::to_string(&m.info()).unwrap());
    m.stop();
}
