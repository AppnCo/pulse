// Projet chargé : 24 pistes, ~300 régions, instru de 3 minutes — l'interface doit rester fluide
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('construction', `const ctx=await PulseAudio.init(); const sr=44100; const b=ctx.createBuffer(1,sr*8,sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.2*Math.sin(i/37);
    PulseAudio.registerBuffer('big', b); const peaks=makePeaks(b);
    const tracks=[]; for(let t=0;t<24;t++){ const clips=[]; for(let c=0;c<12;c++) clips.push({id:'big',name:'p'+c,start:c*9+(t%3),duration:8,offset:0,peaks}); tracks.push({name:'Piste '+(t+1),type:'audio',color:'#A855F7',output:'master',volume:80,clips}); }
    state.project.tracks=tracks; state.project.buses=[];
    const t0=performance.now(); renderAll(); const t1=performance.now();
    return 'pistes='+tracks.length+' régions='+tracks.length*12+' ; renderAll='+(t1-t0).toFixed(0)+' ms'`);
  await R('défilement / zoom', `const t0=performance.now(); for(let i=0;i<5;i++){ setZoom(state.pxPerSecond*1.15, 30); } const t1=performance.now(); return '5 zooms = '+(t1-t0).toFixed(0)+' ms'`);
  await R('lecture : curseur pendant 2 s', `state.playhead=0; await togglePlay(); const t0=performance.now(); let frames=0; await new Promise(r=>{ const f=()=>{ frames++; if(performance.now()-t0<2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); await togglePlay(); return frames+' images en 2 s (≈ '+(frames/2).toFixed(0)+' i/s)'`);
  await R('redimensionner une piste (Option + molette)', `const t0=performance.now(); resizeOneHeight({kind:'track',id:3},1.2); return (performance.now()-t0).toFixed(0)+' ms'`);
};
