//! Écoute d'une chaîne d'effets de Pulse sur un fichier : pulse-fx-demo entree.wav sortie.wav "fet76,pre73" '{"fet76":{...}}'
//! (mêmes effets et réglages que dans un projet ; sert aux pages d'écoute de la gamme Analogique)
use pulse_engine::fx::FxChain;
use pulse_engine::model::EffectParams;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut r = hound::WavReader::open(&a[1]).unwrap();
    let sp = r.spec();
    let x: Vec<f32> = match sp.sample_format {
        hound::SampleFormat::Int => { let m = (1i64 << (sp.bits_per_sample - 1)) as f32; r.samples::<i32>().step_by(sp.channels as usize).map(|v| v.unwrap() as f32 / m).collect() }
        hound::SampleFormat::Float => r.samples::<f32>().step_by(sp.channels as usize).map(|v| v.unwrap()).collect(),
    };
    let fx: Vec<String> = a[3].split(',').filter(|s| !s.is_empty()).map(str::to_owned).collect();
    let params: EffectParams = serde_json::from_str(a.get(4).map_or("{}", |s| s.as_str())).unwrap();
    let mut chain = FxChain::new(&fx, &params, &[], sp.sample_rate as f64, 120.0, -0.3);
    let mut l = x.clone();
    let mut rr = vec![0.0f32; l.len()];
    for (cl, cr) in l.chunks_mut(512).zip(rr.chunks_mut(512)) { chain.process(cl, cr, true); }
    let mut w = hound::WavWriter::create(&a[2], hound::WavSpec { channels: 1, sample_rate: sp.sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int }).unwrap();
    for v in &l { w.write_sample((v.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap(); }
}
