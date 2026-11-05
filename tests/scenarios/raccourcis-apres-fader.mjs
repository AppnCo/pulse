// Comme Logic : après avoir touché un fader, un pan, un envoi ou un bouton, les raccourcis marchent tout de suite (pas besoin de cliquer ailleurs)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'raf', name: 'RAF', bpm: 120, sends: [], tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Back', type: 'audio', color: '#A855F7', clips: [] }] }, { mic: false });
  await ev(`selectTrack(0); renderInspector()`); await sleep(300);
  const click = async (sel) => { const p = await J(ev, `const e = document.querySelector('${sel}'); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200); };
  const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
  for (const [name, sel] of [["fader de l'inspecteur", '#inspector .insp-strip[data-kind="track"] .insp-fader'], ['volume de la liste', '.track-item[data-i="0"] .t-vol'], ['pan de la liste', '.track-item[data-i="0"] .t-knob']]) {
    await ev(`state.project.tracks.forEach(t => { t.muted = false; t.solo = false; }); selectTrack(0)`); await sleep(150);
    await click(sel);
    const foc = await J(ev, `const a = document.activeElement; return a ? a.tagName + '.' + (a.className || '') : null`);
    await key('m', 'KeyM', 77);
    check(`après le ${name} : M coupe la piste`, await J(ev, `return state.project.tracks[0].muted === true`), foc);
    await key('s', 'KeyS', 83);
    check(`après le ${name} : S la met en solo`, await J(ev, `return state.project.tracks[0].solo === true`), foc);
  }
  await click('#inspector .insp-strip[data-kind="track"] .insp-fader');
  await key(' ', 'Space', 32); await sleep(400);
  const playing = await J(ev, `return !!state.playing`);
  if (playing) await key(' ', 'Space', 32);
  check('après le fader : Espace lance la lecture', playing);
};
