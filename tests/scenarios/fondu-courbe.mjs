// Fondu arrondi : poignée au milieu de la courbe, son et dessin qui suivent
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'fc1',name:'Fondu',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`toggleRec()`); await sleep(2500); await ev(`togglePlay()`); await sleep(500);
  // niveau de l'export à mi-fondu (fondu d'entrée de 1 s sur le début du clip)
  const lvl = `const ctx=PulseAudio.getContext(); const b=await ctx.decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer()); const d=b.getChannelData(0); const c=state.project.tracks[0].clips[0]; const i0=Math.round((c.start+0.5)*b.sampleRate); let m=0; for(let i=i0-480;i<i0+480;i++) m=Math.max(m,Math.abs(d[i]));`;
  await R('fondu droit : niveau à mi-fondu', `const cc=state.project.tracks[0].clips[0]; cc.fadeIn=1; delete cc.fadeInCurve; ${lvl} return m.toFixed(4)`);
  await R('fondu arrondi k=2 : plus bas à mi-fondu', `state.project.tracks[0].clips[0].fadeInCurve=2; ${lvl} return m.toFixed(4)+' (attendu ≈ 1/2 du précédent)'`);
  await ev(`state.project.tracks[0].clips[0].fadeIn=1; delete state.project.tracks[0].clips[0].fadeInCurve; renderTimelineTracks()`); await sleep(150);
  await R('poignée présente', `return document.querySelectorAll('.fade-curve-handle').length+' poignée(s)'`);
  await R('tirer la poignée vers le bas = fondu arrondi', `const h=document.querySelector('.fade-curve-handle.in'); const r=h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.left+6,clientY:r.top+6,button:0}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+6,clientY:r.top+36})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    await new Promise(r=>setTimeout(r,80)); return 'fadeInCurve='+state.project.tracks[0].clips[0].fadeInCurve`);
  await R('double-clic = fondu droit', `document.querySelector('.fade-curve-handle.in').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,80)); return 'fadeInCurve='+state.project.tracks[0].clips[0].fadeInCurve`);
};
