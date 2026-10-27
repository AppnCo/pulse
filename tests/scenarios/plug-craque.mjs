// Chaque effet, réglages de départ : le son exporté ne contient ni NaN ni valeur démesurée ; puis ajout en pleine lecture
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pc1',name:'PC',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*3,sr); const d=b.getChannelData(0);
    for(let i=0;i<d.length;i++){ const env=(i%(sr/2))<9600?1:0.3; d[i]=env*(0.5*Math.sin(2*Math.PI*180*i/sr)+0.2*Math.sin(2*Math.PI*2500*i/sr)+0.1*(Math.random()*2-1)); }
    PulseAudio.registerBuffer('v',b);
    const names=Object.keys(FX_START); const out=[];
    for(const n of names){
      const params=JSON.parse(JSON.stringify(FX_START[n]||{}));
      const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id:'v',start:0,duration:3}],effects:[n],effectParams:{[n]:params}}]};
      try{
        const w=await PulseAudio.exportTrackWav(p,0); if(!w){out.push(n+': rien');continue;}
        const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer())).getChannelData(0);
        let bad=0,pk=0,sum=0; for(let i=0;i<x.length;i++){ const v=x[i]; if(!isFinite(v)) bad++; else { pk=Math.max(pk,Math.abs(v)); sum+=v*v; } }
        const rms=Math.sqrt(sum/x.length);
        out.push(n+': crête '+pk.toFixed(2)+' rms '+rms.toFixed(3)+(bad?' NaN='+bad:'')+(pk>1.2?' ⚠ DÉMESURÉ':'')+(rms<0.001?' ⚠ SILENCE':''));
      }catch(e){ out.push(n+': ERREUR '+e.message); }
    }
    return out.join('\\n');
  })()`));
};
