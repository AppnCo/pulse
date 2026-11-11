// Envois : au survol ⏻ (couper / rallumer en gardant le niveau), ⇅ (changer de bus), × (retirer), comme les plugins
import { boot, J, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c; const m = mouse(send);
  await boot(c, { id: 'esv', name: 'E', bpm: 120, sends: [],
    buses: [{ id: 'b1', name: 'Bus 1', busNum: 1, isGroup: true, isAux: true, output: 'master', volume: 100, effects: [] }, { id: 'b2', name: 'Bus 2', busNum: 2, isGroup: true, isAux: true, output: 'master', volume: 100, effects: [] }],
    tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], busSends: { b1: 37 } }] }, { mic: false });
  const row = `document.querySelector('#inspector .insp-strip[data-kind="track"] .strip-send-row[data-bsend]')`;
  const p = await J(ev, `const r = ${row}; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(200);
  const vis = await J(ev, `const r = ${row}; return ['.sb-pow', '.sb-swap', '.sb-del'].map(s => getComputedStyle(r.querySelector(s)).display)`);
  check('survol : ⏻ ⇅ × visibles', vis.every(d => d !== 'none'), JSON.stringify(vis));
  await ev(`${row}.querySelector('.sb-pow').click()`); await sleep(300);
  let t = await J(ev, `const t = state.project.tracks[0]; return { s: t.busSends, m: t.sendMute }`);
  check('⏻ : envoi coupé (0), niveau 37 gardé', t.s.b1 === 0 && t.m['busSend:b1'] === 37, JSON.stringify(t));
  await ev(`${row}.querySelector('.sb-pow').click()`); await sleep(300);
  t = await J(ev, `const t = state.project.tracks[0]; return { s: t.busSends, m: t.sendMute || null }`);
  check('⏻ à nouveau : rallumé à 37', t.s.b1 === 37 && !t.m, JSON.stringify(t));
  // ⇅ : choisir Bus 2 dans le menu → l'envoi passe sur Bus 2 avec le même niveau
  await ev(`${row}.querySelector('.sb-swap').click()`); await sleep(300);
  await ev(`const it = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => /^Bus 2/.test(e.textContent.trim())); it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(400);
  t = await J(ev, `return state.project.tracks[0].busSends`);
  check('⇅ : envoi passé sur Bus 2 au même niveau, Bus 1 retiré', t.b2 === 37 && t.b1 === undefined, JSON.stringify(t));
  await ev(`${row}.querySelector('.sb-del').click()`); await sleep(300);
  t = await J(ev, `return state.project.tracks[0].busSends`);
  check('× : envoi retiré', !t.b2, JSON.stringify(t));
};
