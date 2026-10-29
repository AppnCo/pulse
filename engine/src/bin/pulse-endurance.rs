//! Endurance du lecteur au fil de l'eau sur la vraie carte son : un .pulse joué en boucle pendant N minutes,
//! un fader bougé toutes les 7 s, une relance ailleurs toutes les 10 min (comme Espace). Mettre le Master du projet
//! à 0 pour un essai muet. Affiche chaque minute : position, trous, dérive d'horloge, mémoire du processus.
//! Usage : pulse-endurance fichier.pulse [minutes=120]
use pulse_engine::{file, player::Player, render};
use std::time::{Duration, Instant};

fn rss_mo() -> u64 {
    let pid = std::process::id().to_string();
    std::process::Command::new("ps").args(["-o", "rss=", "-p", &pid]).output().ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok()).unwrap_or(0) / 1024
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let path = a.get(1).expect("usage : pulse-endurance fichier.pulse [minutes]");
    let minutes: f64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(120.0);
    let t0 = Instant::now();
    let (mut project, media) = file::open(std::fs::File::open(path).expect("fichier")).expect("lecture du .pulse");
    let media = std::sync::Arc::new(media);
    let end = project.end();
    println!("projet lu en {} ms : {} pistes, {:.0} s, master={:?}, mémoire={} Mo", t0.elapsed().as_millis(), project.tracks.len(), end, project.master_volume, rss_mo());
    let player = Player::new();
    let mut rate = 0;
    for _ in 0..100 { rate = player.output_rate(); if rate > 0 { break; } std::thread::sleep(Duration::from_millis(20)); }
    assert!(rate > 0, "aucune sortie audio");
    let start = |player: &Player, project: &pulse_engine::model::Project, from: f64| {
        let opts = render::RenderOptions { sample_rate: rate, start: 0.0, ..Default::default() };
        let mut r = render::Renderer::new(project, &media, &opts);
        if from > 0.0 { r.seek(from); }
        r.set_loop(Some((0.0, end)));
        player.play_stream(r, media.clone(), (from * rate as f64).round() as usize);
    };
    start(&player, &project, 0.0);
    std::thread::sleep(Duration::from_millis(300));
    let (mut under, mut relances, mut mixes, mut errs, mut drift_max) = (0u64, 0u32, 0u32, 0u32, 0.0f64);
    let mut seed = 7u32;
    let mut rnd = || { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; seed as f64 / u32::MAX as f64 };
    let stop_at = t0 + Duration::from_secs_f64(minutes * 60.0);
    let (mut next_log, mut next_relaunch) = (Instant::now() + Duration::from_secs(60), Instant::now() + Duration::from_secs(600));
    let (mut prev_pos, mut prev_t) = (player.position(), Instant::now());
    let started = Instant::now();
    let rss0 = rss_mo();
    while Instant::now() < stop_at {
        std::thread::sleep(Duration::from_secs(7));
        let n = project.tracks.len();
        let k = (rnd() * n as f64) as usize % n.max(1);
        if let Some(t) = project.tracks.get_mut(k) { t.volume = Some(40.0 + rnd() * 60.0); t.pan = Some((rnd() * 60.0 - 30.0).round()); }
        player.set_mix(project.clone());
        mixes += 1;
        if !player.is_playing() { errs += 1; println!("ERREUR la lecture s'est arrêtée toute seule"); }
        if let Some(e) = player.take_error() { errs += 1; println!("ERREUR {e}"); }
        // dérive : ce que le lecteur a avancé comparé à l'horloge (modulo un tour de boucle)
        let (pos, now) = (player.position(), Instant::now());
        let el = now.duration_since(prev_t).as_secs_f64();
        let mut d = (pos - prev_pos) - el;
        d = d - (d / end).round() * end;
        drift_max = drift_max.max(d.abs());
        prev_pos = pos; prev_t = now;
        if Instant::now() > next_relaunch {
            under += player.underruns();
            let from = rnd() * (end - 20.0);
            let tr = Instant::now();
            start(&player, &project, from);
            std::thread::sleep(Duration::from_millis(200));
            relances += 1;
            println!("relance à {from:.0} s, prête en {} ms", tr.elapsed().as_millis());
            next_relaunch = Instant::now() + Duration::from_secs(600);
            prev_pos = player.position(); prev_t = Instant::now();
        }
        if Instant::now() > next_log {
            let lv = player.levels();
            println!("MESURE min={:.0} pos={:.1} trous={} relances={} faders={} erreurs={} derive_max_ms={:.1} niveaux_pistes={} memoire_Mo={} (départ {})",
                started.elapsed().as_secs_f64() / 60.0, pos, under + player.underruns(), relances, mixes, errs, drift_max * 1000.0,
                lv.as_ref().map_or(0, |l| l.tracks.len()), rss_mo(), rss0);
            next_log += Duration::from_secs(60);
        }
    }
    under += player.underruns();
    player.stop();
    println!("BILAN trous={under} relances={relances} faders={mixes} erreurs={errs} derive_max_ms={:.1} memoire_Mo={} (départ {rss0})", drift_max * 1000.0, rss_mo());
    println!("FIN");
}
