// Aimant intelligent comme Logic : il crante sur les traits que la règle montre (mesures dézoomé, temps, puis subdivisions zoomé),
// plus fort sur les grandes lignes, et reste libre entre les crans
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, check } = c;
  await boot(c, { id: 'ai', name: 'AI', bpm: 120, sends: [], tracks: [{ name: 'A', type: 'audio', color: '#3B82F6', clips: [] }] }, { mic: false });
  // 120 BPM : 1 temps = 0,5 s, 1 mesure = 2 s
  const T = (px, t) => J(ev, `state.snap = 'magnet'; state.gridRes = 'auto'; state.pxPerSecond = ${px}; return { eff: getEffectiveSnap(), v: +snapTime(${t}).toFixed(4) }`);
  // dézoomé (10 px/s : temps = 5 px, pas numérotés) → seulement les mesures
  let r = await T(10, 2.6);   // 6 px de la mesure 2 (2 s) → accroche la mesure
  check('dézoomé : crante sur la mesure', r.eff === 'bar' && r.v === 2, JSON.stringify(r));
  r = await T(10, 3.0);       // milieu de mesure : libre
  check('dézoomé : libre entre deux mesures', r.v === 3, JSON.stringify(r));
  // temps visibles (60 px/s : temps = 30 px)
  r = await T(60, 2.12);      // 7,2 px de la mesure → la mesure (portée max(14, 35 % de 120) = 14)
  check('temps visibles : la mesure accroche plus loin', r.eff === 'beat' && r.v === 2, JSON.stringify(r));
  r = await T(60, 2.66);      // 9,6 px du temps 2,5 → portée temps = min(10, 35 % de 30 = 10,5) → accroche
  check('temps visibles : crante sur le temps', r.v === 2.5, JSON.stringify(r));
  r = await T(60, 2.75);      // milieu entre deux temps : libre
  check('temps visibles : libre entre deux temps', r.v === 2.75, JSON.stringify(r));
  // zoomé (300 px/s : temps = 150 px, doubles croches = 37,5 px)
  r = await T(300, 2.53);     // 9 px du temps 2,5 → temps (10 px)
  check('zoomé : le temps accroche avant la double croche', r.eff === 'division' && r.v === 2.5, JSON.stringify(r));
  r = await T(300, 2.64);     // 3 px de 2,625 (double croche) → la double croche
  check('zoomé : crante sur la double croche', r.v === 2.625, JSON.stringify(r));
  r = await T(300, 2.6);      // 7,5 px de 2,625 : hors portée des doubles croches (6 px), loin du temps → libre
  check('zoomé : libre entre les crans fins', r.v === 2.6, JSON.stringify(r));
  // mode Temps : toujours sur la grille ; Libre : rien
  r = await J(ev, `state.snap = 'grid'; state.pxPerSecond = 60; return +snapTime(2.75).toFixed(4)`);
  check('mode Temps : toujours calé', r === 2.5 || r === 3, String(r));
  r = await J(ev, `state.snap = 'off'; return snapTime(2.12)`);
  check('mode Libre : rien ne bouge', r === 2.12, String(r));
};
