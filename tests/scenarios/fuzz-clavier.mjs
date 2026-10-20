// Usage brutal : 400 touches au hasard (lecture, rec, couper, annuler…) — aucune exception ne doit sortir
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false);
    const sr=48000,b=ctx.createBuffer(1,sr*8,sr); for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=Math.sin(i/40)*0.3; await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'i.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(700);
  const keys = [' ', 'r', 'k', 'l', 'm', 'q', 's', 'b', 'e', 'z', 'f', 'x', 'a', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Delete', 'Tab', 'Home', 'End', 't'];
  const mods = [{}, {}, {}, { metaKey: true }, { shiftKey: true }, { altKey: true }];
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 400; i++) {
    const k = keys[Math.floor(rnd() * keys.length)], m = mods[Math.floor(rnd() * mods.length)];
    const mod = Object.entries(m).map(([a, v]) => `${a}:${v}`).join(',');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true,${mod}}))`);
    if (i % 25 === 0) await sleep(150);
  }
  await sleep(800);
  console.log('état final:', await ev(`'pistes='+state.project.tracks.length+' clips='+state.project.tracks.reduce((n,t)=>n+(t.clips||[]).length,0)+' rec='+state.recording+' lecture='+state.playing`));
};
