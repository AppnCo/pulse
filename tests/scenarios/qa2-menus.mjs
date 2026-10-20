import { boot, RAP, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const Mo = mouse(send);
  await boot(c, RAP, { w: 1000, h: 640 });
  // 1. « Enregistrer sur cette piste » sur Rec
  const r = await pos(ev, `.track-item[data-i="1"]`, 0.5, 0.5);
  await Mo.rclick(r.x, r.y); await sleep(200);
  const items = await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()))`);
  console.log('menu Rec :', items);
  const geo = await ev(`JSON.stringify((()=>{const m=document.querySelector('.track-ctx-menu'); const b=m.getBoundingClientRect(); return {top:b.top,bottom:b.bottom,h:innerHeight,items:m.querySelectorAll('.ctx-item').length}})())`);
  console.log('géométrie du menu', geo);
  const it = await ev(`(()=>{const e=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(x=>/enregistrer/i.test(x.textContent)); const b=e.getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})})()`);
  const p = JSON.parse(it); await Mo.click(p.x, p.y); await sleep(300);
  console.log('après clic « …enregistrer » sur Rec : message =', await ev(`document.getElementById('flash')?.style.opacity==='1'?document.getElementById('flash').textContent:'(aucun message)'`));
  // 2. menu près du bas : dépasse ?
  await ev(`closeAllMenus()`);
  const last = await pos(ev, `.track-item[data-i="4"]`, 0.5, 0.8);
  console.log('piste Ambiance y=', last.y);
  await Mo.rclick(last.x, Math.min(last.y, 600)); await sleep(200);
  console.log('menu en bas :', await ev(`JSON.stringify((()=>{const m=document.querySelector('.track-ctx-menu'); if(!m) return null; const b=m.getBoundingClientRect(); return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:innerHeight,items:m.querySelectorAll('.ctx-item').length}})())`));
  await shot('/private/tmp/claude-501/qa/menu-bas.jpg');
};
