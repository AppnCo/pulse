// Usage brutal à la souris : clics, glissés et clics droits au hasard sur toute la fenêtre — aucune exception
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false);
    const sr=48000,b=ctx.createBuffer(1,sr*8,sr); for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=Math.sin(i/40)*0.3; await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'i.wav',{type:'audio/wav'}),0,0);
    addTrack('keys'); })()`);
  await sleep(1200);
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const W = 1440, H = 860;
  const M = (type, x, y, button = 'left', buttons = 1, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount });
  for (let i = 0; i < 250; i++) {
    const x = 5 + rnd() * (W - 10), y = 5 + rnd() * (H - 10), kind = rnd();
    if (kind < 0.55) { await M('mousePressed', x, y); await M('mouseReleased', x, y, 'left', 0); }
    else if (kind < 0.8) { const x2 = x + (rnd() - .5) * 400, y2 = y + (rnd() - .5) * 200; await M('mousePressed', x, y); await M('mouseMoved', (x + x2) / 2, (y + y2) / 2); await M('mouseMoved', x2, y2); await M('mouseReleased', x2, y2, 'left', 0); }
    else if (kind < 0.9) { await M('mousePressed', x, y, 'right', 2); await M('mouseReleased', x, y, 'right', 0); }
    else { await M('mousePressed', x, y, 'left', 1, 2); await M('mouseReleased', x, y, 'left', 0, 2); }
    if (i % 20 === 0) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100); }
  }
  await sleep(600);
  console.log('état final:', await ev(`'pistes='+state.project.tracks.length+' rec='+state.recording+' lecture='+state.playing+' éditeur='+(window.PulsePianoRoll&&PulsePianoRoll.isOpen())`));
};
