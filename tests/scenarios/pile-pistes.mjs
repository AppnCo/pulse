// 01/11 : ⇧⌘D = ranger les pistes choisies (dossier ou groupe), comme la pile de pistes de Logic ; ⌘D duplique toujours
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pp1',name:'PP',bpm:120,buses:[],sends:[],tracks:['A','B','C'].map(n=>({name:n,type:'audio',color:'#60A5FA',volume:100,clips:[]}))}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1200);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const kd = (o) => `document.dispatchEvent(new KeyboardEvent('keydown',Object.assign({key:'d',code:'KeyD',metaKey:true,bubbles:true,cancelable:true},${JSON.stringify(o)})));`;
  await R(`selectTrack(0); state.selectedTracks=new Set([0,1]); renderAll(); ${kd({ shiftKey: true, key: 'D' })} return 1`);
  const items = await R(`return [...document.querySelectorAll('.stack-menu .ctx-item')].map(e=>e.textContent).join(' | ')`);
  check('⇧⌘D ouvre le choix dossier / groupe pour les 2 pistes', /^Nouveau dossier \| Nouveau groupe \(bus\)$/.test(items), items);
  check('⇧⌘D ne duplique pas la piste', (await R(`return state.project.tracks.length`)) === 3);
  await R(`document.querySelectorAll('.stack-menu .ctx-item')[0].click(); await new Promise(r=>setTimeout(r,200)); return 1`);
  check('dossier créé avec A et B', (await R(`const t=state.project.tracks; return !!t[0].folder && t[0].folder===t[1].folder && !t[2].folder`)) === true);
  await R(`selectTrack(2); state.selectedTracks=new Set(); renderAll(); ${kd({ shiftKey: true, key: 'D' })} document.querySelectorAll('.stack-menu .ctx-item')[1].click(); await new Promise(r=>setTimeout(r,200)); return 1`);
  check('groupe (bus) créé pour C', (await R(`const t=state.project.tracks.find(x=>x.name==='C'); const b=(state.project.buses||[]).find(b=>b.id===t.output); return !!(b&&b.isGroup)`)) === true);
  await R(`selectTrack(0); state.selectedTracks=new Set(); renderAll(); ${kd({})} return 1`);
  check('⌘D duplique toujours', (await R(`return state.project.tracks.length`)) === 4);
};
