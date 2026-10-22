// Gros WAV (4 min stéréo) déposé comme instru : mesure les saccades de l'interface pendant la lecture
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1')`);
  await nav('http://localhost:8765/index.html');
  const SR = process.env.SR || 44100, SEC = process.env.SEC || 240;
  const t0 = Date.now();
  await ev(`(async()=>{ const sr=${SR}, sec=${SEC}, n=sr*sec, buf=new ArrayBuffer(44+n*4), v=new DataView(buf); const W=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    W(0,'RIFF'); v.setUint32(4,36+n*4,true); W(8,'WAVEfmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,2,true); v.setUint32(24,sr,true); v.setUint32(28,sr*4,true); v.setUint16(32,4,true); v.setUint16(34,16,true); W(36,'data'); v.setUint32(40,n*4,true);
    const beat=60/100; for(let i=0;i<n;i++){ const t=(i/sr)%beat; const x=(t<0.04? Math.sin(2*Math.PI*70*t)*(1-t/0.04)*20000:0)+Math.sin(i*0.05)*3000; v.setInt16(44+i*4,x,true); v.setInt16(46+i*4,x,true); }
    window.__p = startFromInstru(new File([buf],'gros.wav',{type:'audio/wav'})); })()`);
  await ev(`window.__p`); await sleep(12000);
  console.log('import (ms, approx):', Date.now() - t0, await ev(`location.pathname+' clips:'+state.project.tracks.map(t=>t.clips.length)`));
  await nav('http://localhost:8765/studio.html'); await sleep(3000);
  await ev(`(()=>{ window.__gaps=[]; let last=performance.now(); const f=()=>{const n=performance.now(); window.__gaps.push(n-last); last=n; requestAnimationFrame(f)}; requestAnimationFrame(f);
    window.__lt=[]; try{ new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(Math.round(e.duration)))).observe({entryTypes:['longtask']}) }catch(e){} })()`);
  const Z=process.env.ZOOM; if(Z) await ev(`setZoom(${Z}); 0`); await sleep(500);
  await ev(`togglePlay()`); await sleep(10000);
  console.log('lecture:', await ev(`(()=>{const g=window.__gaps; const big=g.filter(x=>x>50); return JSON.stringify({frames:g.length, max:Math.round(Math.max(...g)), gaps50:big.length, longtasks:window.__lt, playing:state.playing, playhead:state.playhead.toFixed(1), ctx:PulseAudio.getContext().state})})()`));
  await ev(`togglePlay()`);
};
