// Comme Logic : double-clic sur un nom = le renommer, partout (liste des pistes, tranche de l'inspecteur, table de mixage ; pistes et groupes)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'rp', name: 'RP', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', volume: 100 }],
    tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Back', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Kick', type: 'audio', color: '#3B82F6', clips: [] }] }, { mic: false });
  const dbl = async (sel) => { const p = await J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
    if (!p) return false;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    for (const cc of [1, 2]) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: cc }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: cc }); }
    await sleep(200); return true; };
  const type = async (txt) => { await send('Input.insertText', { text: txt }); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300); };
  await ev(`selectTrack(2); renderInspector()`); await sleep(300);
  check('inspecteur : nom trouvé', await dbl('#inspector .insp-strip[data-kind="track"] .strip-name'));
  await type('Kick In');
  check('inspecteur : double-clic + Entrée renomme la piste', await J(ev, `return state.project.tracks[2].name`) === 'Kick In', await J(ev, `return state.project.tracks[2].name`));
  check('le nouveau nom est partout (liste)', await J(ev, `return document.querySelector('.track-name[data-i="2"]').textContent.trim()`) === 'Kick In');
  await ev(`document.getElementById('btnMixer').click()`); await sleep(400);
  check('table : nom de piste trouvé', await dbl('.mixer-strips .strip[data-kind="track"][data-i="0"] .strip-name'));
  await type('Lead Vox');
  check('table de mixage : la piste est renommée', await J(ev, `return state.project.tracks[0].name`) === 'Lead Vox', await J(ev, `return state.project.tracks[0].name`));
  check('table : nom de bus trouvé', await dbl('.mixer-strips .strip[data-kind="bus"] .strip-name'));
  await type('Voix');
  check('table de mixage : le groupe est renommé', await J(ev, `return busById('g1').name`) === 'Voix', await J(ev, `return busById('g1').name`));
  // Échap garde l'ancien nom
  await dbl('.mixer-strips .strip[data-kind="track"][data-i="1"] .strip-name');
  await send('Input.insertText', { text: 'zzz' }); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
  check('Échap : le nom ne change pas', await J(ev, `return state.project.tracks[1].name`) === 'Back');
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : le dernier renommage est annulé', await J(ev, `return busById('g1').name`) === 'Vocal');
};
