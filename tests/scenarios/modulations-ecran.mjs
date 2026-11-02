// Chorus, Flanger, Phaser, Trémolo : écran animé — styles, bouton Vitesse, ⌘Z, l'animation avance
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot, send } = c;
  await boot(c, { id: 'mo1', name: 'MO', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['chorus', 'flanger', 'phaser', 'tremolo'], effectParams: {} }] }, { mic: false });
  const fails = []; const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'OK   ' : 'RATÉ ') + msg); };
  for (const fx of ['chorus', 'flanger', 'phaser', 'tremolo']) {
    await ev(`openEffectPanel(0, '${fx}', document.body)`); await sleep(300);
    ok(await ev(`!!document.querySelector('.mod-panel .mod-svg path')`), `${fx} : écran ouvert`);
    const a = await ev(`document.querySelector('.mod-svg').innerHTML.length + ':' + document.querySelector('.mod-svg circle')?.getAttribute('cy')`); await sleep(330);
    const b = await ev(`document.querySelector('.mod-svg').innerHTML.length + ':' + document.querySelector('.mod-svg circle')?.getAttribute('cy')`);
    ok(a !== b, `${fx} : l'oscillation bouge`);
    await ev(`document.querySelector('.mod-panel .mod-look[data-i="2"]').click()`); await sleep(100);
    const p = await J(ev, `return state.project.tracks[0].effectParams.${fx}`);
    ok(p && p.rate > 0, `${fx} : style appliqué (${JSON.stringify(p)})`);
    ok(await ev(`document.querySelector('.mod-panel .mod-look[data-i="2"]').classList.contains('on')`), `${fx} : style marqué`);
    const r0 = p.rate;
    const k = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.mod-panel .pk.big').getBoundingClientRect(); return {x:e.left+e.width/2,y:e.top+e.height/3}})())`));
    const m = (type, y) => send('Input.dispatchMouseEvent', { type, x: k.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await m('mousePressed', k.y); for (let i = 1; i <= 6; i++) await m('mouseMoved', k.y + i * 6); await m('mouseReleased', k.y + 36); await sleep(150);
    const r1 = await J(ev, `return state.project.tracks[0].effectParams.${fx}.rate`);
    ok(r1 < r0, `${fx} : Vitesse baissée au bouton (${r0} → ${r1})`);
    await shot(`/private/tmp/claude-501/qa/mod-${fx}.jpg`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(200);
    ok(await J(ev, `return state.project.tracks[0].effectParams.${fx}.rate`) === r0, `${fx} : ⌘Z`);
    await ev(`document.querySelectorAll('.fx-panel').forEach(x=>x.remove())`);
  }
  if (fails.length) throw new Error(fails.join(' ; '));
};
