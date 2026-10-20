import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send);
  await boot(c, { id: 'tm', name: 'Tempo', bpm: 120, buses: [], tracks: [{ name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#7C3AED', clips: [] }] });
  await ev(`createMidiClip(0,0,true)`); await sleep(500); await ev(`PulsePianoRoll.close()`);
  await ev(`createMidiClip(0,2,true)`); await sleep(500); await ev(`PulsePianoRoll.close()`);
  const st = () => ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>[+c.start.toFixed(2),+(c.start+c.duration).toFixed(2),c.midi.bpm]))`);
  console.log('à 120 BPM [début, fin, bpm du son]', await st());
  await ev(`(()=>{const i=document.getElementById('bpmInput'); i.value='90'; i.dispatchEvent(new Event('change'))})()`); await sleep(1800);
  console.log('à 90 BPM', await st(), 'mesure =', (4*60/90).toFixed(2), 's');
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
  await shot('/private/tmp/claude-501/qa/tempo-midi.jpg');
  // ⌘Z
  await ev(`undoAction()`); await sleep(1800);
  console.log('après ⌘Z', await st(), 'bpm', await ev(`state.project.bpm`), await ev(`document.getElementById('bpmInput').value`));
};
