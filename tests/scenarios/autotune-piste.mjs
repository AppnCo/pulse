// Auto-Tune comme effet de PISTE : s'active depuis la tranche de la piste, corrige toutes ses prises et les prochaines
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  // une voix légèrement fausse : 452,3 Hz (un peu au-dessus de La4 = 440)
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*3,sr); const d=b.getChannelData(0); for(let i=0;i<b.length;i++){ const t=i/sr; d[i]=0.35*Math.sin(2*Math.PI*452.3*t)+0.12*Math.sin(2*Math.PI*904.6*t)+0.06*Math.sin(2*Math.PI*1356.9*t); }
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'voix.wav',{type:'audio/wav'}),0,0);
    state.project.tracks[0].type='audio'; delete state.project.tracks[0].preset; renderAll();})()`);
  await sleep(900);
  await ev(`state.project.tracks[0].tuneSlot=true; if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }`);   // l'Auto-Tune n'est visible que s'il a été ajouté (modèle ou + Effet)
  await ev(`document.getElementById('btnMixer').click()`); await sleep(500);
  await ev(`renderMixer(); bindMixerEvents()`);
  await R('slot Tune sur la piste', `const s=document.querySelector('.strip[data-kind="track"] [data-fx="tune"]'); return s? 'présent '+s.textContent : 'absent'`);
  await ev(`document.querySelector('.strip[data-kind="track"] [data-fx="tune"]').click()`); await sleep(400);
  await R('fenêtre', `const p=document.querySelector('.tune-panel'); return p? ((p.querySelector('.fx-title')||p.querySelector('.fx-panel-header')||p).textContent.trim().replace(/\s+/g,' ').slice(0,40)+' ; bouton='+(p.classList.contains('is-on')?'allumé':'éteint')) : 'absente'`);
  // toutes les notes (Auto-Tune libre) puis activer
  await ev(`document.querySelector('.tune-quick button[data-q="all"]').click(); document.querySelector('.tb-power').click()`); await sleep(6000);
  await R('après activation', `const t=state.project.tracks[0]; return 'autotune='+JSON.stringify({on:t.autotune&&t.autotune.on,strength:t.autotune&&t.autotune.strength})+' ; clip corrigé='+!!(t.clips[0]&&t.clips[0].tune)`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/autotune-piste.jpg');
};
