// Limiteur : la façade s'ouvre, les réglages s'écrivent, l'écran défile pendant la lecture
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'lf',name:'LF',bpm:120,sends:[],buses:[],tracks:[{name:'Mix',type:'audio',color:'#A855F7',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++){const beat=(i%(sr/2))<2400?1:0.35; d[i]=(0.5*Math.sin(2*Math.PI*90*i/sr)*beat+0.15*(Math.random()*2-1))*0.9;} await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'m.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(600);
  await ev(`(()=>{const t=state.project.tracks[0]; t.effects=['limit']; t.effectParams={limit:{tp:1,gain:8,ceiling:-1}}; openEffectPanel(0,'limit',document.body); const p=document.querySelector('.lim-panel'); p.style.left='20px'; p.style.top='40px';})()`); await sleep(200);
  await R('façade ouverte', `const p=document.querySelector('.lim-panel'); return 'écran='+!!p.querySelector('.lim-svg')+' boutons='+p.querySelectorAll('.pk').length+' pic réel='+p.querySelector('.lim-tp').classList.contains('on')+' plafond affiché '+p.querySelector('.lim-c').textContent`);
  await R('pic réel éteint au clic', `document.querySelector('.lim-tp').click(); await new Promise(r=>setTimeout(r,30)); const v=state.project.tracks[0].effectParams.limit.tp; document.querySelector('.lim-tp').click(); return 'tp='+v+' puis '+state.project.tracks[0].effectParams.limit.tp`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(2500);
  await R('en lecture', `const p=document.querySelector('.lim-panel'); return 'étiquettes de pics='+p.querySelectorAll('.lim-lab').length+' réduction max '+p.querySelector('.lim-g').textContent+' sortie '+p.querySelector('.lim-o').textContent`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/limiteur.jpg');
  await ev(`togglePlay()`);
};
