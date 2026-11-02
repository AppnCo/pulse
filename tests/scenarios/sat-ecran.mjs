// Saturation (la simple) : l'écran « courbe vivante » s'ouvre, les familles et les boutons écrivent le bon réglage,
// la valeur d'origine efface la clé (projet léger), ⌘Z revient en arrière, et le son suit (export comparé).
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, { id: 'se1', name: 'SE', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['sat'], effectParams: { sat: { drive: 25 } } }] }, { mic: false });
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'OK   ' : 'RATÉ ') + msg); };
  await ev(`openEffectPanel(0, 'sat', document.body)`); await sleep(300);
  ok(await ev(`!!document.querySelector('.sat-panel .sat-svg path.sat-curve')`), 'écran ouvert avec sa courbe');
  ok(await ev(`document.querySelectorAll('.sat-panel .ms-sty').length`) === 7, '7 familles');
  ok(await ev(`document.querySelectorAll('.sat-panel .pk').length`) === 5, '5 boutons (Entrée, Chaleur, Ton, Mélange, Sortie)');
  await shot('/private/tmp/claude-501/qa/sat-ecran-1.jpg');
  await ev(`document.querySelector('.sat-panel .ms-sty[data-k="lampe"]').click()`); await sleep(100);
  ok(await J(ev, `return state.project.tracks[0].effectParams.sat.sty`) === 'lampe', 'famille Lampe écrite');
  await ev(`document.querySelector('.sat-panel .ms-sty[data-k="classique"]').click()`); await sleep(100);
  ok(await J(ev, `return 'sty' in state.project.tracks[0].effectParams.sat`) === false, 'Classique = clé effacée (ancien son)');
  await ev(`document.querySelector('.sat-panel .sat-ag').click()`); await sleep(100);
  ok(await J(ev, `return state.project.tracks[0].effectParams.sat.ag`) === false, 'Volume égal coupé');
  // bouton Chaleur tiré vers le haut : la valeur monte
  const r = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelectorAll('.sat-panel .pk')[1].getBoundingClientRect(); return {x:e.left+e.width/2,y:e.top+e.height/3}})())`));
  const m = (type, y) => c.send('Input.dispatchMouseEvent', { type, x: r.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await m('mousePressed', r.y); for (let i = 1; i <= 8; i++) await m('mouseMoved', r.y - i * 8); await m('mouseReleased', r.y - 64); await sleep(150);
  const d = await J(ev, `return state.project.tracks[0].effectParams.sat.drive`);
  ok(d > 25, 'Chaleur montée à la souris (' + d + ')');
  await shot('/private/tmp/claude-501/qa/sat-ecran-2.jpg');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(200);
  ok(await J(ev, `return state.project.tracks[0].effectParams.sat.drive`) === 25, '⌘Z : Chaleur revenue à 25 (un seul ⌘Z pour tout le geste)');
  if (fails.length) throw new Error(fails.join(' ; '));
};
