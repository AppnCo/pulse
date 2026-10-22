// Retour terrain 20/10 : instru en haut, coupes D / F au curseur de base, Espace en boucle, zone de fondu réduite
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1')`);
  await nav('http://localhost:8765/index.html');
  await ev(`(async()=>{ const sr=44100, sec=20, n=sr*sec, buf=new ArrayBuffer(44+n*2), v=new DataView(buf); const W=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    W(0,'RIFF'); v.setUint32(4,36+n*2,true); W(8,'WAVEfmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); W(36,'data'); v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++) v.setInt16(44+i*2, Math.sin(i*0.05)*8000, true);
    startFromInstru(new File([buf],'instru.wav',{type:'audio/wav'})); })()`);
  await sleep(5000);
  await nav('http://localhost:8765/studio.html'); await sleep(2500);
  const out = {};
  out.ordre = await ev(`state.project.tracks.map(t=>t.name+':'+t.clips.length).join(' | ')`);
  // Fondu : zone d'attrape
  out.zoneFondu = await ev(`(()=>{ const z=document.querySelector('.clip-fade-zone'); return z? Math.round(z.getBoundingClientRect().width)+'px' : 'aucune' })()`);
  // Coupe à droite (F) au curseur de base pendant la lecture simulée : base à 5 s, tête à 9 s
  out.coupeF = await ev(`(()=>{ state.selectedTrack=0; const c=state.project.tracks[0].clips[0]; const d0=c.duration;
    state.playing=true; state.baseCleared=false; state.playOrigin=5; state.playhead=9;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',bubbles:true,cancelable:true}));
    state.playing=false; return JSON.stringify({avant:d0.toFixed(1), apres:state.project.tracks[0].clips[0].duration.toFixed(1)}) })()`);
  // Coupe à gauche (D) : garde la partie droite à partir de la base (2 s)
  out.coupeD = await ev(`(()=>{ const c=state.project.tracks[0].clips[0];
    state.playing=true; state.baseCleared=false; state.playOrigin=2; state.playhead=4;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD',bubbles:true,cancelable:true}));
    state.playing=false; const n=state.project.tracks[0].clips[0]; return JSON.stringify({start:n.start.toFixed(1), duree:n.duration.toFixed(1)}) })()`);
  // Boucle : chaque Espace repart du début de la boucle…
  await ev(`state.loop={start:2,end:8}; state.looping=true; state.userBaseSec=null; state.baseCleared=true; state.playOrigin=null; state.playhead=5; 0`);
  await ev(`togglePlay()`); await sleep(150);
  out.boucleSansCurseur = await ev(`state.playhead.toFixed(1)`);
  await ev(`togglePlay()`); await sleep(200);
  // …sauf curseur de départ posé dans la boucle
  await ev(`state.baseCleared=false; state.userBaseSec=6; state.playhead=3; 0`);
  await ev(`togglePlay()`); await sleep(150);
  out.boucleAvecCurseur = await ev(`state.playhead.toFixed(1)`);
  await ev(`togglePlay()`);
  console.log(JSON.stringify(out, null, 1));
};
