// 31/10 : warp sur plusieurs régions choisies (comme le reste de la sélection multiple) : caler et retirer pour toutes, un seul ⌘Z
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'wm',name:'WarpMulti',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#A855F7'},{name:'C',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = (c) => ev(`(async()=>{${c}})()`);
  await R(`const ctx=await PulseAudio.init();
    for (let i=0;i<3;i++){ const b=ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate); const d=b.getChannelData(0); for(let k=0;k<d.length;k++) d[k]=0.2*Math.sin(2*Math.PI*(220+i*50)*k/ctx.sampleRate);
      const id='wm'+i; PulseAudio.registerBuffer(id,b); state.project.tracks[i].clips=[{id,start:0,duration:2,offset:0,name:'S'+i,peaks:makePeaks(b)}]; }
    renderAll(); return 1`);
  const D = async () => JSON.parse(await R(`return JSON.stringify(state.project.tracks.map(t=>({d:+t.clips[0].duration.toFixed(3), w:!!t.clips[0].warp})))`));
  await R(`state.selectedClips=new Set(['0:0','2:0']); return 1`);
  await R(`openWarpPanel(0,0,200,200); return 1`); await sleep(400);
  check('le panneau parle des 2 régions', /2 régions/.test(await ev(`document.querySelector('.warp-panel .warp-txt').textContent`)));
  await R(`const p=document.querySelector('.warp-panel'); p.querySelector('.warp-bpm').value='90'; p.querySelector('.warp-bpm').dispatchEvent(new Event('input')); p.querySelector('.warp-apply').click(); return 1`);
  for (let i = 0; i < 60; i++) { await sleep(250); const d = await D(); if (d[0].w && d[2].w) break; }
  let d = await D();
  check('A et C calées (90 → 120 : durée ×0,75), B pas touchée', d[0].w && d[2].w && !d[1].w && Math.abs(d[0].d - 1.5) < 0.01 && Math.abs(d[2].d - 1.5) < 0.01 && d[1].d === 2, JSON.stringify(d));
  await R(`undoAction(); return 1`); await sleep(400); d = await D();
  check('un seul ⌘Z remet les deux', !d[0].w && !d[2].w && d[0].d === 2 && d[2].d === 2, JSON.stringify(d));
  await R(`redoAction(); return 1`); await sleep(400);
  d = await D();
  if (!(d[0].w && d[2].w)) {   // pas de rétablir : on recale directement
    await R(`await applyWarp(state.project.tracks[0].clips[0],90,120); await applyWarp(state.project.tracks[2].clips[0],90,120); return 1`);
  }
  await R(`state.selectedClips=new Set(['0:0','2:0']); openWarpPanel(2,0,200,200); return 1`); await sleep(300);
  check('bouton « retirer (toutes) »', /toutes/.test(await ev(`document.querySelector('.warp-panel .warp-remove')?.textContent||''`)));
  await R(`document.querySelector('.warp-panel .warp-remove').click(); return 1`);
  for (let i = 0; i < 20; i++) { await sleep(200); d = await D(); if (!d[0].w && !d[2].w) break; }
  check('warp retiré des deux', !d[0].w && !d[2].w && d[0].d === 2 && d[2].d === 2, JSON.stringify(d));
  await R(`state.selectedClips=new Set(['0:0','2:0']); openWarpPanel(1,0,200,200); return 1`); await sleep(300);
  check('région hors sélection : le panneau ne parle que d\'elle', !/régions/.test(await ev(`document.querySelector('.warp-panel .warp-txt').textContent`)));
};
