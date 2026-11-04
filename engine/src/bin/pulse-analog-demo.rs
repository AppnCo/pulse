//! Écoute des machines Analogiques : pulse-analog-demo entree.wav sortie.wav <réglage>
//! Réglages : pre (préampli poussé), fet4 (76 ratio 4), fetall (76 tous enfoncés), chaine (73 puis 76, comme le studio)
use pulse_engine::analog::{Fet76, Fet76Params, Pre73, Pre73Params};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut r = hound::WavReader::open(&a[1]).unwrap();
    let sp = r.spec();
    let x: Vec<f64> = match sp.sample_format {
        hound::SampleFormat::Int => { let m = (1i64 << (sp.bits_per_sample - 1)) as f64; r.samples::<i32>().step_by(sp.channels as usize).map(|v| v.unwrap() as f64 / m).collect() }
        hound::SampleFormat::Float => r.samples::<f32>().step_by(sp.channels as usize).map(|v| v.unwrap() as f64).collect(),
    };
    let sr = sp.sample_rate as f64;
    let pre = Pre73Params { gain: 18.0, output: -14.0, high: 4.0, mid: 3.0, mid_f: 3, low: 0.0, low_f: 2, hpf: Some(1), eq: true, ..Default::default() };
    let (mut p73, mut f76): (Option<Pre73>, Option<Fet76>) = match a[3].as_str() {
        "pre" => (Some(Pre73::new(&pre, sr)), None),
        "fet4" => (None, Some(Fet76::new(&Fet76Params { input: 36.0, output: 30.0, attack: 3.0, release: 5.0, ratio: 4.0, mix: 100.0, variant: 0 }, sr))),
        "fetall" => (None, Some(Fet76::new(&Fet76Params { input: 36.0, output: 30.0, attack: 4.0, release: 6.0, ratio: 0.0, mix: 100.0, variant: 0 }, sr))),
        _ => (Some(Pre73::new(&pre, sr)), Some(Fet76::new(&Fet76Params { input: 34.0, output: 30.0, attack: 3.0, release: 5.0, ratio: 4.0, mix: 100.0, variant: 0 }, sr))),
    };
    let lat = p73.as_ref().map_or(0, |_| Pre73::LATENCY) + f76.as_ref().map_or(0, |_| Fet76::LATENCY);
    let mut y = Vec::with_capacity(x.len() + lat);
    for i in 0..x.len() + lat {
        let v = if i < x.len() { x[i] } else { 0.0 };
        let mut s = [v, v];
        if let Some(p) = &mut p73 { p.tick(&mut s, 1); }
        if let Some(f) = &mut f76 { f.tick(&mut s, 1); }
        y.push(s[0]);
    }
    let mut w = hound::WavWriter::create(&a[2], hound::WavSpec { channels: 1, sample_rate: sp.sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int }).unwrap();
    for v in &y[lat..] { w.write_sample((v.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap(); }
}
