// Le curseur se cale sur la grille (comme les clips), Shift = libre
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sn1',name:'Snap',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('snap', `state.snap='beat'; return state.snap+' / beat='+(60/state.project.bpm)+' s'`);
  await R('clic réel sur la règle', `const tl=document.querySelector('.timeline'), r=document.getElementById('timelineRuler'); const b=tl.getBoundingClientRect(); const x=b.left+ (1.23*state.pxPerSecond) - tl.scrollLeft;
    r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:b.top+10,button:0})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,50)); return 'clic à 1,23 s → curseur '+state.playhead.toFixed(3)`);
  await R('Shift = libre', `const tl=document.querySelector('.timeline'), r=document.getElementById('timelineRuler'); const b=tl.getBoundingClientRect(); const x=b.left+(1.23*state.pxPerSecond)-tl.scrollLeft;
    r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:b.top+10,button:0,shiftKey:true})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,50)); return 'curseur '+state.playhead.toFixed(3)`);
  await R('snap coupé', `state.snap='off'; const tl=document.querySelector('.timeline'), r=document.getElementById('timelineRuler'); const b=tl.getBoundingClientRect(); const x=b.left+(1.23*state.pxPerSecond)-tl.scrollLeft;
    r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:b.top+10,button:0})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,50)); return 'curseur '+state.playhead.toFixed(3)`);
};
