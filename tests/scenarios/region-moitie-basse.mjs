// Région : moitié basse = sélection d'une plage au glisser (comme dans le vide), moitié haute = déplacer la région
import { boot, instru, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await instru(ev, 8, 0, 0); await sleep(300);
  const drag = async (x0, y0, x1, y1) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8, button: 'left' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
    await sleep(250);
  };
  const p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.3, 0.8);
  await drag(p.x, p.y, p.x + 120, p.y);
  const sel = await ev(`state.selection ? [state.selection.start, state.selection.end].map(v=>v.toFixed(2)).join('→') : 'aucune'`);
  check('moitié basse + glisser : une plage est choisie', sel !== 'aucune', sel);
  check('la région n’a pas bougé', await ev(`state.project.tracks[0].clips[0].start`) === 0);
  await ev(`clearRangeSelection()`);
  const q = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.75);
  await drag(q.x, q.y, q.x, q.y);
  check('moitié basse, simple clic : la région est choisie', await ev(`!!state.selectedClip && state.selectedClip.trackIdx===0`));
  const h = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.3);
  await drag(h.x, h.y, h.x + 96, h.y);
  check('moitié haute + glisser : la région se déplace', await ev(`state.project.tracks[0].clips[0].start`) > 0.5, await ev(`state.project.tracks[0].clips[0].start`));
};
