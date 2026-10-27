// Boucle sans trou : le tour suivant démarre pile à la fin de boucle (signal = rampe qui code la position)
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const c = AudioNode.prototype.connect; window.__tap = null; AudioNode.prototype.connect = function (t, ...a) { if (t && t.constructor && t.constructor.name === 'AudioDestinationNode' && !window.__tap) window.__tap = this; return c.call(this, t, ...a); }; })();` });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'bt1',name:'BT',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=ctx.sampleRate;
    const b=ctx.createBuffer(1,sr*4,sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.1+0.2*i/d.length;   // 0,1 à 0 s … 0,3 à 4 s
    PulseAudio.registerBuffer('r',b);
    const t=state.project.tracks[0]; t.clips=[{id:'r',start:0,duration:4,offset:0,name:'r'}]; renderAll();
    const rec=[]; const sp=ctx.createScriptProcessor(512,2,1); window.__tap.connect(sp); const z=ctx.createGain(); z.gain.value=0; sp.connect(z); z.connect(ctx.destination);
    sp.onaudioprocess=(e)=>{ rec.push(Float32Array.from(e.inputBuffer.getChannelData(0))); };
    state.loop={start:1,end:1.5}; state.looping=true; state.playhead=1; await togglePlay(); const from=rec.length; await new Promise(r=>setTimeout(r,2600)); await togglePlay();
    const x=new Float32Array((rec.length-from)*512); let o=0; for(let k=from;k<rec.length;k++){ x.set(rec[k],o); o+=512; }
    const drops=[]; for(let i=300;i<x.length-300;i++){ if(x[i-250]-x[i+250]>0.008 && x[i-250]>0.01){ const mid=(x[i-250]+x[i+250])/2; let k=i-250; while(k<i+250 && x[k]>mid) k++; drops.push(k); i+=4000; } }
    const gaps=drops.slice(1).map((v,k)=>v-drops[k]);
    let zeros=0,mz=0; for(let i=drops[0]||0;i<x.length-2000;i++){ if(Math.abs(x[i])<1e-4){zeros++; mz=Math.max(mz,zeros);} else zeros=0; }
    const ratio=drops.length? (x[drops[0]-300]/x[drops[0]+300]) : 0;   // juste avant / juste après : ~(0,1+0,2·1,5/4)/(0,1+0,2·1/4)
    return JSON.stringify({tours:drops.length, ecarts:gaps, silenceMax:mz, ratio:+ratio.toFixed(3), attendu:+((0.1+0.2*1.5/4)/(0.1+0.2*1.00625/4)).toFixed(3), sr});
  })()`));
  console.log(JSON.stringify(r));
  check('au moins 3 tours de boucle', r.tours >= 3, r.tours);
  check('un tour = 0,5 s pile (± 2 échantillons)', r.ecarts.length && r.ecarts.every(g => Math.abs(g - r.sr / 2) <= 2), r.ecarts.join(','));
  check('aucun silence au raccord', r.silenceMax < 5, r.silenceMax);
  check('le son repart bien du début de boucle', Math.abs(r.ratio - r.attendu) < 0.02, r.ratio + ' / ' + r.attendu);
  // 2) pendant la boucle : on ajoute un plugin, puis on raccourcit la boucle à 0,4 s
  const r2 = JSON.parse(await ev(`(async()=>{
    const ctx=PulseAudio.getContext(), sr=ctx.sampleRate, t=state.project.tracks[0];
    const rec=[]; const sp=ctx.createScriptProcessor(512,2,1); window.__tap.connect(sp); const z=ctx.createGain(); z.gain.value=0; sp.connect(z); z.connect(ctx.destination);
    sp.onaudioprocess=(e)=>{ rec.push(Float32Array.from(e.inputBuffer.getChannelData(0))); };
    state.loop={start:1,end:1.5}; state.looping=true; state.playhead=1; await togglePlay(); const from=rec.length;
    await new Promise(r=>setTimeout(r,700)); t.effects=['util']; t.effectParams={util:{gain:0}}; refreshPlaybackSoon();
    await new Promise(r=>setTimeout(r,900)); state.loop={start:1,end:1.4};
    await new Promise(r=>setTimeout(r,2400)); await togglePlay();
    const x=new Float32Array((rec.length-from)*512); let o=0; for(let k=from;k<rec.length;k++){ x.set(rec[k],o); o+=512; }
    const drops=[]; for(let i=300;i<x.length-300;i++){ if(x[i-250]-x[i+250]>0.006 && x[i-250]>0.01){ const mid=(x[i-250]+x[i+250])/2; let k=i-250; while(k<i+250 && x[k]>mid) k++; drops.push(k); i+=4000; } }
    let zeros=0,mz=0; for(let i=(drops[0]||0);i<x.length-3000;i++){ if(Math.abs(x[i])<1e-4){zeros++; mz=Math.max(mz,zeros);} else zeros=0; }
    const gaps=drops.slice(1).map((v,k)=>v-drops[k]);
    return JSON.stringify({gaps, silenceMax:mz, sr});
  })()`));
  console.log(JSON.stringify(r2));
  // les tours après le premier raccord raccourci (le nombre de tours dépend de la charge de la machine : on ne compte pas sur « les 2 derniers »)
  const cut = r2.gaps.findIndex(g => g < r2.sr * 0.45);
  const after = cut < 0 ? [] : r2.gaps.slice(cut + 1);
  check('plugin ajouté pendant la boucle puis boucle raccourcie : aucun silence', r2.silenceMax < 5, r2.silenceMax);
  check('après le changement, un tour = 0,4 s', after.length >= 2 && after.every(g => Math.abs(g - r2.sr * 0.4) <= 2), r2.gaps.join(','));
};
