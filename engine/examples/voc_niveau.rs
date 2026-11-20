//! cargo run --release --example voc_niveau — niveau de sortie du vocodeur selon le nombre de bandes (voix de synthèse 220 Hz)
fn main() {
    let sr = 48000.0;
    for bands in [8.0, 12.0, 16.0, 20.0, 24.0, 32.0] {
        let p = pulse_engine::vocoder::VocoderParams { bands, air: 0.0, ..Default::default() };
        let mut v = pulse_engine::vocoder::Vocoder::new(&p, sr);
        let (mut si, mut so) = (0.0, 0.0);
        for i in 0..(2.0 * sr) as usize {
            let t = i as f64 / sr; let ph = (t * 220.0) % 1.0;
            let x = (ph * 0.6 - 0.3) * (1.0 + 0.5 * (t * 3.0).sin());
            let mut s = [x, 0.0]; v.tick(&mut s, 1);
            if t > 0.5 { si += x * x; so += s[0] * s[0]; }
        }
        println!("{bands} bandes : sortie / entrée {:+.1} dB", 10.0 * (so / si).log10());
    }
}
