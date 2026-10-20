// « Refaire cette prise » : le curseur revient au début de la prise, on réenregistre, l'ancienne est rangée dessous
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, null);
  await instru(ev, 6, 0, 0); await sleep(300);
  await ev(`state.playhead=0; toggleRec()`); await sleep(2500);
  await ev(`togglePlay()`); await sleep(900);
  const info = () => ev(`(()=>{const v=state.project.tracks.find(t=>/Voix/.test(t.name)); return JSON.stringify({clips:v?v.clips.filter(c=>!c.recording).length:-1, takes:v?(v.takes||[]).length:-1, ids:v?v.clips.map(c=>c.id):[]})})()`);
  console.log('après la prise A :', await info());
  const idx = await ev(`state.project.tracks.findIndex(t=>/Voix/.test(t.name))`);
  await ev(`redoTake(${idx}, 0)`); await sleep(3200);
  await ev(`if(state.recording||state.playing) togglePlay()`); await sleep(900);
  const after = await info();
  console.log('après « Refaire » :', after);
  const j = JSON.parse(after);
  if (!(j.clips + j.takes >= 2)) throw new Error('La nouvelle prise n\'est pas là');
};
