// Table de mixage comme Logic : M / S sur chaque tranche (pistes et bus), plusieurs tranches choisies (pistes + bus),
// faders liés en dB relatifs, et l'affichage des autres faders qui suit (retours de Ridwane 04/11 en mixant).
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const tr = (n, out) => ({ name: n, type: 'audio', color: '#A855F7', volume: 100, clips: [], output: out || 'master' });
  await boot(c, { id: 'mx1', name: 'MX', bpm: 120, sends: [], tracks: [tr('A'), tr('B'), tr('C')],
    buses: [{ id: 'b1', name: 'Bus 1', isGroup: true, isAux: true, output: 'master', volume: 100, effects: [] }, { id: 'b2', name: 'Bus 2', isGroup: true, isAux: true, output: 'master', volume: 50, effects: [] }] }, { mic: false });
  await ev(`state.mixerOpen || toggleMixer()`); await sleep(400);
  const at = async (sel) => JSON.parse(await J(ev, `const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'null'; e.scrollIntoView({block:'center',inline:'center'}); const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})`));
  const clickAt = async (p, mod = 0) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); await sleep(30); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); await sleep(150); };
  check('M et S sur chaque tranche (3 pistes + 2 bus)', await J(ev, `return document.querySelectorAll('.mixer-strips .strip .strip-s').length`) === 5);
  // un clic sur la tranche du Bus 1, ⌘ + clic sur le Bus 2 : les deux choisis, aucune piste
  await clickAt(await at('.mixer-strips .strip[data-kind="bus"][data-i="0"] .strip-name'));
  await clickAt(await at('.mixer-strips .strip[data-kind="bus"][data-i="1"] .strip-name'), 4);
  const ch = JSON.parse(await J(ev, `return JSON.stringify([...document.querySelectorAll('.mixer-strips .strip.is-chosen')].map(e=>e.dataset.kind+e.dataset.i))`));
  check('deux bus choisis, aucune piste', JSON.stringify(ch) === '["bus0","bus1"]', JSON.stringify(ch));
  // bouger le fader du Bus 1 de 100 à 50 : le Bus 2 suit (50 → 25), son fader affiché aussi
  await ev(`(()=>{ const f=document.querySelector('.mixer-strips .strip[data-kind="bus"][data-i="0"] .fader'); f.value=volToPos(50); f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(100);
  const v = JSON.parse(await J(ev, `return JSON.stringify({ b1: state.project.buses[0].volume, b2: state.project.buses[1].volume, tA: state.project.tracks[0].volume, f2: posToVol(+document.querySelector('.mixer-strips .strip[data-kind="bus"][data-i="1"] .fader').value) })`));
  check('faders liés : le Bus 2 descend du même écart', Math.abs(v.b2 - 25) <= 1 && Math.abs(v.f2 - v.b2) <= 1, JSON.stringify(v));
  check('les pistes non choisies ne bougent pas', v.tA === 100, JSON.stringify(v));
  // S d'un bus choisi : les deux bus en solo, les pistes hors bus ne s'entendent plus
  await clickAt(await at('.mixer-strips .strip[data-kind="bus"][data-i="0"] .strip-s'));
  check('S d\'un bus choisi : les 2 bus en solo', await J(ev, `return state.project.buses.every(b=>b.solo)`));
  await clickAt(await at('.mixer-strips .strip[data-kind="bus"][data-i="1"] .strip-s'));
  check('re-clic : plus de solo', await J(ev, `return state.project.buses.every(b=>!b.solo)`));
  // pistes : clic sur A, ⇧ + clic sur C, puis ⌘ + clic sur le Bus 2 → 3 pistes + 1 bus ; M sur B = les 3 pistes coupées
  await clickAt(await at('.mixer-strips .strip[data-kind="track"][data-i="0"] .strip-name'));
  await clickAt(await at('.mixer-strips .strip[data-kind="track"][data-i="2"] .strip-name'), 8);
  await clickAt(await at('.mixer-strips .strip[data-kind="bus"][data-i="1"] .strip-name'), 4);
  const ch2 = JSON.parse(await J(ev, `return JSON.stringify([...document.querySelectorAll('.mixer-strips .strip.is-chosen')].map(e=>e.dataset.kind+e.dataset.i))`));
  check('3 pistes + Bus 2 choisis', JSON.stringify(ch2) === '["track0","track1","track2","bus1"]', JSON.stringify(ch2));
  await clickAt(await at('.mixer-strips .strip[data-kind="track"][data-i="1"] .strip-m'));
  check('M d\'une tranche choisie : 3 pistes et le Bus 2 coupés', await J(ev, `return state.project.tracks.every(t=>t.muted) && state.project.buses[1].muted && !state.project.buses[0].muted`));
  check('les boutons M suivent (piste et bus)', await J(ev, `return [...document.querySelectorAll('.mixer-strips .strip .strip-m.active')].length === 4 && document.querySelectorAll('.track-item .t-mini.m-m.active').length === 3`));
  // fader de la piste A : les pistes B, C et le Bus 2 suivent
  await ev(`(()=>{ const f=document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="0"] .fader'); f.value=volToPos(50); f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(100);
  const v2 = JSON.parse(await J(ev, `return JSON.stringify({ t: state.project.tracks.map(t=>t.volume), b2: state.project.buses[1].volume, fC: posToVol(+document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="2"] .fader').value) })`));
  check('fader d\'une piste choisie : les autres pistes et le bus choisi suivent', v2.t.every(x => Math.abs(x - 50) <= 1) && Math.abs(v2.b2 - 12.5) <= 1.5 && Math.abs(v2.fC - 50) <= 1, JSON.stringify(v2));
  // ranger les bus en glissant le nom : Bus 2 avant Bus 1
  const n2 = await at('.mixer-strips .strip[data-kind="bus"][data-i="1"] .strip-name'), n1 = await at('.mixer-strips .strip[data-kind="bus"][data-i="0"] .strip-name');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: n2.x, y: n2.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: n2.x, y: n2.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: n2.x + (n1.x - 40 - n2.x) * k / 8, y: n2.y, buttons: 1 }); await sleep(20); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: n1.x - 40, y: n2.y, button: 'left', clickCount: 1 }); await sleep(200);
  check('glisser : Bus 2 passe devant Bus 1', await J(ev, `return state.project.buses.map(b=>b.name).join(',')`) === 'Bus 2,Bus 1');
  // clic droit sur le Bus 1 → Supprimer le bus : envois et sorties nettoyés
  await ev(`state.project.tracks[0].busSends={b1:40}; state.project.tracks[1].output='b1'; renderMixer(); bindMixerEvents()`); await sleep(100);
  const p1 = await at('.mixer-strips .strip[data-kind="bus"][data-i="1"] .strip-name');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p1.x, y: p1.y + 30, button: 'right', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p1.x, y: p1.y + 30, button: 'right', clickCount: 1 }); await sleep(200);
  const items = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent).join('|')`);
  check('clic droit sur un bus : Renommer, Éclater, Supprimer', /Renommer/.test(items) && /Éclater/.test(items) && /Supprimer le bus/.test(items), items);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent==='Supprimer le bus').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);
  const after = JSON.parse(await J(ev, `return JSON.stringify({ buses: state.project.buses.map(b=>b.name), out: state.project.tracks[1].output, sends: state.project.tracks[0].busSends })`));
  check('bus supprimé : la piste ressort au master, l\'envoi disparaît', after.buses.join() === 'Bus 2' && after.out === 'master' && !after.sends.b1, JSON.stringify(after));
};
