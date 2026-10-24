// U = boucle calée sur la région choisie ; ⌘R = répéter la région une fois de plus (sans casser le reste)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'lu1',name:'LU',bpm:120,tracks:[{name:'Voix',clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html');
  await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const key = (k, code, mods = {}) => `document.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',code:'${code}',bubbles:true,cancelable:true,...${JSON.stringify(mods)}}));`;
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*6,sr); b.getChannelData(0).fill(0.1); PulseAudio.registerBuffer('k',b);
    const t=state.project.tracks[0]; t.clips=[{id:'k',start:2,duration:3,offset:0,name:'a'}]; state.selectedTrack=0; renderAll(); })()`);
  await R('U sans région choisie : la boucle ne bouge pas', `state.loop=null; state.selectedClip=null; state.selectedClips.clear(); ${key('u','KeyU')} return JSON.stringify(state.loop)`);
  await R('U avec région choisie : boucle 2→5, allumée', `state.selectedClip={trackIdx:0,clipIdx:0}; state.playhead=1; ${key('u','KeyU')} return JSON.stringify(state.loop)+' looping='+state.looping+' curseur='+state.playhead`);
  await R('⌘R : répétition ×2 (fin à 8)', `${key('r','KeyR',{metaKey:true})} const c=state.project.tracks[0].clips[0]; return 'loopEnd='+c.loopEnd+' duration='+c.duration`);
  await R('⌘R encore : ×3 (fin à 11)', `${key('r','KeyR',{metaKey:true})} return 'loopEnd='+state.project.tracks[0].clips[0].loopEnd`);
  await R('⌘Z annule une répétition (fin à 8)', `${key('z','KeyZ',{metaKey:true})} return 'loopEnd='+state.project.tracks[0].clips[0].loopEnd`);
  await R('D / F existent toujours (pas de régression sur les coupes)', `state.playhead=3; state.selectedClip={trackIdx:0,clipIdx:0}; const n=state.project.tracks[0].clips.length; ${key('f','KeyF')} return 'clips avant='+n+' après='+state.project.tracks[0].clips.length+' | fin région='+(state.project.tracks[0].clips[0].start+state.project.tracks[0].clips[0].duration)`);
};
