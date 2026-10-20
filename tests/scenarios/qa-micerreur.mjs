// Micro refusé / absent / occupé : message clair, état propre, pas de piste fantôme
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, null, { mic: false });
  const flashTxt = `(()=>{const e=document.getElementById('flash'); return e? (e.style.opacity+':'+e.textContent): 'none'})()`;
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'TypeError']) {
    await ev(`(async()=>{ await PulseAudio.init(); PulseAudio.releaseMic && PulseAudio.releaseMic(); navigator.permissions.query=async()=>({state:'prompt'}); navigator.mediaDevices.getUserMedia=async()=>{ const e=new Error('x'); e.name='${name}'; throw e; }; PulseAudio.setCountIn(false); })()`);
    await ev(`state.playhead=0; toggleRec()`); await sleep(900);
    console.log(name, '=>', await ev(`${flashTxt}`), '| rec=' + await ev(`state.recording`), 'playing=' + await ev(`state.playing`), 'starting=' + await ev(`!!state._recStarting`), 'pistes=' + await ev(`state.project.tracks.map(t=>t.name+(t.armed?'*':'')+(t.clips.length?'#'+t.clips.length:'')).join(',')`));
    await sleep(3200);
  }
  // Espace avec micro refusé sur piste armée
  await ev(`state.project.tracks[0].armed=true; renderAll()`);
  await ev(`togglePlay()`); await sleep(800);
  console.log('Espace piste armée micro refusé =>', await ev(`${flashTxt}`), 'playing=' + await ev(`state.playing`), 'rec=' + await ev(`state.recording`));
  await shot('/private/tmp/claude-501/qa/micerr.jpg');
  await ev(`togglePlay()`);
};
