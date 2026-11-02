// Doubleur, Slapback, Largeur : écran scène — styles, premier bouton, ⌘Z
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot, send } = c;
  await boot(c, { id: 'st1', name: 'ST', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['doubler', 'slapback', 'width'], effectParams: {} }] }, { mic: false });
  const fails = []; const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'OK   ' : 'RATÉ ') + msg); };
  for (const [fx, key] of [['doubler', 'width'], ['slapback', 'time'], ['width', 'width']]) {
    await ev(`openEffectPanel(0, '${fx}', document.body)`); await sleep(300);
    ok(await ev(`!!document.querySelector('.st-panel .st-svg circle')`), `${fx} : écran ouvert`);
    await ev(`document.querySelector('.st-panel .st-look[data-i="1"]').click()`); await sleep(100);
    ok(await ev(`document.querySelector('.st-panel .st-look[data-i="1"]').classList.contains('on')`), `${fx} : style appliqué et marqué`);
    const v0 = await J(ev, `return state.project.tracks[0].effectParams.${fx}.${key}`);
    const k = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.st-panel .pk.big').getBoundingClientRect(); return {x:e.left+e.width/2,y:e.top+e.height/3}})())`));
    const m = (type, y) => send('Input.dispatchMouseEvent', { type, x: k.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await m('mousePressed', k.y); for (let i = 1; i <= 6; i++) await m('mouseMoved', k.y - i * 6); await m('mouseReleased', k.y - 36); await sleep(150);
    const v1 = await J(ev, `return state.project.tracks[0].effectParams.${fx}.${key}`);
    ok(v1 > v0, `${fx} : ${key} monté au bouton (${v0} → ${v1})`);
    await shot(`/private/tmp/claude-501/qa/st-${fx}.jpg`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(200);
    ok(await J(ev, `return state.project.tracks[0].effectParams.${fx}.${key}`) === v0, `${fx} : ⌘Z`);
    await ev(`document.querySelectorAll('.fx-panel').forEach(x=>x.remove())`);
  }
  if (fails.length) throw new Error(fails.join(' ; '));
};
