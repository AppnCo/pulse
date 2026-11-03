//! Essai du Pitch « voix fidèle » sur un fichier : pulse-pitch-demo entree.wav sortie.wav demi-tons formant
//! (la sortie est recalée : le retard de l'effet est retiré)
use pulse_engine::model::PitchParams;
use pulse_engine::pitch::Pitch;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut r = hound::WavReader::open(&a[1]).unwrap();
    let sp = r.spec();
    let x: Vec<f64> = match sp.sample_format {
        hound::SampleFormat::Int => { let m = (1i64 << (sp.bits_per_sample - 1)) as f64; r.samples::<i32>().step_by(sp.channels as usize).map(|v| v.unwrap() as f64 / m).collect() }
        hound::SampleFormat::Float => r.samples::<f32>().step_by(sp.channels as usize).map(|v| v.unwrap() as f64).collect(),
    };
    let sr = sp.sample_rate as f64;
    let mut p = Pitch::new(&PitchParams { semi: Some(a[3].parse().unwrap()), formant: Some(a[4].parse().unwrap()), mix: Some(100.0) }, sr);
    let lat = p.latency();
    let t0 = std::time::Instant::now();
    let mut y = Vec::with_capacity(x.len() + lat);
    for i in 0..x.len() + lat { let v = if i < x.len() { x[i] } else { 0.0 }; let mut s = [v, v]; p.tick(&mut s, 1); y.push(s[0]); }
    let dt = t0.elapsed().as_secs_f64();
    eprintln!("retard {} échantillons ({:.1} ms) ; calcul {:.0}× plus vite que le temps réel", lat, lat as f64 / sr * 1000.0, x.len() as f64 / sr / dt);
    let mut w = hound::WavWriter::create(&a[2], hound::WavSpec { channels: 1, sample_rate: sp.sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int }).unwrap();
    for v in &y[lat..] { w.write_sample((v.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap(); }
}
