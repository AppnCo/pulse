// Comme Logic : ⌥ + glisser une région = copie (l'originale reste) ; plusieurs régions choisies = toutes copiées ; ⌘R répète ; ⌘A choisit tout
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'agc', name: 'AGC', bpm: 120, sends: [], tracks: [{ name: 'A', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'B', type: 'audio', color: '#A855F7', clips: [] }] }, { mic: false });
  await instru(ev, 2, 0, 0); await instru(ev, 2, 1, 4); await sleep(500);
  await ev(`setZoom(60, 0); document.querySelector('.timeline').scrollLeft = 0; state.snap = 'off'`); await sleep(200);
  const box = (ti, ci) => J(ev, `const e = document.querySelector('.timeline-track[data-i="${ti}"] .clip[data-ci="${ci}"]'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, h: r.height }`);
  const drag = async (x, y, dx, mods) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
    for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * k / 8, y, button: 'left', buttons: 1, modifiers: mods }); await sleep(20); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); await sleep(300); };
  const starts = (ti) => J(ev, `return state.project.tracks[${ti}].clips.map(c => +c.start.toFixed(2)).sort((a, b) => a - b)`);
  let b = await box(0, 0);
  await drag(b.x, b.y + b.h * 0.25, 180, 1);
  let s = await starts(0);
  check('⌥ + glisser (haut de la région) : copie, l\'originale reste', s.length === 2 && s[0] === 0 && s[1] > 2.5, JSON.stringify(s));
  b = await box(0, 0);
  await drag(b.x, b.y + b.h * 0.75, 400, 1);
  s = await starts(0);
  check('⌥ + glisser (bas de la région) : copie aussi', s.length === 3, JSON.stringify(s));
  await ev(`undoAction()`); await sleep(200); await ev(`undoAction()`); await sleep(300);
  check('⌘Z ×2 : les copies partent', (await starts(0)).length === 1);
  // ⌘A puis ⌥ + glisser : les deux régions (2 pistes) copiées ensemble
  await ev(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 }); await sleep(250);
  check('⌘A : toutes les régions choisies', await J(ev, `return state.selectedClips.size`) === 2);
  b = await box(0, 0);
  await drag(b.x, b.y + b.h * 0.25, 600, 1);
  const s0 = await starts(0), s1 = await starts(1);
  check('⌥ + glisser une région choisie : toutes les régions choisies sont copiées', s0.length === 2 && s1.length === 2, JSON.stringify([s0, s1]));
  await ev(`undoAction()`); await sleep(300);
  // ⌘R : répéter
  b = await box(1, 0);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y + b.h * 0.3, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y + b.h * 0.3, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y + b.h * 0.3, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 4 }); await sleep(300);
  const r = await J(ev, `const c = state.project.tracks[1].clips[0]; return { n: state.project.tracks[1].clips.length, end: c.loopEnd || (c.start + c.duration) }`);
  check('⌘R : la région se répète juste après elle', Math.abs(r.end - 8) < 0.05, JSON.stringify(r));
  // ⌥ + clic sans bouger : aucune copie cachée
  b = await box(0, 0);
  await drag(b.x, b.y + b.h * 0.25, 0, 1);
  check('⌥ + clic sans bouger : pas de copie cachée', (await starts(0)).length === 1, JSON.stringify(await starts(0)));
};
