// 01/11 : ⌘C / ⌘X / ⌘V / ⌘R / ⌘← prennent TOUTE la sélection (comme Logic)
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'scc',name:'SCC',bpm:120,buses:[],sends:[],tracks:[
    {name:'A',type:'audio',color:'#A855F7',volume:100,clips:[{id:'sa',name:'a',start:0,duration:1,offset:0},{id:'sb',name:'b',start:2,duration:1,offset:0}]},
    {name:'B',type:'audio',color:'#A855F7',volume:100,clips:[{id:'sc',name:'c',start:1,duration:1,offset:0,loopEnd:3}]},
    {name:'C',type:'audio',color:'#A855F7',volume:100,clips:[]},
    {name:'D',type:'audio',color:'#A855F7',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  const key = (k, o = {}) => `document.dispatchEvent(new KeyboardEvent('keydown',Object.assign({key:'${k}',code:'Key${k.toUpperCase()}',metaKey:true,bubbles:true,cancelable:true},${JSON.stringify(o)})));`;
  const R = (c) => ev(`(async()=>{${c}})()`);
  const lay = `return JSON.stringify(state.project.tracks.map(t=>t.clips.map(c=>c.id+'@'+(+c.start.toFixed(3))+(c.loopEnd?'-'+(+c.loopEnd.toFixed(3)):'')).join(' ')))`;
  const selAll = `state.selectedClips=new Set(['0:0','0:1','1:0']); state.selectedClip={trackIdx:0,clipIdx:0}; state.selectedTrack=0;`;
  // ⌘C puis ⌘V à 10 s : mêmes pistes, écarts gardés
  await R(`${selAll} ${key('c')} state.playhead=10; ${key('v')} return 1`);
  let L = JSON.parse(await R(lay));
  check('⌘C/⌘V : les 3 régions collées à 10 s sur leurs pistes, écarts gardés (répétition comprise)', L[0] === 'sa@0 sb@2 sa@10 sb@12' && L[1] === 'sc@1-3 sc@11-13', JSON.stringify(L));
  check('les régions collées deviennent la sélection', (await R(`return state.selectedClips.size`)) === 3);
  await R(`${key('z')} return 1`);
  // coller sur une autre piste choisie : la plus haute va sur C, l'autre sur D
  await R(`${selAll} ${key('c')} state.selectedClip=null; state.selectedClips=new Set(); state.selectedTrack=2; state.playhead=4; ${key('v')} return 1`);
  L = JSON.parse(await R(lay));
  check('collé à partir de la piste choisie (C, puis D en dessous)', L[2] === 'sa@4 sb@6' && L[3] === 'sc@5-7', JSON.stringify(L));
  await R(`${key('z')} return 1`);
  // ⌘X puis ⌘V : tout revient
  await R(`${selAll} ${key('x')} return 1`);
  L = JSON.parse(await R(lay));
  check('⌘X efface les 3 régions', L[0] === '' && L[1] === '', JSON.stringify(L));
  await R(`state.selectedTrack=0; state.playhead=0; ${key('v')} return 1`);
  L = JSON.parse(await R(lay));
  check('⌘V après ⌘X remet les 3 (avant : une seule)', L[0] === 'sa@0 sb@2' && L[1] === 'sc@1-3', JSON.stringify(L));
  // ⌘R : bloc 0→3 recopié à 3
  await R(`${selAll} ${key('r')} return 1`);
  L = JSON.parse(await R(lay));
  check('⌘R sur 3 régions : bloc recopié juste après (+3 s)', L[0] === 'sa@0 sb@2 sa@3 sb@5' && L[1] === 'sc@1-3 sc@4-6', JSON.stringify(L));
  await R(`${key('z')} return 1`);
  // ⌘→ : tout bouge d'un temps (0,5 s à 120), la répétition suit
  await R(`${selAll} setSnapMode('beat'); ${key('ArrowRight')} return 1`);
  await R(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',metaKey:true,bubbles:true,cancelable:true})); return 1`);
  L = JSON.parse(await R(lay));
  check('⌘→ décale toutes les régions choisies, la répétition suit', /^sa@0\.\d+ sb@2\.\d+$/.test(L[0]) && /^sc@1\.\d+-3\.\d+$/.test(L[1]) && (() => { const m = L[1].match(/sc@([\d.]+)-([\d.]+)/); return Math.abs(m[2] - m[1] - 2) < 1e-6; })(), JSON.stringify(L));
  check('un seul pas d\'annulation pour le décalage', JSON.parse(await R(`${key('z')} ${lay}`))[0] === 'sa@0 sb@2');
};
