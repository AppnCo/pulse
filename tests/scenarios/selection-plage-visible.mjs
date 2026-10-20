// Glisser pour choisir une plage : la zone doit se voir SUR les pistes choisies (pas seulement sur la règle)
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sp1',name:'SP',bpm:120,buses:[],tracks:[
    {name:'A',type:'audio',color:'#A855F7',clips:[{id:'a',name:'A',start:0,duration:8,offset:0}]},
    {name:'B',type:'audio',color:'#22D3EE',clips:[{id:'b',name:'B',start:0,duration:8,offset:0}]},
    {name:'C',type:'audio',color:'#34D399',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const g = JSON.parse(await ev(`JSON.stringify((()=>{ const tl=document.querySelector('.timeline').getBoundingClientRect(); const r=document.querySelector('.timeline-track[data-i="1"]').getBoundingClientRect(); const rc=document.querySelector('.timeline-track[data-i="2"]').getBoundingClientRect(); return {x1:tl.left+2*state.pxPerSecond, x2:tl.left+5*state.pxPerSecond, y:r.top+r.height/2, yc:rc.top+rc.height/2}; })())`));
  const ev2 = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, modifiers: 8, clickCount: 1 });
  // Shift + glisser depuis la région B (région = piste B entière) vers la piste C
  await ev2('mousePressed', g.x1, g.y); await ev2('mouseMoved', g.x1 + 40, g.y); await ev2('mouseMoved', g.x2, g.yc);
  await R('pendant le geste : zones visibles', `const q=(s)=>{const e=document.querySelector(s); if(!e) return 'absent'; const r=e.getBoundingClientRect(); return Math.round(r.width)+'x'+Math.round(r.height)+' à y='+Math.round(r.top)}; return 'plage='+q('.range-selection')+' | boucle pistes='+q('.loop-region-tracks')+' | pistes='+JSON.stringify(state.selection&&state.selection.tracks)`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/plage.jpg');
  await ev2('mouseReleased', g.x2, g.yc); await sleep(150);
  await R('après le geste : zones visibles', `const q=(s)=>{const e=document.querySelector(s); if(!e) return 'absent'; const r=e.getBoundingClientRect(); return Math.round(r.width)+'x'+Math.round(r.height)+' à y='+Math.round(r.top)}; return 'plage='+q('.range-selection')+' | boucle pistes='+q('.loop-region-tracks')+' | pistes='+JSON.stringify(state.selection&&state.selection.tracks)+' | clips sélectionnés='+state.selectedClips.size`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/plage2.jpg');
};
