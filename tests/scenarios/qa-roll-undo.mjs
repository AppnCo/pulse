import { boot, mouse, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, { id: 'r', name: 'R', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] });
  const Ms = mouse(send), K = key(send);
  await ev(`createMidiClip(0, 0)`); await sleep(1200);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{ const S=PulsePianoRoll._state(); const r=document.querySelector('.midi-editor canvas').getBoundingClientRect(); return {l:r.left,t:r.top,pxBeat:S.pxBeat,rowH:S.rowH,sy:S.sy,rows:S.rows}})())`));
  const X = (b) => g.l + 66 + b * g.pxBeat, Y = (p) => g.t + 22 + (g.rows.indexOf(p) + .5) * g.rowH - g.sy;
  const N = () => ev(`JSON.stringify({editor:PulsePianoRoll.isOpen()&&PulsePianoRoll._state().notes.length, clip:state.project.tracks[0].clips[0]&&state.project.tracks[0].clips[0].midi.notes.length, undo:_undoStack.length})`);
  await Ms.click(X(0.1), Y(60)); await sleep(700);
  await Ms.click(X(1.1), Y(62)); await sleep(700);
  console.log('2 notes posées et validées :', await N());
  await Ms.click(X(2.1), Y(64)); await sleep(50);   // 3e note, pas encore validée (350 ms)
  console.log('3e note (non validée) :', await N());
  // ⌘Z global : souris hors de l'éditeur
  await Ms.M('mouseMoved', 800, 300);
  await K('z', 4); await sleep(1500);
  console.log('⌘Z global :', await N(), 'flash=', await ev(`document.getElementById('flash').textContent`));
  await K('z', 4); await sleep(800);
  console.log('⌘Z global 2 :', await N(), 'flash=', await ev(`document.getElementById('flash').textContent`));
  await ev(`openMidiEditor(0,0,false)`); await sleep(500);
  console.log('éditeur rouvert :', await N());
};
