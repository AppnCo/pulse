import { boot, instru, RAP, mouse, pos, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  const Ms = mouse(send);
  await instru(ev, 3, 1, 1); await sleep(300);      // une prise sur Rec
  const info = () => ev(`JSON.stringify(state.project.tracks.map((t,i)=>i+':'+t.name+'='+t.clips.length+(t.clips.length?'@'+t.clips.map(c=>c.start.toFixed(1)).join('|'):'')).filter(s=>!/=0$/.test(s)))`);
  console.log('départ', await info());
  const clip = await pos(ev, '.timeline-track[data-i="1"] .clip');
  // 1) déposer sur la ligne d'en-tête du groupe "Vocal 1" (entre Rec et Lead)
  const hdr = await pos(ev, '.timeline-row.group-row[data-bus="vocal1"], .group-timeline-row[data-bus="vocal1"], [data-bus="vocal1"].timeline-group-row');
  console.log('ligne du groupe', JSON.stringify(hdr), await ev(`[...document.querySelectorAll('#timelineTracks > *')].map(e=>e.className.split(' ')[0]+(e.dataset.i?':'+e.dataset.i:'')+(e.dataset.bus?':'+e.dataset.bus:'')).join(' ')`));
  const yHdr = hdr ? hdr.y : clip.y + 100;
  await Ms.drag(clip.x, clip.y, clip.x + 100, yHdr, 8); await sleep(250);
  console.log('lâché sur la ligne du groupe', await info());
  // 2) déposer tout en bas, sous la dernière ligne
  const c2 = await pos(ev, '.timeline-track .clip');
  await Ms.drag(c2.x, c2.y, c2.x, 840, 8); await sleep(250);
  console.log('lâché tout en bas', await info());
  // 3) déposer sur la piste Mix Bus 1 (ligne de bus)
  const c3 = await pos(ev, '.timeline-track .clip');
  const mb = await pos(ev, '[data-bus="mixbus1"]');
  console.log('ligne mixbus1', JSON.stringify(mb));
  if (mb) { await Ms.drag(c3.x, c3.y, c3.x, mb.y, 8); await sleep(250); console.log('lâché sur Mix Bus 1', await info()); }
  console.log('invariants', await ev(`JSON.stringify(${INVARIANTS})`));
  await shot('/private/tmp/claude-501/qa/glisser.jpg');
};
