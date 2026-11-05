// Comme Logic : un geste sur un fader / pan = UN seul ⌘Z, qui remet la valeur de départ d'un coup
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'anf', name: 'ANF', bpm: 120, sends: [], tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', clips: [], volume: 100, pan: 0 }] }, { mic: false });
  await ev(`selectTrack(0); renderInspector()`); await sleep(300);
  const drag = async (sel) => { const p = await J(ev, `const e = document.querySelector('${sel}'); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: r.height > r.width }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (p.v ? 0 : -6 * k), y: p.y + (p.v ? 6 * k : 0), button: 'left', buttons: 1 }); await sleep(20); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + (p.v ? 0 : -48), y: p.y + (p.v ? 48 : 0), button: 'left', buttons: 0, clickCount: 1 }); await sleep(300); };
  const undo = async () => { await ev(`document.activeElement && document.activeElement.blur()`); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); await sleep(300); };
  const V = () => J(ev, `return state.project.tracks[0].volume`);
  for (const [name, sel] of [['inspecteur', '#inspector .insp-strip[data-kind="track"] .insp-fader'], ['liste', '.track-item[data-i="0"] .t-vol']]) {
    const v0 = await V();
    await drag(sel);
    const v1 = await V();
    await undo();
    const v2 = await V();
    check(`${name} : le fader a bougé`, v1 !== v0, JSON.stringify([v0, v1]));
    check(`${name} : un seul ⌘Z le remet à sa valeur de départ`, v2 === v0, JSON.stringify([v0, v1, v2]));
  }
  await ev(`document.getElementById('btnMixer').click()`); await sleep(500);
  const v0 = await V();
  await drag('.mixer-strips .strip[data-kind="track"][data-i="0"] .fader');
  const v1 = await V(); await undo(); const v2 = await V();
  check('table : un seul ⌘Z remet le fader', v1 !== v0 && v2 === v0, JSON.stringify([v0, v1, v2]));
};
