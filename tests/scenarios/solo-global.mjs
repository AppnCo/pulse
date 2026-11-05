// S au-dessus des pistes (comme Logic) : il s'allume dès qu'un solo est actif (piste, groupe, dossier) ; un clic retire tous les solos
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'sg', name: 'SG', bpm: 120, sends: [],
    buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', color: '#A855F7', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'B', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Back', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }] }, { mic: false });
  const lit = () => J(ev, `const b = document.getElementById('btnSoloAll'); return b ? b.classList.contains('active') : null`);
  const clickEl = async (sel) => { const p = await J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250); };
  check('le S est là, éteint', (await lit()) === false);
  await clickEl('.track-item[data-i="1"] .m-s');
  check('solo d\'une piste : le S s\'allume', (await lit()) === true, JSON.stringify(await J(ev, `return state.project.tracks.map(t => !!t.solo)`)));
  await clickEl('.group-header[data-bus="g1"] .g-s');
  check('solo du groupe en plus : toujours allumé', (await lit()) === true && await J(ev, `return !!busById('g1').solo`));
  await clickEl('#btnSoloAll');
  check('clic sur le S : plus aucun solo', await J(ev, `return state.project.tracks.every(t => !t.solo) && !busById('g1').solo`));
  check('le S s\'éteint', (await lit()) === false);
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : les solos reviennent, le S se rallume', await J(ev, `return state.project.tracks[1].solo && !!busById('g1').solo`) && (await lit()) === true);
  await ev(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', modifiers: 7 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', modifiers: 7 }); await sleep(250);
  check('⌃⌥⌘S : éteint aussi le S', (await lit()) === false);
};
