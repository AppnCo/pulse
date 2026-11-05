// Comme Logic : ⌥ + clic sur un réglage = sa valeur par défaut (volume 0 dB, pan au centre, envoi) — partout, sur ce qu'on VOIT
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'acd', name: 'ACD', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', volume: 60, pan: 30 }, { id: 'b1', name: 'Bus 1', busNum: 1, isGroup: true, isAux: true, output: 'master', volume: 100 }],
    tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [], volume: 50, pan: -40, busSends: { b1: 80 } }, { name: 'Back', type: 'audio', color: '#A855F7', output: 'g1', clips: [], volume: 50, pan: 25 }] }, { mic: false });
  await ev(`selectTrack(0); renderInspector()`); await sleep(400);
  const altClick = async (sel) => { await J(ev, `const e0 = document.querySelector(${JSON.stringify(sel)}); if (e0) e0.scrollIntoView({ block: 'center' }); return 1`); const p = await J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return 'caché'; const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return { x, y, top: top && (top.className.baseVal ?? top.className) }`);
    if (!p || typeof p === 'string') return p;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', modifiers: 1 }); await sleep(600);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 }); await sleep(250); return p; };
  const T = (k) => J(ev, `return state.project.tracks[0].${k}`);
  let p = await altClick('#inspector .insp-strip[data-kind="track"] .insp-knob');
  check('inspecteur : ⌥ + clic sur le pan = centre', (await T('pan')) === 0, JSON.stringify([p, await T('pan')]));
  p = await altClick('#inspector .insp-strip[data-kind="track"] .insp-fader');
  check('inspecteur : ⌥ + clic sur le fader = 0 dB', (await T('volume')) === 100, JSON.stringify([p, await T('volume')]));
  p = await altClick('#inspector .insp-strip[data-kind="track"] [data-bsend]');
  const sv = await J(ev, `return state.project.tracks[0].busSends.b1`);
  check('inspecteur : ⌥ + clic sur l\'envoi = valeur par défaut (pas 80)', sv !== 80, JSON.stringify([p, sv]));
  p = await altClick('.track-item[data-i="1"] .t-vol');
  check('liste : ⌥ + clic sur le volume de la piste = 0 dB', await J(ev, `return state.project.tracks[1].volume`) === 100, JSON.stringify(p));
  p = await altClick('.track-item[data-i="1"] .t-knob');
  check('liste : ⌥ + clic sur le pan de la piste = centre', await J(ev, `return state.project.tracks[1].pan || 0`) === 0, JSON.stringify(p));
  await J(ev, `const r = document.querySelector('#tracksList .group-header[data-bus="g1"]').getBoundingClientRect(); return 1`);
  { const h = await J(ev, `const r = document.querySelector('#tracksList .group-header[data-bus="g1"] .group-name').getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }`); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y, button: 'none' }); await sleep(700); }
  p = await altClick('#tracksList .group-header[data-bus="g1"] .group-vol');
  check('liste : ⌥ + clic sur le volume du groupe = 0 dB', await J(ev, `return busById('g1').volume`) === 100, JSON.stringify(p));
  await ev(`state.project.tracks[0].volume = 50; state.project.tracks[0].pan = -40; busById('g1').volume = 60; document.getElementById('btnMixer').click()`); await sleep(500);
  p = await altClick('.mixer-strips .strip[data-kind="track"][data-i="0"] .fader, .mixer-strips .strip[data-kind="track"][data-i="0"] input[type="range"].strip-fader');
  check('table : ⌥ + clic sur le fader = 0 dB', (await T('volume')) === 100, JSON.stringify([p, await T('volume')]));
  p = await altClick('.mixer-strips .strip[data-kind="track"][data-i="0"] .strip-pan-knob');
  check('table : ⌥ + clic sur le pan = centre', (await T('pan')) === 0, JSON.stringify([p, await T('pan')]));
  p = await altClick('.mixer-strips .strip[data-kind="bus"] .fader');
  check('table : ⌥ + clic sur le fader du groupe = 0 dB', await J(ev, `return busById('g1').volume`) === 100, JSON.stringify(p));
  p = await altClick('.mixer-strips .strip[data-kind="bus"] .bus-pan');
  check('table : ⌥ + clic sur le pan du groupe = centre', await J(ev, `return busById('g1').pan || 0`) === 0, JSON.stringify([p, await J(ev, `return busById('g1').pan`)]));
};
