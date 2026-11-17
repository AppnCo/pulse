// Piano à queue (17/11) : banque Salamander (30 notes × 4 frappes) chargée et décodée, notes justes (sur un échantillon
// comme entre deux), frappe douce < forte, région calculée avec la banque, nouvelle piste piano = piano à queue
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'pq', name: 'PQ', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'grand', color: '#22D3EE', clips: [] }] }, { mic: false });
  const t0 = Date.now();
  const ok = await ev(`(async () => String(await ensureBank('grand')) + '/' + PulseSynth.hasBank('grand'))()`);
  check('banque du piano chargée (120 sons)', ok === 'true/true', `${ok} en ${Date.now() - t0} ms`);
  // le vrai piano (échantillons) ne ressemble pas au piano de synthèse : comparaison des deux rendus
  const diff = await J(ev, `const a = renderMidiBuffer({ inst: 'grand', beats: 2, notes: [{ s: 0, d: 1, p: 60, v: 100 }] }, 120).getChannelData(0), b = renderMidiBuffer({ inst: 'piano', beats: 2, notes: [{ s: 0, d: 1, p: 60, v: 100 }] }, 120).getChannelData(0);
    let d = 0, e = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; e += b[i] ** 2; } return d / e`);
  check('les vrais sons du piano sont utilisés', diff > 0.3, 'écart ' + diff.toFixed(2));
  const r = await J(ev, `const sr = PulseAudio.getContext().sampleRate;
    const f0 = (x, a, b) => { const lo = Math.floor(sr / 1500), hi = Math.floor(sr / 40), m = Math.min(b - a, 8000), cs = [];
      for (let l = lo; l < hi; l++) { let c = 0; for (let i = 0; i < m; i++) c += x[a + i] * x[a + i + l]; cs.push(c); }
      const mx = Math.max(...cs); for (let i = 1; i < cs.length - 1; i++) if (cs[i] > cs[i - 1] && cs[i] >= cs[i + 1] && cs[i] > 0.85 * mx) return sr / (lo + i); return 0; };
    const one = (p, v) => { const b = renderMidiBuffer({ inst: 'grand', beats: 4, notes: [{ s: 0, d: 3, p, v }] }, 120); const x = b.getChannelData(0); let pk = 0; for (const s of x) pk = Math.max(pk, Math.abs(s)); return { f: f0(x, Math.round(0.3 * sr), Math.round(0.6 * sr)), want: PulseSynth.hz(p), pk }; };
    return { c4: one(60, 100), as4: one(70, 100), soft: one(60, 30), loud: one(60, 127) }`);
  const near = (x) => Math.abs(x.f - x.want) / x.want < 0.02;
  check('do 4 juste (sur un échantillon)', near(r.c4), JSON.stringify(r.c4));
  check('la# 4 juste (entre deux échantillons)', near(r.as4), JSON.stringify(r.as4));
  check('frappe douce moins forte que la frappe forte', r.soft.pk < r.loud.pk * 0.7 && r.loud.pk <= 1, `${r.soft.pk.toFixed(2)} / ${r.loud.pk.toFixed(2)}`);
  await ev(`createMidiClip(0, 0)`); await sleep(1500);
  check('région créée avec le piano à queue', await J(ev, `const c = state.project.tracks[0].clips[0]; return !!c && c.midi.inst === 'grand' && PulseAudio.hasBuffer(c.id)`));
  await ev(`PulsePianoRoll.close(true)`);
  await ev(`_doAddTrack('keys')`); await sleep(400);
  check('nouvelle piste piano = piano à queue', await J(ev, `return state.project.tracks[state.project.tracks.length - 1].midiInst`) === 'grand');
  await ev(`openSettings()`); await sleep(400);
  check('crédits dans les Réglages', await J(ev, `const t = (document.querySelector('.set-credits') || {}).textContent || ''; return /Salamander.*Holm/.test(t)`));
};
