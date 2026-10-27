// EQ calé sur l'analogique : dans les aigus, la courbe suit un EQ analogique (avant : cloche trop étroite vers 20 kHz).
// Mesuré sur l'export ; mêmes chiffres que eq_cale_analogique (Rust).
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ea',name:'EA',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log('export / écran / analogique idéal :', await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    const lvl=async(f,fx)=>{ const b=ctx.createBuffer(2,sr,sr); for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<sr;i++) d[i]=0.25*Math.sin(2*Math.PI*f*i/sr);} PulseAudio.registerBuffer('s'+f,b);
      const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id:'s'+f,start:0,duration:1}],...fx}]};
      const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      let s=0; for(let i=sr/2;i<sr;i++) s+=x[i]*x[i]; return 20*Math.log10(Math.sqrt(s/(sr/2))); };
    const ana=(f0,g,q,f)=>{const A=Math.pow(10,g/40),w=f/f0,re=1-w*w,n=w*A/q,d=w/(A*q); return 10*Math.log10((re*re+n*n)/(re*re+d*d));};
    const cases=[[12000,6,0.7,18000],[16000,6,0.7,8000],[8000,-6,0.7,12000],[1000,6,1,1500]];
    const out=[];
    for(const [f0,g,q,f] of cases){ const fx={effects:['eq'],effectParams:{eq:{bands:[{type:'bell',freq:f0,gain:g,q}]}}};
      const d=(await lvl(f,fx))-(await lvl(f,{})); out.push('cloche '+g+' dB à '+f0+' mesurée à '+f+' : '+d.toFixed(2)+' / '+eqBandDb({type:'bell',freq:f0,gain:g,q},f).toFixed(2)+' / '+ana(f0,g,q,f).toFixed(2)); }
    return out.join('\\n  ');
  })()`));
};
