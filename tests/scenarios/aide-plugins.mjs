// Aide des plugins (14/11) : phrases d'aide cachées, bouton « ? » dans le bandeau pour les afficher (comme PulseTune), choix gardé
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1920, h: 1080 });
  await ev(`localStorage.removeItem('pulse_fx_help'); state.project.tracks[2].effects = ['gate', 'eq', 'fet76', 'tremolo']`);
  for (const fx of ['gate', 'eq', 'fet76', 'tremolo']) {
    await ev(`document.querySelectorAll('.fx-panel').forEach(p => p.remove()); openEffectPanel(2, '${fx}', document.body)`); await sleep(300);
    const r = await J(ev, `const p=[...document.querySelectorAll('.fx-panel')].pop(); const h=[...p.querySelectorAll('.help-txt')]; return { btn: !!p.querySelector('.fx-help-btn'), n: h.length, vis: h.filter(e => getComputedStyle(e).display !== 'none').length }`);
    check(`${fx} : bouton « ? », aide cachée`, r.btn && r.n > 0 && r.vis === 0, JSON.stringify(r));
  }
  await ev(`document.querySelector('.fx-panel .fx-help-btn').click()`); await sleep(100);
  check('« ? » : aide affichée', await J(ev, `const p=document.querySelector('.fx-panel'); return [...p.querySelectorAll('.help-txt')].some(e => getComputedStyle(e).display !== 'none')`));
  check('choix gardé', await J(ev, `return localStorage.getItem('pulse_fx_help')`) === '1');
  await ev(`localStorage.removeItem('pulse_fx_help')`);
};
