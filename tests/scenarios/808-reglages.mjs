// 808 réglable (18/11) : bouton « Réglages 808 » seulement sur une 808, 5 presets + 5 curseurs, le son de la région change
// (et rien ne change par défaut), le réglage est gardé dans la région, annulable, repris par la région suivante de la piste
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check, shot } = c;
  await boot(c, { id: 'b8', name: 'B8', bpm: 140, buses: [], tracks: [
    { name: '808', type: 'keys', midiInst: 'bass808', color: '#EF4444', clips: [] },
    { name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] }, { mic: false });
  await ev(`createMidiClip(0, 0)`); await sleep(1200);
  await ev(`(()=>{ const S = PulsePianoRoll._state(); S.notes.push({ s: 0, d: 1.5, p: 36, v: 110 }, { s: 1, d: 1, p: 43, v: 110 }); document.querySelector('.me-808').click(); })()`);
  await sleep(300);
  const ui = await J(ev, `const p = document.querySelector('.me-808-pop'); return p ? { pre: [...p.querySelectorAll('.me-808-preset option')].map(o => o.textContent), n: p.querySelectorAll('input[type=range]').length, vis: document.querySelector('.me-808').style.display !== 'none' } : null`);
  check('fenêtre 808 : presets + 5 curseurs', ui && ui.n === 5 && ui.pre.includes('Saturée') && ui.vis, JSON.stringify(ui));
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/808.jpg');
  const sig = (keep) => `(() => { const c = state.project.tracks[0].clips[0], m = Object.assign({}, c.midi, ${keep} ? {} : { snd: undefined }); const x = PulseSynth.render(m, 140, 44100).channels[0]; let e = 0; for (const v of x) e += v * v; return e; })()`;
  await ev(`(()=>{ const s = document.querySelector('.me-808-preset'); s.value = 'courte'; s.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  const m1 = await J(ev, `return state.project.tracks[0].clips[0].midi.snd`);
  const e0 = await ev(sig(false)), e1 = await ev(sig(true));
  check('preset « Courte » gardé dans la région', m1 && m1.decay === 0.7, JSON.stringify(m1));
  check('le son de la région change', Math.abs(e1 - e0) / e0 > 0.1, `${(+e0).toFixed(0)} → ${(+e1).toFixed(0)}`);
  await ev(`(()=>{ const r = document.querySelector('.me-808-pop input[data-k=drive]'); r.value = 7; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  const m2 = await J(ev, `return { snd: state.project.tracks[0].clips[0].midi.snd, pre: document.querySelector('.me-808-preset').value }`);
  check('curseur Saturation → réglage perso', Math.abs(m2.snd.drive - 7) < 0.05 && m2.snd.decay === 0.7 && m2.pre === '', JSON.stringify(m2));
  await ev(`PulsePianoRoll._state && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))`); await sleep(1200);
  check('⌘Z revient au preset précédent', await J(ev, `return state.project.tracks[0].clips[0].midi.snd.drive`) === 3, await J(ev, `return JSON.stringify(state.project.tracks[0].clips[0].midi.snd)`));
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`createMidiClip(0, 8)`); await sleep(1200);
  check('région suivante : même réglage 808', await J(ev, `const c = state.project.tracks[0].clips; return c.length === 2 && c[1].midi.snd && c[1].midi.snd.decay === 0.7`));
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`createMidiClip(1, 0)`); await sleep(1200);
  check('pas de bouton 808 sur un piano', await J(ev, `const b = document.querySelector('.me-808'); return !b || b.style.display === 'none'`));
};
