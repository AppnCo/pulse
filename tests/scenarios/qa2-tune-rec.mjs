import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send);
  await boot(c, { id: 'tr', name: 'TuneRec', bpm: 90, buses: [], tracks: [{ name: 'Voix', type: 'audio', armed: true, color: '#A855F7', clips: [], autotune: { on: true, notes: [true,false,true,false,true,true,false,true,false,true,false,true], source: 'gamme', strength: 0.85, tonic: 0, minor: false } }] });
  const toast = () => ev(`document.getElementById('flash')?.textContent||''`);
  await K('r'); await sleep(3000); await K(' '); await sleep(300);
  console.log('juste après arrêt :', await toast());
  await sleep(4000);
  console.log('plus tard :', await toast(), JSON.stringify(await ev(`state.project.tracks[0].clips.map(c=>[c.name,!!c.tune,c.tune&&c.tune.src===c.id])`)), 'undo', await ev(`_undoStack.length`));
  // 2e prise par-dessus (prises rangées) : la prise rangée est-elle corrigée aussi ?
  await ev(`seekPlayhead(0)`);
  await K('r'); await sleep(2500); await K(' '); await sleep(5000);
  console.log('2e prise :', JSON.stringify(await ev(`[state.project.tracks[0].clips.map(c=>[c.name,!!c.tune]), (state.project.tracks[0].takes||[]).map(c=>[c.name,!!c.tune])]`)), await toast());
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
  // Ctrl+Z x1 
  await ev(`undoAction()`); await sleep(400);
  console.log('⌘Z ×1 :', JSON.stringify(await ev(`[state.project.tracks[0].clips.map(c=>[c.name,!!c.tune]), (state.project.tracks[0].takes||[]).map(c=>[c.name,!!c.tune])]`)));
  // export : le son exporté est celui de la prise corrigée ?
};
