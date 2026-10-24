// EQ « pro » : formes (encoche, pente), pentes raides, auto gain, solo, bulle — et le moteur Rust suit (voir lib.rs)
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr); const d=b.getChannelData(0); for(let i=0;i<b.length;i++) d[i]=0.15*(Math.random()*2-1)+0.2*Math.sin(2*Math.PI*220*i/sr); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'t.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(700);
  await ev(`openEqPanel(0, document.body)`); await sleep(300);
  await R('modèle Voix rap posé', `const s=document.querySelector('.eq-preset'); s.value='voix'; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,60)); return document.querySelectorAll('.eq-pt').length+' points ; bulle='+!document.querySelector('.eq-bub').hidden`);
  const pick = (i) => `document.querySelector('.eq-pt[data-i="${i}"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));`;
  await R('coupe-bas en 48 dB/oct', `${pick(0)} await new Promise(r=>setTimeout(r,30)); const s=document.querySelector('.eq-slope'); s.value='48'; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); const b=state.project.tracks[0].effectParams.eq.bands[0]; return b.type+' pente='+b.slope+' ; -dB à 40 Hz='+eqBandDb(b,40).toFixed(1)+' (12 dB/oct ≈ '+eqBandDb({...b,slope:12},40).toFixed(1)+')'`);
  await R('point 2 en encoche', `${pick(1)} await new Promise(r=>setTimeout(r,30)); document.querySelector('.eq-types [data-type="notch"]').click(); await new Promise(r=>setTimeout(r,30)); const b=state.project.tracks[0].effectParams.eq.bands[1]; return b.type+' q='+b.q+' ; à '+b.freq+' Hz : '+eqBandDb(b,b.freq).toFixed(0)+' dB'`);
  await R('point 3 en pente (tilt)', `${pick(2)} await new Promise(r=>setTimeout(r,30)); document.querySelector('.eq-types [data-type="tilt"]').click(); await new Promise(r=>setTimeout(r,30)); const b=state.project.tracks[0].effectParams.eq.bands[2]; return b.type+' gain='+b.gain+' ; 50 Hz '+eqBandDb(b,50).toFixed(1)+' / 15 kHz '+eqBandDb(b,15000).toFixed(1)`);
  await R('auto gain', `document.querySelector('.eq-ag').click(); await new Promise(r=>setTimeout(r,30)); const e=state.project.tracks[0].effectParams.eq; return 'autogain='+e.autogain+' sortie='+e.out+' dB ; affiché '+document.querySelector('.eq-out b').textContent`);
  await R('mêmes chiffres que Rust (eq_pro_formes)', `const B=[{type:'hpf',freq:80,q:0.71,slope:48},{type:'notch',freq:300,q:2},{type:'tilt',freq:3200,gain:2.5,q:1}]; return [40,1000,15000].map(f=>f+' Hz '+(3+B.reduce((a,b)=>a+eqBandDb(b,f),0)).toFixed(2)).join(' / ')`);
  await R('solo du point 4', `${pick(3)} await new Promise(r=>setTimeout(r,30)); document.querySelector('.eq-solo').click(); await new Promise(r=>setTimeout(r,30)); return 'solo='+state.project.tracks[0].effectParams.eq.solo`);
  await R('fermer = le solo s arrête', `document.querySelector('.eq-panel .fx-panel-close').click(); await new Promise(r=>setTimeout(r,30)); return 'solo='+state.project.tracks[0].effectParams.eq.solo`);
  await ev(`openEqPanel(0, document.body)`); await sleep(200);
  await ev(`(()=>{const p=document.querySelector('.eq-pt[data-i="1"]'); p.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);
  await ev(`document.querySelector('.eq-panel').style.left='20px'; document.querySelector('.eq-panel').style.top='40px'`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(1500);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/eq-pro.jpg');
  await ev(`togglePlay()`);
};
