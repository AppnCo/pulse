// Retour casque : bouton « i » par piste, monitoring logiciel, mode Faible latence
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rc1',name:'Retour',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'},{name:'Back',type:'audio',color:'#22D3EE'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; o.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); await PulseAudio.requestMic(); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const T = `state.project.tracks`;
  await R('piste armée = écoutée, piste non armée = non', `return ${T}.map(t=>trackMonitored(t)).join('/')`);
  await R('« i » sur Voix la coupe (armée → false)', `toggleTrackMonitor(${T}[0]); return trackMonitored(${T}[0])+' inputMonitor='+${T}[0].inputMonitor`);
  await R('« i » de nouveau = retour automatique, rien de stocké', `toggleTrackMonitor(${T}[0]); return trackMonitored(${T}[0])+' inputMonitor='+${T}[0].inputMonitor`);
  await R('« i » sur Back (non armée) la force', `toggleTrackMonitor(${T}[1]); return trackMonitored(${T}[1])+' inputMonitor='+${T}[1].inputMonitor`);
  await R('bouton dans l\'en-tête', `return document.querySelectorAll('.track-item .t-mini.m-i').length+' boutons, actifs='+document.querySelectorAll('.t-mini.m-i.active').length`);
  await R('clic réel sur le bouton', `const b=document.querySelector('.t-mini.m-i[data-i="1"]'); b.click(); await new Promise(r=>setTimeout(r,100)); return 'Back écoutée='+trackMonitored(${T}[1])+' / voix du micro dans le casque='+PulseAudio.isMonitorOn()`);
  await R('plus aucune piste écoutée', `${T}.forEach(t=>{ t.inputMonitor = false; }); syncMonitor(); return ${T}.some(trackMonitored)`);
  await R('monitoring logiciel + faible latence', `PulseAudio.setMonitor(true); const l1=PulseAudio.isLowLatency(); PulseAudio.setLowLatency(false); const l2=PulseAudio.isLowLatency(); PulseAudio.setLowLatency(true); PulseAudio.setMonitor(false); return 'défaut='+l1+' coupé='+l2+' stocké='+localStorage.getItem('pulse_low_latency')+' info='+JSON.stringify(PulseAudio.getLatencyInfo())`);
  await ev(`openSettings()`); await sleep(500);
  await R('Réglages affiche la latence', `return document.getElementById('setLatValue').textContent+' '+document.getElementById('setLatNote').textContent`);
};
