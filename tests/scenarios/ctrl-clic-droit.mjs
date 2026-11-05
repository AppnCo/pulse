// Mac / Logic : ⌃ + clic = clic droit (le menu s'ouvre) et RIEN d'autre (pas de sélection en plus façon ⌘ + clic)
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'ccd', name: 'CCD', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'B', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'C', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }] }, { mic: false });
  await instru(ev, 2, 0, 0); await instru(ev, 2, 0, 3); await sleep(500);
  await ev(`setZoom(60, 0); document.querySelector('.timeline').scrollLeft = 0`); await sleep(200);
  const ctrlClick = async (sel, fy = 0.3) => { const p = await J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(), v = document.querySelector('.timeline').getBoundingClientRect(); return { x: Math.min(r.left + r.width / 2, v.right - 20), y: r.top + r.height * ${fy} }`);
    await ev(`window._cm = 0; document.addEventListener('contextmenu', () => _cm++, { capture: true, once: true })`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', modifiers: 2 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 2 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 2 }); await sleep(300);
    return J(ev, `return { cm: window._cm, menu: !!document.querySelector('.track-ctx-menu, .clip-ctx-menu'), sel: [...state.selectedClips].join('|'), one: state.selectedClip && state.selectedClip.clipIdx }`); };
  // région 0 choisie, puis ⌃ + clic sur la région 1
  await ev(`state.selectedClip = { trackIdx: 0, clipIdx: 0 }; state.selectedClips = new Set(); renderTimelineTracks()`); await sleep(150);
  const r = await ctrlClick('.timeline-track[data-i="0"] .clip[data-ci="1"]');
  console.log('région :', JSON.stringify(r));
  check('⌃ + clic sur une région : pas d\'ajout à la sélection façon ⌘ + clic', !r.sel.includes('|'), JSON.stringify(r));
  await ev(`closeAllMenus()`);
  const t = await ctrlClick('.track-item[data-i="0"] .track-name', 0.5);
  console.log('piste :', JSON.stringify(t));
  check('⌃ + clic sur une piste : pas de sélection multiple', await J(ev, `return state.selectedTracks.size <= 1`));
};
