// Shift pendant qu'on déplace une région = verrou d'axe : si le geste part surtout vers le bas, le temps reste à la position d'ORIGINE et on ne change que de piste
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sh1',name:'Shift',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100},{name:'B',type:'audio',color:'#F472B6',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*2,sr); b.getChannelData(0).fill(0.1); PulseAudio.registerBuffer('k',b); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'a.wav',{type:'audio/wav'}),0,3); })()`);
  await sleep(500);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{ const c=document.querySelector('.timeline-track[data-i="0"] .clip').getBoundingClientRect(); const t1=document.querySelector('.timeline-track[data-i="1"]').getBoundingClientRect(); return {cx:c.left+c.width/2, cy:c.top+c.height/2, ty:t1.top+t1.height/2, start:state.project.tracks[0].clips[0].start}; })())`));
  const mv = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.cx, y: g.cy, button: 'left', clickCount: 1 });
  await mv(g.cx + 40, g.cy); await mv(g.cx + 120, g.cy);                 // on se décale sur le côté
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}))`);   // Shift : retour à l'origine
  await mv(g.cx + 20, g.cy + 30); await mv(g.cx + 20, g.ty);             // puis on descend franchement sur l'autre piste
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.cx + 20, y: g.ty, button: 'left', clickCount: 1 });
  await sleep(200);
  await R('départ d\'origine ' + g.start.toFixed(2), `const t=state.project.tracks; const where=t[0].clips.length?'piste 1':'piste 2'; const c=(t[0].clips[0]||t[1].clips[0]); return where+', start='+c.start.toFixed(2)+' (attendu ${g.start.toFixed(2)}, piste 2)'`);
};
