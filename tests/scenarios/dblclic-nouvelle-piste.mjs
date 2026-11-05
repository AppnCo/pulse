// Comme Logic : double-clic dans le vide sous la dernière piste (liste ou timeline) = nouvelle piste tout en bas, du même genre que la piste choisie
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'dnp', name: 'DNP', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', volume: 100 }],
    tracks: [{ name: 'Kick', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Back', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }] }, { mic: false });
  await instru(ev, 2, 0, 0); await sleep(400);
  await ev(`selectTrack(2)`); await sleep(200);
  const dbl = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    for (const cc of [1, 2]) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: cc }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: cc }); }
    await sleep(350); };
  const below = (sel) => J(ev, `const items = [...document.querySelectorAll('${sel}')]; const last = items[items.length - 1].getBoundingClientRect(); return { x: last.left + 60, y: last.bottom + 40 }`);
  let p = await below('#tracksList .track-item');
  await dbl(p.x, p.y);
  let s = await J(ev, `const t = state.project.tracks; return { n: t.length, last: t[t.length - 1].name, out: t[t.length - 1].output || 'master', sel: state.selectedTrack }`);
  check('liste : double-clic sous la dernière piste = nouvelle piste tout en bas, hors du groupe', s.n === 4 && s.out === 'master' && s.sel === 3, JSON.stringify(s));
  p = await below('.timeline-track');
  await dbl(p.x + 200, p.y);
  s = await J(ev, `return state.project.tracks.length`);
  check('timeline : double-clic sous la dernière piste = encore une piste', s === 5, String(s));
  // double-clic SUR une piste : pas de nouvelle piste
  const on = await J(ev, `const r = document.querySelector('.timeline-track[data-i="0"]').getBoundingClientRect(); return { x: r.left + 200, y: r.top + r.height * 0.8 }`);
  await dbl(on.x, on.y);
  check('double-clic sur une piste : pas de piste en plus', await J(ev, `return state.project.tracks.length`) === 5);
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : la dernière piste ajoutée part', await J(ev, `return state.project.tracks.length`) === 4);
};
