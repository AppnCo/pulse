// Groupes choisis à la souris (clic, ⌘ + clic) sur leurs en-têtes dans la liste des pistes, puis VRAI clic droit (bouton droit
// enfoncé / relâché, pas un événement simulé) → « Ranger les 3 groupes choisis dans un nouveau grand groupe » → un Mix Bus les reçoit
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const G = (id, name) => ({ id, name, isGroup: true, output: 'master', color: '#A855F7', volume: 100 });
  const T = (name, out) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [] });
  await boot(c, { id: 'gvc', name: 'GVC', bpm: 120, sends: [],
    buses: [G('vx', 'Vocal'), G('gt', 'Gtr'), G('pc', 'Perc')],
    tracks: [T('Lead', 'vx'), T('Back', 'vx'), T('Guit', 'gt'), T('Piano', 'gt'), T('Shaker', 'pc'), T('Clap', 'pc'), T('Instru', 'master')] }, { mic: false });
  await sleep(400);
  const at = (id, sel = '.group-name') => J(ev, `const h = document.querySelector('#tracksList .group-header[data-bus="${id}"]'); const n = (h.querySelector('${sel}') || h).getBoundingClientRect(); return { x: n.left + 6, y: n.top + n.height / 2 }`);
  const click = async (id, mods = 0, button = 'left') => { const p = await at(id);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons: button === 'left' ? 1 : 2, clickCount: 1, modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1, modifiers: mods }); await sleep(300); };
  await click('vx'); await click('gt', 4); await click('pc', 4);
  check('3 groupes choisis', await J(ev, `return [...state.mixBuses].sort().join()`) === 'gt,pc,vx', await J(ev, `return [...state.mixBuses].join()`));
  await click('pc', 0, 'right');
  const labels = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(x => x.textContent)`);
  check('menu : « Ranger les 3 groupes choisis… »', labels.some(l => l.startsWith('Ranger les 3')), JSON.stringify(labels));
  const p = await J(ev, `const it = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(x => x.textContent.startsWith('Ranger les 3')); if (!it) return null; const r = it.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }`);
  if (p) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400); }
  const mb = await J(ev, `const b = state.project.buses.find(x => /^Bus [0-9]/.test(x.name)); return b && state.project.buses.filter(x => x.output === b.id).map(x => x.id).sort().join()`);
  check('les 3 groupes partent dans le Mix Bus', mb === 'gt,pc,vx', String(mb));
};
