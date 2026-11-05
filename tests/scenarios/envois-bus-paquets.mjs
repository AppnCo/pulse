// Envois comme Logic : tous les bus jusqu'à 256, rangés par paquets de 32 dans des sous-menus ; un numéro libre crée le bus
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'ebp', name: 'EBP', bpm: 120, sends: [],
    buses: [{ id: 'b1', name: 'Bus 1', busNum: 1, isGroup: true, isAux: true, output: 'master', volume: 100, effects: [] }],
    tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const open = () => ev(`closeAllMenus(); openSendTargetMenu(document.body, 'track', state.project.tracks[0])`);
  await open(); await sleep(200);
  const packs = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].map(e => e.textContent)`);
  check('8 paquets : Bus 1–32 … Bus 225–256', packs.length === 8 && packs[0] === 'Bus 1–32' && packs[7] === 'Bus 225–256', JSON.stringify(packs));
  check('raccourci : premier bus libre (Bus 2)', await J(ev, `return [...document.querySelectorAll('.track-ctx-menu > .ctx-item')].some(e => e.textContent.startsWith('Bus 2') && e.textContent.includes('nouveau'))`));
  // survol du paquet 33–64, clic (souris réelle) sur Bus 40
  const r = await J(ev, `const row = [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e => e.textContent === 'Bus 33–64'); row.dispatchEvent(new MouseEvent('mouseenter')); 
    const it = [...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e => e.textContent === 'Bus 40'); if (!it) return null; it.scrollIntoView({ block: 'nearest' }); const b = it.getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2, n: document.querySelectorAll('.ctx-subpanel .ctx-item').length }`);
  check('sous-menu : 32 bus', r && r.n === 32, JSON.stringify(r));
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  const b40 = await J(ev, `const b = state.project.buses.find(x => x.busNum === 40); return b && { name: b.name, send: state.project.tracks[0].busSends && state.project.tracks[0].busSends[b.id] }`);
  check('Bus 40 créé et la voix y envoie', b40 && b40.name === 'Bus 40' && b40.send > 0, JSON.stringify(b40));
  check('menu fermé après le choix', await J(ev, `return !document.querySelector('.track-ctx-menu')`));
  // le bus déjà créé apparaît sous son nom dans son paquet
  await ev(`busById(state.project.buses.find(x => x.busNum === 40).id).name = 'Reverb Voix'; delete state.project.tracks[0].busSends[state.project.buses.find(x => x.busNum === 40).id]`);
  await open(); await sleep(200);
  const lab = await J(ev, `const row = [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e => e.textContent === 'Bus 33–64'); row.dispatchEvent(new MouseEvent('mouseenter')); return [...document.querySelectorAll('.ctx-subpanel .ctx-item')].map(e => e.textContent).find(t => t.startsWith('Bus 40'))`);
  check('bus nommé : « Bus 40 · Reverb Voix »', lab === 'Bus 40 · Reverb Voix', String(lab));
};
