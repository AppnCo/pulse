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
  await ev(`(()=>{ const r = document.querySelector('.me-808-pop input[data-k=drive]'); r.value = 857; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  const m2 = await J(ev, `return { snd: state.project.tracks[0].clips[0].midi.snd, pre: document.querySelector('.me-808-preset').value }`);
  check('curseur Saturation → réglage perso', Math.abs(m2.snd.drive - 7) < 0.05 && m2.snd.decay === 0.7 && m2.pre === '', JSON.stringify(m2));
  await ev(`PulsePianoRoll._state && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))`); await sleep(1200);
  check('⌘Z revient au preset précédent', await J(ev, `return state.project.tracks[0].clips[0].midi.snd.drive`) === 3, await J(ev, `return JSON.stringify(state.project.tracks[0].clips[0].midi.snd)`));
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`createMidiClip(0, 8)`); await sleep(1200);
  check('région suivante : même réglage 808', await J(ev, `const c = state.project.tracks[0].clips; return c.length === 2 && c[1].midi.snd && c[1].midi.snd.decay === 0.7`));
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`createMidiClip(1, 0)`); await sleep(1200);
  check('pas de bouton Réglages sur un piano', await J(ev, `const b = document.querySelector('.me-808'); return !b || b.style.display === 'none'`));
  // le piano devient Synthé : bouton « Réglages Synthé », 12 curseurs, preset Pluck appliqué à la région
  await ev(`(()=>{ const S = PulsePianoRoll._state(); S.notes.push({ s: 0, d: 1, p: 60, v: 100 }); const s = document.querySelector('.me-inst'); s.value = 'synth'; s.dispatchEvent(new Event('change')); })()`); await sleep(1000);
  const sb = await J(ev, `const b = document.querySelector('.me-808'); return b && b.style.display !== 'none' ? b.textContent : null`);
  check('bouton « Réglages Synthé »', sb === 'Réglages Synthé', String(sb));
  await ev(`document.querySelector('.me-808').click()`); await sleep(300);
  const sp = await J(ev, `const p = document.querySelector('.me-808-pop'); return p ? { n: p.querySelectorAll('input[type=range]').length, pre: [...p.querySelectorAll('.me-808-preset option')].map(o => o.textContent) } : null`);
  check('fenêtre Synthé : 12 curseurs + presets', sp && sp.n === 12 && sp.pre.includes('Pluck trap'), JSON.stringify(sp));
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/synthe.jpg');
  await ev(`(()=>{ const s = document.querySelector('.me-808-preset'); s.value = 'pluck'; s.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  const pm = await J(ev, `const m = state.project.tracks[1].clips[0].midi; return { inst: m.inst, cut: m.snd && m.snd.cutoff }`);
  check('preset Pluck gardé dans la région', pm.inst === 'synth' && pm.cut === 900, JSON.stringify(pm));
  await ev(`(()=>{ const r = document.querySelector('.me-808-pop input[data-k=cutoff]'); r.value = 1000; r.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  check('curseur Filtre au maximum = 14 kHz', await J(ev, `return state.project.tracks[1].clips[0].midi.snd.cutoff`) === 14000);
  // batterie : bouton « Réglages Batterie », 8 curseurs ; preset « Kick qui tient » gardé et le son change ; accord en demi-tons entiers
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`(()=>{ state.project.tracks.push({ id: 'dr', name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#F59E0B', clips: [], volume: 1, pan: 0 }); renderTimelineTracks(); })()`); await sleep(300);
  await ev(`createMidiClip(2, 0)`); await sleep(1200);
  await ev(`(()=>{ const S = PulsePianoRoll._state(); S.notes.push({ s: 0, d: 0.25, p: 36, v: 120 }, { s: 1, d: 0.25, p: 38, v: 110 }, { s: 0.5, d: 0.25, p: 42, v: 90 }); })()`);
  const db = await J(ev, `const b = document.querySelector('.me-808'); return b && b.style.display !== 'none' ? b.textContent : null`);
  check('bouton « Réglages Batterie »', db === 'Réglages Batterie', String(db));
  await ev(`document.querySelector('.me-808').click()`); await sleep(300);
  const dn = await J(ev, `const p = document.querySelector('.me-808-pop'); return p ? p.querySelectorAll('input[type=range]').length : 0`);
  check('fenêtre Batterie : 8 curseurs', dn === 8, String(dn));
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/batterie.jpg');
  await ev(`(()=>{ const s = document.querySelector('.me-808-preset'); s.value = 'tient'; s.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  const dm = await J(ev, `const m = state.project.tracks[2].clips[0].midi; const a = PulseSynth.render(m, 140, 44100).channels[0], b = PulseSynth.render(Object.assign({}, m, { snd: undefined }), 140, 44100).channels[0]; let d = 0, e = 0; for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; e += b[i] ** 2; } return { snd: m.snd, kit: m.kit, r: d / e }`);
  check('preset batterie gardé, le son change', dm.snd && dm.snd.kd === 2.2 && dm.r > 0.05, JSON.stringify(dm));
  await ev(`(()=>{ const r = document.querySelector('.me-808-pop input[data-k=kt]'); r.value = 760; r.dispatchEvent(new Event('change')); })()`); await sleep(1200);
  const kt = await J(ev, `return state.project.tracks[2].clips[0].midi.snd.kt`);
  check('accord du kick en demi-tons entiers', Number.isInteger(kt) && kt > 0, String(kt));
};
