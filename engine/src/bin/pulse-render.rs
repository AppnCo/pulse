//! pulse-render <projet.pulse> <sortie.wav> — mixe un projet Pulse en WAV 24 bits.
use pulse_engine::{file, render};
use std::{fs::File, io::BufReader, path::Path, process::ExitCode};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage : pulse-render <projet.pulse> <sortie.wav>");
        return ExitCode::from(2);
    }
    let run = || -> Result<(), Box<dyn std::error::Error>> {
        let (project, media) = file::open(BufReader::new(File::open(&args[1])?))?;
        let opts = render::RenderOptions::default();
        let (l, r) = render::render(&project, &media, &opts);
        if l.is_empty() {
            return Err("le projet ne contient aucun son à mixer".into());
        }
        file::write_wav(Path::new(&args[2]), &l, &r, opts.sample_rate)?;
        let peak = l.iter().chain(&r).fold(0.0f32, |m, s| m.max(s.abs()));
        println!(
            "« {} » : {} pistes, {:.1} s, crête {:.1} dBFS → {}",
            project.name, project.tracks.len(), l.len() as f64 / opts.sample_rate as f64,
            20.0 * peak.max(1e-9).log10(), args[2]
        );
        Ok(())
    };
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => { eprintln!("Erreur : {e}"); ExitCode::FAILURE }
    }
}
