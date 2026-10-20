// Éditeur de notes à la souris : poser, déplacer, étirer, effacer, annuler (éditeur puis global)
import { boot, instru, mouse, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, { id: 'r', name: 'R', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] });
  const Ms = mouse(send), K = key(send);
  await ev(`createMidiClip(0, 0)`); await sleep(1200);
  const geo = async () => JSON.parse(await ev(`JSON.stringify((()=>{ const S=PulsePianoRoll._state(); const cv=document.querySelector('.midi-editor canvas'); const r=cv.getBoundingClientRect(); return {l:r.left,t:r.top,pxBeat:S.pxBeat,rowH:S.rowH,sx:S.sx,sy:S.sy,keyW:S.view==='steps'?110:66,rows:S.rows,view:S.view,notes:S.notes.length} })())`));
  const g = await geo();
  console.log('géométrie', JSON.stringify({...g, rows: g.rows.length}));
  const X = (beat) => g.l + g.keyW + beat * g.pxBeat - g.sx;
  const Y = (pitch) => g.t + 22 + (g.rows.indexOf(pitch) + 0.5) * g.rowH - g.sy;
  const notes = () => ev(`JSON.stringify(PulsePianoRoll._state().notes.map(n=>({s:n.s,d:n.d,p:n.p})))`);
  // poser une note (clic)
  await Ms.click(X(0.1), Y(60)); await sleep(150);
  console.log('clic = note ', await notes());
  // glisser pour poser une note longue
  await Ms.drag(X(1.0), Y(64), X(2.5), Y(64), 5); await sleep(150);
  console.log('glisser = note longue', await notes());
  // déplacer la 1re note vers la droite
  await Ms.drag(X(0.3), Y(60), X(3.3), Y(62), 5); await sleep(150);
  console.log('déplacer', await notes());
  // étirer (bord droit)
  const n2 = JSON.parse(await notes())[1];
  await Ms.drag(X(n2.s + n2.d) - 3, Y(64), X(n2.s + n2.d) + 60, Y(64), 5); await sleep(150);
  console.log('étirer bord droit', await notes());
  // double-clic = effacer
  await Ms.click(X(1.2), Y(64), 2); await sleep(150);
  console.log('double-clic = effacer', await notes());
  // annuler dans l'éditeur
  await K('z', 4); await sleep(150);
  console.log('⌘Z (éditeur)', await notes());
  await K('z', 4); await sleep(150); await K('z', 4); await sleep(150); await K('z', 4); await sleep(150); await K('z', 4); await sleep(150);
  console.log('⌘Z ×4 de plus', await notes(), 'flash=', await ev(`document.getElementById('flash').textContent`));
  await shot('/private/tmp/claude-501/qa/roll-souris.jpg');
  // fermer puis ⌘Z global
  await ev(`PulsePianoRoll._state().notes.push({s:0,d:1,p:60,v:100}); 0`);
};
