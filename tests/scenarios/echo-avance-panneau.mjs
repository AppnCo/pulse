// Écho avancé (17/11) : les 7 réglages en mode avancé (temps droite, largeur, usure, pleurage, modulation, vitesse, coupe-bas en boucle),
// le choix du temps droite s'enregistre et se dessine, les réglages avancés sont automatisables
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 900 });
  await ev(`localStorage.setItem('pulse_fx_adv','1'); (()=>{ const t=state.project.tracks[2]; t.effects=['delay']; t.effectParams = { delay: { beats: 0.5, feedback: 35, wet: 25 } }; openEffectPanel(2, 'delay', document.body); })()`); await sleep(500);
  const keys = await J(ev, `return [...document.querySelectorAll('.fx-panel [data-key]')].map(s => s.dataset.key)`);
  const want = ['beatsR', 'width', 'sat', 'wow', 'mod', 'modRate', 'hpLoop'];
  check('les 7 réglages avancés sont là', want.every(k => keys.includes(k)), JSON.stringify(keys));
  await ev(`(()=>{ const b=[...document.querySelectorAll('.fx-panel .fx-choice[data-key="beatsR"] button')].find(x=>x.textContent==='1/8 .'); if(b) b.click(); })()`); await sleep(400);
  const r = await J(ev, `return { v: state.project.tracks[2].effectParams.delay.beatsR, txt: (document.querySelector('.fx-panel .viz-delay')||{}).textContent || '' }`);
  check('temps droite 1/8 . enregistré', r && Math.abs(r.v - 0.75) < 1e-9, JSON.stringify(r));
  check('le dessin montre les deux temps', r && /1\/8 \/ /.test(r.txt), r && r.txt);
  const sl = await J(ev, `const s=document.querySelector('.fx-panel .fx-slider[data-key="sat"]'); if(!s) return null; s.value=40; s.dispatchEvent(new Event('input',{bubbles:true})); return state.project.tracks[2].effectParams.delay.sat`);
  check('usure 40 % enregistrée', sl === 40, String(sl));
  check('réglages avancés automatisables', await J(ev, `const ks = fxNumericDefs0('delay', state.project.tracks[2].effectParams.delay).map(d => d.key); return ['width','sat','wow','mod','modRate'].every(k => ks.includes(k))`));
};
