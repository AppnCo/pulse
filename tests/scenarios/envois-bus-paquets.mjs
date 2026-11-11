// Envois comme Logic : Bus 1 à 32 directement, puis les paquets « 33 – 64 ▸ »… jusqu'à 256 ; un bus utilisé montre « → Retour N » ou son nom
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'ebp', name: 'EBP', bpm: 120, sends: [],
    buses: [{ id: 'b1', name: 'Bus 1', busNum: 1, isGroup: true, isAux: true, output: 'master', volume: 100, effects: [] }],
    tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const open = () => ev(`closeAllMenus(); openSendTargetMenu(document.body, 'track', state.project.tracks[0])`);
  await open(); await sleep(200);
  const packs = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].map(e => e.textContent)`);
  check('7 paquets : 33 – 64 … 225 – 256', packs.length === 7 && packs[0] === '33 – 64' && packs[6] === '225 – 256', JSON.stringify(packs));
  const top = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu > .ctx-item:not(.ctx-has-sub)')].map(e => e.textContent)`);
  check('Bus 1 à 32 directement, le Bus 1 utilisé marqué « → Retour 1 »', top.length === 32 && top[0] === 'Bus 1 → Retour 1' && top[1] === 'Bus 2' && top[31] === 'Bus 32', JSON.stringify(top.slice(0, 3)));
  check('le menu tient dans l\'écran', await J(ev, `const b = document.querySelector('.track-ctx-menu').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight`), await J(ev, `const m = document.querySelector('.track-ctx-menu'); const b = m.getBoundingClientRect(); return [b.top, b.bottom, innerHeight, m.style.cssText, document.querySelectorAll('.track-ctx-menu').length]`));
  // survol du paquet 33–64, clic (souris réelle) sur Bus 40
  const r = await J(ev, `const row = [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e => e.textContent === '33 – 64'); row.dispatchEvent(new MouseEvent('mouseenter')); 
    const it = [...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e => e.textContent === 'Bus 40'); if (!it) return null; it.scrollIntoView({ block: 'nearest' }); const b = it.getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2, n: document.querySelectorAll('.ctx-subpanel .ctx-item').length }`);
  check('sous-menu : 32 bus', r && r.n === 32, JSON.stringify(r));
  check('sous-menu visible à l\'écran (pas coupé par le menu qui défile)', await J(ev, `const it = [...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e => e.textContent === 'Bus 40'); const p = it.closest('.ctx-subpanel'); return p.parentElement === document.body && document.elementFromPoint(${r && r.x}, ${r && r.y}) === it`), await J(ev, `const e = document.elementFromPoint(${r && r.x}, ${r && r.y}); return e && (e.tagName + '.' + e.className + ' / ' + (e.textContent||'').slice(0,30))`));
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  const b40 = await J(ev, `const b = state.project.buses.find(x => x.busNum === 40); return b && { name: b.name, send: state.project.tracks[0].busSends && state.project.tracks[0].busSends[b.id] }`);
  check('Bus 40 créé et la voix y envoie', b40 && b40.name === 'Bus 40' && b40.send > 0, JSON.stringify(b40));
  check('menu fermé après le choix', await J(ev, `return !document.querySelector('.track-ctx-menu')`));
  // le bus déjà créé apparaît sous son nom dans son paquet
  await ev(`busById(state.project.buses.find(x => x.busNum === 40).id).name = 'Reverb Voix'; delete state.project.tracks[0].busSends[state.project.buses.find(x => x.busNum === 40).id]`);
  await open(); await sleep(200);
  const lab = await J(ev, `const row = [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e => e.textContent === '33 – 64'); row.dispatchEvent(new MouseEvent('mouseenter')); return [...document.querySelectorAll('.ctx-subpanel .ctx-item')].map(e => e.textContent).find(t => t.startsWith('Bus 40'))`);
  check('bus renommé : « Bus 40 → Reverb Voix »', lab === 'Bus 40 → Reverb Voix', String(lab));
  // déjà envoyé d'ici : grisé
  await ev(`state.project.tracks[0].busSends = { b1: 50 }`); await open(); await sleep(200);
  check('bus déjà envoyé d\'ici : grisé', await J(ev, `const e = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => e.textContent.startsWith('Bus 1 →')); return !!e && e.classList.contains('is-off')`));
};
