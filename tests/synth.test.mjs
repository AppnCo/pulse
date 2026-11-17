// node tests/synth.test.mjs — vérifie le synthé maison (hauteur, durée, niveau, reproductibilité)
await import('../synth.js');
const S = globalThis.PulseSynth, sr = 44100;
let fail = 0; const ok = (n, c, i) => { console.log((c ? 'PASS ' : 'FAIL ') + n + ' — ' + i); if (!c) fail++; };
const freqOf = (x, a, b) => { // autocorrélation : plus fiable que les passages à zéro sur un son riche
  let best = 0, bl = 0; const lo = Math.floor(sr / 1500), hi = Math.floor(sr / 40);
  const m = Math.min(b - a, 8000);
  const cs = []; for (let l = lo; l < hi; l++) { let c = 0; for (let i = 0; i < m; i++) c += x[a + i] * x[a + i + l]; cs.push(c); }
  const mx = Math.max(...cs); // premier pic proche du max (évite les sous-octaves)
  for (let i = 1; i < cs.length - 1; i++) if (cs[i] > cs[i - 1] && cs[i] >= cs[i + 1] && cs[i] > 0.85 * mx) { bl = lo + i; break; }
  return sr / bl; };
const peak = (x) => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; };
for (const [inst, p] of [['piano', 57], ['keys', 57], ['bass808', 45], ['lead', 57], ['bass', 45], ['rhodes', 57], ['pad', 57]]) {
  const r = S.render({ inst, beats: 2, notes: [{ s: 0, d: 1.8, p, v: 110 }] }, 120, sr);
  const f = freqOf(r.channels[0], Math.round(0.25 * sr), Math.round(0.8 * sr)), want = S.hz(p);
  ok(inst + ' hauteur', Math.abs(f - want) / want < 0.03, `${f.toFixed(1)} Hz (${want.toFixed(1)} attendu)`);
  ok(inst + ' niveau', peak(r.channels[0]) > 0.1 && peak(r.channels[0]) <= 1, `crête ${peak(r.channels[0]).toFixed(2)}`);
}
let r = S.render({ inst: 'piano', beats: 4, notes: [] }, 90, sr);
ok('durée', Math.abs(r.duration - 4 * 60 / 90) < 0.001, `${r.duration.toFixed(3)} s`);
ok('silence si pas de notes', peak(r.channels[0]) === 0, 'vide');
const pat = { inst: 'drums', beats: 4, notes: [36, 38, 39, 37, 42, 46, 41, 45, 49].map((p, i) => ({ s: i * 0.25, d: 0.25, p, v: 100 })) };
const a = S.render(pat, 140, sr), b = S.render(pat, 140, sr);
let same = true; for (let i = 0; i < a.length; i++) if (a.channels[0][i] !== b.channels[0][i]) { same = false; break; }
ok('batterie reproductible', same, 'deux rendus identiques');
ok('batterie niveau', peak(a.channels[0]) > 0.3 && peak(a.channels[0]) <= 1, `crête ${peak(a.channels[0]).toFixed(2)}`);
// chaque pièce fait du bruit à son emplacement
let allHit = true;
pat.notes.forEach((n, i) => { const t0 = Math.round(n.s * 60 / 140 * sr); if (peak(a.channels[0].subarray(t0, t0 + 600)) < 0.02) { allHit = false; console.log('muet', n.p); } });
ok('9 pièces audibles', allHit, 'kick, snare, clap, rim, hats, toms, crash');
// vitesse : 300 notes sur 3 minutes
const big = { inst: 'piano', beats: 360, notes: Array.from({ length: 300 }, (_, i) => ({ s: i * 1.1, d: 1, p: 48 + (i % 24), v: 90 })) };
const t = Date.now(); S.render(big, 120, sr); const ms = Date.now() - t;
ok('vitesse', ms < 6000, `${ms} ms pour 300 notes / 3 min`);
const lp = S.loopNotes([{ s: 0, d: 1, p: 60, v: 100 }, { s: 3, d: 1, p: 62, v: 100 }], 4, 10);
ok('boucle', lp.length === 5 && lp[4].s === 8, `${lp.length} notes`);
// 808 de la trap (17/11) : une note qui chevauche la précédente y glisse
{ const r = S.render({ inst: 'bass808', beats: 4, notes: [{ s: 0, d: 2.2, p: 36, v: 110 }, { s: 2, d: 1.5, p: 43, v: 110 }] }, 120, sr);
  const a = freqOf(r.channels[0], Math.round(0.6 * sr), Math.round(0.9 * sr)), b = freqOf(r.channels[0], Math.round(1.3 * sr), Math.round(1.6 * sr));
  ok('808 glisse vers la note suivante', Math.abs(a - S.hz(36)) / S.hz(36) < 0.03 && Math.abs(b - S.hz(43)) / S.hz(43) < 0.03, `${a.toFixed(1)} → ${b.toFixed(1)} Hz`); }
// kits de batterie : chacun sonne, différemment, sans saturer
{ const notes = []; for (let k = 0; k < 16; k++) { notes.push({ s: k / 4, d: 0.25, p: 42, v: 90 }); if (k % 8 === 0) notes.push({ s: k / 4, d: 0.25, p: 36, v: 120 }); if (k % 8 === 4) notes.push({ s: k / 4, d: 0.25, p: 38, v: 115 }); }
  const sums = {};
  for (const kit of Object.keys(S.KITS)) { const r = S.render({ inst: 'drums', kit, beats: 4, notes }, 140, sr); sums[kit] = r.channels[0].reduce((a, v) => a + v * v, 0); ok('kit ' + kit, peak(r.channels[0]) > 0.3 && peak(r.channels[0]) <= 1 && r.channels[0].every(Number.isFinite), `crête ${peak(r.channels[0]).toFixed(2)}`); }
  ok('les kits sonnent différemment', new Set(Object.values(sums).map(x => x.toFixed(1))).size === Object.keys(S.KITS).length, JSON.stringify(Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +v.toFixed(1)])))); }
process.exit(fail ? 1 : 0);
