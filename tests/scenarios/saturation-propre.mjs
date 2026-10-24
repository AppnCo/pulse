// Saturation suréchantillonnée ×4 : plus de fréquences parasites (repliement) quand on pousse.
// 7 kHz à fond : les harmoniques 35 kHz et 49 kHz se replient à 13 kHz et 1 kHz sans suréchantillonnage.
// Mêmes chiffres que saturation_sans_parasites (Rust).
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sp',name:'SP',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log('niveaux :', await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    const run=async(f,a,fx)=>{ const b=ctx.createBuffer(2,sr,sr); for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<sr;i++) d[i]=a*Math.sin(2*Math.PI*f*i/sr);} PulseAudio.registerBuffer('s'+f+a,b);
      const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id:'s'+f+a,start:0,duration:1}],...fx}]};
      return (await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0); };
    const goertzel=(x,f)=>{ let re=0,im=0; for(let i=sr/4;i<sr*3/4;i++){const w=0.5-0.5*Math.cos(2*Math.PI*(i-sr/4)/(sr/2)); re+=x[i]*w*Math.cos(2*Math.PI*f*i/sr); im+=x[i]*w*Math.sin(2*Math.PI*f*i/sr);} return Math.hypot(re,im); };
    const fx={effects:['sat'],effectParams:{sat:{drive:100}}};
    const x=await run(7000,0.5,fx), f0=goertzel(x,7000);
    const db=(v)=>(20*Math.log10(v/f0+1e-12)).toFixed(1);
    const g1=await run(1000,0.25,{effects:['sat'],effectParams:{sat:{drive:50}}}), ref=await run(1000,0.25,{});
    let s1=0,s0=0; for(let i=sr/2;i<sr;i++){s1+=g1[i]*g1[i]; s0+=ref[i]*ref[i];}
    return 'parasite 13 kHz '+db(goertzel(x,13000))+' dB, 1 kHz '+db(goertzel(x,1000))+' dB (sans suréchantillonnage ≈ −22) ; 3e harmonique 21 kHz '+db(goertzel(x,21000))+' dB ; gain à 1 kHz drive 50 : '+(10*Math.log10(s1/s0)).toFixed(2)+' dB';
  })()`));
};
