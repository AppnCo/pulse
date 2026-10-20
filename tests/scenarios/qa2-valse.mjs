import { boot, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, { id: 'v3', name: 'Valse', bpm: 120, beatsPerBar: 3, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] });
  await ev(`createMidiClip(0,0,true)`); await sleep(700);
  console.log('région à 3 temps/mesure :', await ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>({duree_s:c.duration, temps:c.midi.beats, mesure_regle_s:bpb()*60/state.project.bpm})))`));
  await ev(`createMidiClip(0,1.5,true)`);  // 2e mesure de la règle (1.5 s)
  console.log('2e région demandée à 1.5 s (mesure 2 de la règle) :', await ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>[c.start,c.start+c.duration]))`), await ev(`document.getElementById('flash').textContent`));
  await shot('/private/tmp/claude-501/qa/valse.jpg');
};
