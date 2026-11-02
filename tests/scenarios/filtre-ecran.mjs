// Filtre : écran plein — poignées glissées, zone déplacée, sons tout faits, pente, double-clic = retirer, ⌘Z
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot, send } = c;
  await boot(c, { id: 'fe1', name: 'FE', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['filter'], effectParams: { filter: { hpf: 80, lpf: 20000, slope: 12 } } }] }, { mic: false });
  const fails = []; const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'OK   ' : 'RATÉ ') + msg); };
  const FP = () => J(ev, `return state.project.tracks[0].effectParams.filter`);
  await ev(`openEffectPanel(0, 'filter', document.body)`); await sleep(300);
  ok(await ev(`!!document.querySelector('.flt-panel .flt-curve')`), 'écran ouvert avec sa courbe');
  await shot('/private/tmp/claude-501/qa/filtre-1.jpg');
  const pt = async (sel) => JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:e.left+e.width/2,y:e.top+e.height/2}})())`));
  const drag = async (a, dx) => { const m = (type, x) => send('Input.dispatchMouseEvent', { type, x, y: a.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await m('mousePressed', a.x); for (let i = 1; i <= 10; i++) await m('mouseMoved', a.x + dx * i / 10); await m('mouseReleased', a.x + dx); await sleep(150); };
  await drag(await pt('.flt-h[data-k="hpf"] circle'), 120);
  const a = await FP(); ok(a.hpf > 150 && a.hpf <= 1000, 'coupe-bas glissé vers la droite (' + a.hpf + ' Hz)');
  await drag(await pt('.flt-h[data-k="lpf"] circle'), -200);
  const b = await FP(); ok(b.lpf < 20000 && b.lpf >= 1000, 'coupe-haut glissé vers la gauche (' + b.lpf + ' Hz)');
  const z = await pt('.flt-cut'); // zone : entre les deux poignées
  const mid = JSON.parse(await ev(`JSON.stringify((()=>{const hs=[...document.querySelectorAll('.flt-h circle:nth-child(2)')].map(e=>e.getBoundingClientRect()); return {x:(hs[0].left+hs[1].left)/2, y:hs[0].top+60}})())`));
  await drag(mid, 60);
  const c2 = await FP(); ok(c2.hpf > b.hpf && c2.lpf > b.lpf, 'zone déplacée : les deux montent (' + c2.hpf + ' / ' + c2.lpf + ')');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(200);
  const d = await FP(); ok(d.hpf === b.hpf && d.lpf === b.lpf, '⌘Z annule le déplacement de la zone d\'un coup');
  await ev(`openEffectPanel(0, 'filter', document.body)`); await sleep(250);
  await ev(`document.querySelector('.flt-panel .flt-look[data-i="1"]').click()`); await sleep(100);
  const e = await FP(); ok(e.hpf === 500 && e.lpf === 3000 && e.slope === 24, 'son tout fait Téléphone');
  ok(await ev(`document.querySelector('.flt-panel .flt-look[data-i="1"]').classList.contains('on')`), 'Téléphone marqué choisi');
  await shot('/private/tmp/claude-501/qa/filtre-2.jpg');
  const h = await pt('.flt-h[data-k="hpf"] circle');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x, y: h.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', buttons: 1, clickCount: 2 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x, y: h.y, button: 'left', clickCount: 2 }); await sleep(150);
  ok((await FP()).hpf === 20, 'double-clic : coupe-bas retiré');
  if (fails.length) throw new Error(fails.join(' ; '));
};
