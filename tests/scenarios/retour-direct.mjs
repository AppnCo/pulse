// Retour casque direct (appli de bureau) : le moteur natif renvoie la voix au casque, le retour web se tait ;
// s'il échoue, le retour web reprend ; la mémoire tampon choisit sa taille ; fermer le micro le ferme.
// Ici l'appli est simulée (window.__TAURI__ factice) : le vrai moteur est testé par tests/native.sh.
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__calls = []; window.__failMon = false;
    window.__TAURI__ = { core: { invoke: async (cmd, args) => {
      window.__calls.push([cmd, args]);
      if (cmd === 'monitor_start') { if (window.__failMon) throw 'micro introuvable pour le retour direct'; return { running: true, rate: 48000, buffer: args.buffer, input: args.device, output: 'Casque', latency_ms: 0, underruns: 0, error: null }; }
      if (cmd === 'monitor_info') return { running: true, rate: 48000, buffer: 64, input: '', output: '', latency_ms: 4.0, underruns: 0, error: null };
      return null;
    } } };` });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_monitor','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rd',name:'RD',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[],armed:true}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    await PulseAudio.init();
    const mc = new AudioContext(), md = mc.createMediaStreamDestination(), o = mc.createOscillator(); o.connect(md); o.start();
    navigator.mediaDevices.getUserMedia = async () => md.stream.clone();
    const starts = () => __calls.filter(c => c[0] === 'monitor_start');
    const stops = () => __calls.filter(c => c[0] === 'monitor_stop').length;
    const out = { avail: PulseNative.available, defOn: PulseAudio.getNativeMonitor().usable };
    await PulseAudio.requestMic(); await w(500);
    out.a = { starts: starts().length, last: starts().slice(-1)[0], active: PulseAudio.getNativeMonitor().active, web: PulseAudio.getMonitorWebGain(), lat: PulseAudio.getLatencyInfo() };
    // mémoire tampon grande : retour direct rouvert avec 256
    await PulseAudio.setBufferMode('grand'); await w(500);
    out.b = { last: starts().slice(-1)[0], active: PulseAudio.getNativeMonitor().active, web: PulseAudio.getMonitorWebGain() };
    await PulseAudio.setBufferMode('petit'); await w(400);
    // coupé dans les réglages : arrêté, le retour web reprend
    const s0 = stops(); PulseAudio.setNativeMonitor(false); await w(200);
    out.c = { stopped: stops() > s0, active: PulseAudio.getNativeMonitor().active, web: PulseAudio.getMonitorWebGain(), saved: localStorage.getItem('pulse_native_monitor') };
    // échec à l'ouverture : le retour web reprend, l'erreur est gardée
    __failMon = true; PulseAudio.setNativeMonitor(true); await w(300);
    out.d = { active: PulseAudio.getNativeMonitor().active, web: PulseAudio.getMonitorWebGain(), err: PulseAudio.getNativeMonitor().error };
    __failMon = false; PulseAudio.setNativeMonitor(false); PulseAudio.setNativeMonitor(true); await w(300);
    // « M'entendre dans le casque » coupé : arrêté
    const s1 = stops(); PulseAudio.setMonitor(false); await w(200);
    out.e = { stopped: stops() > s1, active: PulseAudio.getNativeMonitor().active, web: PulseAudio.getMonitorWebGain() };
    PulseAudio.setMonitor(true); await w(300);
    // le bouton « i » de la piste coupé (aucune piste écoutée) : arrêté
    const s2 = stops(); PulseAudio.setMonitorRoute(false); await w(200); out.f = { stopped: stops() > s2 }; PulseAudio.setMonitorRoute(true); await w(300);
    // micro fermé : arrêté
    const s3 = stops(); PulseAudio.releaseMic(); await w(200); out.g = { stopped: stops() > s3, active: PulseAudio.getNativeMonitor().active };
    // la réglette apparaît dans les Réglages de l'appli
    openSettings(); await w(300); out.box = !!document.getElementById('setNativeMon') && document.getElementById('setNativeMon').checked;
    return JSON.stringify(out);
  })()`));
  console.log(JSON.stringify(r));
  check('dans l\'appli, le retour direct est activé par défaut', r.avail && r.defOn, JSON.stringify([r.avail, r.defOn]));
  check('micro ouvert : retour direct lancé (tampon 64, entrée 1) et retour web muet', r.a.starts === 1 && r.a.last[1].buffer === 64 && r.a.last[1].channel === 0 && r.a.active && r.a.web === 0, JSON.stringify(r.a));
  check('le retard affiché est celui du retour direct', r.a.lat && r.a.lat.native && r.a.lat.totalMs <= 8, JSON.stringify(r.a.lat));
  check('mémoire tampon grande : retour direct rouvert à 256', r.b.last[1].buffer === 256 && r.b.active && r.b.web === 0, JSON.stringify(r.b));
  check('coupé dans les Réglages : arrêté, retour web à la place', r.c.stopped && !r.c.active && r.c.web === 1 && r.c.saved === '0', JSON.stringify(r.c));
  check('s\'il ne s\'ouvre pas : retour web à la place, sans rien casser', !r.d.active && r.d.web === 1 && /introuvable/.test(r.d.err), JSON.stringify(r.d));
  check('« M\'entendre dans le casque » coupé : retour direct arrêté, rien au casque', r.e.stopped && !r.e.active && r.e.web === 0, JSON.stringify(r.e));
  check('aucune piste écoutée (« i ») : arrêté', r.f.stopped, JSON.stringify(r.f));
  check('micro fermé : retour direct fermé', r.g.stopped && !r.g.active, JSON.stringify(r.g));
  check('la case « Retour direct par l\'appli » est dans les Réglages, cochée', r.box === true, String(r.box));
};
