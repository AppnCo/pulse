// Zoom fluide sur gros projet : pendant le geste, chaque cran est quasi gratuit (aperçu étiré) ; à la fin, un vrai rendu net,
// et la base (ou le point sous la souris) n'a pas bougé
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const tracks = Array.from({ length: 60 }, (_, i) => ({ name: 'P' + (i + 1), type: 'audio', color: '#3B82F6', clips: Array.from({ length: 4 }, (_, k) => ({ id: 'c' + i + '_' + k, name: 'r', start: k * 20, duration: 15, offset: 0, peaks: Array.from({ length: 200 }, () => Math.random()) })) }));
  await boot(c, { id: 'zf', name: 'ZF', bpm: 120, sends: [], tracks }, { mic: false });
  await sleep(800);
  await ev(`setZoom(40, 0); document.querySelector('.timeline').scrollLeft = 400; state.playhead = 30; state.userBaseSec = 30; state.baseCleared = false`); await sleep(400);
  // 10 crans « E » rapprochés : temps de chacun
  const t = await J(ev, `const out = []; for (let k = 0; k < 10; k++) { const t0 = performance.now(); const zt = zoomTarget(); setZoom(state.pxPerSecond * 1.25, zt.sec, zt.center); out.push(performance.now() - t0); } return out.map(x => Math.round(x * 10) / 10)`);
  const later = t.slice(1);
  check('pendant le geste : chaque cran < 16 ms (60 images / s)', Math.max(...later) < 16, JSON.stringify(t));
  const mid = await J(ev, `const tl = document.querySelector('.timeline'); return { x: Math.round(state.playhead * state.pxPerSecond - tl.scrollLeft), mid: Math.round(tl.clientWidth / 2), tr: document.getElementById('timelineTracks').style.transform }`);
  check('pendant le geste : la base reste au milieu', Math.abs(mid.x - mid.mid) < 4, JSON.stringify(mid));
  await sleep(400);
  const fin = await J(ev, `const tl = document.querySelector('.timeline'), el = document.getElementById('timelineTracks'); const c = document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="1"]'); const r = c.getBoundingClientRect(), tr = document.querySelector('.timeline-track[data-i="0"]').getBoundingClientRect(); return { tr: el.style.transform, x: Math.round(state.playhead * state.pxPerSecond - tl.scrollLeft), mid: Math.round(tl.clientWidth / 2), clipLeft: Math.round(r.left - tr.left), want: Math.round(20 * state.pxPerSecond) }`);
  check('à la fin : rendu net (plus d étirement)', fin.tr === '', JSON.stringify(fin));
  check('à la fin : la base toujours au milieu', Math.abs(fin.x - fin.mid) < 4, JSON.stringify(fin));
  check('à la fin : les régions à la bonne place', Math.abs(fin.clipLeft - fin.want) <= 2, JSON.stringify(fin));
};
