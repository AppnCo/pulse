// Warp : caler un clip sur le tempo du projet, le retirer, suivre le tempo ; EQ d'un groupe
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'wp1',name:'Warp',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`toggleRec()`); await sleep(3000); await ev(`togglePlay()`); await sleep(500);
  const C = `state.project.tracks[0].clips[0]`;
  await R('clip de départ', `const c=${C}; return 'durée='+c.duration.toFixed(2)+' id='+c.id.slice(0,12)`);
  await R('caler 90 → 120 BPM', `const c=${C}; const d0=c.duration; const ok=await applyWarp(c,90,120); return 'ok='+ok+' durée '+d0.toFixed(2)+' → '+c.duration.toFixed(2)+' (×0,75 = '+(d0*0.75).toFixed(2)+') warp='+JSON.stringify(c.warp)+' tampon='+PulseAudio.getBuffer(c.id).duration.toFixed(2)+' s'`);
  await R('panneau Warp', `openWarpPanel(0,0,200,200); await new Promise(r=>setTimeout(r,200)); const p=document.querySelector('.warp-panel'); const v=p.querySelector('.warp-bpm').value; p.remove(); return 'tempo affiché='+v+' bouton retirer='+!!p.querySelector('.warp-remove')+' tag='+document.querySelector('.clip-gain-tag')?.textContent`);
  await R('le projet passe à 100 BPM : le clip suit', `state.project.bpm=100; await new Promise(r=>setTimeout(r,2500)); const c=${C}; return 'warp='+JSON.stringify(c.warp)+' durée='+c.duration.toFixed(2)+' (attendu '+(3.0*0.9).toFixed(2)+' environ)'`);
  await R('retirer le warp', `const c=${C}; await removeWarp(c); return 'durée='+c.duration.toFixed(2)+' warp='+c.warp+' id source='+!c.id.includes('_w')`);
  await R('refus : écart trop grand', `const ok=await applyWarp(${C},40,140); return 'ok='+ok`);
};
