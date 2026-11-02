// Pitch : écran plein — cadran glissé, touche cliquée, sauts, molette, double-clic = 0, ⌘Z
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot, send } = c;
  await boot(c, { id: 'pe1', name: 'PE', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['pitch'], effectParams: { pitch: { semi: 0, mix: 100 } } }] }, { mic: false });
  const fails = []; const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'OK   ' : 'RATÉ ') + msg); };
  const semi = () => J(ev, `return state.project.tracks[0].effectParams.pitch.semi`);
  await ev(`openEffectPanel(0, 'pitch', document.body)`); await sleep(300);
  ok(await ev(`!!document.querySelector('.pit-panel .pit-dial')`), 'écran ouvert avec son cadran');
  const d = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.pit-dial').getBoundingClientRect(); return {x:e.left+e.width/2,y:e.top+e.height/2}})())`));
  const m = (type, y) => send('Input.dispatchMouseEvent', { type, x: d.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await m('mousePressed', d.y); for (let i = 1; i <= 6; i++) await m('mouseMoved', d.y - i * 10); await m('mouseReleased', d.y - 60); await sleep(150);
  ok(await semi() === 5, 'cadran glissé vers le haut : +5 (' + await semi() + ')');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(200);
  ok(await semi() === 0, '⌘Z : retour à 0 en une fois');
  await ev(`openEffectPanel(0, 'pitch', document.body)`); await sleep(250);
  await ev(`document.querySelector('.pit-panel .pit-jump[data-v="-12"]').click()`); await sleep(100);
  ok(await semi() === -12, 'saut Octave −');
  const k = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.pit-key[data-n="19"]').getBoundingClientRect(); return {x:e.left+e.width/2,y:e.top+e.height*0.85}})())`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: k.x, y: k.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: k.x, y: k.y, button: 'left', clickCount: 1 }); await sleep(150);
  ok(await semi() === 7, 'touche sol cliquée : +7');
  await shot('/private/tmp/claude-501/qa/pitch-1.jpg');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: d.x, y: d.y, deltaX: 0, deltaY: -100 }); await sleep(150);
  ok(await semi() === 8, 'molette : +1');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: d.x, y: d.y, button: 'left', buttons: 1, clickCount: 2 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: d.x, y: d.y, button: 'left', clickCount: 2 }); await sleep(150);
  ok(await semi() === 0, 'double-clic : voix d\'origine');
  if (fails.length) throw new Error(fails.join(' ; '));
};
