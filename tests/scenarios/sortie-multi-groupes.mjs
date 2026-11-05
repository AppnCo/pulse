// Comme Logic : plusieurs groupes choisis, sortie (en bas de la tranche) vers un bus → tous y partent ; plusieurs pistes pareil
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const G = (id, name, out = 'master') => ({ id, name, isGroup: true, output: out, color: '#A855F7', volume: 100 });
  const T = (name, out) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [] });
  await boot(c, { id: 'smg', name: 'SMG', bpm: 120, sends: [],
    buses: [G('kb', 'Kick Bass'), G('pc', 'Perc'), G('vx', 'Vocal'), G('mb', 'Mix Bus 1')],
    tracks: [T('Kick', 'kb'), T('Bass', 'kb'), T('Shaker', 'pc'), T('Clap', 'pc'), T('Lead', 'vx'), T('Back', 'vx'), T('X1', 'mb'), T('X2', 'mb')] }, { mic: false });
  await sleep(300);
  const clickH = async (id, modifiers = 0) => { const p = await J(ev, `const n = document.querySelector('#tracksList .group-header[data-bus="${id}"] .group-name').getBoundingClientRect(); return { x: n.left + 6, y: n.top + n.height / 2 }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers }); await sleep(250); };
  await clickH('kb'); await clickH('pc', 8);
  check('Kick Bass + Perc choisis', await J(ev, `return [...state.mixBuses].sort().join()`) === 'kb,pc');
  const out = await J(ev, `const b = document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-output'); return b ? b.textContent : null`);
  check('la tranche du groupe a sa sortie en bas', !!out, String(out));
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-output').click()`); await sleep(200);
  const top = await J(ev, `return [...document.querySelectorAll('.out-menu > .ctx-item')].map(e => e.textContent.trim())`);
  check('menu de sortie comme Logic : actuelle cochée, Pas de sortie, Sortie ▸, Bus ▸', top[0] === 'Sortie stéréo' && top.includes('Pas de sortie') && top.includes('Sortie') && top.includes('Bus'), JSON.stringify(top));
  await ev(`document.querySelectorAll('.out-menu .ctx-has-sub').forEach(r => { if (r.textContent.trim() === 'Bus') r.dispatchEvent(new MouseEvent('mouseenter')); });`); await sleep(100);
  const ok = await J(ev, `const it = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => e.textContent.trim() === 'Mix Bus 1'); if (!it) return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e => e.textContent.trim()); it.click(); return true`);
  await sleep(300);
  check('menu de sortie : Mix Bus 1 proposé', ok === true, JSON.stringify(ok));
  check('les 2 groupes choisis partent vers Mix Bus 1, pas les autres', await J(ev, `return busById('kb').output === 'mb' && busById('pc').output === 'mb' && busById('vx').output === 'master'`));
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : un seul retour', await J(ev, `return busById('kb').output === 'master' && busById('pc').output === 'master'`));
  // plusieurs pistes : déjà le cas, on vérifie
  await ev(`selectTrack(4); state.selectedTracks = new Set([4, 5]); renderAll()`); await sleep(300);
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-output').click()`); await sleep(200);
  await ev(`document.querySelectorAll('.out-menu .ctx-has-sub').forEach(r => { if (r.textContent.trim() === 'Bus') r.dispatchEvent(new MouseEvent('mouseenter')); });`); await sleep(100);
  await J(ev, `const it = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => e.textContent.trim() === 'Perc'); it.click(); return 1`); await sleep(300);
  check('2 pistes choisies → toutes les deux vers Perc', await J(ev, `return state.project.tracks.filter(t => t.output === 'pc').length === 4`));
  // Pas de sortie : les 2 pistes choisies ne sortent plus, leurs envois restent ; le bus caché n'apparaît nulle part
  await ev(`state.project.tracks[4].busSends = { mb: 50 }; selectTrack(4); state.selectedTracks = new Set([4, 5]); renderAll()`); await sleep(300);
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-output').click()`); await sleep(200);
  await J(ev, `const it = [...document.querySelectorAll('.out-menu > .ctx-item')].find(e => e.textContent.trim() === 'Pas de sortie'); it.click(); return 1`); await sleep(300);
  const no = await J(ev, `const b = busById('no_out'); return { outs: state.project.tracks.slice(4, 6).map(t => t.output).join(), vol: b && b.volume, send: state.project.tracks[4].busSends.mb, label: document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-output').textContent, head: !!document.querySelector('.group-header[data-bus="no_out"]'), strip: !!document.querySelector('.mixer-strips .strip[data-kind="bus"][data-id="no_out"]') }`);
  check('Pas de sortie : les 2 pistes, volume zéro, envoi gardé, affiché sur le bouton', no.outs === 'no_out,no_out' && no.vol === 0 && no.send === 50 && no.label.includes('Pas de sortie') && !no.head, JSON.stringify(no));
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : elles ressortent vers Perc', await J(ev, `return state.project.tracks[4].output === 'pc' && state.project.tracks[5].output === 'pc'`));
};
