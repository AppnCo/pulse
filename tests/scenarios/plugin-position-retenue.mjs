// Comme Logic : une fenêtre de plugin rouverte revient là où on l'avait posée (par plugin et par piste)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'ppr', name: 'PPR', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], effects: ['comp'] }, { name: 'Basse', type: 'audio', color: '#3B82F6', clips: [], effects: ['comp'] }] }, { mic: false });
  await ev(`openEffectPanel(0, 'comp', document.body)`); await sleep(400);
  const head = await J(ev, `const r = document.querySelector('.fx-panel.plug-win .fx-panel-header').getBoundingClientRect(); return { x: r.left + 120, y: r.top + 10 }`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head.x, y: head.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: head.x, y: head.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 6; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head.x + 30 * k, y: head.y + 15 * k, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: head.x + 180, y: head.y + 90, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
  const p1 = await J(ev, `const r = document.querySelector('.fx-panel.plug-win').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }`);
  await ev(`document.querySelector('.fx-panel.plug-win .fx-panel-close').click()`); await sleep(200);
  await ev(`openEffectPanel(0, 'comp', document.body)`); await sleep(400);
  const p2 = await J(ev, `const r = document.querySelector('.fx-panel.plug-win').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }`);
  check('rouverte : même place', Math.abs(p1.x - p2.x) <= 2 && Math.abs(p1.y - p2.y) <= 2, JSON.stringify([p1, p2]));
  await ev(`document.querySelectorAll('.fx-panel').forEach(p => p.remove()); openEffectPanel(1, 'comp', document.body)`); await sleep(400);
  const p3 = await J(ev, `const r = document.querySelector('.fx-panel.plug-win').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }`);
  check('le compresseur d\'une AUTRE piste n\'hérite pas de cette place', Math.abs(p3.x - p1.x) > 20 || Math.abs(p3.y - p1.y) > 20, JSON.stringify([p1, p3]));
};
