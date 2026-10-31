// 31/10 : les régions choisies restent les mêmes quand des pistes bougent (dossier, groupe, copie, suppression)
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  const tr = 'ABCD'.split('').map((n,i)=>({name:n,type:'audio',color:'#A855F7',clips:[{id:'x'+n,name:'r'+n,start:i,duration:1,offset:0}]}));
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ss',name:'Ss',bpm:120,buses:[],tracks:${JSON.stringify(tr)}}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const sel = `return [...state.selectedClips].map(k=>{const [a,b]=k.split(':').map(Number); return state.project.tracks[a]?.clips[b]?.name||'?'}).join(',')+' sel1='+(state.selectedClip? JSON.stringify(state.selectedClip):'')`;
  const setSel = `state.selectedClips=new Set(['0:0','2:0']); `;
  await R(setSel + `return 1`); check('départ', (await R(sel)).startsWith('rA,rC'));
  await R(`createFolderFromTracks([0,2]); return 1`); { const v = await R(sel); check('après dossier A+C : toujours rA et rC', v.startsWith('rA,rC'), v); }
  await R(`undoAction(); ${setSel} duplicateTrack(0); return 1`); { const v = await R(sel); check('après dupliquer A : toujours rA et rC', v.startsWith('rA,rC'), v); }
  await R(`undoAction(); ${setSel} state.selectedTrack=1; state.selectedTracks=new Set(); deleteSelectedTrack(); return 1`); { const v = await R(sel); check('après suppr. B : toujours rA et rC', v.startsWith('rA,rC'), v); }
  await R(`undoAction(); ${setSel} createGroupFromTracks([0,2]); return 1`); { const v = await R(sel); check('après groupe A+C : toujours rA et rC', v.startsWith('rA,rC'), v); }
};
