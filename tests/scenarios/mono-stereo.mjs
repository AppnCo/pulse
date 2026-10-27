// Retour terrain 17/10 : choisir mono / stéréo sur la piste (comme Logic)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ms1',name:'Mono',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('piste stéréo (G=0,2 / D=0,6)', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(2,sr*2,sr); b.getChannelData(0).fill(0.2); b.getChannelData(1).fill(0.6); PulseAudio.registerBuffer('st',b); state.project.tracks[0].clips=[{id:'st',start:0,duration:1.5,name:'x'}]; renderTracksPanel(); bindTrackEvents(); renderInspector(); return document.querySelector('.insp-mono').textContent`);
  const mix = `const o=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer()); const k=Math.floor(sr*0.5); return o.getChannelData(0)[k].toFixed(3)+' / '+o.getChannelData(1)[k].toFixed(3)`;
  await R('export stéréo (attendu 0.160 / 0.480, volume maître 0,8)', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; ${mix}`);
  await R('clic sur Stéréo → Mono', `document.querySelector('.insp-mono').click(); await new Promise(r=>setTimeout(r,200)); return document.querySelector('.insp-mono').textContent+' mono='+state.project.tracks[0].mono`);
  await R('export mono (attendu 0.226 / 0.226)', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; ${mix}`);
  await R('retour en stéréo', `document.querySelector('.insp-mono').click(); await new Promise(r=>setTimeout(r,200)); return document.querySelector('.insp-mono').textContent+' mono='+state.project.tracks[0].mono`);
};
