// Retour terrain 29/10 : zoom jusqu'à voir la forme d'onde en ligne, échantillon par échantillon (comme Logic / Pro Tools)
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ze1',name:'Zoom',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7'}]})); 1`);
  await nav('http://localhost:8765/studio.html');
  const r = await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*120,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.6*Math.sin(2*Math.PI*440*i/sr)*Math.sin(2*Math.PI*0.5*i/sr);
    PulseAudio.registerBuffer('ze',b); state.project.tracks[0].clips=[{id:'ze',start:0,duration:120,offset:0,name:'voix'}]; renderTimelineTracks();
    const t0=performance.now(); setZoom(1e9, 10.25, true); const ms=Math.round(performance.now()-t0);
    await new Promise(r=>setTimeout(r,300));
    const line=document.querySelector('.clip .line-wave polyline'); const n=line?line.getAttribute('points').trim().split(' ').length:0;
    const w=document.querySelector('.timeline-track').getBoundingClientRect().width;
    return JSON.stringify({pps:Math.round(state.pxPerSecond), maxi:Math.round(zoomMax()), pxParEchantillon:+(state.pxPerSecond/sr).toFixed(2), ligne:!!line, points:n, largeurPiste:Math.round(w), ms});
  })()`);
  console.log('zoom maxi :', r);
  if (shot) await shot('/private/tmp/claude-501/-Users-redrecords/136c40af-3251-4dd1-8cf3-184585ce32d9/scratchpad/zoom.jpg');
  const o = JSON.parse(r);
  const ok = o.ligne && o.pxParEchantillon >= 1 && o.points > 100 && o.largeurPiste > 1e6 && o.ms < 1500;
  console.log(ok ? '✓ forme d\'onde en ligne au zoom maxi' : '✗ zoom maxi incomplet');
  // dézoom : on revient aux barres
  const back = await ev(`(async()=>{ setZoom(48, 10, true); await new Promise(r=>setTimeout(r,200)); return String(!!document.querySelector('.clip .line-wave')) })()`);
  console.log(back === 'false' ? '✓ dézoomé : barres habituelles' : '✗ la ligne reste au dézoom');
  if (!ok || back !== 'false') throw new Error('zoom-echantillon en échec');
};
