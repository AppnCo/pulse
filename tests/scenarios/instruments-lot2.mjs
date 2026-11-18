// Instruments, 2e et 3e lots (18/11) : cordes, flûte, cuivres (boucle de tenue), harpe, cloches, glockenspiel, vibraphone (Versilian, CC0) + chœur et kalimba de synthèse.
// Banques chargées, notes justes, cordes tenues 12 s sans trou ni clic, son de secours tant que la banque n'est pas là, crédits.
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'l2', name: 'L2', bpm: 120, buses: [], tracks: [{ name: 'Cordes', type: 'keys', midiInst: 'cordes', color: '#22D3EE', clips: [] }] }, { mic: false });
  const fb = await J(ev, `const b = renderMidiBuffer({ inst: 'cordes', beats: 2, notes: [{ s: 0, d: 1, p: 60, v: 100 }] }, 120).getChannelData(0); let m = 0; for (const x of b) m = Math.max(m, Math.abs(x)); return m`);
  check('son de secours avant la banque', fb > 0.02, 'crête ' + fb.toFixed(2));
  const t0 = Date.now();
  const ok = await ev(`(async () => (await Promise.all(['cordes', 'harpe', 'cloches', 'glock', 'flute', 'cuivres', 'vibra'].map(ensureBank))).join())()`);
  check('7 banques chargées', ok === 'true,true,true,true,true,true,true', `${ok} en ${Date.now() - t0} ms`);
  const r = await J(ev, `const sr = PulseAudio.getContext().sampleRate;
    const f0 = (x, a, b) => { const lo = Math.floor(sr / 2200), hi = Math.floor(sr / 40), m = Math.min(b - a, 8000), cs = [];
      for (let l = lo; l < hi; l++) { let c = 0; for (let i = 0; i < m; i++) c += x[a + i] * x[a + i + l]; cs.push(c); }
      const mx = Math.max(...cs); for (let i = 1; i < cs.length - 1; i++) if (cs[i] > cs[i - 1] && cs[i] >= cs[i + 1] && cs[i] > 0.85 * mx) return sr / (lo + i); return 0; };
    const one = (inst, p, at) => { const x = renderMidiBuffer({ inst, beats: 4, notes: [{ s: 0, d: 3, p, v: 100 }] }, 120).getChannelData(0); return { f: +f0(x, Math.round(at * sr), Math.round((at + 0.3) * sr)).toFixed(1), want: +PulseSynth.hz(p).toFixed(1) }; };
    return { c3: one('cordes', 48, 0.8), e5: one('cordes', 76, 0.8), harpe: one('harpe', 60, 0.15), choeur: one('choeur', 57, 0.6), kal: one('kalimba', 69, 0.1), flute: one('flute', 74, 0.6), cor: one('cuivres', 45, 0.6), trompette: one('cuivres', 72, 0.6), vibra: one('vibra', 62, 0.1) }`);
  for (const k in r) check(k + ' juste', Math.abs(r[k].f - r[k].want) / r[k].want < 0.02, JSON.stringify(r[k]));
  // glockenspiel : lames aux harmoniques non entières (l'autocorrélation s'y trompe) : énergie à la bonne note vs ± 1/2 ton
  const g = await J(ev, `const sr = PulseAudio.getContext().sampleRate, x = renderMidiBuffer({ inst: 'glock', beats: 2, notes: [{ s: 0, d: 1, p: 86, v: 100 }] }, 120).getChannelData(0);
    const mag = (f) => { let re = 0, im = 0; for (let i = 0; i < 0.25 * sr; i++) { const w = 2 * Math.PI * f * i / sr, h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (0.25 * sr)); re += x[i + 2000] * Math.cos(w) * h; im += x[i + 2000] * Math.sin(w) * h; } return Math.hypot(re, im); };
    const f = PulseSynth.hz(86); return [mag(f), mag(f * Math.pow(2, -0.5 / 12)), mag(f * Math.pow(2, 0.5 / 12))]`);
  check('glock juste (entre deux lames)', g[0] > 3 * g[1] && g[0] > 3 * g[2], JSON.stringify(g.map((v) => +v.toFixed(1))));
  // notes tenues 12 s (cordes, flûte, cuivres) : la boucle ne doit ni creuser le son ni claquer
  for (const [inst, p] of [['cordes', 62], ['flute', 79], ['cuivres', 48], ['cuivres', 70]]) {
    const s = await J(ev, `const sr = PulseAudio.getContext().sampleRate, x = renderMidiBuffer({ inst: '${inst}', beats: 26, notes: [{ s: 0, d: 24, p: ${p}, v: 90 }] }, 120).getChannelData(0);
      const w = Math.round(0.1 * sr), rms = []; for (let a = Math.round(1.5 * sr); a + w < 11.5 * sr; a += w) { let e = 0; for (let i = a; i < a + w; i++) e += x[i] * x[i]; rms.push(Math.sqrt(e / w)); }
      const d = (a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
      return { lo: Math.min(...rms), hi: Math.max(...rms), dHead: d(Math.round(0.8 * sr), Math.round(3 * sr)), dLoop: d(Math.round(3 * sr), Math.round(11.5 * sr)) }`);
    check(inst + ' ' + p + ' tenu sans trou', s.lo > 0.3 * s.hi && s.lo > 0.01, JSON.stringify(s));
    check(inst + ' ' + p + ' tenu sans clic', s.dLoop < 2 * s.dHead, `${s.dLoop.toFixed(3)} / ${s.dHead.toFixed(3)}`);
  }
  const bel = await J(ev, `const x = renderMidiBuffer({ inst: 'cloches', beats: 8, notes: [{ s: 0, d: 0.5, p: 67, v: 120 }] }, 120).getChannelData(0), sr = PulseAudio.getContext().sampleRate; let a = 0, b = 0; for (let i = 0; i < 0.2 * sr; i++) a = Math.max(a, Math.abs(x[i])); for (let i = 1.5 * sr; i < 1.7 * sr; i++) b = Math.max(b, Math.abs(x[i])); return [a, b]`);
  check('cloche qui résonne après la note', bel[0] > 0.1 && bel[1] > 0.01, JSON.stringify(bel));
  const opts = await J(ev, `return Object.keys(PulseSynth.INSTRUMENTS).join()`);
  check('9 nouveaux instruments au menu', ['cordes', 'choeur', 'harpe', 'cloches', 'glock', 'kalimba', 'flute', 'cuivres', 'vibra'].every((k) => opts.includes(k)), opts);
  await ev(`openSettings()`); await sleep(400);
  check('crédits Versilian', await J(ev, `return [...document.querySelectorAll('.set-credits')].some((e) => /Versilian/.test(e.textContent))`));
};
