// Comme Logic : un clic dans la règle pendant la lecture = la lecture saute là et continue
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'rpl', name: 'RPL', bpm: 120, sends: [], tracks: [{ name: 'A', type: 'audio', color: '#3B82F6', clips: [] }] }, { mic: false });
  await instru(ev, 30, 0, 0); await sleep(500);
  await ev(`setZoom(40, 0); document.querySelector('.timeline').scrollLeft = 0; state.snap = 'off'; state.playhead = 0`); await sleep(200);
  await ev(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await sleep(800);
  const p = await J(ev, `const r = document.querySelector('.timeline-ruler').getBoundingClientRect(), tl = document.querySelector('.timeline'); return { x: r.left + 20 * state.pxPerSecond - tl.scrollLeft + 0, y: r.bottom - 4 }`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(900);
  const r = await J(ev, `return { playing: !!state.playing, pos: +PulseAudio.getPlaybackPosition().toFixed(2), ph: +state.playhead.toFixed(2) }`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await sleep(300);
  check('clic dans la règle pendant la lecture : la lecture continue', r.playing, JSON.stringify(r));
  check('… depuis l\'endroit cliqué (20 s)', r.pos >= 19.5 && r.pos < 22, JSON.stringify(r));
};
