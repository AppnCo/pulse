// Ordre des effets : clic maintenu + glisser dans l'inspecteur (plus de flèches)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check, shot } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [
    { name: 'A', type: 'audio', color: '#A855F7', effects: ['eq', 'comp', 'delay'], clips: [] }] });
  await sleep(300);
  const order = () => ev(`chainOf(state.project.tracks[0]).join(',')`);
  const start = await order();
  check('plus de petites flèches', await ev(`!document.querySelector('.insp-move')`));
  const r = (n) => ev(`(() => { const b = document.querySelector('.insp-strip .insp-fx-row[data-fx="${n}"]').getBoundingClientRect(); return { x: b.left + 15, y: b.top + b.height / 2, h: b.height }; })()`);
  const first = start.split(',')[0], last = start.split(',').slice(-1)[0];
  const a = await r(first), z = await r(last);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y + (z.y + z.h - a.y) * i / 8, button: 'left' });
  await shot(process.env.TMPDIR + '/effets-glisser.jpg');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: z.y + z.h, button: 'left', clickCount: 1 });
  await sleep(200);
  const after = await order();
  check('le 1er effet glissé tout en bas', after.split(',').slice(-1)[0] === first, `${start} → ${after}`);
  check('aucune fenêtre ouverte par le glisser', await ev(`!document.querySelector('.fx-panel')`));
  await ev(`undoAction()`); await sleep(200);
  check("⌘Z remet l'ordre", await order() === start, await order());
  const b = await r(first);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await sleep(200);
  check("un simple clic ouvre toujours l'effet", await ev(`!!document.querySelector('.fx-panel')`));
};
