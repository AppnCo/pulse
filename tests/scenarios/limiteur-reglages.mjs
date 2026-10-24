// Limiteur : gain d'entrée, plafond, relâchement, pic réel — mêmes chiffres que limiteur_reglages (Rust)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'lr',name:'LR',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    // 12 kHz décalé d un huitième : les échantillons tombent toujours 3 dB sous les crêtes (pic réel > pic des échantillons)
    const b=ctx.createBuffer(2,sr,sr); for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<sr;i++) d[i]=0.3*Math.sin(2*Math.PI*12000*i/sr+Math.PI/4);} PulseAudio.registerBuffer('lim',b);
    const run=async(limit)=>{ const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id:'lim',start:0,duration:1}],effects:['limit'],effectParams:{limit}}]};
      const x=(await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      let s=0,pk=0; for(let i=sr/2;i<sr;i++){s+=x[i]*x[i]; pk=Math.max(pk,Math.abs(x[i]));} return (20*Math.log10(Math.sqrt(s/(sr/2)))).toFixed(2)+' dB (crête '+pk.toFixed(3)+')'; };
    return 'sans pic réel : '+await run({gain:12,ceiling:-1,release:50})+' | avec pic réel : '+await run({gain:12,ceiling:-1,release:50,tp:1})+' | gain 0 : '+await run({ceiling:-1});
  })()`));
};
