// 01/11 : renommer comme Logic — plusieurs régions choisies prennent le nom, numérotées si le nom finit par un nombre ; ⌘Z
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rnr',name:'RNR',bpm:120,buses:[],sends:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100,clips:[{id:'k1',start:4,duration:1,offset:0,name:'x'},{id:'k2',start:0,duration:1,offset:0,name:'y'}].sort((a,b)=>a.start-b.start)},{name:'B',type:'audio',color:'#60A5FA',volume:100,clips:[{id:'k3',start:2,duration:1,offset:0,name:'z'}]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const ren = (ti, ci, txt) => R(`startClipRename(${ti},${ci}); await new Promise(r=>setTimeout(r,50)); const el=document.querySelector('.clip-name[contenteditable]'); if(!el) return 'pas de champ'; el.textContent=${JSON.stringify(txt)}; el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); if (el.getAttribute('contenteditable')) el.dispatchEvent(new FocusEvent('blur')); await new Promise(r=>setTimeout(r,100)); return state.project.tracks.map(t=>t.clips.map(c=>c.name).join('/')).join(' | ')`);
  await R(`state.selectedClips=new Set(['0:0','0:1','1:0']); state.selectedClip={trackIdx:0,clipIdx:0}; renderAll(); return 1`);
  let n = await ren(0, 0, 'Couplet 01');
  check('numérotés dans l\'ordre du temps (0 s, 2 s, 4 s)', n === 'Couplet 01/Couplet 03 | Couplet 02', n);
  await R(`state.selectedClips=new Set(['0:0','0:1','1:0']); state.selectedClip={trackIdx:0,clipIdx:0}; renderAll(); return 1`);
  n = await ren(0, 1, 'Refrain');
  check('sans nombre : même nom pour toutes', n === 'Refrain/Refrain | Refrain', n);
  await R(`undoAction(); await new Promise(r=>setTimeout(r,150)); return 1`);
  n = await R(`return state.project.tracks.map(t=>t.clips.map(c=>c.name).join('/')).join(' | ')`);
  check('⌘Z remet les noms d\'avant', n === 'Couplet 01/Couplet 03 | Couplet 02', n);
  await R(`state.selectedClips=new Set(); state.selectedClip={trackIdx:1,clipIdx:0}; renderAll(); return 1`);
  n = await ren(1, 0, 'Pont');
  check('une seule région : elle seule', n === 'Couplet 01/Couplet 03 | Pont', n);
};
