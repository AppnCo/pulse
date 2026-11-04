// En-têtes de groupes comme des tranches : ⌘ + clic pour en choisir plusieurs, leurs volumes bougent ensemble (dB relatifs)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const tr = (n, out) => ({ name: n, type: 'audio', color: '#A855F7', volume: 100, clips: [], output: out });
  await boot(c, { id: 'ge1', name: 'GE', bpm: 120, sends: [], tracks: [tr('G1', 'ga'), tr('G2', 'ga'), tr('M1', 'gb'), tr('M2', 'gb')],
    buses: [{ id: 'ga', name: 'Guitares', isGroup: true, output: 'master', volume: 100 }, { id: 'gb', name: 'Mélodies', isGroup: true, output: 'master', volume: 50 }] }, { mic: false });
  const at = async (sel) => JSON.parse(await J(ev, `const e=document.querySelector(${JSON.stringify(sel)}); const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width*0.35,y:r.y+r.height/2})`));
  const clickAt = async (p, mod = 0) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); await sleep(30); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); await sleep(200); };
  await clickAt(await at('.group-header[data-bus="ga"] .group-name'));
  await clickAt(await at('.group-header[data-bus="gb"] .group-name'), 4);
  check('⌘ + clic : les deux groupes choisis', await J(ev, `return document.querySelectorAll('.group-header.is-chosen').length`) === 2);
  await ev(`(()=>{ const f=document.querySelector('.group-header[data-bus="ga"] .group-vol'); f.value=volToPos(50); f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(150);
  const v = JSON.parse(await J(ev, `return JSON.stringify({ a: state.project.buses[0].volume, b: state.project.buses[1].volume, sb: posToVol(+document.querySelector('.group-header[data-bus="gb"] .group-vol').value) })`));
  check('le 2e groupe suit du même écart (50 → 25), son curseur aussi', Math.abs(v.b - 25) <= 1 && Math.abs(v.sb - v.b) <= 1, JSON.stringify(v));
  await clickAt(await at('.group-header[data-bus="ga"] .group-name'));
  check('clic simple : un seul groupe, plus de contour', await J(ev, `return document.querySelectorAll('.group-header.is-chosen').length`) === 0);
};
