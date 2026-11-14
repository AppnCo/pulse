// Écho (14/11) : un seul bouton « Mix » (0 % voix seule · 50 % les deux à fond · 100 % écho seul) à la place de Quantité + Voix d'origine
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 900 });
  await ev(`(()=>{ const t=state.project.tracks[2]; t.effects=['delay']; t.effectParams = { delay: { beats: 0.5, feedback: 35, wet: 25 } }; openEffectPanel(2, 'delay', document.body); })()`); await sleep(500);
  const keys = await J(ev, `return [...document.querySelectorAll('.fx-panel .fx-slider')].map(s => s.dataset.key)`);
  check('un bouton Mix, plus de Quantité ni de Voix d\'origine', keys.includes('mix') && !keys.includes('wet') && !keys.includes('dry'), JSON.stringify(keys));
  check('ancien réglage (25 % d\'écho) = Mix 13 %', await J(ev, `return +document.querySelector('.fx-panel .fx-slider[data-key="mix"]').value`) === 13);
  const set = async (v) => { await ev(`(()=>{ const s=document.querySelector('.fx-panel .fx-slider[data-key="mix"]'); s.value=${v}; s.dispatchEvent(new Event('input',{bubbles:true})); })()`); return J(ev, `const p=state.project.tracks[2].effectParams.delay; return [p.wet, p.dry]`); };
  check('Mix 100 % = écho seul', JSON.stringify(await set(100)) === '[100,0]');
  check('Mix 50 % = les deux à fond', JSON.stringify(await set(50)) === '[100,100]');
  check('Mix 0 % = voix seule', JSON.stringify(await set(0)) === '[0,100]');
};
