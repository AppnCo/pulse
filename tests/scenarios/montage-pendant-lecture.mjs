// Montage pendant la lecture : une région déplacée / coupée / effacée s'entend tout de suite (sans relancer la lecture)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const R = (s, d) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), name: 'r', start: s, duration: d, offset: 0, peaks: Array.from({ length: 50 }, () => 0.5) });
  await boot(c, { id: 'mpl', name: 'MPL', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', output: 'master', clips: [R(2, 6), R(12, 6)] }] }, { mic: false });
  await ev(`setZoom(60, 0); state.playhead = 0; togglePlay()`); await sleep(900);
  const ok = () => J(ev, `const n = PulseAudio.debugLive()[0], t = state.project.tracks[0]; return { ok: !!n && n.clips === PulseAudio.clipSig(t), moteur: n && n.clips, ecran: PulseAudio.clipSig(t), lecture: state.playing }`);
  const M = (type, x, y, buttons = 1, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1, modifiers });
  const at = () => J(ev, `const r = document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="1"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.3 }`);
  // glisser la 2e région de 120 px vers la gauche (2 s plus tôt)
  let p = await at();
  await M('mouseMoved', p.x, p.y, 0); await M('mousePressed', p.x, p.y);
  for (let k = 1; k <= 6; k++) await M('mouseMoved', p.x - k * 20, p.y);
  await M('mouseReleased', p.x - 120, p.y, 0); await sleep(400);
  let r = await ok(); check('région déplacée : le moteur suit', r.ok && r.lecture && /^10\.000/.test(r.ecran), JSON.stringify(r));
  // ⌥ + glisser = copie
  p = await at();
  await M('mouseMoved', p.x, p.y, 0, 1); await M('mousePressed', p.x, p.y, 1, 1);
  for (let k = 1; k <= 6; k++) await M('mouseMoved', p.x - k * 25, p.y, 1, 1);
  await M('mouseReleased', p.x - 150, p.y, 0, 1); await sleep(400);
  r = await ok(); check('⌥ + glisser (copie) : le moteur suit', r.ok && (r.ecran.match(/\|/g) || []).length >= 2, JSON.stringify(r));
  // effacer la région choisie
  await ev(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await sleep(400);
  r = await ok(); check('région effacée : le moteur suit', r.ok, JSON.stringify(r));
  // ⌘Z : elle revient, et s'entend
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 }); await sleep(400);
  r = await ok(); check('⌘Z : la région revient dans le son', r.ok && r.lecture, JSON.stringify(r));
};
