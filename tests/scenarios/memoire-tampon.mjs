// Mémoire tampon (Réglages > Retour casque) : petite / moyenne / grande = indice de latence du moteur audio, rouvert proprement.
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mt',name:'MT',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const c1 = await PulseAudio.init(), sr = c1.sampleRate;
    const b = c1.createBuffer(1, sr * 2, sr); b.getChannelData(0).fill(0.2); PulseAudio.registerBuffer('s', b);
    state.project.tracks[0].clips = [{ id: 's', start: 0, duration: 2, name: 's' }]; renderAll();
    const lat0 = c1.baseLatency;
    // micro simulé sur un moteur à part (il survit à la fermeture de celui de Pulse) ; une copie du flux à chaque ouverture
    const mc = new AudioContext(), md = mc.createMediaStreamDestination(), o = mc.createOscillator(); o.connect(md); o.start();
    navigator.mediaDevices.getUserMedia = async () => md.stream.clone();
    let mic0 = false; try { await PulseAudio.requestMic(); mic0 = PulseAudio.hasMic(); } catch {}
    await togglePlay(); await new Promise(r => setTimeout(r, 300));
    openSettings(); await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('setBuffer'); const def = sel.value;
    sel.value = 'grand'; sel.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 800));
    const c2 = PulseAudio.getContext();
    const stopped = !state.playing;
    const saved = localStorage.getItem('pulse_buffer');
    // le son passe toujours : lecture + export
    await togglePlay(); await new Promise(r => setTimeout(r, 400)); const pos = PulseAudio.getPlaybackPosition(); await togglePlay();
    const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer());
    const peak = Math.max(...ab.getChannelData(0).subarray(0, 48000));
    const lat2 = c2.baseLatency;
    const an = PulseAudio.getMicAnalyser(); const mic2 = { has: PulseAudio.hasMic(), sameCtx: !!an && an.context === c2 };
    sel.value = 'petit'; sel.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 800));
    const c3 = PulseAudio.getContext();
    return JSON.stringify({ def, changed: c2 !== c1, closed: c1.state, stopped, saved, pos, peak, lat0, lat2, back: c3 !== c2 && c3.state, mode: PulseAudio.getBufferMode(), mic0, mic2 });
  })()`));
  console.log(JSON.stringify(r));
  check('par défaut : petite (le moins de retard)', r.def === 'petit', r.def);
  check('passer à « grande » rouvre le moteur audio (l\'ancien est fermé) et arrête la lecture', r.changed && r.closed === 'closed' && r.stopped, `${r.closed} / arrêt ${r.stopped}`);
  check('le choix est retenu', r.saved === 'grand', r.saved);
  check('grande : tampon plus grand que petite', r.lat2 >= r.lat0, `${(r.lat0 * 1000).toFixed(1)} → ${(r.lat2 * 1000).toFixed(1)} ms`);
  check('après le changement : la lecture avance et l\'export sonne', r.pos > 0.2 && Math.abs(r.peak - 0.2 * 0.8 / Math.SQRT2) < 0.01, `pos ${r.pos.toFixed(2)} s, crête ${r.peak.toFixed(3)}`);
  check('le micro ouvert avant est rouvert sur le nouveau moteur', !r.mic0 || (r.mic2.has && r.mic2.sameCtx), JSON.stringify({ avant: r.mic0, apres: r.mic2 }));
  check('retour à « petite »', r.back === 'running' || r.back === 'suspended' ? r.mode === 'petit' : false, `${r.back} / ${r.mode}`);
};
