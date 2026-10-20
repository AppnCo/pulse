//! pulse-play <projet.pulse> [--muet] — joue un projet Pulse sur la sortie audio du système.
//! Première brique du temps réel : le projet est mixé, puis envoyé à la carte son par le moteur natif.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use pulse_engine::{file, render};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::{fs::File, io::BufReader, process::ExitCode, time::Duration};

fn run(path: &str, muted: bool) -> Result<(), Box<dyn std::error::Error>> {
    let (project, media) = file::open(BufReader::new(File::open(path)?))?;

    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("aucune sortie audio trouvée — branche un casque ou des enceintes")?;
    let config = device.default_output_config()?;
    if config.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("format de sortie non géré pour l'instant : {:?}", config.sample_format()).into());
    }
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;

    // On mixe directement à la fréquence de la carte son
    let opts = render::RenderOptions { sample_rate, ..Default::default() };
    let (left, right) = render::render(&project, &media, &opts);
    if left.is_empty() {
        return Err("le projet ne contient aucun son à jouer".into());
    }
    let total = left.len();
    println!(
        "« {} » sur {} — {} Hz, {} canaux, {:.1} s{}",
        project.name,
        device.name().unwrap_or_else(|_| "sortie par défaut".into()),
        sample_rate, channels, total as f64 / sample_rate as f64,
        if muted { " (muet)" } else { "" }
    );

    let pos = Arc::new(AtomicUsize::new(0));
    let cb_pos = pos.clone();
    // Règle du temps réel : dans ce rappel, ni allocation, ni verrou, ni appel système
    let stream = device.build_output_stream(
        &config.into(),
        move |out: &mut [f32], _| {
            let mut p = cb_pos.load(Ordering::Relaxed);
            for frame in out.chunks_mut(channels) {
                let (l, r) = if p < total && !muted { (left[p], right[p]) } else { (0.0, 0.0) };
                for (c, s) in frame.iter_mut().enumerate() {
                    *s = match c { 0 => l, 1 => r, _ => 0.0 };
                }
                p += 1;
            }
            cb_pos.store(p, Ordering::Relaxed);
        },
        |err| eprintln!("Erreur de la sortie audio : {err}"),
        None,
    )?;
    stream.play()?;
    while pos.load(Ordering::Relaxed) < total {
        std::thread::sleep(Duration::from_millis(50));
    }
    std::thread::sleep(Duration::from_millis(100));
    println!("Lecture terminée ({} échantillons envoyés à la carte son).", pos.load(Ordering::Relaxed).min(total));
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let muted = args.iter().any(|a| a == "--muet");
    let Some(path) = args.iter().find(|a| !a.starts_with("--")) else {
        eprintln!("Usage : pulse-play <projet.pulse> [--muet]");
        return ExitCode::from(2);
    };
    match run(path, muted) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => { eprintln!("Erreur : {e}"); ExitCode::FAILURE }
    }
}
