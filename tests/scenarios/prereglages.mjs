// Préréglages des plugs : Red Records (provisoires) + les miens
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', effects: [], clips: [] }] });
  await ev(`openEffectPanel(0, 'delay', document.body)`); await sleep(200);
  const opts = await ev(`[...document.querySelectorAll('.plug-win .fx-preset option')].map(o=>o.textContent).join(' | ')`);
  check('le menu propose les préréglages Red Records', /Del 1\/8 ping-pong/.test(opts), opts);
  await ev(`(()=>{ const s=document.querySelector('.plug-win .fx-preset'); s.value='f0'; s.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const p = await ev(`JSON.stringify(state.project.tracks[0].effectParams.delay)`);
  check('Del 1/8 ping-pong appliqué (1/8, ping-pong)', /"beats":0.5/.test(p) && /"pp":1/.test(p), p);
  check("l'Écho est allumé", await ev(`state.project.tracks[0].effects.includes('delay')`));
  check('une seule fenêtre, rouverte', await ev(`document.querySelectorAll('.plug-win').length`) === 1);
  check('le menu affiche le préréglage choisi', await ev(`document.querySelector('.plug-win .fx-preset').selectedOptions[0].textContent`) === 'Del 1/8 ping-pong');
  await ev(`(()=>{ const s=document.querySelector('.plug-win .fx-preset'); s.value='__save'; s.dispatchEvent(new Event('change')); })()`); await sleep(100);
  await ev(`(()=>{ const i=document.querySelector('.plug-win .fx-preset-name'); i.value='Mon 1/16'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`); await sleep(250);
  check('mon préréglage est rangé dans « Les miens »', await ev(`[...document.querySelectorAll('.plug-win .fx-preset optgroup[label="Les miens"] option')].map(o=>o.textContent).join()`) === 'Mon 1/16');
  await ev(`undoAction()`); await sleep(200);
};
