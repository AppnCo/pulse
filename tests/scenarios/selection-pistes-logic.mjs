// Comme Logic : ⇧ + clic = toutes les pistes entre les deux, ⌘ + clic = ajouter / retirer une piste — dans la liste ET dans la table de mixage
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'spl', name: 'SPL', bpm: 120, sends: [], tracks: ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n, type: 'audio', color: '#3B82F6', clips: [] })) }, { mic: false });
  const clickAt = async (sel, mods = 0) => { const p = await J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + Math.min(30, r.width / 2), y: r.top + Math.min(12, r.height / 2) }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); await sleep(250); };
  const chosen = () => J(ev, `return selectedTrackIdxs().join()`);
  const name = (i) => `.track-item[data-i="${i}"] .track-name`;
  await clickAt(name(0)); await clickAt(name(2), 8);
  check('liste : ⇧ + clic = A à C', (await chosen()) === '0,1,2', await chosen());
  await clickAt(name(4), 4);
  check('liste : ⌘ + clic = + E', (await chosen()) === '0,1,2,4', await chosen());
  await clickAt(name(1), 4);
  check('liste : ⌘ + clic sur B = B retirée', (await chosen()) === '0,2,4', await chosen());
  await clickAt(name(3));
  check('liste : clic simple = D seule', (await chosen()) === '3', await chosen());
  await ev(`document.getElementById('btnMixer').click()`); await sleep(500);
  const st = (i) => `.mixer-strips .strip[data-kind="track"][data-i="${i}"] .strip-name`;
  await clickAt(st(1)); await clickAt(st(3), 8);
  check('table : ⇧ + clic = B à D', (await chosen()) === '1,2,3', await chosen());
  await clickAt(st(0), 4);
  check('table : ⌘ + clic = + A', (await chosen()) === '0,1,2,3', await chosen());
  await clickAt(st(2), 4);
  check('table : ⌘ + clic sur C = C retirée', (await chosen()) === '0,1,3', await chosen());
  check('la liste montre la même sélection', await J(ev, `return [...document.querySelectorAll('.track-item.selected')].map(e => e.dataset.i).sort().join()`) === '0,1,3');
};
