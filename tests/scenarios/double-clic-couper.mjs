// Double-clic maintenu sur une région : on choisit l'endroit en glissant, la coupe se fait au relâché
import { boot, instru, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, { id: 'dc', name: 'DC', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await instru(ev, 6, 0, 0); await sleep(400);
  const Ms = mouse(send);
  const clips = () => ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>[+c.start.toFixed(2), +c.duration.toFixed(2)]))`);
  const p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.7);
  const px = JSON.parse(await ev('state.pxPerSecond'));
  // 1er clic, 2e appui maintenu, glisse de 1 s vers la droite, relâche
  await Ms.click(p.x, p.y, 1);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 2 });
  await sleep(100);
  console.log('pendant le maintien :', await clips(), 'trait=', await ev(`!!document.querySelector('.split-line')`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + px * 1, y: p.y, buttons: 1 });
  await sleep(100);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + px * 1, y: p.y, button: 'left', buttons: 0, clickCount: 2 });
  await sleep(300);
  const after = JSON.parse(await clips());
  console.log('après le relâché :', JSON.stringify(after));
  if (after.length !== 2 || Math.abs(after[0][1] - 4) > 0.01) throw new Error('La coupe n\'est pas au point relâché (4 s attendu)');
};
