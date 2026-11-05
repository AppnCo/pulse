// Comme Logic : U / ⌘U calent la boucle sur la plage choisie (sinon sur les régions choisies)
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'bpu', name: 'BPU', bpm: 120, sends: [], tracks: [{ name: 'A', type: 'audio', color: '#3B82F6', clips: [] }] }, { mic: false });
  await instru(ev, 4, 0, 1); await sleep(400);
  const key = async (mods) => { await ev(`document.activeElement && document.activeElement.blur()`); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85, modifiers: mods, text: mods ? undefined : 'u' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85, modifiers: mods }); await sleep(250); };
  await ev(`state.loop = null; state.selectedClip = null; state.selectedClips.clear(); state.selection = { start: 2, end: 6, tracks: [0, 0] }`);
  await key(0);
  check('U avec une plage : boucle de 2 à 6 s', await J(ev, `return state.loop && state.loop.start === 2 && state.loop.end === 6 && state.looping`), JSON.stringify(await J(ev, `return state.loop`)));
  await ev(`state.loop = null; state.selection = { start: 3, end: 4.5, tracks: [0, 0] }`);
  await key(4);
  check('⌘U (Logic) avec une plage : boucle de 3 à 4,5 s', await J(ev, `return state.loop && state.loop.start === 3 && state.loop.end === 4.5`), JSON.stringify(await J(ev, `return state.loop`)));
  await ev(`state.loop = null; state.selection = null; state.selectedClip = { trackIdx: 0, clipIdx: 0 }`);
  await key(0);
  check('U sans plage, région choisie : boucle sur la région (1 à 5 s)', await J(ev, `return state.loop && Math.abs(state.loop.start - 1) < 0.01 && Math.abs(state.loop.end - 5) < 0.01`), JSON.stringify(await J(ev, `return state.loop`)));
};
