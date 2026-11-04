// Raccourcis de mix comme Logic : I = inspecteur, V = cacher / remontrer les fenêtres de plugins
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'rm1', name: 'RM', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['comp', 'eq'] }] }, { mic: false });
  const key = async (k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: 'Key' + k.toUpperCase(), text: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: 'Key' + k.toUpperCase() }); await sleep(200); };
  await ev(`document.activeElement && document.activeElement.blur()`);
  const before = await J(ev, `return inspectorOpen()`);
  await key('i');
  check('I : l\'inspecteur change d\'état', await J(ev, `return inspectorOpen()`) === !before);
  await key('i');
  check('I encore : il revient', await J(ev, `return inspectorOpen()`) === before);
  await ev(`openEffectPanel(0,'comp',document.body)`); await sleep(300); await ev(`openEffectPanel(0,'eq',document.body)`); await sleep(300);
  const vis = () => J(ev, `return [...document.querySelectorAll('.fx-panel.plug-win')].filter(w=>w.style.display!=='none').length`);
  const n0 = await vis();
  await ev(`document.activeElement && document.activeElement.blur()`); await key('v');
  check('V : les fenêtres de plugins se cachent', n0 >= 2 && (await vis()) === 0, String(n0));
  await key('v');
  check('V encore : elles reviennent', (await vis()) === n0);
};
