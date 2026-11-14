// Coupe au double-clic maintenu (14/11) : ⇧ enfoncé = la coupe bouge 5× plus lentement (sans aimant), le temps exact s'affiche
import { boot, instru, mouse, pos, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'cf', name: 'CF', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await instru(ev, 6, 0, 0); await sleep(400);
  const Ms = mouse(send);
  const p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.7);
  const px = JSON.parse(await ev('state.pxPerSecond'));
  const t0 = await J(ev, `return (${p.x} - document.querySelector('.timeline-track[data-i="0"]').getBoundingClientRect().left) / state.pxPerSecond`);
  await Ms.click(p.x, p.y, 1);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 2 });
  await sleep(100);
  check('temps affiché sur le trait', /^\d+:\d\d,\d{3}$/.test(await J(ev, `const t=document.querySelector('.split-line .split-tag'); return t && t.textContent`)));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + px, y: p.y, buttons: 1, modifiers: 8 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + px, y: p.y, button: 'left', buttons: 0, clickCount: 2, modifiers: 8 });
  await sleep(300);
  const cl = await J(ev, `return state.project.tracks[0].clips.map(c=>c.duration)`);
  check('⇧ : 1 s de souris = 0,2 s de coupe', cl.length === 2 && Math.abs(cl[0] - (t0 + 0.2)) < 0.03, JSON.stringify([t0, cl]));
};
