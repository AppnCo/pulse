// Tête de lecture confiée à la carte graphique pendant la lecture : elle reste collée à la vraie position
// (lecture, zoom, saut, arrêt) et la page n'est plus retouchée à chaque image.
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  const tracks = Array.from({ length: 6 }, (_, i) => ({ name: 'P' + (i + 1), type: 'audio', color: '#3B82F6', clips: [{ id: 'c' + i, name: 'r', start: 0, duration: 60, offset: 0, peaks: Array.from({ length: 200 }, () => Math.random()) }] }));
  await boot(c, { id: 'tlf', name: 'TLF', bpm: 120, sends: [], tracks }, { mic: false });
  await sleep(800);
  // écart (px) entre la tête affichée et la vraie position, mesuré dans la même image
  const gap = () => J(ev, `const ph = document.getElementById('playhead'), par = ph.parentElement.getBoundingClientRect(); return Math.round((ph.getBoundingClientRect().left - par.left + ph.parentElement.scrollLeft - state.playhead * state.pxPerSecond) * 10) / 10`);
  const gapPlay = () => ev(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { const ph = document.getElementById('playhead'), par = ph.parentElement.getBoundingClientRect(); r(Math.round((ph.getBoundingClientRect().left - par.left + ph.parentElement.scrollLeft - state.playhead * state.pxPerSecond) / state.pxPerSecond * 1000) || 0); })))`);   // en millisecondes (state.playhead date de l'image d'avant : une image d'écart est normale)
  check('à l arrêt : tête à sa place', Math.abs(await gap()) <= 1, await gap());
  await ev(`state.playhead = 2; updatePlayhead(); togglePlay()`); await sleep(900);
  let g = await gapPlay(); check('en lecture : tête collée à la position', Math.abs(g) <= 40, g + ' ms');
  const mut = await ev(`new Promise(res => { let n = 0; const ob = new MutationObserver(l => n += l.length); ob.observe(document.getElementById('playhead'), { attributes: true }); setTimeout(() => { ob.disconnect(); res(n); }, 1000); })`);
  check('en lecture : la tête n est plus retouchée à chaque image', mut <= 2, mut);
  await ev(`setZoom(state.pxPerSecond * 2, state.playhead)`); await sleep(500);
  g = await gapPlay(); check('après un zoom en lecture : toujours collée', Math.abs(g) <= 40, g + ' ms');
  await sleep(1500); g = await gapPlay(); check('2 s plus tard : pas de dérive', Math.abs(g) <= 40, g + ' ms');
  await ev(`togglePlay()`); await sleep(400);
  const a = await J(ev, `return document.getElementById('playhead').getBoundingClientRect().left`); await sleep(400);
  const b = await J(ev, `return document.getElementById('playhead').getBoundingClientRect().left`);
  check('à l arrêt : la tête ne bouge plus', a === b, a + ' / ' + b);
  check('à l arrêt : tête à sa place', Math.abs(await gap()) <= 1, await gap());
};
