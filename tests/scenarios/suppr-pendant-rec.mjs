// Supprimer une piste en pleine prise : elle disparaît tout de suite, la prise atterrit sur la bonne piste
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sr',name:'S',bpm:120,buses:[],tracks:[{name:'Haut',type:'audio',color:'#A855F7',clips:[]},{name:'Milieu',type:'audio',color:'#C084FC',clips:[]},{name:'Voix',type:'audio',armed:true,color:'#A855F7',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  await ev(`toggleRec()`); await sleep(1200);
  check('la prise tourne', await ev(`state.recording`));
  await ev(`state.selectedTrack=0; state.selectedTracks=new Set(); deleteSelectedTrack()`); await sleep(200);
  check('piste « Haut » masquée tout de suite', await ev(`!!document.querySelector('.track-item.pend-del') && getComputedStyle(document.querySelector('.track-item.pend-del')).display==='none'`));
  check('la prise continue', await ev(`state.recording`));
  await ev(`state.selectedTrack=2; deleteSelectedTrack()`); await sleep(100);
  check('la piste qui enregistre ne se supprime pas', await ev(`state.project.tracks.length===3 && !document.querySelectorAll('.track-item.pend-del')[1]`));
  await sleep(800); await ev(`toggleRec()`); await sleep(400); await ev(`state.playing && togglePlay()`); await sleep(1500);
  const r = await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+':'+(t.clips||[]).length))`);
  check('après la prise : « Haut » retirée, la prise est sur « Voix »', r === '["Milieu:0","Voix:1"]', r);
  await ev(`undoAction()`); await sleep(300);
  const u = await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+':'+(t.clips||[]).length+(t.muted?'(muet)':'')))`);
  check('⌘Z remet « Haut » sans perdre la prise', u === '["Haut:0","Milieu:0","Voix:1"]', u);
};
