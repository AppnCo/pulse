//! Mesure : pendant que le son passe dans un plugin externe (blocs de 512 au rythme réel), l'appli fait ce qu'elle fait
//! en vrai (enregistrer l'état, lire la latence, les réglages touchés). Combien de blocs passent SANS le plugin ?
//! `cargo run --release --features ext --example ext_verrou -- "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 4.vst3" …`
#[cfg(not(feature = "ext"))]
fn main() { eprintln!("à lancer avec --features ext"); }
#[cfg(feature = "ext")]
fn main() {
    use pulse_engine::ext;
    use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
    use std::time::{Duration, Instant};
    let sr = 48_000.0;
    for (k, path) in std::env::args().skip(1).enumerate() {
        let name = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let mut p = match vst3_host::simple::load_plugin(&path) { Ok(p) => p, Err(e) => { println!("{name}: chargement impossible ({e})"); continue; } };
        if p.reconfigure(sr, ext::MAX_BLOCK).is_err() || p.start_processing().is_err() { println!("{name}: démarrage impossible"); continue; }
        let id = format!("vst#m{k}");
        let inner = Arc::new(Mutex::new(p));
        ext::insert(&id, ext::Inst::Vst(inner.clone()));
        let stop = Arc::new(AtomicBool::new(false));
        let (stop2, id2) = (stop.clone(), id.clone());
        let m0 = ext::MISSES.load(Ordering::Relaxed);
        let audio = std::thread::spawn(move || {
            let mut slot = ext::ExtSlot::new(&id2, sr);
            let (mut l, mut r) = (vec![0.0f32; 512], vec![0.0f32; 512]);
            let (t0, mut n, mut worst) = (Instant::now(), 0u64, 0.0f64);
            while !stop2.load(Ordering::Relaxed) {
                for i in 0..512 { let v = 0.2 * ((n * 512 + i as u64) as f32 * 0.05).sin(); l[i] = v; r[i] = v; }
                let t = Instant::now(); slot.process(&mut l, &mut r, false); worst = worst.max(t.elapsed().as_secs_f64() * 1000.0);
                n += 1;
                let due = Duration::from_secs_f64(n as f64 * 512.0 / sr); if let Some(w) = due.checked_sub(t0.elapsed()) { std::thread::sleep(w); }
            }
            (n, worst)
        });
        let (mut t_state, mut t_par, mut t_lat, mut len) = (0.0f64, 0.0f64, 0.0f64, 0usize);
        for _ in 0..15 {
            std::thread::sleep(Duration::from_millis(200));
            let t = Instant::now(); if let Ok(st) = inner.lock().unwrap().save_state() { len = st.len(); } t_state = t_state.max(t.elapsed().as_secs_f64() * 1000.0);
            let t = Instant::now(); let _ = inner.lock().unwrap().take_parameter_edits(); let _ = inner.lock().unwrap().get_parameters(); t_par = t_par.max(t.elapsed().as_secs_f64() * 1000.0);
            let t = Instant::now(); let _ = ext::latency(&id); t_lat = t_lat.max(t.elapsed().as_secs_f64() * 1000.0);
        }
        stop.store(true, Ordering::Relaxed);
        let (n, worst) = audio.join().unwrap();
        println!("{name}: blocs {n}, SANS plugin {}, pire bloc {worst:.2} ms (10,7 dispo) | état {len} octets en {t_state:.2} ms, réglages {t_par:.2} ms, latence {t_lat:.2} ms",
            ext::MISSES.load(Ordering::Relaxed) - m0);
        ext::remove(&id);
    }
}
