// Groupe fermé : un clic sur sa ligne dans la zone des régions pose le curseur de lecture (croix), glisser choisit une plage
import { boot, J, pos, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'gfc', name: 'GFC', bpm: 120, sends: [],
    buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', color: '#A855F7', volume: 100, collapsed: true }],
    tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Back', type: 'audio', color: '#C084FC', output: 'g1', clips: [] },
             { name: 'Basse', type: 'audio', color: '#3B82F6', clips: [] }] }, { mic: false });
  await sleep(400);
  const m = mouse(send);
  const row = await J(ev, `const e = document.querySelector('.timeline-group-row[data-bus="g1"]'); if (!e) return null; const r = e.getBoundingClientRect(), v = document.querySelector('.timeline').getBoundingClientRect();
    return { x: Math.max(r.left, v.left) + 300, y: r.top + r.height / 2, h: r.height }`);
  check('la ligne du groupe fermé est là', !!row && row.h > 0, JSON.stringify(row));
  check('curseur en croix sur la ligne', await J(ev, `return getComputedStyle(document.querySelector('.timeline-group-row[data-bus="g1"]')).cursor`) === 'crosshair');
  await ev(`state.playhead = 0; state.userBaseSec = 0;`);
  await m.click(row.x, row.y); await sleep(300);
  const ph = await J(ev, `return { ph: state.playhead, lasso: !!document.querySelector('.region-lasso, .lasso') }`);
  check('clic : le curseur de lecture se pose là', ph.ph > 0.5, JSON.stringify(ph));
  // glisser : une plage se choisit, sans erreur
  await m.M('mouseMoved', row.x, row.y); await m.M('mousePressed', row.x, row.y);
  for (let i = 1; i <= 6; i++) { await m.M('mouseMoved', row.x + i * 25, row.y); await sleep(30); }
  await m.M('mouseReleased', row.x + 150, row.y); await sleep(300);
  const sel = await J(ev, `return state.selection && Math.abs(state.selection.end - state.selection.start)`);
  check('glisser : une plage est choisie', sel > 0.2, String(sel));
};
