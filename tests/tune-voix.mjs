import { readWav, writeWav } from './wav-io.mjs';
// node tests/tune-voix.mjs [chemin de tune.js] — qualité de l'Auto-Tune sur une VRAIE voix (WAV=… FROM=… DUR=… VOICE=…)
await import(process.argv[2] || '../tune.js');
const T = globalThis.PulseTune;
const w = readWav(process.env.WAV || '/Volumes/KINGSTON/CLAUDE/PULSE-ENTRAINEMENT/SONS TELECHARGES/JamesMay_ElizaJane_Full/15_LeadVox.wav');
const sr = w.sr; const from = +(process.env.FROM || 26), dur = +(process.env.DUR || 40);
const x = w.chans[0].slice(Math.round(from * sr), Math.round((from + dur) * sr));
const voice = process.env.VOICE || 'mid';
const db = (v) => (10 * Math.log10(v + 1e-20)).toFixed(1);
const f0 = await T.trackPitch(x, sr, null, voice);
const hop = x.length / (f0.length - 1) > 300 ? 0.01 : 0.005; const hopS = hop * sr;
let v = 0, fl = 0, jm = 0; for (let i = 1; i + 1 < f0.length; i++) { if (f0[i] > 0) { v++; if (f0[i - 1] > 0 && Math.abs(12 * Math.log2(f0[i] / f0[i - 1])) > 4) jm++; } else if (f0[i - 1] > 0 && f0[i + 1] > 0) fl++; }
console.log(`suivi : voisé ${(100 * v / f0.length).toFixed(0)} %, trous d'une trame ${fl}, sauts > 4 dt ${jm}`);
// 1. Identité : sans correction la voix doit ressortir identique
const one = new Float32Array(f0.length).fill(1);
let y = T.psola(x, sr, f0, one);
let e = 0, s = 0, worst = -200; const B = Math.round(0.02 * sr);
for (let a = 0; a + B <= x.length; a += B) { let eb = 0, sb = 0; for (let i = a; i < a + B; i++) { const d = y[i] - x[i]; eb += d * d; sb += x[i] * x[i]; } e += eb; s += sb; if (sb / B > 1e-5) worst = Math.max(worst, 10 * Math.log10(eb / sb + 1e-20)); }
console.log(`identité : résidu ${db(e / s)} dB (pire tranche de 20 ms : ${worst.toFixed(1)} dB)`);
// 2. Décalage constant : la note de sortie doit suivre l'entrée, sans accroc
for (const dt of [1, -1, 2]) {
  const r = new Float32Array(f0.length); for (let i = 0; i < r.length; i++) r[i] = f0[i] > 0 ? Math.pow(2, dt / 12) : 1;
  y = T.psola(x, sr, f0, r);
  const g0 = await T.trackPitch(y, sr, null, voice);
  let ok = 0, tot = 0, bad = 0, lost = 0;
  for (let i = 3; i + 3 < f0.length; i++) { if (!(f0[i] > 0 && f0[i - 3] > 0 && f0[i + 3] > 0)) continue; tot++; if (!(g0[i] > 0)) { lost++; continue; } const c = Math.abs(1200 * Math.log2(g0[i] / f0[i]) - 100 * dt); if (c < 20) ok++; if (c > 100) bad++; }
  // régularité : ressemblance entre périodes voisines de la sortie
  let cs = 0, cn = 0, rough = 0;
  for (let i = 3; i + 3 < g0.length; i++) { if (!(g0[i] > 0 && f0[i] > 0 && f0[i-3] > 0 && f0[i+3] > 0)) continue; const Tp = Math.round(sr / g0[i]), c = Math.round(i * hopS); if (c - Tp < 0 || c + 2 * Tp >= y.length) continue;
    const cor = (z, P) => { let ab = 0, aa = 0, bb = 0; for (let k = 0; k < P; k++) { const u = z[c + k], q = z[c + k + P]; ab += u * q; aa += u * u; bb += q * q; } return ab / Math.sqrt(aa * bb + 1e-20); };
    const co = cor(y, Tp), ci = cor(x, Math.round(sr / f0[i])); cs += co; cn++; if (co < ci - 0.25) rough++; }
  console.log(`décalage ${dt > 0 ? '+' : ''}${dt} dt : juste à 20 cents ${(100 * ok / tot).toFixed(1)} %, fausse (>100 cents) ${bad}, note perdue ${lost}, trames rugueuses ${rough}/${cn}, régularité ${(cs / cn).toFixed(3)}`);
  if (process.env.OUT && dt === 1) writeWav(process.env.OUT + '.wav', [y], sr);
}
