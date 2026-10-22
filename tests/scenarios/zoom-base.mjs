// Zoom E / Z et molette : le curseur de base (là où on a cliqué) se met pile au milieu de l'écran
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await instru(ev, 120, 0, 0); await sleep(300);
  const mid = `(()=>{ const tl=document.querySelector('.timeline'); return Math.round(BASE * state.pxPerSecond - tl.scrollLeft - tl.clientWidth / 2); })()`;
  await ev(`seekPlayhead(40)`); await sleep(100);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',bubbles:true}))`); await sleep(200);
  check('E : le curseur au milieu de l’écran', Math.abs(await ev(mid.replace('BASE', '40'))) <= 2, await ev(mid.replace('BASE', '40')) + ' px du milieu');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',bubbles:true}))`); await sleep(200);
  check('Z : toujours au milieu', Math.abs(await ev(mid.replace('BASE', '40'))) <= 2, await ev(mid.replace('BASE', '40')) + ' px');
  // Pendant la lecture : c'est la base (40 s) qui reste au milieu, pas le curseur qui défile
  await ev(`togglePlay()`); await sleep(1500);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',bubbles:true}))`); await sleep(200);
  check('pendant la lecture : la base au milieu', Math.abs(await ev(mid.replace('BASE', '40'))) <= 2, await ev(mid.replace('BASE', '40')) + ' px');
  await ev(`togglePlay()`); await sleep(300);
  // Molette avec ⌘, souris sur le côté : même chose
  const r = await ev(`(()=>{ const b=document.querySelector('.timeline').getBoundingClientRect(); return {x:b.left+60,y:b.top+120}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -100, modifiers: 4 }); await sleep(300);
  check('⌘ + molette (souris sur le côté) : la base au milieu', Math.abs(await ev(mid.replace('BASE', 'baseCursorSec()'))) <= 2, await ev(mid.replace('BASE', 'baseCursorSec()')) + ' px');
};
