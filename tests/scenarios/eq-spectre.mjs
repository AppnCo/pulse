// EQ : le signal de la piste s'affiche derrière la courbe pendant la lecture
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr); const d=b.getChannelData(0); for(let i=0;i<b.length;i++) d[i]=0.25*Math.sin(2*Math.PI*220*i/sr)+0.2*Math.sin(2*Math.PI*3000*i/sr); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'t.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(700);
  await ev(`openEqPanel(0, document.body)`); await sleep(300);
  await R('à l arrêt : rien dessiné', `const c=document.querySelector('.eq-spec'); if(!c) return 'pas de canvas'; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return 'pixels='+n`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(1800);
  await R('en lecture : le spectre apparaît', `const c=document.querySelector('.eq-spec'); const g=c.getContext('2d'); const d=g.getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return 'pixels='+n+' (doit être > 1000)'`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/eq-spectre.jpg');
  await ev(`togglePlay()`);
};
