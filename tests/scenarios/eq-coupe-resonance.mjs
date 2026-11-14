// EQ (14/11) : un coupe-bas tiré vers le haut / le bas règle sa résonance (comme Pro-Q), la fenêtre est grande
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 900 });
  await ev(`(()=>{ const t=state.project.tracks[2]; t.effects=['eq']; t.effectParams={ eq: { bands: [{ type: 'hpf', freq: 200, gain: 0, q: 0.71, slope: 12 }] } }; openEffectPanel(2, 'eq', document.body); })()`); await sleep(500);
  check('fenêtre de l\'EQ large', await J(ev, `return document.querySelector('.eq-panel').getBoundingClientRect().width`) >= 1100);
  const p = await J(ev, `const e=document.querySelector('.eq-panel .eq-pt[data-i="0"]'); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y - 12 * i, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y - 72, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
  const b = await J(ev, `return state.project.tracks[2].effectParams.eq.bands[0]`);
  check('tiré vers le haut : résonance plus forte, fréquence gardée', b.q > 1.0 && Math.abs(b.freq - 200) < 15, JSON.stringify(b));
};
