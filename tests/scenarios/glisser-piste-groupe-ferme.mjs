// Comme Logic : glisser une piste sur un groupe FERMÉ (sur son en-tête) = elle rejoint ce groupe ; le son suit (sortie = le bus du groupe)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'gpgf', name: 'GPGF', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Perc', isGroup: true, output: 'master', color: '#22C55E', volume: 100, collapsed: true }],
    tracks: [{ name: 'Shaker', type: 'audio', color: '#22C55E', output: 'g1', clips: [] }, { name: 'Clap', type: 'audio', color: '#22C55E', output: 'g1', clips: [] }, { name: 'Kick', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Conga', type: 'audio', color: '#F59E0B', clips: [] }] }, { mic: false });
  await sleep(300);
  const from = await J(ev, `const r = document.querySelector('.track-item[data-i="3"] .track-name').getBoundingClientRect(); return { x: r.left + 8, y: r.top + r.height / 2 }`);
  const to = await J(ev, `const r = document.querySelector('#tracksList .group-header[data-bus="g1"]').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 10; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * k / 10, y: from.y + (to.y - from.y) * k / 10, button: 'left', buttons: 1 }); await sleep(30); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  const r = await J(ev, `const t = state.project.tracks.find(x => x.name === 'Conga'); return { out: t.output || 'master', order: state.project.tracks.map(x => x.name).join() }`);
  check('Conga lâchée sur le groupe fermé Perc : elle passe dans Perc', r.out === 'g1', JSON.stringify(r));
  check('… rangée avec les pistes de Perc', /Shaker,Clap,Conga|Conga,Shaker,Clap|Shaker,Conga,Clap/.test(r.order), r.order);
  // (Pulse déplie le groupe pour montrer où la piste est tombée)
};
