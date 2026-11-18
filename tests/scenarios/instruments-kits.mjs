// Instruments du 17/11 : Rhodes et Pad dans la liste des sons ; batterie avec choix du kit (Classique, Trap, Boom bap),
// une nouvelle région de batterie part en Trap, le kit choisi est gardé dans la région et repris par la suivante
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'ik', name: 'IK', bpm: 120, buses: [], tracks: [
    { name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#F59E0B', clips: [] },
    { name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] }, { mic: false });
  await ev(`createMidiClip(0, 0)`); await sleep(1200);
  const k0 = await J(ev, `const s = document.querySelector('.me-kit'); return { opts: s ? [...s.options].map(o => o.textContent) : null, v: s && s.value, kit: state.project.tracks[0].clips[0].midi.kit }`);
  check('séquenceur de pas : choix du kit', k0.opts && k0.opts.join() === 'Classique,Trap,Boom bap,Drill,Lo-fi', JSON.stringify(k0));
  check('nouvelle région de batterie en Trap', k0.v === 'trap' && k0.kit === 'trap', JSON.stringify(k0));
  await ev(`(()=>{ const S = PulsePianoRoll._state(); S.notes.push({ s: 0, d: 0.25, p: 36, v: 110 }, { s: 1, d: 0.25, p: 38, v: 110 }); const s = document.querySelector('.me-kit'); s.value = 'boombap'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(1200);
  check('kit Boom bap gardé dans la région', await J(ev, `return state.project.tracks[0].clips[0].midi.kit`) === 'boombap');
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`createMidiClip(0, 4)`); await sleep(1200);
  check('la région suivante reprend le kit de la piste', await J(ev, `return state.project.tracks[0].clips.map(c => c.midi.kit).join()`) === 'boombap,boombap', await J(ev, `return state.project.tracks[0].clips.map(c => c.midi.kit).join()`));
  await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  await ev(`createMidiClip(1, 0)`); await sleep(1200);
  const insts = await J(ev, `const s = document.querySelector('.me-inst'); return s ? [...s.options].map(o => o.value) : []`);
  check('Rhodes et Pad dans la liste des sons', insts.includes('rhodes') && insts.includes('pad'), JSON.stringify(insts));
  check('pas de kit sur une piste piano', await J(ev, `return !document.querySelector('.me-kit') && !('kit' in state.project.tracks[1].clips[0].midi)`));
};
