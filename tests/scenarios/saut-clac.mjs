// Saut de curseur et tour de boucle pendant la lecture : plus de coupure nette (écoute de la sortie, première différence d'un sinus)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const c = AudioNode.prototype.connect; window.__tap = null; AudioNode.prototype.connect = function (t, ...a) { if (t && t.constructor && t.constructor.name === 'AudioDestinationNode' && !window.__tap) window.__tap = this; return c.call(this, t, ...a); }; })();` });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sk1',name:'SK',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=ctx.sampleRate;
    const b=ctx.createBuffer(1,Math.round(sr*8),sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.3*Math.sin(2*Math.PI*200*i/sr);
    PulseAudio.registerBuffer('s',b);
    const t=state.project.tracks[0]; t.clips=[{id:'s',start:0,duration:8,offset:0,name:'s'}]; renderAll();
    const rec=[]; const sp=ctx.createScriptProcessor(512,2,1); window.__tap.connect(sp); const z=ctx.createGain(); z.gain.value=0; sp.connect(z); z.connect(ctx.destination);
    sp.onaudioprocess=(e)=>{ rec.push(Float32Array.from(e.inputBuffer.getChannelData(0))); };
    const grab=(from)=>{ const x=new Float32Array((rec.length-from)*512); let o=0; for(let k=from;k<rec.length;k++){ x.set(rec[k],o); o+=512; } return x; };
    // plus grand pas entre deux échantillons (un sinus 200 Hz à 0,3 n'en a pas plus de 0,0079) et plus long silence
    const stat=(x)=>{ let mx=0, zr=0, mz=0; for(let i=1;i<x.length;i++){ mx=Math.max(mx,Math.abs(x[i]-x[i-1])); if(Math.abs(x[i])<1e-6){zr++; mz=Math.max(mz,zr);} else zr=0; } return 'pas max '+mx.toFixed(4)+' (sinus pur 0,0079) · silence '+(mz/sr*1000).toFixed(1)+' ms'; };
    const out=[];
    state.playhead=0; await togglePlay(); await new Promise(r=>setTimeout(r,1200));
    let from=rec.length; seekPlayhead(3.3); await new Promise(r=>setTimeout(r,900)); out.push('saut du curseur : '+stat(grab(from)));
    from=rec.length; seekPlayhead(5.1); await new Promise(r=>setTimeout(r,900)); out.push('2e saut : '+stat(grab(from)));
    await togglePlay(); await new Promise(r=>setTimeout(r,300));
    state.loop={start:1,end:1.5}; state.looping=true; state.playhead=1.2; from=rec.length; await togglePlay(); await new Promise(r=>setTimeout(r,2300));
    out.push('3 tours de boucle (0,5 s) : '+stat(grab(from+8))+' · lecture='+state.playing);
    await togglePlay();
    return out.join('\\n');
  })()`));
};
