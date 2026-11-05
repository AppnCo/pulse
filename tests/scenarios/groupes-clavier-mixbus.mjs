// Groupes comme Logic : S / M au clavier sur le groupe choisi, ⇧ + clic = tous les groupes entre les deux,
// plusieurs groupes rangés d'un coup dans un « Mix Bus », et encore une fois au-dessus (plusieurs niveaux)
import { boot, J, mouse, key as keyF } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const G = (id, name) => ({ id, name, isGroup: true, output: 'master', color: '#A855F7', volume: 100, collapsed: true });
  const T = (name, out) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [] });
  await boot(c, { id: 'gcm', name: 'GCM', bpm: 120, sends: [],
    buses: [G('kb', 'Kick Bass'), G('pc', 'Perc'), G('gt', 'GTR'), G('vx', 'Vocal')],
    tracks: [T('Kick', 'kb'), T('Bass', 'kb'), T('Shaker', 'pc'), T('Clap', 'pc'), T('Guit', 'gt'), T('Piano', 'gt'), T('Lead', 'vx'), T('Back', 'vx')] }, { mic: false });
  await sleep(400);
  const m = mouse(send), key = keyF(send);
  const hdr = (id) => J(ev, `const h = document.querySelector('#tracksList .group-header[data-bus="${id}"]'); const n = h.querySelector('.group-name').getBoundingClientRect(); return { x: n.left + 6, y: n.top + n.height / 2 }`);
  const clickH = async (id, mods = {}) => { const p = await hdr(id); const modifiers = (mods.shift ? 8 : 0) | (mods.cmd ? 4 : 0);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers }); await sleep(250); };
  const blur = () => ev(`document.activeElement && document.activeElement.blur()`);
  // S / M sur un groupe
  await clickH('gt'); await blur();
  await key('s'); await sleep(200);
  check('S : le groupe choisi passe en solo', await J(ev, `return !!busById('gt').solo && state.project.tracks.every(t => !t.solo)`));
  await key('s'); await sleep(200);
  check('S encore : solo retiré', await J(ev, `return !busById('gt').solo`));
  await key('m'); await sleep(200);
  check('M : le groupe choisi est coupé', await J(ev, `return busById('gt').muted === true && state.project.tracks.every(t => !t.muted)`));
  check('M : se voit sur l\'en-tête', await J(ev, `return document.querySelector('#tracksList .group-header[data-bus="gt"]').classList.contains('is-muted')`));
  await key('m'); await sleep(200);
  check('M encore : remis', await J(ev, `return !busById('gt').muted`));
  // ⇧ + clic = plage
  await clickH('kb'); await clickH('vx', { shift: true });
  check('⇧ + clic : tous les groupes de Kick Bass à Vocal', await J(ev, `return [...state.mixBuses].sort().join()`) === 'gt,kb,pc,vx');
  await clickH('pc', { cmd: true });
  check('⌘ + clic : retire un seul groupe', await J(ev, `return [...state.mixBuses].sort().join()`) === 'gt,kb,vx');
  await blur(); await key('s'); await sleep(200);
  check('S sur plusieurs groupes choisis', await J(ev, `return ['kb','gt','vx'].every(i => busById(i).solo) && !busById('pc').solo`));
  await key('s'); await sleep(200);
  // les 4 dans un Mix Bus
  await clickH('kb'); await clickH('vx', { shift: true });
  const menuLabel = await J(ev, `const h = document.querySelector('#tracksList .group-header[data-bus="gt"]'); const r = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 5 }));
    const it = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(x => x.textContent.startsWith('Ranger les 4')); if (it) it.click(); return it ? it.textContent : null`);
  await sleep(400);
  check('clic droit : « Ranger les 4 groupes choisis… »', !!menuLabel, String(menuLabel));
  const mb = await J(ev, `const b = state.project.buses.find(x => x.name === 'Mix Bus 1'); return b && { id: b.id, out: b.output, kids: state.project.buses.filter(x => x.output === b.id).map(x => x.id).sort().join() }`);
  check('Mix Bus 1 créé, les 4 groupes dedans, sortie master', mb && mb.kids === 'gt,kb,pc,vx' && mb.out === 'master', JSON.stringify(mb));
  check('ordre des pistes intact', await J(ev, `return state.project.tracks.map(t => t.name).join()`) === 'Kick,Bass,Shaker,Clap,Guit,Piano,Lead,Back');
  // un niveau de plus : Mix Bus 1 dans Mix Bus 2
  await ev(`wrapGroups(['${mb.id}'])`); await sleep(300);
  const mb2 = await J(ev, `const b = state.project.buses.find(x => x.name === 'Mix Bus 2'); return b && state.project.buses.find(x => x.name === 'Mix Bus 1').output === b.id && groupChain(busById('kb')).length`);
  check('Mix Bus 1 dans Mix Bus 2 (3 niveaux)', mb2 === 3, String(mb2));
  await ev(`undoAction()`); await sleep(300); await ev(`undoAction()`); await sleep(300);
  check('⌘Z ×2 : retour aux 4 groupes séparés', await J(ev, `return !state.project.buses.some(x => /^Mix Bus/.test(x.name)) && ['kb','pc','gt','vx'].every(i => busById(i).output === 'master')`));
};
