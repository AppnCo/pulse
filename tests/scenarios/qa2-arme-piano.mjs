import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, { id: 'ap', name: 'Arme', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }, { name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }] });
  const toast = () => ev(`document.getElementById('flash')?.textContent||''`);
  const p = await pos(ev, `.track-item[data-i="0"] .m-r`); await Mo.click(p.x, p.y); await sleep(200);
  console.log('armer le piano :', await ev(`state.project.tracks[0].armed`), '|', await toast());
  await K('r'); await sleep(2500); await K(' '); await sleep(1500);
  console.log('après prise :', JSON.stringify(await ev(`state.project.tracks.map(t=>[t.name,t.type,t.armed,(t.clips||[]).map(c=>[c.name,!!c.midi,+c.duration.toFixed(2)])])`)), '|', await toast());
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
  await shot('/private/tmp/claude-501/qa/arme-piano.jpg');
};
