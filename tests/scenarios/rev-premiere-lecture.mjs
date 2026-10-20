// Retour terrain 17/10 : dose de Rev sur une piste puis lecture -> page blanche + curseur à 0 (1ère fois)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rv1',name:'Rev',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('prépare un clip', `window.__marker=1; const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*6,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(2*Math.PI*220*i/sr); PulseAudio.registerBuffer('rv',b); state.project.tracks[0].clips=[{id:'rv',start:0,duration:6,name:'x'}]; renderTimelineTracks(); return 'ok'`);
  await ev(`toggleMixer()`); await sleep(400);
  for (const n of [1, 2]) {
    await R(`envoi Rev n°${n}`, `const t=state.project.tracks[0]; t.sends=t.sends||{}; t.sends.revlong=${n*20}; const sl=document.querySelector('.mixer-strips .strip[data-kind=track] [data-send=revlong] .send-level'); if(sl){sl.value=${n*20}; sl.dispatchEvent(new Event('input')); sl.dispatchEvent(new Event('change'));} state.playhead=1.5; updatePlayhead(); await togglePlay(); await new Promise(r=>setTimeout(r,1500)); const out='marqueur='+window.__marker+' | tête='+state.playhead.toFixed(2)+' | lecture='+state.playing; if(state.playing) await togglePlay(); return out`);
  }
};
