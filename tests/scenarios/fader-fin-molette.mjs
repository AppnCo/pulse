// Comme Logic : ⇧ + glisser un fader = réglage fin ; molette sur un fader / curseur (groupes compris) = régler
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'ffm', name: 'FFM', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', volume: 100, pan: 0 }],
    tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [], volume: 100 }, { name: 'Back', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }] }, { mic: false });
  await ev(`selectTrack(0); renderInspector()`); await sleep(300);
  const at = (sel) => J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, v: +e.value }`);
  const drag = async (p, dx, dy, mods) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
    for (let k = 1; k <= 5; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + dx * k / 5, y: p.y + dy * k / 5, button: 'left', buttons: 1, modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); await sleep(250); };
  const f = await at('#inspector .insp-strip[data-kind="track"] .insp-fader');
  const vertical = f.h > f.w;
  const v0 = await J(ev, `return state.project.tracks[0].volume`);
  await drag(f, vertical ? 0 : -60, vertical ? 60 : 0, 8);
  const v1 = await J(ev, `return state.project.tracks[0].volume`);
  check('⇧ + glisser le fader : il bouge, mais peu', v1 !== v0 && Math.abs(v1 - v0) < 25, JSON.stringify({ v0, v1, vertical }));
  check('⇧ + glisser ne saute pas là où on a cliqué', Math.abs(v1 - v0) < 25);
  // molette sur le volume du groupe (liste) et sur le pan du groupe (table)
  const h = await J(ev, `const r = document.querySelector('#tracksList .group-header[data-bus="g1"] .group-name').getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y, button: 'none' }); await sleep(700);
  const gv = await at('#tracksList .group-header[data-bus="g1"] .group-vol');
  for (let k = 0; k < 3; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: gv.x, y: gv.y, deltaX: 0, deltaY: 40 }); await sleep(60); }
  await sleep(400);
  check('molette sur le volume du groupe : il baisse', await J(ev, `return busById('g1').volume < 100`), String(await J(ev, `return busById('g1').volume`)));
  await ev(`document.getElementById('btnMixer').click()`); await sleep(500);
  const bp = await at('.mixer-strips .strip[data-kind="bus"] .bus-pan');
  for (let k = 0; k < 3; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bp.x, y: bp.y, deltaX: 0, deltaY: -40 }); await sleep(60); }
  await sleep(400);
  check('molette sur le pan du groupe (table) : il bouge', await J(ev, `return (busById('g1').pan || 0) !== 0`), String(await J(ev, `return busById('g1').pan`)));
};
