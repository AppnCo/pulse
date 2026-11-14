// PulseTune ajouté par « + Effet » : allumé tout de suite, et listé dans les récents du menu (14/11)
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 860 });
  await ev(`(()=>{ localStorage.removeItem('pulse_fx_recent'); const t=state.project.tracks[2]; delete t.autotune; delete t.tuneSlot; openAddEffectMenu(document.body, 2, t); })()`); await sleep(300);
  const it = await J(ev, `const e=[...document.querySelectorAll('.fx-add-menu .fam-fx')].find(x => x.textContent.includes('PulseTune')); if(e) e.click(); return !!e`);
  check('PulseTune dans le menu', it);
  await sleep(1500);
  check('allumé à l\'ajout', await J(ev, `return !!(state.project.tracks[2].autotune && state.project.tracks[2].autotune.on)`));
  await ev(`(()=>{ document.querySelectorAll('.tune-panel').forEach(p=>p.remove()); openAddEffectMenu(document.body, 2, state.project.tracks[2]); })()`); await sleep(300);
  const rec = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-recent')].map(x => x.textContent)`);
  check('dans les récents', rec.includes('PulseTune'), JSON.stringify(rec));
  check('image PulseTune', await J(ev, `const e=[...document.querySelectorAll('.fx-add-menu .fam-fx')].find(x => x.textContent.includes('PulseTune')); const i=e&&e.querySelector('img.fam-thumb'); return !!i && i.getAttribute('src').endsWith('tune.webp')`));
  // ⏻ « tous les effets » de la tranche : PulseTune s'éteint et se rallume comme les autres
  await ev(`(()=>{ document.querySelectorAll('.tune-panel,.track-ctx-menu').forEach(p=>p.remove()); const t=state.project.tracks[2]; t.effects=['eq']; renderInspector(); })()`); await sleep(300);
  await ev(`toggleAllFx(state.project.tracks[2])`); await sleep(1200);
  check('tout couper : PulseTune éteint aussi', await J(ev, `const t=state.project.tracks[2]; return !t.autotune.on && !t.effects.includes('eq')`));
  await ev(`toggleAllFx(state.project.tracks[2])`); await sleep(1500);
  check('tout rallumer : PulseTune rallumé', await J(ev, `const t=state.project.tracks[2]; return !!t.autotune.on && t.effects.includes('eq')`));
  check('⏻ sur la ligne PulseTune', await J(ev, `state.selectedTrack = 2; renderInspector(); return !!document.querySelector('.insp-tune-row .fx-pow')`));
};
