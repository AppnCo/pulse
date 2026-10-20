import { boot, instru, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP, { w: 1000, h: 700 });
  const Ms = mouse(send);
  const els = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-tooltip]')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.right<=innerWidth&&r.bottom<=innerHeight}).map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.dataset.tooltip.slice(0,60),id:e.id||e.className.toString().slice(0,20),pl:e.dataset.tooltipPlacement||''}}))`));
  console.log('éléments avec infobulle :', els.length);
  // pour chacun : survol, puis mesure du ::after via capture : on utilise getComputedStyle sur le pseudo-élément
  let bad = 0;
  for (const e of els) {
    await Ms.M('mouseMoved', e.x, e.y); await sleep(60);
    const r = JSON.parse(await ev(`JSON.stringify((()=>{ const el=document.elementFromPoint(${e.x},${e.y}); const t=el.closest('[data-tooltip]'); if(!t) return null; const cs=getComputedStyle(t,'::after'); return {op:cs.opacity, l:cs.left, r:cs.right, t:cs.top, b:cs.bottom, w:cs.width, h:cs.height, pos:cs.position, tr:cs.transform, content:cs.content.slice(0,30), rect:JSON.stringify(t.getBoundingClientRect())} })())`));
    if (!r) continue;
    // estimation de la position réelle : left (px) relative à l'élément ; on la calcule avec le rect
    const rect = JSON.parse(r.rect);
    const w = parseFloat(r.w) || 0;
    const left = parseFloat(r.l);
    let absLeft = isNaN(left) ? null : rect.left + left;
    if (/translate/.test(r.tr || '') || /matrix/.test(r.tr || '')) { const m = r.tr.match(/matrix\(([^)]+)\)/); if (m) absLeft = absLeft + parseFloat(m[1].split(',')[4]); }
    if (absLeft !== null && (absLeft < 0 || absLeft + w > 1000)) { bad++; console.log('DÉBORDE', e.id, JSON.stringify(e.t), 'x=', Math.round(absLeft), 'w=', Math.round(w), 'placement', e.pl); }
    else if (r.content === '""' || r.content === 'none' || r.content === 'normal') console.log('VIDE', e.id, JSON.stringify(e.t), r.content);
  }
  console.log('infobulles qui débordent :', bad);
};
