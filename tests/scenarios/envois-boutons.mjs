// Envois en boutons ronds : tourner = doser, double-clic = 0, ⌘Z annule
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check, shot } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  check('des boutons ronds à la place des curseurs', await ev(`document.querySelectorAll('#inspector .send-knob').length`) >= 2);
  const k = await ev(`(()=>{ const r=document.querySelector('#inspector .send-knob').getBoundingClientRect(); return {x:r.left+13,y:r.top+13}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: k.x, y: k.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: k.x, y: k.y - 5 * i, button: 'left' });
  await shot(process.env.TMPDIR + '/envois-boutons.jpg');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: k.x, y: k.y - 50, button: 'left', clickCount: 1 });
  await sleep(200);
  const v = await ev(`JSON.stringify(state.project.tracks[0].sends||{})`);
  check('tourner vers le haut dose l’envoi (≈30)', /:(2[5-9]|3[0-5])/.test(v), v);
  await ev(`undoAction()`); await sleep(200);
  check('⌘Z remet à zéro', await ev(`!Object.values(state.project.tracks[0].sends||{}).some(x=>x>0)`));
  await ev(`state.mixerOpen || toggleMixer && toggleMixer()`); await sleep(400);
  check('table de mix : boutons ronds aussi', await ev(`document.querySelectorAll('.mixer-strips .send-knob').length`) >= 2);
};
