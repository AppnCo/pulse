// Copier / coller un clip : où atterrit la copie ? (piste sélectionnée vs piste d'origine)
import { boot, instru, key, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }, { name: 'B', type: 'audio', color: '#22D3EE', clips: [] }, { name: 'C', type: 'audio', color: '#34D399', clips: [] }] });
  const K = key(send), Ms = mouse(send);
  await instru(ev, 2, 0, 0); await sleep(300);
  const st = () => ev(`state.project.tracks.map(t=>t.name+':'+t.clips.map(c=>c.start.toFixed(1)).join('|')).join('  ')`);
  const p = await pos(ev, '.timeline-track[data-i="0"] .clip');
  await Ms.click(p.x, p.y); await sleep(150);
  await K('c', 4); await sleep(100);
  // sélectionner la piste C en cliquant son nom, placer le curseur à 5 s
  const pc = await pos(ev, '.track-item[data-i="2"]', 0.5, 0.3);
  await Ms.click(pc.x, pc.y); await sleep(150);
  await ev(`seekPlayhead(5)`);
  console.log('piste choisie =', await ev(`state.selectedTrack`), ' clip choisi =', await ev(`JSON.stringify(state.selectedClip)`));
  await K('v', 4); await sleep(300);
  await K('Delete'); await sleep(300);
  console.log('après Suppr (piste C choisie, clip de A resté choisi) :', await st(), ' flash=', await ev(`document.getElementById('flash').textContent`));
  console.log('après ⌘V (piste C choisie, curseur à 5 s) :', await st());
};
