// node tests/warp.test.mjs — vérifie le warp (étirement sans changer la hauteur)
await import('../warp.js');
const W = globalThis.PulseWarp, sr = 48000;
let fail = 0; const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + ' — ' + info); if (!cond) fail++; };
const freqOf = (x, from, to) => { // fréquence par passages à zéro montants
  let z = 0, first = -1, last = -1;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; last = i; z++; }
  return (z - 1) * sr / (last - first);
};
// 1. Un La 440 : plus rapide (90 → 120 BPM = ×0,75) : durée × 0,75, hauteur inchangée
const n = sr * 4, sine = new Float32Array(n);
for (let i = 0; i < n; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
let r = await W.stretch([sine], sr, 0.75);
ok('durée ×0,75', Math.abs(r[0].length - n * 0.75) <= 1, `${r[0].length} échantillons pour ${Math.round(n * 0.75)}`);
let f = freqOf(r[0], 4000, r[0].length - 4000);
ok('hauteur conservée', Math.abs(f - 440) < 4, `${f.toFixed(1)} Hz (440 attendu)`);
const mid = r[0].subarray(20000, 60000); let pk = 0; for (const v of mid) pk = Math.max(pk, Math.abs(v));
ok('niveau conservé', pk > 0.45 && pk < 0.56, `crête ${pk.toFixed(3)}`);
// 2. Plus lent (×1,3)
r = await W.stretch([sine], sr, 1.3);
f = freqOf(r[0], 4000, r[0].length - 4000);
ok('plus lent ×1,3', Math.abs(r[0].length - n * 1.3) <= 1 && Math.abs(f - 440) < 4, `${r[0].length} échantillons, ${f.toFixed(1)} Hz`);
// 3. Un rythme : clics de 90 BPM → 120 BPM, les clics doivent tomber toutes les 0,5 s
const beat = new Float32Array(sr * 8), period = Math.round(sr * 60 / 90);
for (let t = 0; t + 200 < beat.length; t += period) for (let i = 0; i < 200; i++) beat[t + i] = 0.9 * Math.sin(2 * Math.PI * 1500 * i / sr) * Math.exp(-i / 40);
r = await W.stretch([beat, beat], sr, 90 / 120);
const peaks = []; let lastP = -sr;
for (let i = 0; i < r[0].length; i++) if (Math.abs(r[0][i]) > 0.35 && i - lastP > sr * 0.2) { peaks.push(i); lastP = i; }
const gaps = peaks.slice(1).map((p, i) => (p - peaks[i]) / sr);
const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
ok('clics toutes les 0,5 s', Math.abs(avg - 0.5) < 0.01 && peaks.length >= 10, `${peaks.length} clics, écart moyen ${avg.toFixed(3)} s`);
ok('stéréo', r.length === 2 && r[1].length === r[0].length, `${r.length} canaux`);
// 4. Garde-fous
ok('écart trop grand refusé', !W.checkRatio(40, 140).ok && W.checkRatio(90, 120).ok && W.checkRatio(60, 120).ok === true, JSON.stringify([W.checkRatio(40, 140), W.checkRatio(90, 120)]));
console.log(fail ? `${fail} échec(s)` : 'tout passe'); process.exit(fail ? 1 : 0);
