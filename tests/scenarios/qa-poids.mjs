import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, null);
  await instru(ev, 30, 0, 0); await sleep(300);
  console.log('JSON projet (1 clip 30 s) :', await ev(`JSON.stringify(state.project).length`), 'octets ; peaks =', await ev(`JSON.stringify(state.project.tracks[0].clips[0].peaks).length`), 'octets, n=', await ev(`state.project.tracks[0].clips[0].peaks.length`));
  // 200 coupes
  console.log(await ev(`(()=>{ const t=state.project.tracks[0]; for(let i=1;i<=200;i++){ splitClipAt(0, t.clips.length-1, 0.1*i + 0.05); } return 'clips='+t.clips.length+' json='+JSON.stringify(state.project).length+' octets ; undo='+_undoStack.length })()`));
  console.log('localStorage utilisé (o):', await ev(`Object.keys(localStorage).reduce((s,k)=>s+k.length+localStorage.getItem(k).length,0)`));
  console.log('flash:', await ev(`document.getElementById('flash').textContent`));
};
