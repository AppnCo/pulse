// Après l'ajout d'un plugin en lecture : la position continue sans saut ; arrêt pendant le fondu = propre ; plusieurs ajouts de suite
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pp1',name:'PP',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=ctx.sampleRate,b=ctx.createBuffer(1,sr*8,sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.3*Math.sin(2*Math.PI*200*i/sr); PulseAudio.registerBuffer('s',b);
    const t=state.project.tracks[0]; t.clips=[{id:'s',start:0,duration:8,offset:0,name:'s'}]; renderAll(); state.playhead=0; await togglePlay(); })()`);
  await sleep(1500);
  await R('position : avant / après l ajout / attendu', `const t=state.project.tracks[0]; const p0=PulseAudio.getPlaybackPosition(), w0=performance.now(); t.effects=['eq']; t.effectParams={eq:{}}; refreshPlaybackSoon(); await new Promise(r=>setTimeout(r,800)); const p1=PulseAudio.getPlaybackPosition(), w1=performance.now(); const att=p0+(w1-w0)/1000; return p0.toFixed(3)+' → '+p1.toFixed(3)+' (attendu '+att.toFixed(3)+', écart '+Math.abs(p1-att).toFixed(3)+' s) lecture='+state.playing`);
  await R('3 ajouts rapprochés', `const t=state.project.tracks[0]; const p0=PulseAudio.getPlaybackPosition(), w0=performance.now(); for(const n of ['comp','limit','gate']){ t.effects.push(n); t.effectParams[n]={}; refreshPlaybackSoon(); await new Promise(r=>setTimeout(r,170)); } await new Promise(r=>setTimeout(r,600)); const p1=PulseAudio.getPlaybackPosition(), w1=performance.now(); const att=p0+(w1-w0)/1000; return 'écart de position '+Math.abs(p1-att).toFixed(3)+' s ; lecture='+state.playing`);
  await R('arrêt en plein fondu : plus aucun son', `const t=state.project.tracks[0]; t.effects.push('sat'); t.effectParams.sat={}; refreshPlaybackSoon(); await new Promise(r=>setTimeout(r,150)); await togglePlay(); await new Promise(r=>setTimeout(r,300)); return 'lecture='+state.playing`);
  await R('relancer après : ça joue encore', `state.playhead=0; await togglePlay(); await new Promise(r=>setTimeout(r,500)); const p=PulseAudio.getPlaybackPosition(); await togglePlay(); return 'position='+p.toFixed(2)`);
};
