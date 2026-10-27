// Gate : ratio (expandeur), genou, attaque, maintien, filtre du déclencheur — mêmes chiffres que gate_reglages (Rust)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gr',name:'GR',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    // 0,5 s fort (300 Hz à 0,5), puis 0,5 s faible (300 Hz à 0,01) ; et un grondement grave (50 Hz à 0,1)
    const mk=(id,fn)=>{const b=ctx.createBuffer(2,sr,sr); for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<sr;i++) d[i]=fn(i);} PulseAudio.registerBuffer(id,b);};
    mk('voix',i=>(i<sr/2?0.5:0.01)*Math.sin(2*Math.PI*300*i/sr)); mk('grave',i=>0.1*Math.sin(2*Math.PI*50*i/sr));
    const lvl=async(id,gate,a,z)=>{ const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id,start:0,duration:1}],effects:['gate'],effectParams:{gate}}]};
      const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      let s=0; for(let i=Math.floor(a*sr);i<Math.floor(z*sr);i++) s+=x[i]*x[i]; return (20*Math.log10(Math.sqrt(s/((z-a)*sr))+1e-12)).toFixed(2); };
    const exp={threshold:-30,reduction:30,ratio:4,knee:6,attack:2,hold:20,release:80};
    return 'gate franc (son d avant) faible : '+await lvl('voix',{threshold:-30},0.7,0.95)+' | expandeur 4:1 faible : '+await lvl('voix',exp,0.7,0.95)+' | fort : '+await lvl('voix',exp,0.1,0.45)+' | grondement sans filtre : '+await lvl('grave',{threshold:-30},0.5,0.95)+' | avec coupe-bas 200 Hz : '+await lvl('grave',{threshold:-30,hp:200},0.5,0.95);
  })()`));
};
