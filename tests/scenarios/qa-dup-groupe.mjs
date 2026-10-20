import { boot, RAP, mouse, pos, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  await ev(`duplicateGroup('allvocal')`); await sleep(400);
  console.log(await ev(`JSON.stringify({buses:state.project.buses.map(b=>b.id.slice(0,8)+':'+b.name+'→'+b.output.slice(0,8)), tracks:state.project.tracks.map(t=>t.name+'→'+t.output.slice(0,8)), inv:${INVARIANTS}})`));
  await shot('/private/tmp/claude-501/qa/dup-groupe.jpg');
};
