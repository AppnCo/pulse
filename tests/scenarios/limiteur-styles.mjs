// Limiteur : styles Transparent / Doux / Franc — mêmes chiffres que limiteur_styles (Rust)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ls',name:'LS',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    // 1 s : 100 Hz fort pendant 0,25 s, puis plus doux (0,05) : on mesure le niveau pendant le fort, puis juste après (relâchement)
    const b=ctx.createBuffer(2,sr,sr); for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<sr;i++) d[i]=(i<sr/4?0.9:0.05)*Math.sin(2*Math.PI*100*i/sr);} PulseAudio.registerBuffer('lst',b);
    const run=async(limit)=>{ const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id:'lst',start:0,duration:1}],effects:['limit'],effectParams:{limit}}]};
      const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      const rms=(a,z)=>{let s=0; for(let i=Math.round(a*sr);i<Math.round(z*sr);i++) s+=x[i]*x[i]; return 20*Math.log10(Math.sqrt(s/Math.round((z-a)*sr))+1e-9);};
      let pk=0; for(let i=0;i<sr;i++) pk=Math.max(pk,Math.abs(x[i]));
      return [rms(0.05,0.25).toFixed(2), rms(0.26,0.30).toFixed(2), rms(0.40,0.50).toFixed(2), pk.toFixed(3)].join(' / '); };
    const base={gain:6,ceiling:-3,release:120};
    return 'fort / juste après / plus tard / crête\\nTransparent : '+await run(base)+'\\nDoux : '+await run({...base,style:1})+'\\nFranc : '+await run({...base,style:2});
  })()`));
};
