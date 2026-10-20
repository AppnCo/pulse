// Interface à plusieurs entrées (Apollo…) : on choisit l'entrée à enregistrer — micro simulé à 2 canaux (G = son, D = silence)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ei1',name:'Entrée',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(500);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('micro simulé à 2 entrées', `const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); md.channelCount=2; md.channelCountMode='explicit'; const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.4; o.connect(g); const mg=ctx.createChannelMerger(2); g.connect(mg,0,0); mg.connect(md); o.start();
    window.__stream=md.stream; navigator.mediaDevices.getUserMedia=async()=>{ const st=window.__stream; const t=st.getAudioTracks()[0]; const gs=t.getSettings.bind(t); t.getSettings=()=>({...gs(), channelCount:2}); return st; }; return 'ok'`);
  const level = ``;
  await R('entrée 1 : niveau', `PulseAudio.setMicChannel(1); await PulseAudio.requestMic(); await new Promise(r=>setTimeout(r,500)); const a=PulseAudio.getMicAnalyser(); const b=new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); let pk=0; for(const v of b) pk=Math.max(pk,Math.abs(v)); return 'canaux='+PulseAudio.getMicChannels()+' crête='+pk.toFixed(3)+' (attendu ≈0.4)'`);
  await R('entrée 2 : silence', `PulseAudio.setMicChannel(2); await PulseAudio.requestMic(); await new Promise(r=>setTimeout(r,500)); const a=PulseAudio.getMicAnalyser(); const b=new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); let pk=0; for(const v of b) pk=Math.max(pk,Math.abs(v)); return 'crête='+pk.toFixed(3)+' (attendu 0.000)'`);
  const click = async (sel, text) => { const r = JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${text?`els.find(e=>e.textContent.includes(${JSON.stringify(text)}))`:'els[0]'}; if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`)); if (!r) { console.log('introuvable', sel, text); return; } for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type==='mousePressed'?1:0, clickCount: 1 }); await sleep(300); };
  await R('bouton Entrée dans la tranche de gauche', `state.selectedTrack=0; renderTracksPanel(); bindTrackEvents(); renderInspector(); return document.querySelector('.insp-fmt .insp-input')?.textContent+' | '+document.querySelector('.insp-fmt .insp-mono')?.textContent`);
  await click('.insp-input');
  await click('.track-ctx-menu .ctx-item', 'Entrée 2');
  await R('choix Entrée 2 sur la piste', `return 'inputChannel='+state.project.tracks[0].inputChannel+' | bouton='+document.querySelector('.insp-input').textContent`);
  await R('au début de la prise, l entrée de la piste est appliquée', `PulseAudio.setMicChannel(1); await beginCapture(0, 0); const v=localStorage.getItem('pulse_mic_channel'); try{ PulseAudio.stopRecording && await PulseAudio.stopRecording(); }catch(e){} return 'entrée active='+v+' (attendu 2)'`);
};
