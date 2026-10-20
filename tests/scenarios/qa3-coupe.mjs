// QA3 n°2 : double-clic maintenu = coupe au relâché
import { boot, instru, mouse, pos, key, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const Ms = mouse(send); const K = key(send);
  const dump = (t = 0) => ev(`JSON.stringify(state.project.tracks[${t}].clips.map(c=>[c.name,+c.start.toFixed(2),+c.duration.toFixed(2),c.loopEnd?+c.loopEnd.toFixed(2):null,+(c.offset||0).toFixed(2)]))`);
  const fresh = async (tracks, snap = 'off') => { await boot(c, { id: 'cv', name: 'CV', bpm: 120, buses: [], tracks }); await ev(`setSnapMode('${snap}',true)`); };
  const P = (type, x, y, cc = 1, buttons = type === 'mouseReleased' ? 0 : 1, mod = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: cc, modifiers: mod });
  // double-clic maintenu : renvoie après le relâché
  const hold = async (x, y, { moveTo = null, holdMs = 100, esc = false, between = null, mod = 0 } = {}) => {
    await P('mouseMoved', x, y); await P('mousePressed', x, y, 1); await P('mouseReleased', x, y, 1);
    await P('mousePressed', x, y, 2, 1, mod); await sleep(holdMs);
    if (moveTo) { await P('mouseMoved', moveTo.x, moveTo.y, 2, 1, mod); await sleep(60); }
    if (between) await between();
    if (esc) { await K('Escape'); await sleep(60); }
    const tx = moveTo ? moveTo.x : x, ty = moveTo ? moveTo.y : y;
    await P('mouseReleased', tx, ty, 2, 0, mod); await sleep(300); };
  const mk = (o = {}) => [{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R', start: 1, duration: 6, offset: 0, ...o }] }];
  const clipPos = (fx = 0.5, fy = 0.7) => pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="0"]', fx, fy);
  const PX = async () => +(await ev('state.pxPerSecond'));

  // 1. maintenu long (> 500 ms) : le dblclick natif peut-il recouper ?
  await fresh(mk()); let p = await clipPos(0.5); let px = await PX();
  await hold(p.x, p.y, { moveTo: { x: p.x + px, y: p.y }, holdMs: 800 });
  console.log('1. maintenu 800 ms puis +1 s :', await dump(), '(attendu : 2 morceaux, coupe à 5 s)');
  // 2. Échap
  await fresh(mk()); p = await clipPos(0.5);
  await hold(p.x, p.y, { moveTo: { x: p.x + px, y: p.y }, esc: true });
  console.log('2. Échap pendant le maintien :', await dump(), 'split-line restante=', await ev(`!!document.querySelector('.split-line')`), 'is-splitting=', await ev(`document.body.classList.contains('is-splitting')`));
  // 3. zoom changé pendant le maintien (molette ⌘/Ctrl)
  await fresh(mk()); p = await clipPos(0.5); px = await PX();
  await hold(p.x, p.y, { moveTo: { x: p.x + 20, y: p.y }, between: async () => { await ev(`setZoom ? setZoom(state.pxPerSecond*2) : 0`); await sleep(150); },
  });
  console.log('3. zoom ×2 pendant le maintien, relâché au même pixel :', await dump(), ' trait présent=', await ev(`!!document.querySelector('.split-line')`));
  // 4. aimant (grille) : la coupe tombe sur la grille ?
  await fresh(mk(), 'bar'); p = await clipPos(0.5); px = await PX();
  await hold(p.x, p.y, { moveTo: { x: p.x + px * 0.3, y: p.y } });
  console.log('4. aimant mesure, coupe vers 4,3 s :', await dump());
  // 5. ⌘ tenu au relâché = libre
  await fresh(mk(), 'bar'); p = await clipPos(0.5);
  await hold(p.x, p.y, { moveTo: { x: p.x + px * 0.3, y: p.y }, mod: CMD });
  console.log('5. aimant + ⌘ :', await dump());
  // 6. région bouclée : clic dans la répétition
  await fresh(mk({ duration: 2, loopEnd: 8 })); p = await clipPos(0.8, 0.7); px = await PX();
  await hold(p.x, p.y);
  console.log('6. clic double dans la répétition d\'une boucle (0-2 jusqu\'à 8, clic vers 6,4 s) :', await dump());
  // 6b. dans le 1er motif
  await fresh(mk({ duration: 2, loopEnd: 8 })); p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="0"]', 0.1, 0.7);
  await hold(p.x, p.y);
  console.log('6b. clic double dans le 1er motif :', await dump());
  // 7. clic double sur le nom
  await fresh(mk()); p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="0"] .clip-name', 0.3, 0.5);
  await P('mouseMoved', p.x, p.y); await P('mousePressed', p.x, p.y, 1); await P('mouseReleased', p.x, p.y, 1); await P('mousePressed', p.x, p.y, 2); await P('mouseReleased', p.x, p.y, 2, 0); await sleep(300);
  console.log('7. clic double sur le nom : contenteditable=', await ev(`document.querySelector('.clip-name')?.getAttribute('contenteditable')`), await dump());
  await ev(`document.activeElement&&document.activeElement.blur()`);
  // 8. triple clic
  await fresh(mk()); p = await clipPos(0.5);
  for (let i = 1; i <= 3; i++) { await P('mouseMoved', p.x, p.y); await P('mousePressed', p.x, p.y, i); await P('mouseReleased', p.x, p.y, i, 0); }
  await sleep(300);
  console.log('8. triple clic :', await dump());
  // 9. maintenu tout à gauche (près du bord) : coupe collée au bord ?
  await fresh(mk()); p = await clipPos(0.5); px = await PX();
  await hold(p.x, p.y, { moveTo: { x: p.x - px * 10, y: p.y } });
  console.log('9. relâché à gauche, bien avant la région :', await dump());
  // 10. maintenu puis relâché sur une autre piste
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R', start: 1, duration: 6, offset: 0 }] }, { name: 'B', type: 'audio', color: '#60A5FA', clips: [{ id: 'b', name: 'S', start: 1, duration: 6, offset: 0 }] }]);
  p = await clipPos(0.5); const p2 = await pos(ev, '.timeline-track[data-i="1"] .clip[data-ci="0"]', 0.7, 0.5);
  await hold(p.x, p.y, { moveTo: { x: p2.x, y: p2.y } });
  console.log('10. relâché sur la piste B : A=', await dump(0), ' B=', await dump(1));
  // 11. région en lecture : coupe pendant la lecture
  await fresh(mk()); await ev(`togglePlay()`); await sleep(300); p = await clipPos(0.5);
  await hold(p.x, p.y, { moveTo: { x: p.x + 30, y: p.y }, holdMs: 400 });
  console.log('11. coupe pendant la lecture :', await dump(), ' lecture=', await ev('state.playing'));
  await ev(`togglePlay()`);
  // 12. ⌘Z annule en un coup
  await fresh(mk()); p = await clipPos(0.5);
  await hold(p.x, p.y, { moveTo: { x: p.x + 60, y: p.y } });
  await K('z', CMD); await sleep(200);
  console.log('12. ⌘Z après la coupe :', await dump());
  // 13. région MIDI : double-clic maintenu ouvre l'éditeur ; le mousedown 2 ne coupe pas
  await fresh([{ name: 'P', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }]);
  await ev(`createMidiClip(0,0,true)`); await sleep(400); await ev(`PulsePianoRoll.close(true)`); await sleep(300);
  p = await clipPos(0.5);
  await hold(p.x, p.y, { moveTo: { x: p.x + 30, y: p.y } });
  console.log('13. double-clic maintenu sur une région MIDI :', await dump(), ' éditeur ouvert=', await ev(`!!(window.PulsePianoRoll&&PulsePianoRoll.isOpen())`));
};
