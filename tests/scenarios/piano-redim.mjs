// Éditeur de notes : la poignée du haut l'agrandit / le réduit, la taille est mémorisée, double-clic = taille normale
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`addTrack('keys')`); await sleep(1000);
  await R('taille de départ', `return document.querySelector('.midi-editor').offsetHeight`);
  const r = JSON.parse(await ev(`(()=>{const b=document.querySelector('.me-grip').getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})})()`));
  const ev2 = (t, y) => send('Input.dispatchMouseEvent', { type: t, x: r.x, y, button: 'left', buttons: t === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await ev2('mousePressed', r.y); await ev2('mouseMoved', r.y - 120); await ev2('mouseMoved', r.y - 160); await ev2('mouseReleased', r.y - 160);
  await sleep(300);
  await R('agrandi de 160 px', `return document.querySelector('.midi-editor').offsetHeight+' (mémorisé: '+localStorage.getItem('pulse_midi_h')+') canvas='+document.querySelector('.me-cv').clientHeight`);
  await ev(`PulsePianoRoll.close(true); addTrack('keys')`); await sleep(1000);
  await R('rouvert : même taille', `return document.querySelector('.midi-editor').offsetHeight`);
  const r2 = JSON.parse(await ev(`(()=>{const b=document.querySelector('.me-grip').getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})})()`));
  for (const n of [1, 2]) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r2.x, y: r2.y, button: 'left', buttons: 1, clickCount: n }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r2.x, y: r2.y, button: 'left', buttons: 0, clickCount: n }); }
  await sleep(300);
  await R('double-clic : taille normale', `return document.querySelector('.midi-editor').offsetHeight+' (mémorisé: '+localStorage.getItem('pulse_midi_h')+')'`);
};
