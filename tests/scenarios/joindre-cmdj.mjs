// 01/11 : ⌘J = Joindre comme Logic (piste par piste, un seul ⌘Z) ; copie d'une piste gelée sans le rendu gelé
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cj1',name:'CJ',bpm:120,buses:[],sends:[],tracks:[{name:'P1',type:'keys',color:'#60A5FA',volume:100,clips:[]},{name:'P2',type:'keys',color:'#60A5FA',volume:100,clips:[]},{name:'P3',type:'keys',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    await PulseAudio.init(); const T=state.project.tracks;
    const mk=async(start,p)=>{const c={start,duration:2,offset:0,name:'R'}; await bakeMidiClip(c,{inst:'piano',beats:4,notes:[{s:0,d:1,p,v:100}]},120); return c;};
    T[0].clips=[await mk(0,60), await mk(4,62)]; T[1].clips=[await mk(0,64), await mk(2,65)]; T[2].clips=[await mk(0,67)]; renderAll();
    state.selectedClips=new Set(['0:0','0:1','1:0','1:1','2:0']); state.selectedClip={trackIdx:0,clipIdx:0};
    const d0=_undoStack.length;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',code:'KeyJ',metaKey:true,bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,1200));
    const res={n:T.map(t=>t.clips.length).join(','), pile:_undoStack.length-d0, d0:T[0].clips[0].duration, d1:T[1].clips[0].duration};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,300));
    res.apresZ=state.project.tracks.map(t=>t.clips.length).join(',');
    // une seule région : message, rien ne bouge
    state.selectedClips=new Set(['2:0']); state.selectedClip={trackIdx:2,clipIdx:0};
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',code:'KeyJ',metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,300));
    res.seule=state.project.tracks[2].clips.length;
    // copie d'une piste gelée
    const g=state.project.tracks[0]; g.frozen={id:'gel_x',gain:1}; g.locked=true;
    duplicateTrack(0); const cp=state.project.tracks[1];
    res.copie={nom:cp.name, gel:!!cp.frozen, verrou:!!cp.locked, origGel:!!g.frozen};
    return JSON.stringify(res);
  })()`));
  console.log(JSON.stringify(r));
  check('⌘J : une région par piste là où il y en avait plusieurs, la piste à une seule région intacte', r.n === '1,1,1', r.n);
  check('régions jointes de la bonne longueur (0→6 s et 0→4 s)', Math.abs(r.d0 - 6) < 1e-6 && Math.abs(r.d1 - 4) < 1e-6, r.d0 + ' / ' + r.d1);
  check('un seul pas d\'annulation', r.pile === 1, r.pile);
  check('⌘Z remet toutes les régions', r.apresZ === '2,2,1', r.apresZ);
  check('⌘J sur une seule région : rien ne change', r.seule === 1, r.seule);
  check('copie d\'une piste gelée : ni gel ni verrou, l\'original reste gelé', r.copie.gel === false && r.copie.verrou === false && r.copie.origGel === true, JSON.stringify(r.copie));
};
