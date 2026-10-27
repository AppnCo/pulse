// Réglages, annulation d'une prise, encodeur MP3 local
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rg1',name:'Réglages',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const n = `state.project.tracks[0].clips.length+' devant / '+(state.project.tracks[0].takes||[]).length+' rangé'`;
  await ev(`toggleRec()`); await sleep(2200); await ev(`togglePlay()`); await sleep(400);
  await ev(`(async()=>{ state.playhead=0.5; await toggleRec(); })()`); await sleep(900); await ev(`togglePlay()`); await sleep(400);
  await R('2 prises', `return ${n}`);
  await R('⌘Z annule la 2e prise', `undoAction(); return ${n}+' — '+state.project.tracks[0].clips.map(c=>takeLetter(c.take)+'['+c.start.toFixed(1)+'→'+(c.start+c.duration).toFixed(1)+']').join(' ')`);
  await R('⌘Z annule la 1re', `undoAction(); return ${n}`);
  await R('rétablir x2', `redoAction(); redoAction(); return ${n}`);
  await R('mp3 local', `const w=await PulseAudio.exportWav(state.project); const m=await encodeToMp3(w,192); return 'lamejs='+(typeof lamejs)+' mp3 '+m.size+' octets'`);
  await R('export volume au maximum', `const ctx=PulseAudio.getContext(); const pk=async(o)=>{ const b=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(state.project,o)).arrayBuffer()); let m=0; for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c); for(let i=0;i<d.length;i++) m=Math.max(m,Math.abs(d[i]));} return (20*Math.log10(m)).toFixed(1); };
    return 'crête normale '+await pk({})+' dBFS → avec volume au maximum '+await pk({normalize:true})+' dBFS (cible -1.0)'`);
  await ev(`openSettings()`); await sleep(500);
  if (SHOTS) await shot(SHOTS + '/shot-settings.jpg');
  await R('réglages', `document.querySelector('input[name=recmode][value=overlap]').click(); document.getElementById('setBg').click(); document.getElementById('setCountIn').click();
    const r=JSON.stringify({mode:recMode(), bg:localStorage.getItem('pulse_bg_capture'), countIn:PulseAudio.isCountInEnabled()}); document.querySelector('input[name=recmode][value=takes]').click(); document.getElementById('setBg').click(); return r`);
  await R('retour casque', `document.getElementById('setMonitor').click(); await new Promise(r=>setTimeout(r,500)); const a=PulseAudio.isMonitorOn()+'/'+localStorage.getItem('pulse_monitor')+'/micro prêt='+PulseAudio.hasMic();
    document.getElementById('setMonitor').click(); await new Promise(r=>setTimeout(r,300)); return 'allumé: '+a+' | éteint: '+PulseAudio.isMonitorOn()+'/'+localStorage.getItem('pulse_monitor')`);
  await R('capture arrière-plan coupée', `localStorage.setItem('pulse_bg_capture','0'); document.getElementById('settingsModal')?.remove(); state.playhead=0; await togglePlay(); await new Promise(r=>setTimeout(r,500)); const c=PulseAudio.isCapturing(); await togglePlay(); return 'capture pendant la lecture: '+c`);
};
