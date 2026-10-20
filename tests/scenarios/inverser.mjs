// Inverser le son d'un clip : le son part à l'envers, la portion visible suit, on peut revenir
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rv1',name:'Rev',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*4,sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=i/d.length; PulseAudio.registerBuffer('k',b); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'a.wav',{type:'audio/wav'}),0,0); })()`);
  await sleep(500);
  await R('clip coupé : offset 1 s, durée 1 s', `const c=state.project.tracks[0].clips[0]; c.offset=1; c.duration=1; c.fadeIn=0.2; return 'ok'`);
  await R('inverser', `const c=state.project.tracks[0].clips[0]; const id0=c.id; await toggleReverse(c);
    const b=PulseAudio.getBuffer(c.id); const d=b.getChannelData(0);
    return 'rev='+!!c.rev+' début='+d[0].toFixed(2)+' (≈1.00) fin='+d[d.length-1].toFixed(2)+' (≈0.00) offset='+c.offset+' (2) fadeOut='+c.fadeOut+' (0.2) fadeIn='+c.fadeIn+' (undefined) src='+(c.rev&&c.rev.src===id0)`);
  await R('remettre à l\'endroit', `const c=state.project.tracks[0].clips[0]; await toggleReverse(c);
    const d=PulseAudio.getBuffer(c.id).getChannelData(0);
    return 'rev='+!!c.rev+' début='+d[0].toFixed(2)+' (0.00) offset='+c.offset+' (1) fadeIn='+c.fadeIn+' (0.2)'`);
  await R('annuler', `undoAction(); return 'rev après ⌘Z='+!!state.project.tracks[0].clips[0].rev`);
};
