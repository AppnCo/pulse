// Lancer la lecture juste derrière la prise qu'on vient de faire : ça part du curseur, pas du début
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'lp',name:'L',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  await ev(`state.playhead=2; updatePlayhead(); toggleRec()`); await sleep(1500);
  await ev(`togglePlay()`); await sleep(1200);
  const end = await ev(`computeProjectEndSec()`);
  check('une prise est posée', end > 2.5, end);
  for (const [lbl, at] of [['pile à la fin de la prise', end], ['juste derrière', end + 0.3]]) {
    await ev(`seekPlayhead(${at})`); await sleep(100);
    await ev(`togglePlay()`); await sleep(400);
    const p = await ev(`state.playhead`);
    check(`curseur ${lbl} : la lecture part de là`, p > end - 0.1, `départ ${at.toFixed(2)} → ${p.toFixed(2)}`);
    await ev(`togglePlay()`); await sleep(300);
  }
};
