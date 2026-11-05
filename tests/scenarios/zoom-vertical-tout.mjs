// Comme Logic / Pro Tools : le zoom vertical (⌥ + molette sur la timeline) agrandit TOUT — pistes, groupes (ouverts ou fermés),
// dossiers, réglés à la main ou pas — et la liste de gauche reste alignée ligne à ligne avec la timeline
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const G = (id, name, extra = {}) => ({ id, name, isGroup: true, output: 'master', color: '#A855F7', volume: 100, ...extra });
  const T = (name, out, extra = {}) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [], ...extra });
  await boot(c, { id: 'zvt', name: 'ZVT', bpm: 120, sends: [],
    buses: [G('kb', 'Kick Bass', { collapsed: true }), G('pc', 'Perc', { collapsed: true, height: 60 }), G('vx', 'Vocal')],
    folders: [{ id: 'f1', kind: 'folder', name: 'Dossier', color: '#22C55E' }],
    tracks: [T('Kick', 'kb'), T('Bass', 'kb'), T('Shaker', 'pc'), T('Clap', 'pc'), T('Lead', 'vx'), T('Back', 'vx'), T('Voix', 'master', { folder: 'f1' }), T('Choeur', 'master', { folder: 'f1' })] }, { mic: false });
  await ev(`setTrackHeight(72)`); await sleep(300);
  const H = () => J(ev, `const h = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().height) : null; };
    return { track: h('.track-item[data-i="4"]'), kb: h('#tracksList .group-header[data-bus="kb"]'), pc: h('#tracksList .group-header[data-bus="pc"]'), vx: h('#tracksList .group-header[data-bus="vx"]'), f1: h('#tracksList .group-header[data-bus="f1"]'),
      kbRow: h('.timeline-group-row[data-bus="kb"]') }`);
  const a = await H();
  check('zoom normal : groupes à 36 px (comme avant), Perc à sa hauteur', a.kb === 36 && a.vx === 36 && a.pc === 60 && a.track === 72, JSON.stringify(a));
  // ⌥ + molette sur la timeline (vide d'une piste) : agrandir
  const p = await J(ev, `const r = document.querySelector('.timeline-track[data-i="4"]').getBoundingClientRect(); return { x: r.left + 300, y: r.top + r.height / 2 }`);
  for (let k = 0; k < 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: -60, modifiers: 1 }); await sleep(40); }
  await sleep(300);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft' }); await sleep(200);
  const b = await H();
  const k = b.track / a.track;
  check('⌥ + molette sur la timeline : les pistes grandissent', k > 1.3, JSON.stringify(b));
  check('… les groupes (fermés comme ouverts) et le dossier grandissent autant', [b.kb / a.kb, b.vx / a.vx, b.f1 / a.f1].every(x => Math.abs(x - k) < 0.12), JSON.stringify([a, b]));
  check('… Perc (réglé à la main) suit aussi', Math.abs(b.pc / a.pc - k) < 0.12, JSON.stringify([a.pc, b.pc]));
  check('la ligne du groupe dans la timeline = la hauteur de son en-tête', b.kbRow === b.kb, JSON.stringify(b));
  // alignement : chaque en-tête de groupe à la même hauteur que sa ligne de timeline, chaque piste aussi
  const al = await J(ev, `const out = []; document.querySelectorAll('#tracksList .group-header[data-bus]').forEach(h => { const r = document.querySelector('.timeline-group-row[data-bus="' + h.dataset.bus + '"]'); if (r && !r.classList.contains('is-group-collapsed') && getComputedStyle(h).display !== 'none') out.push(Math.round(h.getBoundingClientRect().top - r.getBoundingClientRect().top)); });
    document.querySelectorAll('.track-item[data-i]').forEach(t => { const r = document.querySelector('.timeline-track[data-i="' + t.dataset.i + '"]'); if (r && getComputedStyle(t).display !== 'none') out.push(Math.round(t.getBoundingClientRect().top - r.getBoundingClientRect().top)); }); return out`);
  check('liste et timeline alignées ligne à ligne', al.length > 4 && al.every(d => Math.abs(d) <= 1), JSON.stringify(al));
  // ⌥ + tirer le bord d'une piste : tout le monde à la même hauteur, les groupes suivent (Perc oublie sa hauteur)
  await ev(`(() => { const t = state.project.tracks; })()`);
  const e = await J(ev, `const h = document.querySelector('.track-item[data-i="4"] .track-resize, .track-resize[data-i="4"]'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
  if (e) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: e.x, y: e.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: e.x, y: e.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: e.x, y: e.y - 30, button: 'left', buttons: 1, modifiers: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: e.x, y: e.y - 30, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 }); await sleep(300);
    const d = await H();
    check('⌥ + tirer une piste : toutes pareilles, groupes à la moitié, Perc compris', d.kb === d.pc && d.pc === d.vx && Math.abs(d.kb - Math.round(d.track / 2)) <= 1, JSON.stringify(d));
  } else check('poignée de bord de piste trouvée', false);
  // ⌘↓ / ⌘↑ (Logic) : tout grandit / rétrécit
  const before = await H();
  await ev(`document.activeElement && document.activeElement.blur()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 4 }); await sleep(250);
  const after = await H();
  check('⌘↓ : pistes et groupes grandissent ensemble', after.track > before.track && after.kb > before.kb && after.pc > before.pc, JSON.stringify([before, after]));
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, modifiers: 4 }); await sleep(250);
  const back = await H();
  check('⌘↑ : ils reviennent', Math.abs(back.track - before.track) <= 1 && Math.abs(back.kb - before.kb) <= 1, JSON.stringify([before, back]));
};
