// Tirer une piste par sa poignée : sous un groupe elle y entre (son son passe par ce bus), entre des pistes seules elle en sort
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'dg1',name:'DG',bpm:120,
    buses:[{id:'g1',name:'Voix',isGroup:true,output:'master',color:'#A855F7',volume:100}],
    tracks:[{name:'A',type:'audio',color:'#A855F7',output:'g1',clips:[]},{name:'B',type:'audio',color:'#A855F7',output:'g1',clips:[]},{name:'C',type:'audio',color:'#22D3EE',output:'master',clips:[]},{name:'D',type:'audio',color:'#34D399',output:'master',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(700);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const st = `state.project.tracks.map(t=>t.name+'→'+t.output).join(' | ')`;
  const pos = (sel, f = 0.5) => ev(`JSON.stringify((()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height*${f}}})())`).then(JSON.parse);
  const M = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await R('départ', `return ${st}`);
  // D (index 3) tirée sur le bas de la piste A (dans le groupe)
  const h = await pos('.track-item[data-i="3"] .track-icon');
  const a = await pos('.track-item[data-i="0"]', 0.85);
  await M('mousePressed', h.x, h.y); await M('mouseMoved', h.x, h.y - 40); await M('mouseMoved', a.x, a.y);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/deplacer.jpg');
  await M('mouseReleased', a.x, a.y); await sleep(300);
  await R('D lâchée sous A : D entre dans le groupe', `return ${st}`);
  // maintenant B (index 2) tirée entre C et D? -> on la sort : sur le haut de la piste C
  const idxB = JSON.parse(await ev(`JSON.stringify(state.project.tracks.findIndex(t=>t.name==='B'))`));
  const idxC = JSON.parse(await ev(`JSON.stringify(state.project.tracks.findIndex(t=>t.name==='C'))`));
  const hb = await pos(`.track-item[data-i="${idxB}"] .track-icon`);
  const c = await pos(`.track-item[data-i="${idxC}"]`, 0.8);
  await M('mousePressed', hb.x, hb.y); await M('mouseMoved', hb.x, hb.y + 40); await M('mouseMoved', c.x, c.y);
  await M('mouseReleased', c.x, c.y); await sleep(300);
  await R('B lâchée sous C : B sort du groupe', `return ${st}`);
  await R('annuler', `undoAction(); return ${st}`);
};
