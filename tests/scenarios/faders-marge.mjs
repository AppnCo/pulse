// Faders avec marge au-dessus de 0 dB : 0 dB aux 3/4 de la course, +6 dB en haut ; le son suit à l'export
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'fm1',name:'FM',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:80}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*2,sr); b.getChannelData(0).fill(0.1); PulseAudio.registerBuffer('k',b); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'a.wav',{type:'audio/wav'}),0,0); state.mixerOpen=true; renderMixer(); bindMixerEvents(); })()`);
  await sleep(500);
  const set = (pos) => `const f=document.querySelector('.strip[data-kind="track"] .fader'); f.value=${pos}; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true}));`;
  await R('départ : 80 → -1.9 dB, curseur à 60 %', `const f=document.querySelector('.strip[data-kind="track"] .fader'); return 'pos='+f.value+' (60) volume='+state.project.tracks[0].volume+' db='+document.querySelector('.strip[data-kind="track"] .strip-db').textContent`);
  await R('3/4 de la course = 0 dB', `${set(75)} return 'volume='+state.project.tracks[0].volume+' (100) '+document.querySelector('.strip[data-kind="track"] .strip-db').textContent`);
  await R('tout en haut = +6 dB', `${set(100)} return 'volume='+state.project.tracks[0].volume+' (200) '+document.querySelector('.strip[data-kind="track"] .strip-db').textContent`);
  await R('saisie +3 dB au clavier', `const el=document.querySelector('.strip[data-kind="track"] .strip-db'); el.click(); const i=el.querySelector('input'); i.value='+3'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return 'volume='+state.project.tracks[0].volume+' (141) pos='+document.querySelector('.strip[data-kind="track"] .fader').value+' '+document.querySelector('.strip[data-kind="track"] .strip-db').textContent`);
  await R('+9 dB tapé : plafonné à +6', `const el=document.querySelector('.strip[data-kind="track"] .strip-db'); el.click(); const i=el.querySelector('input'); i.value='9'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return 'volume='+state.project.tracks[0].volume+' (200)'`);
  await R('double-clic = valeur d\'origine', `const f=document.querySelector('.strip[data-kind="track"] .fader'); f.value=f.dataset.default; f.dispatchEvent(new Event('input',{bubbles:true})); return 'volume='+state.project.tracks[0].volume+' (80)'`);
  await R('export : +6 dB = deux fois plus fort que 0 dB', `const ctx=PulseAudio.getContext(); const at=async(v)=>{ const p=JSON.parse(JSON.stringify(state.project)); p.tracks[0].volume=v; const w=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer()); return Math.abs(w.getChannelData(0)[48000]); };
    const a=await at(100), b=await at(200); return 'rapport='+(b/a).toFixed(2)+' (≈2.00)'`);
};
