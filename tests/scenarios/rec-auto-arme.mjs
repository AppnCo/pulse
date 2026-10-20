// Aucune piste armée : R arme tout seul la piste voix (« boum ça enregistre »)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('avant : armée', `return state.project.tracks.some(t=>t.armed)`);
  await ev(`toggleRec()`); await sleep(1500);
  await R('R sans rien armé : la piste 1 est armée et on enregistre', `return 'armée='+state.project.tracks[0].armed+' rec='+state.recording`);
  await ev(`toggleRec()`); await sleep(600);
  await R('stop : un clip posé', `return 'clips='+state.project.tracks[0].clips.length+' rec='+state.recording`);
  // Avec un instru déjà posé sur la piste 1 : la voix va sur une nouvelle piste, pas par-dessus
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  await R('instru posé puis R', `const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false);
    const sr=48000,b=ctx.createBuffer(1,sr*4,sr); b.getChannelData(0).fill(0.1);
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'instru.wav',{type:'audio/wav'}),0,0);
    state.selectedTrack=0; const n0=state.project.tracks.length; await toggleRec(); await new Promise(r=>setTimeout(r,1000));
    const ts=state.project.tracks; const r='pistes '+n0+'→'+ts.length+' ; instru seul sur la 1re='+(ts[0].clips.filter(c=>!c.recording).length===1)+' ; rec sur piste '+(ts.findIndex(t=>(t.clips||[]).some(c=>c.recording)))+' armée='+ts.some(t=>t.armed); await toggleRec(); return r`);
};
