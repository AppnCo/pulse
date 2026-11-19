//! PulseTune en direct (retour casque) : on s'entend corrigé pendant la prise, avec le plus petit retard possible.
//! La prise enregistrée reste brute (elle est corrigée proprement après, par tune.js).
//!
//! Méthode « tête de lecture à vitesse variable » (celle des correcteurs temps réel) :
//! 1. on suit la note chantée sur les 21 dernières ms (YIN sur le son ramené à 12 kHz), toutes les 64 échantillons ;
//! 2. on choisit la note juste (gamme de la piste) et on règle la vitesse de lecture pour y arriver (Vitesse = temps de glissement) ;
//! 3. la tête de lecture lit la voix un poil plus vite (plus aigu) ou plus lentement (plus grave), juste derrière le micro ;
//!    quand elle rattrape le micro (ou prend trop de retard), elle saute d'une période de la voix en arrière (ou en avant),
//!    à l'endroit le plus ressemblant, avec un fondu court : la forme d'onde se raccorde, on n'entend pas le saut.
//! Retard : entre DMIN et DMIN + une période (≈ 2 à 6 ms pour une voix), au lieu de ~60 ms pour un PSOLA classique.
//! Les corrections font rarement plus d'un demi-ton : la lecture varie de quelques %, les formants ne bougent pas à l'oreille.

const N: usize = 8192; // mémoire de la voix (puissance de 2)
const HOP: usize = 64; // suivi de la note toutes les 64 échantillons (1,3 ms)
const DEC: usize = 4; // analyse à fréquence / 4
const WIN: usize = 1024; // fenêtre d'analyse (21 ms à 48 kHz : plus courte = suit mieux une voix rap)
const DMIN: f64 = 24.0; // la tête de lecture reste au moins à 24 échantillons du micro (0,5 ms)

pub struct LiveTune {
    sr: f64,
    mask: [bool; 12],
    tau: f64,
    hist: Vec<f32>,
    w: usize,
    rp: f64,
    // fondu d'un saut : ancienne position de lecture, avancement, longueur
    xf_old: f64,
    xf_i: usize,
    xf_n: usize,
    period: f64,
    voiced: bool,
    cur: f64,
    last_target: Option<f64>,
    since: usize,
    dec: Vec<f64>,
    diff: Vec<f64>,
}

fn hz_to_midi(f: f64) -> f64 { 69.0 + 12.0 * (f / 440.0).log2() }

impl LiveTune {
    /// `notes` = 12 notes permises (Do → Si), `strength` = Vitesse 0–1 (1 = collé à la note, effet robot)
    pub fn new(sr: f64, notes: [bool; 12], strength: f64) -> Self {
        let s = strength.clamp(0.0, 1.0);
        let mut mask = notes;
        if !mask.iter().any(|&b| b) { mask = [true; 12]; }
        Self {
            sr, mask, tau: (1.0 - s).powi(2) * 0.25,
            hist: vec![0.0; N], w: 0, rp: -DMIN - 64.0,
            xf_old: 0.0, xf_i: 0, xf_n: 0,
            period: 0.0, voiced: false, cur: 0.0, last_target: None, since: 0,
            dec: vec![0.0; WIN / DEC], diff: vec![0.0; WIN / DEC],
        }
    }

    /// Retard moyen du retour corrigé (échantillons)
    pub fn latency(&self) -> f64 { DMIN + if self.period > 0.0 { self.period * 0.5 } else { 64.0 } }

    #[inline]
    fn at(&self, i: i64) -> f32 { if i < 0 { 0.0 } else { self.hist[(i as usize) & (N - 1)] } }

    /// Lecture entre deux échantillons (Hermite à 4 points)
    fn read(&self, pos: f64) -> f32 {
        let i = pos.floor() as i64;
        let t = (pos - i as f64) as f32;
        let (a, b, c, d) = (self.at(i - 1), self.at(i), self.at(i + 1), self.at(i + 2));
        let c0 = b;
        let c1 = 0.5 * (c - a);
        let c2 = a - 2.5 * b + 2.0 * c - 0.5 * d;
        let c3 = 0.5 * (d - a) + 1.5 * (b - c);
        ((c3 * t + c2) * t + c1) * t + c0
    }

    /// Suivi de la note (YIN) sur les WIN derniers échantillons
    fn detect(&mut self) {
        let m = WIN / DEC;
        let start = self.w as i64 - WIN as i64;
        let mut energy = 0.0;
        for k in 0..m {
            let mut s = 0.0;
            for j in 0..DEC { s += self.at(start + (k * DEC + j) as i64) as f64; }
            let v = s / DEC as f64;
            self.dec[k] = v;
            energy += v * v;
        }
        let rms = (energy / m as f64).sqrt();
        let dsr = self.sr / DEC as f64;
        let tmin = (dsr / 1000.0).floor().max(2.0) as usize;
        let tmax = ((dsr / 70.0).ceil() as usize).min(m / 2);
        let wlen = m - tmax;
        let mut found = 0.0;
        if rms > 2e-3 && tmax > tmin + 2 {
            let mut run = 0.0;
            self.diff[0] = 1.0;
            for tau in 1..=tmax {
                let mut d = 0.0;
                for j in 0..wlen { let e = self.dec[j] - self.dec[j + tau]; d += e * e; }
                run += d;
                self.diff[tau] = if run > 0.0 { d * tau as f64 / run } else { 1.0 };
            }
            let mut tau = tmin;
            while tau < tmax {
                if self.diff[tau] < 0.15 {
                    while tau + 1 < tmax && self.diff[tau + 1] < self.diff[tau] { tau += 1; }
                    break;
                }
                tau += 1;
            }
            if tau >= tmax {   // pas de creux franc : le meilleur
                tau = (tmin..tmax).min_by(|&a, &b| self.diff[a].partial_cmp(&self.diff[b]).unwrap()).unwrap_or(tmin);
            }
            let best = self.diff[tau];
            if best < 0.3 && tau > tmin && tau + 1 < tmax {
                let (a, b, c) = (self.diff[tau - 1], self.diff[tau], self.diff[tau + 1]);
                let den = a - 2.0 * b + c;
                let dt = if den.abs() > 1e-12 { 0.5 * (a - c) / den } else { 0.0 };
                found = dsr / (tau as f64 + dt.clamp(-0.5, 0.5));
            }
        }
        let hop_s = HOP as f64 / self.sr;
        let alpha = if self.tau <= 5e-4 { 1.0 } else { 1.0 - (-hop_s / self.tau).exp() };
        if found > 0.0 {
            self.voiced = true;
            self.period = self.sr / found;
            let mm = hz_to_midi(found);
            // note juste la plus proche dans la gamme, avec hystérésis (pas de gargouillis entre deux notes)
            let r = mm.round();
            let mut target = r;
            for d in 0..7 {
                let up = r + d as f64; let dn = r - d as f64;
                let ok = |n: f64| self.mask[((n as i64 % 12 + 12) % 12) as usize];
                let cu = ok(up); let cd = ok(dn);
                if cu || cd { target = if cu && cd { if (up - mm).abs() < (dn - mm).abs() { up } else { dn } } else if cu { up } else { dn }; break; }
            }
            if let Some(lt) = self.last_target { if lt != target && (mm - lt).abs() < 0.62 { target = lt; } }
            self.last_target = Some(target);
            let want = target - mm;
            self.cur += (want - self.cur) * alpha;
        } else {
            self.voiced = false;
            self.last_target = None;
            self.cur *= 0.7;   // souffle, silence : on revient doucement à la vitesse normale
        }
    }

    /// Meilleur saut d'environ une période (le plus ressemblant), en arrière (dir = −1) ou en avant (+1)
    fn best_jump(&self, dir: f64) -> f64 {
        let p = self.period.max(16.0);
        let lo = (p * 0.9) as i64;
        let hi = (p * 1.1) as i64;
        let base = self.rp.floor() as i64;
        let len = (p as i64).clamp(32, 256);
        let mut best = p;
        let mut bv = f64::MIN;
        for k in lo..=hi {
            let other = base + (dir as i64) * k;
            if dir > 0.0 && other as f64 > self.w as f64 - DMIN - len as f64 { break; }
            let mut c = 0.0;
            let mut a = 0.0;
            let mut b = 0.0;
            for j in (0..len).step_by(2) {
                let u = self.at(base - j) as f64; let v = self.at(other - j) as f64;
                c += u * v; a += u * u; b += v * v;
            }
            let r = if a > 0.0 && b > 0.0 { c / (a * b).sqrt() } else { 0.0 };
            if r > bv { bv = r; best = k as f64; }
        }
        best
    }

    /// Corrige `buf` (voix mono) sur place
    pub fn process(&mut self, buf: &mut [f32]) {
        for x in buf.iter_mut() {
            self.hist[self.w & (N - 1)] = *x;
            self.w += 1;
            self.since += 1;
            if self.since >= HOP && self.w >= WIN { self.since = 0; self.detect(); }
            let rate = 2f64.powf(self.cur / 12.0);
            self.rp += rate;
            let delay = self.w as f64 - self.rp;
            if self.xf_n == 0 {
                let p = if self.voiced && self.period > 0.0 { self.period } else { 0.0 };
                if p > 0.0 && delay < DMIN {
                    let j = self.best_jump(-1.0);
                    self.xf_old = self.rp; self.rp -= j; self.xf_i = 0; self.xf_n = ((p * 0.5) as usize).clamp(32, 256);
                } else if p > 0.0 && delay > DMIN + p + 48.0 {
                    let j = self.best_jump(1.0);
                    if self.w as f64 - (self.rp + j) >= DMIN { self.xf_old = self.rp; self.rp += j; self.xf_i = 0; self.xf_n = ((p * 0.5) as usize).clamp(32, 256); }
                } else if p == 0.0 && (delay < DMIN || delay > DMIN + 400.0) {
                    // hors voix : on se recale juste derrière le micro, en fondu
                    self.xf_old = self.rp; self.rp = self.w as f64 - DMIN - 64.0; self.xf_i = 0; self.xf_n = 128;
                }
            }
            let y = if self.xf_n > 0 {
                let g = (self.xf_i as f32 + 0.5) / self.xf_n as f32;
                let g = 0.5 - 0.5 * (std::f32::consts::PI * g).cos();
                let v = self.read(self.xf_old) * (1.0 - g) + self.read(self.rp) * g;
                self.xf_old += rate;
                self.xf_i += 1;
                if self.xf_i >= self.xf_n { self.xf_n = 0; }
                v
            } else { self.read(self.rp) };
            *x = y;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(f: impl Fn(f64) -> f64, sec: f64, sr: f64) -> Vec<f32> {
        let n = (sec * sr) as usize; let mut ph = 0.0; let mut out = vec![0.0f32; n];
        for (i, o) in out.iter_mut().enumerate() {
            let t = i as f64 / sr; let fr = f(t); ph += 2.0 * std::f64::consts::PI * fr / sr;
            let mut s = 0.0; for h in 1..=10 { s += (h as f64 * ph).sin() / (h as f64 * (1.0 + (h as f64 * fr - 700.0).abs() / 900.0)); }
            *o = (0.35 * s) as f32;
        }
        out
    }
    fn pitch(x: &[f32], sr: f64) -> f64 {
        // autocorrélation simple sur 40 ms
        let n = (0.04 * sr) as usize; let x = &x[..n.min(x.len())];
        let (lo, hi) = ((sr / 1000.0) as usize, (sr / 70.0) as usize);
        let mut best = (0usize, f64::MIN);
        for l in lo..hi { let mut c = 0.0; for i in 0..x.len() - l { c += x[i] as f64 * x[i + l] as f64; } if c > best.1 { best = (l, c); } }
        let l = best.0 as f64;
        let c = |l: usize| { let mut c = 0.0; for i in 0..x.len() - l { c += x[i] as f64 * x[i + l] as f64; } c };
        let (a, b, cc) = (c(best.0 - 1), c(best.0), c(best.0 + 1));
        let d = 0.5 * (a - cc) / (a - 2.0 * b + cc);
        sr / (l + d)
    }
    fn run(x: &[f32], lt: &mut LiveTune, block: usize) -> Vec<f32> {
        let mut y = x.to_vec();
        for c in y.chunks_mut(block) { lt.process(c); }
        y
    }

    #[test]
    fn corrige_vers_la_note_juste() {
        let sr = 48000.0;
        let f = 440.0 * 2f64.powf(0.4 / 12.0); // La + 40 cents
        let x = voice(|_| f, 1.0, sr);
        let mut lt = LiveTune::new(sr, [true; 12], 1.0);
        let y = run(&x, &mut lt, 64);
        let p = pitch(&y[(0.5 * sr) as usize..], sr);
        let cents = 1200.0 * (p / 440.0).log2();
        assert!(cents.abs() < 8.0, "sortie {p:.2} Hz ({cents:.1} cents)");
        assert!(lt.latency() < 0.006 * sr, "retard {:.1} ms", lt.latency() / sr * 1000.0);
    }

    #[test]
    fn vers_le_bas_aussi_et_gamme() {
        let sr = 48000.0;
        // Ré# un peu bas (−35 cents) en Do majeur : pas de Ré# dans la gamme → Ré ou Mi ; le plus proche = Ré (−65) vs Mi (+135) → Ré
        let f = 440.0 * 2f64.powf((63.0 - 0.35 - 69.0) / 12.0);
        let x = voice(|_| f, 1.0, sr);
        let maj = [true, false, true, false, true, true, false, true, false, true, false, true];
        let mut lt = LiveTune::new(sr, maj, 1.0);
        let y = run(&x, &mut lt, 128);
        let p = pitch(&y[(0.6 * sr) as usize..], sr);
        let m = hz_to_midi(p);
        assert!((m - 62.0).abs() < 0.08, "note de sortie {m:.3} (Ré = 62)");
    }

    #[test]
    fn pas_de_clic_et_juste_retard() {
        let sr = 48000.0;
        // glissé lent de 30 cents + vibrato : beaucoup de sauts de période
        let x = voice(|t| 220.0 * 2f64.powf((0.3 * t + 0.25 * (2.0 * std::f64::consts::PI * 5.5 * t).sin()) / 12.0), 2.0, sr);
        let mut lt = LiveTune::new(sr, [true; 12], 1.0);
        let y = run(&x, &mut lt, 64);
        let jump = |z: &[f32]| z.windows(2).skip((0.1 * sr) as usize).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(jump(&y) < 1.5 * jump(&x), "saut max {:.4} (voix {:.4})", jump(&y), jump(&x));
        // niveau tenu (pas de trou)
        let rms = |z: &[f32]| (z.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / z.len() as f64).sqrt();
        for k in 2..19 { let a = (k as f64 * 0.1 * sr) as usize; let b = a + (0.1 * sr) as usize; let r = rms(&y[a..b]) / rms(&x[a..b]); assert!(r > 0.85 && r < 1.15, "niveau à {k}00 ms : {r:.2}"); }
    }

    #[test]
    fn silence_et_souffle_passent() {
        let sr = 48000.0;
        let mut seed = 1u32;
        let x: Vec<f32> = (0..(0.5 * sr) as usize).map(|_| { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); ((seed >> 8) as f32 / 16777216.0 - 0.5) * 0.2 }).collect();
        let mut lt = LiveTune::new(sr, [true; 12], 1.0);
        let y = run(&x, &mut lt, 64);
        let e = |z: &[f32]| z.iter().skip(4000).map(|v| (*v as f64).powi(2)).sum::<f64>();
        let r = e(&y) / e(&x);
        assert!(r > 0.8 && r < 1.2, "le souffle garde son niveau : {r:.2}");
    }
}
