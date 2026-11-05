// ⌥⌘N (Logic) = menu « nouvelle piste » sans quitter le projet ; ⌘⌫ = supprimer les pistes choisies
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'rpi', name: 'RPI', bpm: 120, sends: [], tracks: ['A', 'B', 'C'].map(n => ({ name: n, type: 'audio', color: '#3B82F6', clips: [] })) }, { mic: false });
  const key = async (k, code, vk, mods) => { await ev(`document.activeElement && document.activeElement.blur()`); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await sleep(300); };
  const url0 = await J(ev, `return location.pathname`);
  await key('˜', 'KeyN', 78, 5);
  check('⌥⌘N : on reste dans le projet', await J(ev, `return location.pathname`) === url0);
  check('⌥⌘N : le menu d\'ajout de piste s\'ouvre', await J(ev, `return !!document.querySelector('.track-ctx-menu, .add-track-menu, .add-menu')`));
  await ev(`closeAllMenus && closeAllMenus(); document.querySelectorAll('.track-ctx-menu, .add-track-menu, .add-menu').forEach(m => m.remove()); selectTrack(1); state.selectedTracks = new Set([1, 2]); renderAll()`); await sleep(300);
  await key('Backspace', 'Backspace', 8, 4);
  await sleep(500);
  const n = await J(ev, `return state.project.tracks.filter(t => !isPendDel(t)).map(t => t.name).join()`);
  check('⌘⌫ : les 2 pistes choisies sont supprimées', n === 'A', n);
};
