const SP = new URL('.', import.meta.url).pathname;
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 520, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_countin','0'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tk1',name:'Prises',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'},{name:'Instru',type:'audio',preset:'instru',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  // micro simulé : un oscillateur continu
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.3; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const dump = `const t=state.project.tracks[0]; const f=c=>takeLetter(c.take)+'['+c.start.toFixed(2)+'→'+(c.start+c.duration).toFixed(2)+' off'+(c.offset||0).toFixed(2)+']'; return 'devant: '+t.clips.slice().sort((a,b)=>a.start-b.start).map(f).join(' ')+' | rangé: '+(t.takes||[]).map(f).join(' ')+' | lignes: '+document.querySelectorAll('.take-lane').length+' ouvert:'+!!t.takesOpen;`;
  const click = async (sel) => { const r = JSON.parse(await ev(`JSON.stringify((()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`)); for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type==='mousePressed'?1:0, clickCount: 1 }); await sleep(250); };
  await ev(`toggleRec()`); await sleep(2200); await ev(`togglePlay()`); await sleep(400);
  await ev(`(async()=>{ state.playhead=1; updatePlayhead(); await toggleRec(); })()`); await sleep(1300); await ev(`togglePlay()`); await sleep(400);
  await R('après prise B', dump);
  await click('.takes-toggle'); await R('clic réel sur le bouton (doit fermer)', dump);
  await click('.takes-toggle'); await R('2e clic (doit rouvrir)', dump);
};
