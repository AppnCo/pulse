// ⌘W (Logic) : ferme la fenêtre de plugin de devant, une à la fois
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'cw', name: 'CW', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], effects: ['comp', 'eq'] }] }, { mic: false });
  await ev(`openEffectPanel(0, 'comp', document.body)`); await sleep(300); await ev(`openEffectPanel(0, 'eq', document.body)`); await sleep(300);
  const wins = () => J(ev, `return [...document.querySelectorAll('.fx-panel.plug-win')].map(w => w.dataset.fx).join()`);
  check('2 fenêtres ouvertes', (await wins()).split(',').length === 2, await wins());
  const cmdW = async () => { await ev(`document.activeElement && document.activeElement.blur()`); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, modifiers: 4 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, modifiers: 4 }); await sleep(250); };
  await cmdW();
  check('⌘W : la fenêtre de devant (EQ) se ferme, le compresseur reste', (await wins()) === 'comp', await wins());
  await cmdW();
  check('⌘W encore : plus rien', (await wins()) === '');
  await cmdW();
  check('⌘W sans plugin ouvert : la page reste là', await J(ev, `return !!document.querySelector('.timeline')`));
};
