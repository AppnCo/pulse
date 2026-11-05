// Comme Logic : molette = défilement vertical (liste et timeline ensemble), ⇧ + molette = horizontal, pavé tactile = les deux
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'mdf', name: 'MDF', bpm: 120, sends: [], tracks: Array.from({ length: 16 }, (_, i) => ({ name: 'P' + (i + 1), type: 'audio', color: '#3B82F6', clips: [] })) }, { mic: false });
  await ev(`setZoom(80, 0)`); await sleep(300);
  const st = () => J(ev, `const tl = document.querySelector('.timeline'), li = document.getElementById('tracksList'); const t0 = document.querySelector('.timeline-track[data-i="5"]').getBoundingClientRect().top, l0 = document.querySelector('.track-item[data-i="5"]').getBoundingClientRect().top; return { x: Math.round(tl.scrollLeft), y: Math.round(tl.scrollTop), d: Math.round(t0 - l0), maxY: tl.scrollHeight - tl.clientHeight, maxX: tl.scrollWidth - tl.clientWidth }`);
  const wheel = async (sel, dx, dy, mods = 0) => { const p = await J(ev, `const el = document.querySelector('${sel}'); const r = el.getBoundingClientRect(); const v = (el.closest('.timeline') || el.closest('.tracks-panel')).getBoundingClientRect(); const nm = el.querySelector('.track-name'); const x = nm ? nm.getBoundingClientRect().left + 10 : Math.max(r.left, v.left) + 200; return { x, y: r.top + r.height / 2 }`);
    for (let k = 0; k < 4; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: dx, deltaY: dy, modifiers: mods }); await sleep(40); } await sleep(300); };
  const a = await st();
  await wheel('.timeline-track[data-i="2"]', 0, 60);
  const b = await st();
  check('molette sur la timeline : défile vers le bas', b.y > a.y && b.x === a.x, JSON.stringify([a, b]));
  check('… la liste suit (alignée)', Math.abs(b.d) <= 1, JSON.stringify(b));
  await wheel('.track-item[data-i="6"]', 0, 60);
  const c2 = await st();
  check('molette sur la liste : la timeline suit aussi', c2.y > b.y && Math.abs(c2.d) <= 1, JSON.stringify(c2));
  await wheel('.timeline-track[data-i="7"]', 0, 60, 8);
  const d = await st();
  check('⇧ + molette : défile de côté', d.x > c2.x && Math.abs(d.y - c2.y) <= 1, JSON.stringify([c2, d]));
  await wheel('.timeline-track[data-i="7"]', 60, 0);
  const e = await st();
  check('pavé tactile (glisser de côté) : défile de côté', e.x > d.x, JSON.stringify([d, e]));
};
