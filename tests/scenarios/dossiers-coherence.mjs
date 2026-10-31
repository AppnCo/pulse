// 31/10 : un groupe (bus) est rangé en entier dans un seul dossier ; dossier vidé = retiré ; copie de piste en français
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'dc',name:'Dc',bpm:120,buses:[],tracks:'ABCDEF'.split('').map(n=>({name:n,type:'audio',color:'#A855F7',clips:[]}))}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const T = async () => JSON.parse(await R(`return JSON.stringify(Object.fromEntries(state.project.tracks.map(t=>[t.name,{f:t.folder||null,o:t.output||'master'}])))`));
  const idx = (n) => `state.project.tracks.findIndex(t=>t.name==='${n}')`;
  await R(`createFolderFromTracks([1,3]); return 1`);
  await R(`duplicateTrack(${idx('B')}); return 1`);
  let t = await T();
  check('copie de piste nommée en français', !!t['B copie'] && !!t['B copie'].f, Object.keys(t).join(' '));
  await R(`createGroupFromTracks([${idx('A')}, ${idx('B')}]); return 1`);
  t = await T();
  check('nouveau groupe : ses pistes partagent le même dossier', t.A.f === t.B.f && t.A.o === t.B.o && t.A.o !== 'master', JSON.stringify({ A: t.A, B: t.B }));
  const fid = await R(`return state.project.folders[0].id`);
  await R(`moveTracksToFolder([${idx('A')}], '${fid}'); return 1`);
  t = await T();
  check('ranger une piste du groupe dans un dossier emmène tout le groupe', t.A.f === fid && t.B.f === fid, JSON.stringify({ A: t.A, B: t.B }));
  await R(`removeTracksFromFolder([${idx('B')}]); return 1`);
  t = await T();
  check('sortir une piste du groupe du dossier sort tout le groupe', !t.A.f && !t.B.f && t['B copie'].f === fid);
  await R(`const ids=state.project.tracks.map((t,i)=>t.folder?i:-1).filter(i=>i>=0); state.selectedTrack=ids[0]; state.selectedTracks=new Set(ids); deleteSelectedTrack(); return 1`);
  check('dossier vidé par suppression : retiré', (await R(`return (state.project.folders||[]).length`)) === 0);
  await R(`undoAction(); return 1`); await sleep(200);
  check('⌘Z : dossier et pistes reviennent', (await R(`return (state.project.folders||[]).length + ':' + state.project.tracks.filter(t=>t.folder).length`)) === '1:2');
};
