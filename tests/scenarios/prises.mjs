const SP = new URL('.', import.meta.url).pathname;
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 520, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_countin','0'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tk1',name:'Prises',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'},{name:'Instru',type:'audio',preset:'instru',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  // micro simulé : un oscillateur continu
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.3; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const dump = `const t=state.project.tracks[0]; const f=c=>takeLetter(c.take)+'['+c.start.toFixed(2)+'→'+(c.start+c.duration).toFixed(2)+' off'+(c.offset||0).toFixed(2)+']'; return 'devant: '+t.clips.slice().sort((a,b)=>a.start-b.start).map(f).join(' ')+' | rangé: '+(t.takes||[]).map(f).join(' ')+' | lignes: '+document.querySelectorAll('.take-lane').length+' ouvert:'+!!t.takesOpen;`;
  await ev(`toggleRec()`); await sleep(3200); await ev(`togglePlay()`); await sleep(400);
  await R('prise A', dump);
  await ev(`(async()=>{ state.playhead=1; updatePlayhead(); await toggleRec(); })()`); await sleep(1300); await ev(`togglePlay()`); await sleep(400);
  await R('prise B par-dessus', dump);
  await R('hauteurs alignées', `return document.getElementById('tracksList').scrollHeight+' vs '+document.getElementById('timelineTracks').scrollHeight`);
  await R('clic sur A rangée', `document.querySelector('.take-piece[data-pi]').click(); ${dump}`);
  await R('undo', `undoAction(); ${dump}`);
  await R('3e prise C', `state.playhead=0.5; updatePlayhead(); await toggleRec(); await new Promise(r=>setTimeout(r,1000)); await togglePlay(); await new Promise(r=>setTimeout(r,400)); ${dump}`);
  await R('export+pulse', `const w=await PulseAudio.exportWav(state.project); const pk=await PulseFile.pack(state.project); return 'wav '+w.size+' | .pulse clips '+pk.clips+' manquants '+pk.missing`);
  await R('mode superposer', `localStorage.setItem('pulse_rec_mode','overlap'); state.playhead=0; await toggleRec(); await new Promise(r=>setTimeout(r,700)); await togglePlay(); await new Promise(r=>setTimeout(r,300)); const t=state.project.tracks[0]; localStorage.removeItem('pulse_rec_mode'); return 'clips devant '+t.clips.length+', rangés '+t.takes.length`);
};
