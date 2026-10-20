// Zoom autour du pointeur (comme Pro Tools) ; en lecture, zoomer / défiler soi-même arrête le suivi automatique
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'zp1',name:'ZP',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*60,sr); b.getChannelData(0).fill(0.1); PulseAudio.registerBuffer('k',b); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'a.wav',{type:'audio/wav'}),0,0); })()`);
  await sleep(500);
  await R('touche E : le point sous le pointeur ne bouge pas', `const tl=document.querySelector('.timeline'); const r=tl.getBoundingClientRect(); state.playhead=0; updatePlayhead();
    const x=r.left+300; document.dispatchEvent(new MouseEvent('mousemove',{clientX:x,clientY:r.top+60,bubbles:true}));
    const secBefore=(x-r.left+tl.scrollLeft)/state.pxPerSecond;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,100));
    const secAfter=(x-r.left+tl.scrollLeft)/state.pxPerSecond; return 'zoom='+state.pxPerSecond.toFixed(0)+' px/s ; temps sous le pointeur avant='+secBefore.toFixed(2)+' après='+secAfter.toFixed(2)+' (identiques)'`);
  await R('en lecture : zoomer à la molette suspend le suivi', `state.playhead=0; updatePlayhead(); await togglePlay(); await new Promise(r=>setTimeout(r,200));
    const tl=document.querySelector('.timeline'); tl.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,metaKey:true,clientX:400,clientY:200,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,150));
    const off=state.followOff; await togglePlay(); await togglePlay(); const back=state.followOff; await togglePlay();
    return 'suivi suspendu='+off+' (true) ; réactivé au prochain Espace='+!back+' (true)'`);
};
