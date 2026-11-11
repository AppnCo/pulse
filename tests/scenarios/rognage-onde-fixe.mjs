// Tirer le bord d'une région (rognage, pas stretch) : la forme d'onde reste fixe dans la timeline pendant le geste (retour terrain 11/11)
import { boot, J, instru, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c; const m = mouse(send);
  await boot(c, { id: 'rog', name: 'R', bpm: 120, sends: [], buses: [], tracks: [{ name: 'Instru', type: 'audio', color: '#60A5FA', volume: 100, clips: [] }] }, { mic: false });
  await instru(ev, 8, 0, 0); await sleep(500);
  // on commence par raccourcir la région à gauche (offset 2 s) pour pouvoir la rallonger ensuite
  await ev(`(()=>{ const c = state.project.tracks[0].clips[0]; c.start = 2; c.offset = 2; c.duration = 4; renderAll(); })()`); await sleep(400);
  const pos = await J(ev, `const el = document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="0"]'); const r = el.getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2, w: r.width }`);
  const peak = `(()=>{ const p = document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="0"] .clip-wave-svg'); if (!p) return null; const r = p.getBoundingClientRect(); const vb = p.viewBox.baseVal; return { left: Math.round(r.left), ppx: r.width / (vb && vb.width || r.width) }; })()`;
  // l'abscisse à l'écran d'un même instant du son : (début du fichier) = gauche de la région - offset
  const anchor = `(()=>{ const c = state.project.tracks[0].clips[0]; const el = document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="0"]'); const p = el.querySelector('.clip-wave-svg'); const r = p.getBoundingClientRect(); return Math.round(r.left + (c.offset - 0) * 0); })()`;
  await m.M('mouseMoved', pos.x, pos.y);
  await m.M('mousePressed', pos.x, pos.y);
  await m.M('mouseMoved', pos.x - 5, pos.y); await sleep(80);
  const a0 = JSON.parse(await ev(`JSON.stringify(${peak})`));
  const lefts = [];
  for (let k = 1; k <= 6; k++) { await m.M('mouseMoved', pos.x - 5 - k * 15, pos.y); await sleep(60); lefts.push(JSON.parse(await ev(`JSON.stringify(${peak})`)).left); }
  await m.M('mouseReleased', pos.x - 95, pos.y); await sleep(400);
  const cl = await J(ev, `const c = state.project.tracks[0].clips[0]; return { start: +c.start.toFixed(2), off: +c.offset.toFixed(2), dur: +c.duration.toFixed(2) }`);
  check('rognage à gauche fait (la région a grandi vers la gauche)', cl.start < 2 && cl.off < 2, JSON.stringify(cl));
  const spread = Math.max(...lefts, a0.left) - Math.min(...lefts, a0.left);
  check('forme d\'onde immobile à l\'écran pendant le geste (écart ≤ 1 px)', spread <= 1, JSON.stringify({ a0, lefts }));
};
