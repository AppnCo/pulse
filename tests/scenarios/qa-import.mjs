// Import d'une instru : liste des pistes à jour ? annulable ? tempo changé silencieusement ?
import { boot, instru, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, null);
  // instru à 90 BPM (kicks réguliers) sur la piste 1
  await ev(`(async()=>{ const ctx=PulseAudio.getContext(); const sr=44100,n=sr*12,b=ctx.createBuffer(1,n,sr),d=b.getChannelData(0); const beat=60/90; for(let i=0;i<n;i++){const t=(i/sr)%beat; d[i]=t<0.04?Math.sin(2*Math.PI*70*t)*(1-t/0.04)*0.9:0;}
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'trap90.wav',{type:'audio/wav'}),0,0); })()`);
  await sleep(500);
  console.log('état  : nom=', await ev(`state.project.tracks[0].name`), 'type=', await ev(`state.project.tracks[0].type`), 'bpm=', await ev(`state.project.bpm`));
  console.log('écran : nom=', await ev(`document.querySelector('.track-item[data-i="0"] .track-name').textContent.trim()`), 'icône=', await ev(`document.querySelector('.track-item[data-i="0"] .track-icon').innerHTML.slice(0,40)`), 'inspecteur=', await ev(`document.querySelector('#inspector .strip-name, #inspector .strip-title, #inspector')?.textContent.trim().slice(0,30)`));
  await shot('/private/tmp/claude-501/qa/import1.jpg');
  console.log('annuler:', await ev(`(()=>{ const n=_undoStack.length; undoAction(); return 'piles='+n+' clips après='+state.project.tracks[0].clips.length+' bpm='+state.project.bpm })()`));
  // Un 2e fichier sur une autre piste : le tempo du projet change-t-il tout seul ?
  await ev(`(async()=>{ state.project.bpm=120; document.getElementById('bpmInput').value=120; _doAddTrack('audio'); const ctx=PulseAudio.getContext(); const sr=44100,n=sr*12,b=ctx.createBuffer(1,n,sr),d=b.getChannelData(0); const beat=60/100; for(let i=0;i<n;i++){const t=(i/sr)%beat; d[i]=t<0.04?Math.sin(2*Math.PI*70*t)*(1-t/0.04)*0.9:0;}
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'loop100.wav',{type:'audio/wav'}),1,0); })()`);
  await sleep(500);
  console.log('2e fichier : bpm projet après =', await ev(`state.project.bpm`), '(était 120)');
};
