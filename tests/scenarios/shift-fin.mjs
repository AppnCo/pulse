// ⇧ enfoncé en tournant un réglage = 10× plus fin, même si on l'appuie en plein geste (pas de saut) — 14/11
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 860 });
  await ev(`(()=>{ const t=state.project.tracks[2]; t.autotune={on:true,strength:0.5,human:0}; openTunePanel(2, -1, 300, 100, true); })()`); await sleep(700);
  const k = await J(ev, `const e=document.querySelector('.tune-panel .tp-k[data-k="human"] .tp-knob'); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}`);
  const val = () => J(ev, `return parseInt(document.querySelector('.tune-panel .tp-k[data-k="human"] .tp-val').textContent)`);
  const M = (type, y, mods = 0) => send('Input.dispatchMouseEvent', { type, x: k.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mods });
  await M('mousePressed', k.y);
  for (let i = 1; i <= 4; i++) await M('mouseMoved', k.y - 10 * i);          // 40 px normal = +10
  const a = await val();
  for (let i = 1; i <= 4; i++) await M('mouseMoved', k.y - 40 - 10 * i, 8);  // 40 px avec ⇧ = +1
  const b = await val();
  await M('mouseReleased', k.y - 80, 8); await sleep(100);
  check('sans ⇧ : 40 px = +10', a === 10, String(a));
  check('avec ⇧ (appuyé en plein geste) : 40 px = +1, sans saut', b === 11, String(b));
};
