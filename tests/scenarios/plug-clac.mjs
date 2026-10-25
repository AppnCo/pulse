// Ajouter un plugin en pleine lecture : mesure le « clac » (saut dans le signal) et le trou de silence à la sortie
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  // on repère le nœud branché sur la sortie pour l'écouter sans rien changer au son
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const c = AudioNode.prototype.connect; window.__tap = null; AudioNode.prototype.connect = function (t, ...a) { if (t && t.constructor && t.constructor.name === 'AudioDestinationNode' && !window.__tap) window.__tap = this; return c.call(this, t, ...a); }; })();` });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pk1',name:'PK',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=ctx.sampleRate;
    const b=ctx.createBuffer(1,Math.round(sr*6),sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.3*Math.sin(2*Math.PI*200*i/sr);
    PulseAudio.registerBuffer('s',b);
    const t=state.project.tracks[0]; t.clips=[{id:'s',start:0,duration:6,offset:0,name:'s'}]; renderAll();
    if(!window.__tap) return 'nœud de sortie introuvable';
    const rec=[]; const sp=ctx.createScriptProcessor(512,2,1); window.__tap.connect(sp); const z=ctx.createGain(); z.gain.value=0; sp.connect(z); z.connect(ctx.destination);
    sp.onaudioprocess=(e)=>{ rec.push(Float32Array.from(e.inputBuffer.getChannelData(0))); };
    state.playhead=0; await togglePlay(); await new Promise(r=>setTimeout(r,1200));
    const mark=rec.length;
    const names=['eq','comp','reverb','limit'];
    const res=[];
    for(const n of names){
      const before=rec.length;
      t.effects=(t.effects||[]).concat([n]); t.effectParams=t.effectParams||{}; t.effectParams[n]=JSON.parse(JSON.stringify((typeof FX_START!=='undefined'&&FX_START[n])||{}));
      refreshPlaybackSoon(); await new Promise(r=>setTimeout(r,900));
      const x=new Float32Array((rec.length-before)*512); let o=0; for(let k=before;k<rec.length;k++){ x.set(rec[k],o); o+=512; }
      // saut : écart à la prédiction d'une sinusoïde (x[n] ≈ 2cosω·x[n−1] − x[n−2]) ; silence : plus de 20 échantillons à zéro de suite
      const w=2*Math.PI*200/sr, c=2*Math.cos(w); let worst=0, at=0, zeros=0, maxz=0;
      for(let i=2;i<x.length;i++){ if(Math.abs(x[i])<1e-6){ zeros++; maxz=Math.max(maxz,zeros);} else zeros=0; }
      for(let i=2;i<x.length;i++){ if(Math.abs(x[i])<1e-6||Math.abs(x[i-1])<1e-6) continue; const e=Math.abs(x[i]-(c*x[i-1]-x[i-2])); if(e>worst){worst=e;at=i;} }
      res.push(n+' : saut max '+worst.toFixed(3)+' (sinus pur ≈ 0,000) · trou de silence '+maxz+' éch. = '+(maxz/sr*1000).toFixed(1)+' ms');
    }
    await togglePlay();
    return res.join('\\n');
  })()`));
};
