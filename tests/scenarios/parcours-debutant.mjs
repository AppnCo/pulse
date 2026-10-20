// Parcours d'un débutant de bout en bout : instru posé → R → voix → Espace → Exporter (MP3)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false);
    window.__dl=[]; const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__dl.push(this.download); return; } return oc.call(this); }; })()`);
  await R('1. poser l instru', `const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr*6,sr); for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=Math.sin(i/40)*0.3; await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'instru.wav',{type:'audio/wav'}),0,0); return 'pistes='+state.project.tracks.map(t=>t.name+'/'+t.type).join(',')`);
  await ev(`state.playhead=0; toggleRec()`); await sleep(2500);
  await R('2. R : ça enregistre', `return 'rec='+state.recording+' pistes='+state.project.tracks.map(t=>t.name+(t.armed?'*':'')).join(',')`);
  await ev(`togglePlay()`); await sleep(500);
  await R('2b. message après l arrêt', `return [...document.querySelectorAll('[class*=flash],[class*=toast]')].map(e=>e.textContent.trim()).join('|')`);
  await sleep(300);
  await R('3. Espace : arrêté, voix posée', `const v=state.project.tracks.find(t=>/Voix/.test(t.name)); return 'rec='+state.recording+' lecture='+state.playing+' clips voix='+(v?v.clips.filter(c=>!c.recording).length:'?')`);
  await R('4. exporter en MP3', `exportProject(); await new Promise(r=>setTimeout(r,400)); const m=document.querySelector('.export-opt[data-fmt="mp3"]'); if(!m) return 'pas de bouton mp3'; m.click(); await new Promise(r=>setTimeout(r,15000)); return 'fichiers='+JSON.stringify(window.__dl)+' modal='+!!document.getElementById('exportModal')+' flash='+[...document.querySelectorAll('[class*=flash],[class*=toast]')].map(e=>e.textContent.trim()).join('|')`);
};
