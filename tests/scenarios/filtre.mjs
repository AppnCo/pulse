// Filtre (coupe-bas / coupe-haut) : mêmes valeurs que le test Rust `filtre_coupe_bas_et_haut` (engine/src/lib.rs)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'fi1',name:'Filtre',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,output:'master',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('filtre', `const ctx=await PulseAudio.init(); const sr=48000;
    const tone=(id,f)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(2*Math.PI*f*i/sr); PulseAudio.registerBuffer(id,b);};
    [30,100,200,1000,5000,12000].forEach(f=>tone('t'+f,f));
    const rms=async(id,fp)=>{const p={buses:[],tracks:[{volume:100,clips:[{id,start:0,duration:2}],effects:fp?['filter']:[],effectParams:{filter:fp||{}}}]};
      const b=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer()); const d=b.getChannelData(0); let s=0,n=0; for(let i=sr*0.5;i<sr*1.5;i++){s+=d[i]*d[i];n++;} return Math.sqrt(s/n);};
    const db=async(f,fp)=>20*Math.log10(await rms('t'+f,fp)/await rms('t'+f,null));
    const o=[]; const chk=(nom,v,lo,hi)=>o.push((v>=lo&&v<=hi?'PASS ':'FAIL ')+nom+' '+v.toFixed(2)+' dB');
    const a={hpf:200,lpf:5000,slope:12}, b={hpf:200,slope:24}, off={hpf:20,lpf:20000};
    chk('12 dB : 200 Hz (coupure)', await db(200,a), -3.5,-2.5);
    chk('12 dB : 100 Hz (octave sous)', await db(100,a), -14.5,-11.5);
    chk('12 dB : 5 kHz (coupure haut)', await db(5000,a), -3.5,-2.5);
    chk('12 dB : 1 kHz intact', await db(1000,a), -0.5,0.5);
    chk('24 dB : 200 Hz', await db(200,b), -3.5,-2.5);
    chk('24 dB : 100 Hz', await db(100,b), -60,-22);
    chk('éteint : 30 Hz transparent', await db(30,off), -0.05,0.05);
    chk('éteint : 12 kHz transparent', await db(12000,off), -0.05,0.05);
    return o.join('\\n');`);
  await R('exceptions', `return 'aucune'`);
};
