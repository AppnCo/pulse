// Compresseur Propre avec maintien des crêtes : le navigateur donne les mêmes chiffres que le moteur Rust
// (compresseur_comme_le_navigateur, compresseur_genou_et_rattrapage, compresseur_parallele, comp_basses_sans_distorsion)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cp',name:'CP',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    const run=async(f,a,fx,sec=2)=>{ const id='c'+f+'_'+a; const b=ctx.createBuffer(2,sr*sec,sr); for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<d.length;i++) d[i]=a*Math.sin(2*Math.PI*f*i/sr);} PulseAudio.registerBuffer(id,b);
      const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id,start:0,duration:sec}],...fx}]};
      return (await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0); };
    const rms=(x,a,z)=>{let s=0; for(let i=Math.floor(a*sr);i<Math.floor(z*sr);i++) s+=x[i]*x[i]; return Math.sqrt(s/((z-a)*sr)); };
    const gain=async(f,a,fx)=>{ const y=await run(f,a,fx), x=await run(f,a,{}); return (20*Math.log10(rms(y,0.5,2)/rms(x,0.5,2))).toFixed(2); };
    const C=(o)=>({effects:['comp'],effectParams:{comp:o}});
    const out=[];
    const A={ratio:3.08,threshold:-20,attack:10,release:50};
    out.push('navigateur-like : faible '+await gain(300,0.03,C(A))+' normale '+await gain(300,0.3,C(A))+' forte '+await gain(300,0.7,C(A))+'   (Rust 4.73 / -1.72 / -6.69)');
    const G=(knee,makeup)=>C({threshold:-20,ratio:4,attack:10,release:50,knee,makeup});
    out.push('genou : seuil net '+await gain(300,0.1,G(0,0))+' / doux '+await gain(300,0.1,G(24,0))+' / forte '+await gain(300,0.5,G(0,0))+' / rattrapage '+await gain(300,0.5,G(0,6))+'   (Rust 0.00 / -2.25 / -10.48 / -4.48)');
    out.push('parallèle : 0 % '+await gain(300,0.7,C({...A,mix:0}))+' / 50 % '+await gain(300,0.7,C({...A,mix:50}))+' / 100 % '+await gain(300,0.7,C({...A,mix:100}))+'   (Rust 0.00 / -2.72 / -6.69)');
    // basses : 3e harmonique à 60 Hz
    const goertzel=(x,f,a,z)=>{ let re=0,im=0; const n=z-a; for(let i=a;i<z;i++){const w=0.5-0.5*Math.cos(2*Math.PI*(i-a)/n); re+=x[i]*w*Math.cos(2*Math.PI*f*i/sr); im+=x[i]*w*Math.sin(2*Math.PI*f*i/sr);} return Math.hypot(re,im); };
    const h3=async(att,rel)=>{ const y=await run(60,0.7,C({threshold:-30,ratio:8,attack:att,release:rel,makeup:0}),2); const f0=goertzel(y,60,sr/2,2*sr); return (20*Math.log10(goertzel(y,180,sr/2,2*sr)/f0+1e-12)).toFixed(0); };
    out.push('60 Hz, 3e harmonique : att 0.1/rel 5 '+await h3(0.1,5)+' dB ; 1/20 '+await h3(1,20)+' dB ; 10/50 '+await h3(10,50)+' dB   (avant : -18 / -25 / -36)');
    return out.join('\\n');
  })()`));
};
