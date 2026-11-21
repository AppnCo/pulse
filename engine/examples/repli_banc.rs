//! cargo run --release --example repli_banc — Repliement (souffle métallique dans les aigus) de chaque effet qui colore le son.
//! Sinus 11 kHz à −6 dBFS : tout ce qui sort ailleurs qu'à 11 et 22 kHz (et hors du continu) est du repliement ou du bruit.
use pulse_engine::fx::Chain;
use pulse_engine::model::Track;
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len(); let mut j = 0;
    for i in 1..n { let mut b = n >> 1; while j & b != 0 { j ^= b; b >>= 1; } j ^= b; if i < j { re.swap(i, j); im.swap(i, j); } }
    let mut l = 2; while l <= n { let a = -2.0 * std::f64::consts::PI / l as f64; for i in (0..n).step_by(l) { for k in 0..l / 2 { let (c, s) = ((a * k as f64).cos(), (a * k as f64).sin()); let (u, v) = (i + k, i + k + l / 2); let tr = re[v] * c - im[v] * s; let ti = re[v] * s + im[v] * c; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } l <<= 1; }
}
fn main() {
    let sr = 48000.0;
    let cases: Vec<(&str, String)> = std::env::args().nth(1).map(|a| vec![("arg", a)]).unwrap_or_else(|| {
        let mut v: Vec<(&str, String)> = vec![];
        for s in ["classique", "bande", "lampe", "ampli", "transfo", "repli", "lofi"] { v.push(("sat", format!(r#"{{"sat":{{"drive":70,"sty":"{s}"}}}}"#))); }
        for s in ["bande", "lampe", "ampli", "transfo"] { v.push(("msat", format!(r#"{{"msat":{{"bands":[{{"base":true,"sty":"{s}","va":1,"heat":80}}]}}}}"#))); }
        for m in 0..4 { v.push(("comp", format!(r#"{{"comp":{{"mode":{m},"threshold":-24,"ratio":4}}}}"#))); }
        for f in ["fet76", "pre73", "opto2a", "eqp1", "busg", "tape", "l670", "dtr", "stripe", "eq550", "comp25", "bus33", "massif", "prev76", "eclat", "souffle"] { v.push((f, "{}".to_string())); }
        v
    });
    for (fx, ep) in cases {
        let name = if fx == "arg" { serde_json::from_str::<serde_json::Value>(&ep).ok().and_then(|v| v.as_object().and_then(|o| o.keys().next().cloned())).unwrap_or_default() } else { fx.to_string() };
        let t: Track = serde_json::from_str(&format!(r#"{{"effects":["{name}"],"effectParams":{ep}}}"#)).unwrap();
        let mut c = Chain::for_track(&t, sr, 120.0);
        let n = 65536usize; let tot = n + 24000;
        let mut l: Vec<f32> = (0..tot).map(|i| (0.5 * (2.0 * std::f64::consts::PI * 11000.0 * i as f64 / sr).sin()) as f32).collect();
        let mut r = l.clone();
        c.process(&mut l, &mut r, false);
        let mut re: Vec<f64> = (0..n).map(|i| l[24000 + i] as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos())).collect();
        let mut im = vec![0.0; n]; fft(&mut re, &mut im);
        let df = sr / n as f64; let (mut fund, mut rest) = (0.0, 0.0);
        for k in 1..n / 2 { let f = k as f64 * df; let p = re[k] * re[k] + im[k] * im[k]; if (f - 11000.0).abs() < 80.0 { fund += p; } else if (f - 22000.0).abs() < 80.0 || f < 30.0 { } else { rest += p; } }
        if std::env::var("TOP").is_ok() { let mut v: Vec<(f64, f64)> = (1..n / 2).map(|k| (k as f64 * df, re[k] * re[k] + im[k] * im[k])).filter(|(f, _)| (f - 11000.0).abs() > 80.0 && (f - 22000.0).abs() > 80.0).collect(); v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap()); for (f, p) in v.iter().take(12) { println!("  {:7.0} Hz {:6.1} dB", f, 10.0 * (p / fund).log10()); } }
        let sty = ep.split("\"sty\":\"").nth(1).map(|s| s.split('"').next().unwrap_or("")).or_else(|| ep.split("\"mode\":").nth(1).map(|s| &s[..1])).unwrap_or("");
        println!("{name:8} {sty:10} repliement {:6.1} dB", 10.0 * (rest / fund.max(1e-30)).max(1e-30).log10());
    }
}
