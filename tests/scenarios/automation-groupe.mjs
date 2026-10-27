// Courbe de volume d'un groupe : audible à l'export, points posés à la souris sur la ligne du groupe
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ag1',name:'AutoG',bpm:120,buses:[{id:'g1',name:'Voix',isGroup:true,output:'master',volume:100}],tracks:[{name:'Voix 1',type:'audio',color:'#60A5FA',volume:100,output:'g1'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('export suit la courbe du groupe', `const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr); b.getChannelData(0).fill(0.2); PulseAudio.registerBuffer('k',b);
    const P=(pts)=>({buses:[{id:'g1',output:'master',volume:100,automation:{volume:{points:pts}}}],tracks:[{volume:100,output:'g1',clips:[{id:'k',start:0,duration:8}]}]});
    const at=async(p,t)=>{ const w=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer()); return w.getChannelData(0)[Math.round(t*sr)]; };
    const ref=await at(P([]),4); const v=async(pts,t)=>((await at(P(pts),t))/ref).toFixed(2);
    const pts=[{t:0,v:1},{t:4,v:1},{t:6,v:0}];
    return 'à 2s '+await v(pts,2)+' (1.00) | à 5s '+await v(pts,5)+' (0.50) | à 7s '+await v(pts,7)+' (0.00)'`);
  await ev(`(async()=>{ const b=PulseAudio.getBuffer('k'); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,0); toggleAutomationMode(); })()`); await sleep(400);
  const box = JSON.parse(await ev(`JSON.stringify((()=>{ const s=document.querySelector('.vol-curve[data-bus="g1"]'); if(!s) return null; const r=s.getBoundingClientRect(); return {x:r.left,y:r.top,h:r.height,pps:state.pxPerSecond}; })())`));
  console.log('courbe sur la ligne du groupe:', !!box);
  if (!box) return;
  const click = async (t, frac, n = 1) => { const x = box.x + t * box.pps, y = box.y + box.h * frac;
    for (let i = 1; i <= n; i++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i }); } };
  await click(4, 0.1); await click(6, 0.9);
  await R('points posés à la souris', `return JSON.stringify(state.project.buses[0].automation.volume.points.map(p=>[+p.t.toFixed(2),p.v]))`);
  await R('annuler', `undoAction(); return state.project.buses[0].automation.volume.points.length+' points après ⌘Z'`);
};
