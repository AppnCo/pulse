// Effets de mouvement (chorus, flanger, phaser, trémolo, doubleur, slapback, bitcrusher, utilitaire) : mêmes chiffres que `mouvement_mesures` (engine/src/lib.rs) (engine/src/lib.rs)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mo1',name:'Mouvement',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,output:'master',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('mouvement', `const ctx=await PulseAudio.init(); const sr=48000;
    const tone=(id,f)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.25*Math.sin(2*Math.PI*f*i/sr); PulseAudio.registerBuffer(id,b);};
    tone('t440',440); tone('t1000',1000);
    const rms=async(id,fx)=>{const p={buses:[],tracks:[{volume:100,clips:[{id,start:0,duration:2}],effects:fx?[fx]:[],effectParams:{}}]};
      const b=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer()); const d=b.getChannelData(0); let s=0,n=0; for(let i=sr;i<sr*2;i++){s+=d[i]*d[i];n++;} return Math.sqrt(s/n);};
    const db=async(f,fx)=>20*Math.log10(await rms('t'+f,fx)/await rms('t'+f,null));
    const REF={chorus:[-3.501,-2.838],flanger:[0.860,-3.512],phaser:[-2.256,-4.896],tremolo:[-2.264,-2.264],doubler:[-2.365,-3.127],slapback:[-4.868,0.291],crush:[-0.005,0.045],util:[0,0]};
    const o=[]; for(const [fx,[a,b]] of Object.entries(REF)){ const x=await db(440,fx), y=await db(1000,fx);
      const ok=Math.abs(x-a)<0.15&&Math.abs(y-b)<0.15; o.push((ok?'PASS ':'FAIL ')+fx+' 440='+x.toFixed(3)+' (Rust '+a+') 1000='+y.toFixed(3)+' (Rust '+b+')'); }
    return o.join('\\n');`);
};
