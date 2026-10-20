// Accueil : déposer une instru -> studio, voix, enregistrer, exporter, retour accueil, rouvrir le projet récent
import { J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async ({ ev, nav, send, sleep, shot, logs }) => {
  const K = key(send);
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/index.html'); await sleep(600);
  await ev(`(async()=>{ const sr=44100, n=sr*6, buf=new ArrayBuffer(44+n*2), v=new DataView(buf); const w=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
    w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++){ const beat=Math.floor(i/(sr*0.5)); const t=(i%(sr*0.5))/sr; const s=Math.sin(2*Math.PI*(beat%2?220:165)*i/sr)*0.3*Math.exp(-t*6); v.setInt16(44+i*2, s*32767, true); }
    await startFromInstru(new File([buf],'Instru - Été (140bpm).wav',{type:'audio/wav'})); })()`);
  await sleep(2500);
  console.log('URL', await ev(`location.pathname`));
  // micro simulé
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); window.__dl=[]; const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__dl.push(this.download); return; } return oc.call(this); }; })()`);
  console.log('projet', await ev(`JSON.stringify({name:state.project.name,bpm:state.project.bpm,tracks:state.project.tracks.map(t=>[t.name,t.type,t.armed,(t.clips||[]).map(c=>c.name)])})`));
  console.log('piste choisie', await ev(`state.selectedTrack`));
  await K('r'); await sleep(3000); await K(' '); await sleep(1500);
  console.log('après prise', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).map(c=>[c.name,+c.start.toFixed(2),+c.duration.toFixed(2)])]))`));
  await ev(`doExport('mp3',128)`); await sleep(3500);
  console.log('dl', await ev(`JSON.stringify(window.__dl)`));
  // retour à l'accueil : ⌘N
  await ev(`flushProjectDocSave()`); await sleep(400);
  await nav('http://localhost:8765/index.html'); await sleep(900);
  console.log('récents', await ev(`[...document.querySelectorAll('.recent-item-name')].map(e=>e.textContent).join(' | ')`));
  await ev(`document.querySelector('.recent-item').click()`); await sleep(2500);
  console.log('rouvert', await ev(`location.pathname`), await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).map(c=>[c.name,+c.duration.toFixed(2), !!PulseAudio.getBuffer(c.id)])]))`));
  await shot('/private/tmp/claude-501/qa/accueil-rouvert.jpg');
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
};
