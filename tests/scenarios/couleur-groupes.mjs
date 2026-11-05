// ⌥C (Logic) : la couleur s'applique à ce qu'on a choisi — régions, pistes, ou groupes (un ou plusieurs)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const G = (id, name) => ({ id, name, isGroup: true, output: 'master', color: '#A855F7', volume: 100 });
  await boot(c, { id: 'cg', name: 'CG', bpm: 120, sends: [], buses: [G('kb', 'Kick Bass'), G('pc', 'Perc'), G('vx', 'Vocal')],
    tracks: [['Kick', 'kb'], ['Bass', 'kb'], ['Shaker', 'pc'], ['Clap', 'pc'], ['Lead', 'vx'], ['Back', 'vx']].map(([n, o]) => ({ name: n, type: 'audio', color: '#3B82F6', output: o, clips: [] })) }, { mic: false });
  const clickH = async (id, modifiers = 0) => { const p = await J(ev, `const n = document.querySelector('#tracksList .group-header[data-bus="${id}"] .group-name').getBoundingClientRect(); return { x: n.left + 6, y: n.top + n.height / 2 }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers }); await sleep(250); };
  const altC = async () => { await ev(`document.activeElement && document.activeElement.blur()`); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ç', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 1 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ç', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 1 }); await sleep(250); };
  await clickH('kb'); await clickH('pc', 8);
  await altC();
  const title = await J(ev, `const t = document.querySelector('.color-panel .color-panel-title'); return t && t.textContent`);
  check('⌥C avec 2 groupes choisis : « Couleur de 2 groupes »', title === 'Couleur de 2 groupes', String(title));
  await ev(`document.querySelectorAll('.color-panel .ctx-swatch')[3].click()`); await sleep(200);
  const col = await J(ev, `const sw = document.querySelectorAll('.color-panel .ctx-swatch')[3].dataset.c; return { sw, kb: busById('kb').color, pc: busById('pc').color, vx: busById('vx').color, kick: state.project.tracks[0].color }`);
  check('les 2 groupes prennent la couleur, pas Vocal ni les pistes', col.kb === col.sw && col.pc === col.sw && col.vx === '#A855F7' && col.kick === '#3B82F6', JSON.stringify(col));
  await ev(`document.querySelectorAll('.color-panel').forEach(p => p.remove()); selectTrack(4); state.selectedTracks = new Set([4, 5]); renderAll()`); await sleep(300);
  await altC();
  check('pistes choisies : « Couleur de 2 pistes » (comme avant)', await J(ev, `return document.querySelector('.color-panel .color-panel-title').textContent`) === 'Couleur de 2 pistes');
};
