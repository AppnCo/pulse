// Enregistrement en boucle : avec une boucle allumée, la prise continue ; à l'arrêt, un morceau par tour (le dernier devant, les autres rangés A, B, C…)
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'br1',name:'BR',bpm:120,buses:[],sends:[],tracks:[{name:'Instru',type:'audio',color:'#60A5FA',volume:100,clips:[]},{name:'Voix',type:'audio',color:'#A855F7',volume:100,armed:true,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false);
    const sr=48000,b=ctx.createBuffer(1,sr*6,sr); b.getChannelData(0).fill(0.05); PulseAudio.registerBuffer('ins',b);
    state.project.tracks[0].clips=[{id:'ins',start:0,duration:6,offset:0,name:'Instru'}]; state.selectedTrack=1; renderAll(); })()`);
  await sleep(300);
  const r = JSON.parse(await ev(`(async()=>{
    state.loop={start:1,end:2}; state.looping=true; state.playhead=1; await togglePlay(); await new Promise(r=>setTimeout(r,300));
    await toggleRec(); await new Promise(r=>setTimeout(r,3300));
    const during={rec:state.recording, pos:+PulseAudio.getPlaybackPosition().toFixed(2), wraps:PulseAudio.getRecWraps().length};
    await toggleRec(); await new Promise(r=>setTimeout(r,200)); await togglePlay(); await new Promise(r=>setTimeout(r,900));
    const t=state.project.tracks[1];
    const front=t.clips.map(c=>({s:+c.start.toFixed(2), d:+c.duration.toFixed(2), o:+(c.offset||0).toFixed(2), k:c.take}));
    const takes=(t.takes||[]).map(c=>({s:+c.start.toFixed(2), d:+c.duration.toFixed(2), o:+(c.offset||0).toFixed(2), k:c.take})).sort((a,b)=>a.k-b.k);
    return JSON.stringify({during, front, takes});
  })()`));
  console.log(JSON.stringify(r));
  check('pendant la prise : la lecture boucle (position entre 1 et 2 s) et la prise continue', r.during.rec && r.during.pos >= 1 && r.during.pos <= 2.05 && r.during.wraps >= 2, JSON.stringify(r.during));
  check('devant : le dernier tour complet (1 s, au début de boucle)', r.front.length === 1 && Math.abs(r.front[0].s - 1) < 0.01 && Math.abs(r.front[0].d - 1) < 0.02, JSON.stringify(r.front));
  check('les tours précédents sont rangés derrière (au moins 2)', r.takes.length >= 2, r.takes.length);
  const all = [...r.takes, ...r.front].sort((a, b) => a.k - b.k);
  check('lettres dans l’ordre des tours ; le bout incomplet de la fin reste rangé derrière', all.every((c, i) => !i || c.k > all[i - 1].k) && all[all.length - 1].k === r.front[0].k + 1, all.map(c => c.k).join(','));
  check('les tours se suivent dans le fichier (rien de perdu, rien en double)', all.every((c, i) => !i || Math.abs(all[i - 1].o + all[i - 1].d - c.o) < 0.02), all.map(c => c.o + '+' + c.d).join(' '));
  check('tours complets = 1 s et calés au début de boucle', all.slice(1, -1).every(c => Math.abs(c.d - 1) < 0.02 && Math.abs(c.s - 1) < 0.01), JSON.stringify(all.slice(1, -1)));
  check('le bout de la fin est bien gardé (rien de perdu)', r.takes.some(c => c.k === all[all.length - 1].k), JSON.stringify(r.takes));
};
