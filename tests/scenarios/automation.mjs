// Courbe de volume : audible à l'export, points posés à la souris
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'au1',name:'Auto',bpm:120,buses:[],tracks:[{name:'Instru',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('export suit la courbe', `const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr); b.getChannelData(0).fill(0.2); PulseAudio.registerBuffer('k',b);
    const P=(pts)=>({buses:[],tracks:[{volume:100,clips:[{id:'k',start:0,duration:8}],automation:{volume:{points:pts}}}]});
    const at=async(p,t,opts)=>{ const w=await ctx.decodeAudioData(await (await PulseAudio.exportWav(p,opts)).arrayBuffer()); return w.getChannelData(0)[Math.round(t*sr)]; };
    const ref=await at(P([]),4); const v=async(pts,t,o)=>((await at(P(pts),t,o))/ref).toFixed(2);
    const pts=[{t:0,v:1},{t:4,v:1},{t:6,v:0}];
    return 'à 2s '+await v(pts,2)+' (1.00) | à 5s '+await v(pts,5)+' (0.50) | à 7s '+await v(pts,7)+' (0.00) | plage 4.5→8, à +0.5s '+await v(pts,0.5,{startSec:4.5,endSec:8})+' (0.50)'`);
  await ev(`(async()=>{ const b=PulseAudio.getBuffer('k'); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'instru.wav',{type:'audio/wav'}),0,0); toggleAutomationMode(); })()`); await sleep(400);
  // clics réels : un point à 4 s en haut, un à 6 s en bas (fondu de fin), puis double-clic pour retirer
  const box = JSON.parse(await ev(`JSON.stringify((()=>{ const r=document.querySelector('.vol-curve').getBoundingClientRect(); return {x:r.left,y:r.top,h:r.height,pps:state.pxPerSecond}; })())`));
  const click = async (t, frac, n = 1) => { const x = box.x + t * box.pps, y = box.y + box.h * frac;
    for (let i = 1; i <= n; i++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i }); } };
  await click(4, 0.1); await click(6, 0.9);
  await R('points posés à la souris', `return JSON.stringify(state.project.tracks[0].automation.volume.points.map(p=>[+p.t.toFixed(2),p.v]))`);
  if (SHOTS) await shot(SHOTS + '/shot-auto.jpg');
  await click(6, 0.9, 2);
  await R('après double-clic souris', `return state.project.tracks[0].automation.volume.points.length+' points'`);
  await ev(`(()=>{ const svg=document.querySelector('.vol-curve'); const r=svg.getBoundingClientRect(); const pts=state.project.tracks[0].automation.volume.points; const p=pts[pts.length-1]; if(pts.length===3) svg.dispatchEvent(new MouseEvent('dblclick',{clientX:r.left+p.t*state.pxPerSecond, clientY:r.top+volY(p.v), bubbles:true})); })()`);
  await R('double-clic retire le point', `return state.project.tracks[0].automation.volume.points.length+' points'`);
  await R('annuler', `undoAction(); return state.project.tracks[0].automation.volume.points.length+' points après ⌘Z'`);
};
