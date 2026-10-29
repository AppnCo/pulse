// Fuite du 29/10 : un effet débranché doit s'arrêter pour de bon (sinon il tourne et envoie ses mesures pour toujours)
export default async ({ ev, nav, send, sleep }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ea1',name:'Arret',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',fx:[{type:'comp'},{type:'deess'},{type:'eq'}],clips:[]}]})); 1`);
  await nav('http://localhost:8765/studio.html');
  const r = await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*6,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(2*Math.PI*220*i/sr);
    PulseAudio.registerBuffer('ea',b); state.project.tracks[0].clips=[{id:'ea',start:0,duration:6,offset:0,name:'a'}]; renderTimelineTracks();
    // on espionne les processeurs : combien tournent encore après l'arrêt ?
    const before = window.__pulseWk.created;
    for (let k=0;k<6;k++){ if(!state.playing) await togglePlay(); await new Promise(r=>setTimeout(r,300)); if(state.playing) await togglePlay(); await new Promise(r=>setTimeout(r,100)); }
    await new Promise(r=>setTimeout(r,300));
    const w = window.__pulseWk;
    return JSON.stringify({ crees: w.created - before, arretes: w.retired, total: w.created });
  })()`);
  console.log('6 lectures / arrêts :', r);
  const o = JSON.parse(r);
  const ok = o.crees > 0 && o.arretes >= o.crees - 2;
  console.log(ok ? '✓ les effets des lectures arrêtées sont bien arrêtés' : '✗ des effets restent allumés');
  if (!ok) throw new Error('effets non arrêtés');
};
