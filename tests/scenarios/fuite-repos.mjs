// Fuite mémoire au repos (29/10) : projet de Ridwane (piste Rec armée), on ne touche à rien et on compte
import fs from 'fs';
export default async ({ ev, nav, send, sleep }) => {
  const proj = fs.readFileSync('/private/tmp/claude-501/-Users-redrecords/136c40af-3251-4dd1-8cf3-184585ce32d9/scratchpad/projet.json', 'utf8');
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', ${JSON.stringify(proj)}); 1`);
  await ev(`(()=>{})()`);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{ window.__cnt={}; const wrap=(name)=>{ const O=window[name]; if(!O) return; window[name]=new Proxy(O,{construct(t,a){ __cnt[name]=(__cnt[name]||0)+1; return Reflect.construct(t,a); }}); }; ['AudioWorkletNode','Float32Array','MessageChannel','Worker'].forEach(wrap); const AC=window.AudioContext; const pm=AudioContext.prototype; ['createGain','createBufferSource','createBuffer','createAnalyser','createBiquadFilter','createMediaStreamSource'].forEach(m=>{const f=pm[m]; pm[m]=function(...a){__cnt[m]=(__cnt[m]||0)+1; return f.apply(this,a)}}); const st=window.setTimeout; let nT=0; window.setTimeout=function(...a){nT++; __cnt.setTimeout=nT; return st.apply(this,a)}; const raf=window.requestAnimationFrame; window.requestAnimationFrame=function(f){__cnt.raf=(__cnt.raf||0)+1; return raf.call(this,f)}; })()` });
  await nav('http://localhost:8765/studio.html');
  for (let i = 0; i < 12; i++) {
    await sleep(15000);
    console.log(((i + 1) * 15) + ' s :', await ev(`JSON.stringify({heapMo: Math.round(performance.memory.usedJSHeapSize/1e6), ...__cnt})`));
  }
};
