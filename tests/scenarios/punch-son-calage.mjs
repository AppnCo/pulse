const SP = new URL('.', import.meta.url).pathname;
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pn1',name:'Punch',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); PulseAudio.getMasterAnalyser().connect(md); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); window._voice=g; navigator.mediaDevices.getUserMedia=async()=>md.stream; })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const dump = `const t=state.project.tracks[0]; const f=c=>takeLetter(c.take)+'['+c.start.toFixed(2)+'→'+(c.start+c.duration).toFixed(2)+' off'+(c.offset||0).toFixed(2)+']'; return 'devant: '+t.clips.slice().sort((a,b)=>a.start-b.start).map(f).join(' ')+' | rangé: '+(t.takes||[]).map(f).join(' ')+' | lecture:'+state.playing+' rec:'+state.recording+' curseur:'+state.playhead.toFixed(2);`;
  await R('calage auto', `window._voice.gain.value=0; const r=await PulseAudio.calibrateLatency(); window._voice.gain.value=0.2; return JSON.stringify(r)+' réglage manuel='+localStorage.getItem('pulse_latency_ms')+'ms total='+(PulseAudio.getRoundTripLatency()*1000).toFixed(1)+'ms'`);
  await R('calage sans son', `PulseAudio.setMasterVolume(0); window._voice.gain.value=0; const r=await PulseAudio.calibrateLatency(); PulseAudio.setMasterVolume(100); window._voice.gain.value=0.2; return JSON.stringify(r)`);
  await ev(`PulseAudio.setCountIn(false); toggleRec()`); await sleep(6200); await ev(`togglePlay()`); await sleep(400);
  await R('prise A (6 s)', dump);
  // punch sur 4.5 → 5.5 (élan de 2 mesures = 4 s à 120 bpm → départ 0.5)
  await ev(`state.selection={start:4.5,end:5.5}; toggleRec()`); await sleep(1200);
  await R('pendant élan', `return 'curseur '+state.playhead.toFixed(2)+' rec:'+state.recording+' clip rouge largeur '+(document.querySelector('.clip.is-recording')?.style.width)`);
  await sleep(5200);
  await R('punch fini tout seul', dump);
  await R('son', `const t=state.project.tracks[0]; t.sound={preset:'phone',tone:0,hold:60,drive:35}; applySound(t); const a=JSON.stringify(t.effects)+' '+JSON.stringify(t.effectParams.eq); t.sound={preset:'lead',tone:-100,hold:35,drive:0}; applySound(t); const w=await PulseAudio.exportWav(state.project); return a+' | lead clair: '+JSON.stringify(t.effectParams)+' | export '+w.size`);
  await ev(`toggleMixer()`); await sleep(600); await ev(`document.querySelector('.mixer-strips .strip-sound').click()`); await sleep(300);
};
