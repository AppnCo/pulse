// Région MIDI coupée en deux, puis tempo changé : les deux moitiés suivent-elles ?
import { boot, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, { id: 'cm', name: 'Coupe', bpm: 120, buses: [], tracks: [{ name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#7C3AED', clips: [] }] });
  await ev(`createMidiClip(0,0,true)`); await sleep(600);
  await ev(`(()=>{ const s=PulsePianoRoll._state(); const tpl=document.querySelector('.me-tpl'); tpl.value='trap'; tpl.dispatchEvent(new Event('change')) })()`); await sleep(700);
  await ev(`PulsePianoRoll.close()`); await sleep(300);
  await ev(`splitClipAt(0,0,1)`); await sleep(100);
  const st = () => ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>({start:+c.start.toFixed(2),dur:+c.duration.toFixed(2),off:+(c.offset||0).toFixed(2),bpmSon:c.midi.bpm,idFin:c.id.slice(-4),partage:false})))`);
  console.log('après coupe à 1 s (120 BPM)', await st(), '| même objet midi :', await ev(`state.project.tracks[0].clips[0].midi===state.project.tracks[0].clips[1].midi`));
  await ev(`(()=>{const i=document.getElementById('bpmInput'); i.value='90'; i.dispatchEvent(new Event('change'))})()`); await sleep(2000);
  console.log('à 90 BPM          ', await st());
  console.log('attendu : les deux morceaux à 90 BPM ; durée totale', (2*4/3).toFixed(2), 's');
};
