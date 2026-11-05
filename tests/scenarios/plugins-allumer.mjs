// Cases de plugins comme Logic : ⏻ à gauche (clic maintenu + glisser vers le bas = plusieurs d'un coup), un plugin éteint garde sa case,
// ⇅ à droite = remplacer à la même place ; en plus de Logic : un ⏻ en haut pour tout couper / rallumer (avant / après)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'pa', name: 'PA', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], effects: ['comp', 'eq', 'sat'], fxOrder: ['comp', 'eq', 'sat'] }] }, { mic: false });
  await ev(`selectTrack(0); renderInspector()`); await sleep(300);
  const S = '#inspector .insp-strip[data-kind="track"]';
  const rowsState = () => J(ev, `return [...document.querySelectorAll('${S} .insp-fx-row')].filter(r => r.dataset.fx !== 'tune').map(r => r.dataset.fx + (r.classList.contains('is-off') ? ':off' : ':on')).join(' ')`);
  const M = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left', buttons, clickCount: 1 });
  const powAt = async (fx) => { await J(ev, `return 1`); const r = await J(ev, `const row = document.querySelector('${S} .insp-fx-row[data-fx="${fx}"]'); const b = row.getBoundingClientRect(); return { x: b.left + 9, y: b.top + b.height / 2 }`); return r; };
  check('3 plugins allumés', (await rowsState()) === 'comp:on eq:on sat:on', await rowsState());
  // clic maintenu sur le ⏻ du comp, glisser jusqu'au sat
  const a = await powAt('comp'), z = await powAt('sat');
  await M('mouseMoved', a.x, a.y); await sleep(80);
  const vis = await J(ev, `const b = document.querySelector('${S} .insp-fx-row[data-fx="comp"] .fx-pow'); return getComputedStyle(b).display`);
  check('survol : le ⏻ apparaît à gauche', vis === 'grid', vis);
  await M('mousePressed', a.x, a.y, 1);
  for (let k = 1; k <= 6; k++) { await M('mouseMoved', a.x, a.y + (z.y - a.y) * k / 6, 1); await sleep(30); }
  await M('mouseReleased', z.x, z.y); await sleep(250);
  check('glisser sur les ⏻ : les 3 éteints, ils gardent leur case et leur ordre', (await rowsState()) === 'comp:off eq:off sat:off', await rowsState());
  check('le moteur ne joue plus rien', await J(ev, `return (state.project.tracks[0].effects || []).length === 0`));
  await ev(`undoAction()`); await sleep(300); await ev(`renderInspector()`); await sleep(150);
  check('⌘Z : un seul retour rallume les 3', (await rowsState()) === 'comp:on eq:on sat:on', await rowsState());
  // clic simple sur le ⏻ de l'EQ
  const e1 = await powAt('eq');
  await M('mouseMoved', e1.x, e1.y); await M('mousePressed', e1.x, e1.y, 1); await M('mouseReleased', e1.x, e1.y); await sleep(250);
  check('clic sur un ⏻ : seulement lui', (await rowsState()) === 'comp:on eq:off sat:on', await rowsState());
  check('un clic sur le ⏻ n\'ouvre pas la fenêtre', await J(ev, `return !document.querySelector('.fx-panel.plug-win')`));
  // ⏻ du haut : avant / après
  await ev(`document.querySelector('${S} .fx-all').click()`); await sleep(250);
  check('⏻ du haut : tout coupé (avant)', (await rowsState()) === 'comp:off eq:off sat:off', await rowsState());
  await ev(`document.querySelector('${S} .fx-all').click()`); await sleep(250);
  check('⏻ du haut encore : les mêmes reviennent (l\'EQ reste éteint)', (await rowsState()) === 'comp:on eq:off sat:on', await rowsState());
  // ⇅ : remplacer le comp à la même place
  await ev(`document.querySelector('${S} .insp-fx-row[data-fx="comp"] .fx-swap').click()`); await sleep(250);
  const picked = await J(ev, `const it = document.querySelector('.track-ctx-menu .fam-fx[data-fx="limit"]') || document.querySelector('.track-ctx-menu .fam-fx[data-fx="deess"]'); if (!it) return null; const f = it.dataset.fx; it.click(); return f`);
  await sleep(300); await ev(`document.querySelectorAll('.fx-panel').forEach(p => p.remove()); renderInspector()`); await sleep(150);
  const st = await rowsState();
  check('⇅ : le comp est remplacé, à la même place', !!picked && st === `${picked}:on eq:off sat:on`, picked + ' → ' + st);
};
