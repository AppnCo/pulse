// 01/11 : couper le son d'une région / la monter au max par le clic droit = appliqué tout de suite à la lecture en cours
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mrr',name:'MRR',bpm:120,buses:[],sends:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  const R = (c) => ev(`(async()=>{${c}})()`);
  await R(`const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,48000,48000); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.2*Math.sin(i*0.05); PulseAudio.registerBuffer('kk',b);
    state.project.tracks[0].clips=[{id:'kk',start:0,duration:1,offset:0,name:'a'}]; renderAll(); window.__n=0; const o=window.refreshPlaybackSoon; window.refreshPlaybackSoon=function(){ window.__n++; return o.apply(this,arguments); }; return 1`);
  const pick = (path) => R(`closeAllMenus(); document.querySelectorAll('.track-ctx-menu,.ctx-subpanel').forEach(m=>m.remove()); openClipContextMenu(300, 200, 0, 0); await new Promise(r=>setTimeout(r,120));
    const row=[...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(path[0])})); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,80));
    const el=[...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e=>e.textContent.includes(${JSON.stringify(path[1])})); if(!el) return 'introuvable'; const n0=window.__n; el.click(); await new Promise(r=>setTimeout(r,150)); return window.__n-n0;`);
  const fn = await R(`return typeof openClipContextMenu`);
  check('menu de région disponible', fn === 'function', fn);
  const a = await pick(['Réglages', 'Couper le son du clip']);
  check('couper le son : lecture mise à jour', a >= 1, a);
  check('région bien muette', (await R(`return !!state.project.tracks[0].clips[0].muted`)) === true);
  const b = await pick(['Son', 'Monter ce clip au volume maximum']);
  check('volume max : lecture mise à jour', b >= 1, b);
};
