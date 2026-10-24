import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send);
  await boot(c, { id: 'tp', name: 'TunePiste', bpm: 90, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Voix 2', type: 'audio', color: '#22D3EE', clips: [] }] });
  const voice = (t0) => `(async()=>{ const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr*3,sr),d=b.getChannelData(0); let ph=0;
    for(let i=0;i<d.length;i++){ ph+=2*Math.PI*452/sr; let s=0; for(let h=1;h<=8;h++) s+=Math.sin(h*ph)/h; d[i]=0.3*s; }
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,${t0}); })()`;
  await ev(`PulseAudio.init()`);
  await ev(`(async()=>{await PulseAudio.init()})()`);
  await ev(voice(0)); await ev(voice(4)); await sleep(500);
  // Piste armée pour que l'import n'en fasse pas une instru
  console.log('type piste', await ev(`state.project.tracks[0].type+' / clips '+state.project.tracks[0].clips.length`));
  await ev(`state.project.tracks[0].type='audio'; renderAll()`);
  await ev(`openTunePanel(0,-1,300,200,true)`); await sleep(300);
  await ev(`document.querySelector('.tune-quick [data-q="all"]').click()`);
  await ev(`document.querySelector('.tb-power').click()`);
  await sleep(6000);
  const st = () => ev(`JSON.stringify({auto:state.project.tracks[0].autotune&&state.project.tracks[0].autotune.on, tuned:state.project.tracks[0].clips.map(c=>!!c.tune), undo:_undoStack.length, tag:document.querySelectorAll('.clip-gain-tag').length})`);
  console.log('après activation', await st());
  await ev(`undoAction()`); await sleep(500);
  console.log('après 1 ⌘Z', await st(), '| bouton Tune actif dans le mixeur :', await ev(`(toggleMixer(), document.querySelector('.strip[data-i="0"] .insp-fx-row[data-fx="tune"]')?.classList.contains('on'))`));
  await ev(`toggleMixer()`);
  await ev(`undoAction()`); await sleep(500);
  console.log('après 2 ⌘Z', await st());
  await ev(`undoAction()`); await sleep(500);
  console.log('après 3 ⌘Z', await st(), await ev(`document.getElementById('flash').textContent`));
  // Nouveau clip importé après activation : est-il corrigé ?
  await ev(`openTunePanel(0,-1,300,200,true)`); await sleep(200);
  await ev(`document.querySelector('.tune-quick [data-q="all"]').click(); document.querySelector('.tb-power').click()`); await sleep(5000);
  await ev(voice(8)); await sleep(1500);
  console.log('3e clip importé sur piste Tune : corrigé ?', await st());
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
};
