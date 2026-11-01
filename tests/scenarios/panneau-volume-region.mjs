// 01/11 : panneau « Volume de ce clip… » — ⌘Z revient au volume d'avant, la lecture en cours suit
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pvr',name:'PVR',bpm:120,buses:[],sends:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100,clips:[{id:'kk',start:0,duration:1,offset:0,name:'a'},{id:'kk',start:2,duration:1,offset:0,name:'b'}]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  const R = (c) => ev(`(async()=>{${c}})()`);
  await R(`window.__n=0; const o=window.refreshPlaybackSoon; window.refreshPlaybackSoon=function(){ window.__n++; return o.apply(this,arguments); }; return 1`);
  const r = JSON.parse(await R(`state.selectedClips=new Set(['0:0','0:1']); state.selectedClip={trackIdx:0,clipIdx:0};
    openClipGainPanel(0,0); await new Promise(r=>setTimeout(r,100));
    const sl=document.querySelector('#clipGainSlider');
    for (const v of ['2','4','6']) { sl.value=v; sl.dispatchEvent(new Event('input')); }
    sl.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,100));
    const g=state.project.tracks[0].clips.map(c=>c.gain); const n=window.__n;
    document.querySelectorAll('.clip-gain-panel').forEach(p=>p.remove());
    undoAction(); await new Promise(r=>setTimeout(r,150));
    return JSON.stringify({g, n, apres: state.project.tracks[0].clips.map(c=>c.gain===undefined?'origine':c.gain)});`));
  check('les deux régions à +6 dB', r.g.every(x => Math.abs(x - 1.995) < 0.01), JSON.stringify(r.g));
  check('lecture mise à jour au relâché', r.n >= 1, r.n);
  check('⌘Z : volume d\'origine (pas une étape intermédiaire)', r.apres.every(x => x === 'origine'), JSON.stringify(r.apres));
};
