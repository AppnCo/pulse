// Zoom à l'arrêt : après un clic qui pose la base (bas d'une piste, région, règle, ligne de groupe), le zoom (molette ⌘, E / Z)
// se cale sur la base, même si la souris est ailleurs. Clic en haut d'une piste (base retirée) : le zoom suit la souris.
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'zbc', name: 'ZBC', bpm: 120, sends: [],
    buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', color: '#A855F7', volume: 100, collapsed: true }],
    tracks: [{ name: 'Instru', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Back', type: 'audio', color: '#C084FC', output: 'g1', clips: [] }, { name: 'Vide', type: 'audio', color: '#22C55E', clips: [] }] }, { mic: false });
  await instru(ev, 40, 0, 0); await sleep(600);
  await ev(`setZoom(40, 0); document.querySelector('.timeline').scrollLeft = 0`); await sleep(200);
  const M = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, ...extra });
  const click = async (x, y) => { await M('mouseMoved', x, y); await M('mousePressed', x, y); await M('mouseReleased', x, y); await sleep(250); };
  const wheel = async (x, y, dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, modifiers: 4 }); await sleep(120); };
  const at = (sel, fy) => J(ev, `const e = document.querySelector('${sel}'); const r = e.getBoundingClientRect(), v = document.querySelector('.timeline').getBoundingClientRect(); return { x: Math.max(r.left, v.left) + 260, y: r.top + r.height * ${fy}, far: v.right - 60 }`);
  const baseScreen = () => J(ev, `const tl = document.querySelector('.timeline'), v = tl.getBoundingClientRect(); return { base: state.userBaseSec, cleared: state.baseCleared, x: Math.round(state.playhead * state.pxPerSecond - tl.scrollLeft), mid: Math.round(tl.clientWidth / 2), px: state.pxPerSecond }`);
  const cases = [
    ['bas d\'une piste vide', '.timeline-track[data-i="3"]', 0.75],
    ['bas d\'une région', '.timeline-track[data-i="0"] .clip', 0.8],
    ['règle', '.timeline-ruler', 0.8],
    ['ligne du groupe fermé', '.timeline-group-row[data-bus="g1"]', 0.5],
  ];
  for (const [name, sel, fy] of cases) {
    await ev(`setZoom(40, 0); document.querySelector('.timeline').scrollLeft = 400`); await sleep(150);
    const p = await at(sel, fy);
    await click(p.x, p.y);
    const b0 = await baseScreen();
    await M('mouseMoved', p.far, p.y); await sleep(100);
    for (let i = 0; i < 4; i++) await wheel(p.far, p.y, -100);
    await sleep(300);
    const b1 = await baseScreen();
    check(`${name} : base posée`, b0.base != null && !b0.cleared, JSON.stringify(b0));
    check(`${name} : molette ⌘ → la base au milieu, pas sous la souris`, b1.px > b0.px && Math.abs(b1.x - b1.mid) < 8, JSON.stringify([b0, b1]));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', text: 'e' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE' }); await sleep(250);
    const b2 = await baseScreen();
    check(`${name} : E → reste sur la base`, b2.px > b1.px && Math.abs(b2.x - b2.mid) < 8, JSON.stringify(b2));
  }
  // Le cas vécu : lecture, Espace (arrêt), clic ailleurs → le zoom va sur le nouveau clic, pas sur l'ancien point de départ
  await ev(`setZoom(40, 0); document.querySelector('.timeline').scrollLeft = 400`); await sleep(150);
  let q = await at('.timeline-track[data-i="3"]', 0.75);
  await click(q.x, q.y);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' }); await sleep(1200);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' }); await sleep(400);
  const st = await J(ev, `return { playing: state.playing, paused: !!state.paused }`);
  await click(q.x + 300, q.y);
  const nb = await baseScreen();
  await M('mouseMoved', q.far, q.y); await sleep(100);
  for (let i = 0; i < 4; i++) await wheel(q.far, q.y, -100);
  await sleep(300);
  const na = await J(ev, `const tl = document.querySelector('.timeline'); return { x: Math.round(state.playhead * state.pxPerSecond - tl.scrollLeft), mid: Math.round(tl.clientWidth / 2), ph: state.playhead }`);
  check('après lecture + Espace, nouveau clic : le zoom va sur le clic', !st.playing && Math.abs(na.x - na.mid) < 8 && Math.abs(na.ph - nb.base) < 0.01, JSON.stringify([st, nb, na]));
  // base retirée (clic en haut d'une piste) : la molette garde le point sous la souris
  await ev(`setZoom(40, 0); document.querySelector('.timeline').scrollLeft = 0`); await sleep(150);
  const p = await at('.timeline-track[data-i="3"]', 0.25);
  await click(p.x, p.y);
  const before = await J(ev, `const tl = document.querySelector('.timeline'), v = tl.getBoundingClientRect(); return (${p.far} - v.left + tl.scrollLeft) / state.pxPerSecond`);
  for (let i = 0; i < 4; i++) await wheel(p.far, p.y, -100);
  await sleep(300);
  const after = await J(ev, `const tl = document.querySelector('.timeline'), v = tl.getBoundingClientRect(); return { sec: (${p.far} - v.left + tl.scrollLeft) / state.pxPerSecond, cleared: state.baseCleared }`);
  check('sans base : le point sous la souris ne bouge pas', after.cleared && Math.abs(after.sec - before) < 0.3, JSON.stringify([before, after]));
};
