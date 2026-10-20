import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, { id: 'um', name: 'UndoMidi', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] });
  await ev(`createMidiClip(0,0,true)`); await sleep(700);
  const cv = await pos(ev, '.me-cv', 0, 0);
  const S = JSON.parse(await ev(`JSON.stringify({pxBeat:PulsePianoRoll._state().pxBeat})`));
  for (let i = 0; i < 4; i++) { await Mo.click(cv.x + 66 + 10 + i * S.pxBeat, cv.y + 120 + i * 16); await sleep(60); }
  await sleep(600);
  const n = () => ev(`(state.project.tracks[0].clips[0]?state.project.tracks[0].clips[0].midi.notes.length:'(plus de région)')`);
  console.log('4 notes posées → notes dans la région :', await n(), '| undo stack', await ev(`_undoStack.length`));
  await ev(`PulsePianoRoll.close()`); await sleep(300);
  await K('z', CMD); await sleep(300);
  console.log('éditeur fermé, ⌘Z ×1 → notes :', await n(), '|', await ev(`document.getElementById('flash').textContent`));
  await K('z', CMD); await sleep(300);
  console.log('⌘Z ×2 → notes :', await n(), '| pistes', await ev(`state.project.tracks.length`));
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
};
