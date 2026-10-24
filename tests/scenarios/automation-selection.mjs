// Plusieurs points d'automation : Maj + glisser = rectangle, glisser l'un déplace tous les choisis, Suppr les efface (⌘Z les rend)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [], buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [], autoParam: 'pan',
    automation: { pan: { points: [{ t: 5, v: 0.5 }, { t: 6, v: 0.8 }, { t: 7, v: 0.8 }, { t: 8, v: 0.5 }] } } }] });
  await ev(`toggleAutomationMode()`); await sleep(300);
  const g = await ev(`(()=>{ const r=document.querySelector('.timeline-track .vol-curve').getBoundingClientRect(); return {l:r.left,t:r.top,h:r.height,px:state.pxPerSecond}; })()`);
  const X = (t) => g.l + t * g.px, Y = (v) => g.t + 7 + (1 - v) * (g.h - 14);
  const M = (type, x, y, mod = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mod });
  // rectangle autour des points à 6 s et 7 s (loin de la pastille, en haut à gauche)
  await M('mousePressed', X(5.6), g.t + 2, 8); await M('mouseMoved', X(6.5), Y(0.6), 8); await M('mouseMoved', X(7.4), Y(0.6), 8); await M('mouseReleased', X(7.4), Y(0.6), 8); await sleep(150);
  check('rectangle : 2 points choisis', await ev(`document.querySelectorAll('.vol-pt.is-sel').length`) === 2);
  // glisser le point à 2 s vers le bas : les deux descendent
  await M('mousePressed', X(6), Y(0.8)); await M('mouseMoved', X(6), Y(0.6)); await M('mouseMoved', X(6), Y(0.4)); await M('mouseReleased', X(6), Y(0.4)); await sleep(150);
  const pts = await ev(`JSON.stringify(state.project.tracks[0].automation.pan.points.map(p=>[p.t,p.v]))`);
  check('les points choisis bougent ensemble', /\[6,0\.[34]\d*\],\[7,0\.[34]\d*\]/.test(pts), pts);
  // Suppr
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await sleep(150);
  check('Suppr : les 2 points choisis effacés', await ev(`state.project.tracks[0].automation.pan.points.length`) === 2);
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : ils reviennent', await ev(`state.project.tracks[0].automation.pan.points.length`) === 4);
};
