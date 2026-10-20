import { boot, instru, key, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }, { name: 'B', type: 'audio', color: '#22D3EE', clips: [] }, { name: 'C', type: 'audio', color: '#34D399', clips: [] }] });
  const K = key(send), Ms = mouse(send);
  await instru(ev, 2, 0, 0); await sleep(300);
  const p = await pos(ev, '.timeline-track[data-i="0"] .clip');
  await Ms.click(p.x, p.y); await sleep(150);
  const pc = await pos(ev, '.track-item[data-i="2"]', 0.5, 0.3);
  await Ms.click(pc.x, pc.y); await sleep(150);
  console.log('piste choisie =', await ev(`state.selectedTrack`), ' clip choisi =', await ev(`JSON.stringify(state.selectedClip)`), 'clip surligné=', await ev(`document.querySelectorAll('.clip.selected').length`));
  await K('Delete'); await sleep(300);
  console.log('après Suppr : clips de A =', await ev(`state.project.tracks[0].clips.length`), 'pistes =', await ev(`state.project.tracks.length`));
};
