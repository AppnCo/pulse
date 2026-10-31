// 31/10 : comme Logic, une nouvelle piste arrive juste sous la piste choisie (dans son dossier / son groupe)
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'np',name:'Np',bpm:120,buses:[],tracks:'ABCD'.split('').map(n=>({name:n,type:'audio',color:'#A855F7',clips:[]}))}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const names = () => R(`return state.project.tracks.map(t=>t.name).join(',')`);
  await R(`selectTrack(0); _doAddTrack('audio'); return 1`);
  let n = await names();
  check('piste A choisie : la nouvelle arrive juste sous A', /^A,Piste \d+,B,C,D$/.test(n), n);
  check('la nouvelle piste est choisie', await R(`return state.selectedTrack === 1`));
  await R(`const ix=(n)=>state.project.tracks.findIndex(t=>t.name===n); createFolderFromTracks([ix('C'), ix('D')]); selectTrack(ix('C')); _doAddTrack('audio'); return 1`);
  const t = JSON.parse(await R(`const i=state.selectedTrack, t=state.project.tracks[i], c=state.project.tracks.find(x=>x.name==='C'); return JSON.stringify({prev: state.project.tracks[i-1].name, f: t.folder||null, cf: c.folder})`));
  check('piste d\'un dossier choisie : la nouvelle va dans le même dossier', t.prev === 'C' && t.f === t.cf && !!t.f, JSON.stringify(t));
  await R(`createGroupFromTracks([0, 1]); selectTrack(0); _doAddTrack('audio'); return 1`);
  const g = JSON.parse(await R(`const T=state.project.tracks; return JSON.stringify({a:T[0].output, n:T[1].output, name:T[1].name})`));
  check('piste d\'un groupe choisie : la nouvelle passe par le même groupe', g.a === g.n && g.a !== 'master' && !!g.a, JSON.stringify(g));
  await R(`undoAction(); return 1`);
  check('⌘Z retire la nouvelle piste', (await R(`return state.project.tracks.length`)) === 6);
};
