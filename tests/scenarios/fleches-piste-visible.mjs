// Comme Logic : ↑ / ↓ changent de piste ET la liste défile pour que la piste choisie reste visible (grand projet)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'fpv', name: 'FPV', bpm: 120, sends: [], tracks: Array.from({ length: 30 }, (_, i) => ({ name: 'P' + (i + 1), type: 'audio', color: '#3B82F6', clips: [] })) }, { mic: false });
  await ev(`selectTrack(0); document.activeElement && document.activeElement.blur()`); await sleep(300);
  const key = async (code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: code, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: code, code, windowsVirtualKeyCode: vk }); await sleep(60); };
  for (let k = 0; k < 24; k++) await key('ArrowDown', 40);
  await sleep(300);
  const vis = () => J(ev, `const i = state.selectedTrack, el = document.querySelector('.track-item[data-i="' + i + '"]'), p = document.querySelector('.tracks-panel').getBoundingClientRect(), r = el.getBoundingClientRect(), tl = document.querySelector('.timeline'), tr = document.querySelector('.timeline-track[data-i="' + i + '"]').getBoundingClientRect(), tb = tl.getBoundingClientRect(); return { i, inList: r.top >= p.top && r.bottom <= p.bottom + 1, inTl: tr.top >= tb.top && tr.bottom <= tb.bottom + 1 }`);
  let v = await vis();
  check('↓ ×24 : piste 25 choisie', v.i === 24, JSON.stringify(v));
  check('… visible dans la liste', v.inList, JSON.stringify(v));
  check('… et sa ligne visible dans la timeline (alignées)', v.inTl, JSON.stringify(v));
  for (let k = 0; k < 22; k++) await key('ArrowUp', 38);
  await sleep(300);
  v = await vis();
  check('↑ ×22 : piste 3 choisie et visible', v.i === 2 && v.inList && v.inTl, JSON.stringify(v));
};
