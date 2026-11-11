// EQ : double-clic dans le graphique = nouveau point (retour terrain 11/11 : « le double-clic pour ajouter un point s'est retiré »)
import { boot, J, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c; const m = mouse(send);
  await boot(c, { id: 'eqd', name: 'EQ', bpm: 120, sends: [], buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, effects: ['eq'], clips: [] }] }, { mic: false });
  await ev(`openEffectPanel(0, 'eq', document.body)`); await sleep(500);
  const g = await J(ev, `const g=document.querySelector('.fx-panel .eq-graph'); const r=g.getBoundingClientRect(); return {x:r.left+r.width*0.5, y:r.top+r.height*0.4, cls:g.getAttribute('class')}`);
  const n0 = await J(ev, `return document.querySelectorAll('.fx-panel .eq-pt').length`);
  console.log('sous la souris :', await J(ev, `const e=document.elementFromPoint(${g.x},${g.y}); window.__dbl=0; window.__md=0; document.addEventListener('dblclick',()=>window.__dbl++,true); document.addEventListener('mousedown',()=>window.__md++,true); return e.tagName+'.'+(e.getAttribute('class')||'')+' < '+(e.parentElement&&e.parentElement.getAttribute('class'))`));
  await m.click(g.x, g.y, 1); await m.click(g.x, g.y, 2); await sleep(400);
  const n1 = await J(ev, `return document.querySelectorAll('.fx-panel .eq-pt').length`);
  console.log('événements :', await J(ev, `return {dbl: window.__dbl, md: window.__md}`));
  check('double-clic dans le vide de l\'EQ : un point de plus', n1 === n0 + 1, JSON.stringify({ n0, n1, g }));
  // double-clic sur le point : il est retiré
  const pt = await J(ev, `const p=document.querySelector('.fx-panel .eq-pt'); if(!p) return null; const r=p.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}`);
  if (pt) { await sleep(500); await m.click(pt.x, pt.y, 1); await m.click(pt.x, pt.y, 2); await sleep(400); }
  const n2 = await J(ev, `return document.querySelectorAll('.fx-panel .eq-pt').length`);
  check('double-clic sur le point : retiré', pt && n2 === n1 - 1, JSON.stringify({ n1, n2, pt }));
  // deux clics lents (0,6 s) : pas de point ajouté
  await sleep(500); await m.click(g.x - 80, g.y, 1); await sleep(600); await m.click(g.x - 80, g.y, 1); await sleep(300);
  const n3 = await J(ev, `return document.querySelectorAll('.fx-panel .eq-pt').length`);
  check('deux clics lents : rien d\'ajouté', n3 === n2, JSON.stringify({ n2, n3 }));
};
