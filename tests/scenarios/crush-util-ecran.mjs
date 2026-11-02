// Bitcrusher et Utilitaire : écrans pleins — styles, boutons, Phase / Mono, ⌘Z
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, { id: 'cu1', name: 'CU', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['crush', 'util'], effectParams: {} }] }, { mic: false });
  const fails = []; const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'OK   ' : 'RATÉ ') + msg); };
  await ev(`openEffectPanel(0, 'crush', document.body)`); await sleep(300);
  ok(await ev(`!!document.querySelector('.cu-panel .cu-svg path')`), 'Bitcrusher : écran ouvert');
  await ev(`document.querySelector('.cu-panel .cu-look[data-i="3"]').click()`); await sleep(100);
  const p = await J(ev, `return state.project.tracks[0].effectParams.crush`);
  ok(p.bits === 4 && p.down === 16, 'Bitcrusher : style Destruction');
  await shot('/private/tmp/claude-501/qa/cu-crush.jpg');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(200);
  ok((await J(ev, `return state.project.tracks[0].effectParams.crush`)).bits === 8, 'Bitcrusher : ⌘Z');
  await ev(`document.querySelectorAll('.fx-panel').forEach(x=>x.remove())`);
  await ev(`openEffectPanel(0, 'util', document.body)`); await sleep(300);
  ok(await ev(`document.querySelectorAll('.cu-panel .cu-tog').length`) === 2, 'Utilitaire : boutons Phase et Mono');
  await ev(`document.querySelector('.cu-panel .cu-tog[data-k="invert"]').click()`); await ev(`document.querySelector('.cu-panel .cu-tog[data-k="mono"]').click()`); await sleep(100);
  const u = await J(ev, `return state.project.tracks[0].effectParams.util`);
  ok(u.invert === 1 && u.mono === 1, 'Utilitaire : phase inversée et mono');
  ok(await ev(`document.querySelector('.cu-panel .cu-tog[data-k="mono"]').classList.contains('on')`), 'Utilitaire : bouton Mono allumé');
  await shot('/private/tmp/claude-501/qa/cu-util.jpg');
  if (fails.length) throw new Error(fails.join(' ; '));
};
