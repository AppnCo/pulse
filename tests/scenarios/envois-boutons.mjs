// Envois en boutons ronds : tourner = doser, double-clic = 0, ⌘Z annule
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check, shot } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  check('tranche de gauche : envois en liste (une ligne chacun), du haut vers le bas', await ev(`(()=>{ const r=[...document.querySelectorAll('#inspector .send-bar-row')].map(e=>e.getBoundingClientRect()); return r.length>=2 && r[1].top>r[0].bottom-1 && Math.abs(r[1].left-r[0].left)<2; })()`));
  const k = await ev(`(()=>{ const r=document.querySelector('#inspector .send-bar-row').getBoundingClientRect(); return {x:r.left+4,y:r.top+11,w:r.width}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: k.x, y: k.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: k.x + k.w * 0.03 * i, y: k.y, button: 'left' });
  await shot(process.env.TMPDIR + '/envois-boutons.jpg');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: k.x + k.w * 0.3, y: k.y, button: 'left', clickCount: 1 });
  await sleep(200);
  const v = await ev(`JSON.stringify(state.project.tracks[0].sends||{})`);
  check('tourner vers le haut dose l’envoi (≈30)', /:(2[5-9]|3[0-5])/.test(v), v);
  await ev(`undoAction()`); await sleep(200);
  check('⌘Z remet à zéro', await ev(`!Object.values(state.project.tracks[0].sends||{}).some(x=>x>0)`));
  await ev(`state.mixerOpen || toggleMixer && toggleMixer()`); await sleep(400);
  check('table de mix : boutons ronds aussi', await ev(`document.querySelectorAll('.mixer-strips .send-knob').length`) >= 2);
};
