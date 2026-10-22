// Accueil : déposer une instru ouvre un projet prêt à enregistrer
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1')`);
  await nav('http://localhost:8765/index.html');
  if (SHOTS) await shot(SHOTS + '/shot-home.jpg');
  // instru synthétique 100 BPM en WAV, passée à startFromInstru comme un fichier déposé
  await ev(`(async()=>{ const sr=44100, sec=12, n=sr*sec, buf=new ArrayBuffer(44+n*2), v=new DataView(buf); const W=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    W(0,'RIFF'); v.setUint32(4,36+n*2,true); W(8,'WAVEfmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); W(36,'data'); v.setUint32(40,n*2,true);
    const beat=60/100; for(let i=0;i<n;i++){ const t=(i/sr)%beat; v.setInt16(44+i*2, t<0.04? Math.sin(2*Math.PI*70*t)*(1-t/0.04)*26000 : 0, true); }
    startFromInstru(new File([buf],'Mon instru trap.wav',{type:'audio/wav'})); })()`);
  await sleep(4000);
  console.log(await ev(`(()=>{ const p=state.project; return JSON.stringify({page:location.pathname, nom:p.name, bpm:p.bpm, pistes:p.tracks.map(t=>t.name+':'+t.clips.length+(t.armed?' (armée)':'')), dureeInstru:p.tracks[0].clips[0]?.duration, enAttente:!!p.pendingInstru, hintRec:!!document.querySelector('.track-empty-hint'), son:p.tracks[0].sound?.preset}); })()`));
  if (SHOTS) await shot(SHOTS + '/shot-start.jpg');
  await nav('http://localhost:8765/studio.html');
  console.log('rechargement:', await ev(`state.project.tracks[0].clips.length+' clip instru, audio présent: '+PulseAudio.hasBuffer(state.project.tracks[0].clips[0].id)`));
};
