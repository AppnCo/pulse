// Gate : mêmes valeurs que le test Rust `gate_coupe_sous_le_seuil` (engine/src/lib.rs)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ga1',name:'Gate',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,output:'master',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('gate', `const ctx=await PulseAudio.init(); const sr=48000;
    const tone=(id,amp)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=amp*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer(id,b);};
    tone('fort',0.3); tone('faible',0.01);
    const rms=async(id,on)=>{const p={buses:[],tracks:[{volume:100,clips:[{id,start:0,duration:2}],effects:on?['gate']:[],effectParams:{gate:{threshold:-35,release:50,reduction:24}}}]};
      const b=await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer()); const d=b.getChannelData(0); let s=0,n=0; for(let i=sr;i<sr*1.8;i++){s+=d[i]*d[i];n++;} return Math.sqrt(s/n);};
    const db=async(id)=>20*Math.log10(await rms(id,true)/await rms(id,false));
    const o=[]; const chk=(nom,v,lo,hi)=>o.push((v>=lo&&v<=hi?'PASS ':'FAIL ')+nom+' '+v.toFixed(2)+' dB');
    chk('son fort (au-dessus du seuil) intact', await db('fort'), -0.2, 0.2);
    chk('bruit faible (sous le seuil) coupé de 24 dB', await db('faible'), -25, -23);
    return o.join('\\n');`);
};
