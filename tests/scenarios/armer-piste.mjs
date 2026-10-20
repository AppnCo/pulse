// Piste Rec du modèle : armée à l'ouverture, mais on peut armer une autre piste à sa place (une seule à la fois)
import { boot, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, RAP);
  const st = () => ev(`JSON.stringify(state.project.tracks.map(t=>t.name+(t.armed?'*':'')))`);
  console.log('à l ouverture :', await st());
  await ev(`document.querySelector('.t-mini.m-r[data-i="2"]').click()`); await sleep(200);
  const a = await st(); console.log('R sur Lead :', a);
  if (!a.includes('Lead*') || a.includes('Rec*')) throw new Error('Lead doit être seule armée');
  await ev(`document.querySelector('.t-mini.m-r[data-i="1"]').click()`); await sleep(200);
  const b = await st(); console.log('R sur Rec :', b);
  if (!b.includes('Rec*') || b.includes('Lead*')) throw new Error('Rec doit être seule armée');
  await ev(`document.querySelector('.t-mini.m-r[data-i="2"]').click()`); await sleep(200);
  await ev(`state.playhead=0; toggleRec()`); await sleep(2200); await ev(`togglePlay()`); await sleep(900);
  console.log('prises :', await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+':'+t.clips.filter(c=>!c.recording).length))`));
};
