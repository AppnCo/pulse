// 01/11 : ⌘Z / ⌘⇧Z exacts (un seul pas) pour les commandes sur plusieurs régions / pistes ajoutées le 01/11
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'qum',name:'QUM',bpm:120,buses:[],sends:[],tracks:[
    {name:'A',type:'audio',color:'#A855F7',volume:100,clips:[{id:'s1',name:'a',start:0,duration:1,offset:0},{id:'s1',name:'b',start:2,duration:1,offset:0}]},
    {name:'B',type:'audio',color:'#22D3EE',volume:100,clips:[{id:'s1',name:'c',start:1,duration:1,offset:0,loopEnd:3}]},
    {name:'P',type:'keys',color:'#60A5FA',volume:100,clips:[]},
    {name:'D',type:'audio',color:'#F472B6',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,48000,48000); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.2*Math.sin(i*0.05); PulseAudio.registerBuffer('s1',b);
    const T=state.project.tracks[2]; const mk=async(start,p)=>{const c={start,duration:2,offset:0,name:'n'}; await bakeMidiClip(c,{inst:'piano',beats:4,notes:[{s:0,d:1,p,v:100}]},120); return c;}; T.clips=[await mk(0,60), await mk(4,62)]; renderAll(); })()`);
  await sleep(300);
  const strip = `(()=>{ const p=JSON.parse(JSON.stringify(state.project)); delete p.lyrics; return JSON.stringify(p); })()`;
  const sel3 = `state.selectedClips=new Set(['0:0','0:1','1:0']); state.selectedClip={trackIdx:0,clipIdx:0}; state.selectedTrack=0;`;
  const selT = `selectTrack(0); state.selectedTracks=new Set([0,1]);`;
  const menu = (idx, path) => `closeAllMenus(); openTrackContextMenu(300,200,${idx},state.project.tracks[${idx}]); await new Promise(r=>setTimeout(r,80));
    { const path=${JSON.stringify(path)}; let el; if (path.length===2) { const row=[...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e=>e.textContent.trim().startsWith(path[0])); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,60)); el=[...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e=>e.textContent.includes(path[1])); } else el=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes(path[0])); el.click(); }`;
  const actions = {
    '⌘J piano (2 régions)': `state.selectedClips=new Set(['2:0','2:1']); state.selectedClip={trackIdx:2,clipIdx:0}; await joinSelectionByTrack()`,
    '⌘C/⌘V 3 régions': `${sel3} copySelectedClip(); state.playhead=10; pasteClip()`,
    '⌘X 3 régions': `${sel3} cutSelectedClip()`,
    '⌘R bloc': `${sel3} repeatSelectedClip()`,
    '⌘→ 3 régions': `${sel3} nudgeSelectedClip(1,false)`,
    'renommer 3 régions': `${sel3} renderAll(); startClipRename(0,0); await new Promise(r=>setTimeout(r,40)); const el=document.querySelector('.clip-name[contenteditable]'); el.textContent='V 1'; el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); if (el.getAttribute('contenteditable')) el.dispatchEvent(new FocusEvent('blur'))`,
    'menu : dupliquer 2 pistes': `${selT} ${menu(0, ['Dupliquer'])}`,
    'menu : verrouiller 2 pistes': `${selT} ${menu(0, ['Réglages', 'Verrouiller'])}`,
    'menu : masquer 2 pistes': `${selT} ${menu(0, ['Réglages', 'Masquer'])}`,
    'menu : phase 2 pistes': `${selT} ${menu(0, ['Son', 'Inverser la phase'])}`,
    'menu : supprimer 2 pistes': `${selT} ${menu(0, ['Supprimer'])}`,
    '⇧⌘D dossier': `${selT} openStackMenu(); document.querySelectorAll('.stack-menu .ctx-item')[0].click()`,
  };
  for (const [label, code] of Object.entries(actions)) {
    const r = JSON.parse(await ev(`(async()=>{ try{
      const before=${strip}; const u0=_undoStack.length;
      ${code};
      await new Promise(r=>setTimeout(r,300));
      const after=${strip}; const u1=_undoStack.length; const res={changed:before!==after, pas:u1-u0};
      if (u1>u0) { undoAction(); await new Promise(r=>setTimeout(r,120)); res.undo=${strip}===before; redoAction(); await new Promise(r=>setTimeout(r,120)); res.redo=${strip}===after; }
      closeAllMenus(); document.querySelectorAll('.stack-menu').forEach(m=>m.remove());
      state.project = JSON.parse(before); state.selectedClips=new Set(); state.selectedClip=null; state.selectedTracks=new Set(); _undoStack.length=u0; renderAll();
      return JSON.stringify(res); } catch(e){ return JSON.stringify({err:e.message}) } })()`));
    check(`${label} : un pas, ⌘Z et ⌘⇧Z exacts`, r.changed && r.pas === 1 && r.undo && r.redo, JSON.stringify(r));
  }
};
