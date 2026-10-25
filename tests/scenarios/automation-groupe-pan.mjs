// Courbe de pan sur un groupe : le son part à gauche puis à droite (la valeur fixe ne doit pas écraser la courbe)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gp',name:'GP',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const out = await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000; const b=ctx.createBuffer(1,sr*4,sr),d=b.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('gp',b);
    const p={bpm:120,sends:[],buses:[{id:'g',name:'G',output:'master',volume:100,pan:0,automation:{pan:{points:[{t:0,v:0},{t:2,v:0},{t:2.5,v:1}]}}}],
      tracks:[{volume:100,output:'g',clips:[{id:'gp',start:0,duration:4}]}]};
    const buf=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer());
    const L=buf.getChannelData(0), R=buf.getChannelData(1);
    const rms=(x,a,z)=>{let s=0; for(let i=a*sr;i<z*sr;i++)s+=x[i]*x[i]; return Math.sqrt(s/((z-a)*sr));};
    return JSON.stringify({debutL:rms(L,0.3,1.5),debutR:rms(R,0.3,1.5),finL:rms(L,2.8,3.7),finR:rms(R,2.8,3.7)});
  })()`);
  const r = JSON.parse(out);
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  ok(r.debutL > r.debutR * 10, `groupe : à gauche au début (G ${r.debutL.toFixed(3)} / D ${r.debutR.toFixed(3)})`);
  ok(r.finR > r.finL * 10, `groupe : à droite à la fin (G ${r.finL.toFixed(3)} / D ${r.finR.toFixed(3)})`);
};
