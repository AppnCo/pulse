// EQ d'un groupe : le signal du groupe s'affiche aussi derrière la courbe
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sg1',name:'SG',bpm:120,
    buses:[{id:'g1',name:'Voix',isGroup:true,output:'master',color:'#A855F7',volume:100,effects:['eq']}],
    tracks:[{name:'A',type:'audio',color:'#A855F7',output:'g1',clips:[]},{name:'B',type:'audio',color:'#22D3EE',output:'g1',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr); const d=b.getChannelData(0); for(let i=0;i<b.length;i++) d[i]=0.3*Math.sin(2*Math.PI*440*i/sr); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'t.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(800);
  await ev(`openEqPanel(state.project.buses[0], document.querySelector('#btnMixer'))`); await sleep(300);
  await ev(`state.playhead=0; togglePlay()`); await sleep(1800);
  await R('spectre du groupe', `const c=document.querySelector('.eq-spec'); if(!c) return 'pas de canvas'; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return 'pixels='+n+' (doit être > 800)'`);
  await ev(`togglePlay()`);
};
