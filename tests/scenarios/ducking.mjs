// Ducking de l'écho et de la reverb : l'effet se pousse pendant la voix et ressort dans le trou.
// Mêmes écarts que ducking_echo_et_reverb (Rust) : écho −13,97 / 0,00 ; reverb −13,98 / 0,00.
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'dk',name:'DK',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log('écarts :', await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000; const b=ctx.createBuffer(2,sr*3,sr);
    for(const c of [0,1]){const d=b.getChannelData(c); for(let i=0;i<sr;i++) d[i]=0.5*Math.sin(2*Math.PI*300*i/sr);} PulseAudio.registerBuffer('dk',b);
    const lvl=async(fx,a,z)=>{ const p={bpm:120,buses:[],sends:[],tracks:[{volume:100,clips:[{id:'dk',start:0,duration:3}],...fx}]};
      const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      let s=0; for(let i=Math.floor(a*sr);i<Math.floor(z*sr);i++) s+=x[i]*x[i]; return 20*Math.log10(Math.sqrt(s/((z-a)*sr))+1e-12); };
    const e=(duck)=>({effects:['delay'],effectParams:{delay:{beats:1,feedback:50,wet:100,dry:0,duck,hpf:150,lpf:6000}}});
    const r=(duck)=>({effects:['reverb'],effectParams:{reverb:{wet:100,size:2.4,pre:20,low:150,high:8000,duck}}});
    const f=(v)=>v.toFixed(2);
    const ep=(await lvl(e(80),0.6,0.95))-(await lvl(e(0),0.6,0.95)), ea=(await lvl(e(80),1.55,1.95))-(await lvl(e(0),1.55,1.95));
    const rp=(await lvl(r(80),0.5,0.95))-(await lvl(r(0),0.5,0.95)), ra=(await lvl(r(80),1.4,1.9))-(await lvl(r(0),1.4,1.9));
    return 'écho pendant '+f(ep)+' / après '+f(ea)+' ; reverb pendant '+f(rp)+' / après '+f(ra)+'  (Rust : −13.97 / 0.00 ; −13.98 / 0.00)';
  })()`));
};
