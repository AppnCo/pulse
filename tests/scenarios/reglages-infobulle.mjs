// Réglages : l'aide longue (Mémoire tampon…) passe par l'infobulle flottante ; avant le 15/11 elle débordait (barre horizontale)
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1920, h: 1080 });
  await ev(`openSettings()`); await sleep(500);
  const p = await J(ev, `const r=[...document.querySelectorAll('.settings-modal .set-row[data-tooltip]')].find(e=>/Petite : le moins/.test(e.dataset.tooltip)); r.scrollIntoView({block:'center'}); return 1`); await sleep(600);
  const p2 = await J(ev, `const r=[...document.querySelectorAll('.settings-modal .set-row[data-tooltip]')].find(e=>/Petite : le moins/.test(e.dataset.tooltip)); const b=r.getBoundingClientRect(); return {x:b.left+40,y:b.top+b.height/2}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p2.x, y: p2.y }); await sleep(800); 
  const t = await J(ev, `const t=document.querySelector('.float-tip.on'); const m=document.querySelector('.settings-modal'); const r=t&&t.getBoundingClientRect(); return {on:!!t, w:r&&Math.round(r.width), inside:r&&r.right<=innerWidth&&r.left>=0, sw:m.scrollWidth, cw:m.clientWidth}`);
  check('infobulle flottante entière, pas de débordement', t.on && t.inside && t.w <= 360 && t.sw <= t.cw + 1, JSON.stringify(t));
};
