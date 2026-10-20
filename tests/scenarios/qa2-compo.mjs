import { boot, RAP, instru, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  const P = { id: 'c1', name: 'Compo', bpm: 100, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }] };
  await boot(c, P);
  const st = () => ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,t.type,(t.clips||[]).map(c=>[+c.start.toFixed(2),+c.duration.toFixed(2),c.name,c.midi&&c.midi.beats,c.midi&&c.midi.notes.length])]))`);
  await ev(`addTrack('keys')`); await sleep(800);
  console.log('1 piano', await st(), 'éditeur', await ev(`PulsePianoRoll.isOpen()`), 'sel', await ev(`state.selectedTrack`));
  // gamme Do majeur
  await ev(`(()=>{const s=document.querySelector('.me-scale'); s.value='t:0:0'; s.dispatchEvent(new Event('change'))})()`);
  const pads = await ev(`document.querySelectorAll('.me-pad').length`);
  console.log('pads', pads);
  // pose 3 accords (1 mesure)
  for (let i = 0; i < 3; i++) { const p = await pos(ev, `.me-pad[data-i="${i}"]`); await Mo.click(p.x, p.y); await sleep(100); }
  console.log('après 3 accords', await ev(`PulsePianoRoll.isOpen()`), await ev(`document.querySelector('.me-len-n').textContent`));
  await ev(`PulsePianoRoll.close()`); await sleep(500);
  console.log('2', await st());
  // Ajout d'une 2e région juste après sur la même piste (double-clic vide)
  await ev(`createMidiClip(1, 4*60/100*3, true)`); await sleep(600);
  await ev(`PulsePianoRoll.close()`); await sleep(300);
  console.log('3', await st());
  // rouvrir la 1re région et l'allonger avec 2 accords (4 mesures)
  await ev(`openMidiEditor(1,0,false)`); await sleep(500);
  await ev(`(()=>{const s=document.querySelector('.me-scale'); s.value='t:0:0'; s.dispatchEvent(new Event('change'))})()`);
  for (let i = 0; i < 4; i++) { const p = await pos(ev, `.me-pad[data-i="${i}"]`); await Mo.click(p.x, p.y); await sleep(100); }
  await ev(`PulsePianoRoll.close()`); await sleep(500);
  console.log('4 après allongement (chevauchement ?)', await st());
  await shot('/private/tmp/claude-501/qa/compo-1.jpg');
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
  // Batterie
  await ev(`addTrack('drums')`); await sleep(800);
  console.log('5 batterie', await st(), await ev(`PulsePianoRoll.isOpen()`));
  await ev(`(()=>{const s=document.querySelector('.me-tpl'); console.log([...s.options].map(o=>o.text).join('|')); s.value=s.options[1].value; s.dispatchEvent(new Event('change'))})()`); await sleep(300);
  console.log('6 notes', await ev(`PulsePianoRoll.isOpen()`), await ev(`document.querySelector('.me-tpl').options.length`));
  await ev(`PulsePianoRoll.close()`); await sleep(500);
  console.log('7', await st());
  // Copier / coller de la région du piano sur la batterie (type différent)
  await ev(`state.selectedTrack=1; state.selectedClip={trackIdx:1,clipIdx:0}; copySelectedClip(); selectTrack(2); seekPlayhead(10); pasteClip()`); await sleep(500);
  console.log('8 collé du piano sur batterie', await st());
  // coller sur voix
  await ev(`selectTrack(0); seekPlayhead(10); pasteClip()`); await sleep(300);
  console.log('9 collé sur voix', await st());
  // double clic région MIDI collée sur voix
  await ev(`openMidiEditor(0,0,false)`); await sleep(400);
  console.log('10 éditeur sur voix', await ev(`PulsePianoRoll.isOpen()`), await ev(`document.querySelector('.me-inst')?.options.length`));
  await ev(`PulsePianoRoll.close()`);
  // coller 2 fois au même endroit (chevauchement identique)
  await ev(`pasteClip(); pasteClip()`); await sleep(300);
  console.log('11 collé 2x même place', await st());
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
  await shot('/private/tmp/claude-501/qa/compo-2.jpg');
};
