// 18/10 : la lecture ne s'arrête plus à la fin des régions ; Espace arrête, puis relance depuis la base du curseur
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'la',name:'La',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (l, c) => console.log(l + ':', await ev(`(async()=>{${c}})()`));
  await R('prépare', `const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate); const d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.2*Math.sin(i/20); PulseAudio.registerBuffer('la',b); state.project.tracks[0].clips=[{id:'la',start:0,duration:2,name:'A'}]; state.playhead=0.5; renderTimelineTracks(); return 'ok'`);
  await R('lecture lancée depuis 0,5 s', `togglePlay(); await new Promise(r=>setTimeout(r,300)); return state.playing`);
  await sleep(4500);
  await R('4,8 s plus tard (région finie à 2 s) : encore en lecture ?', `return JSON.stringify({playing:state.playing, ph:+state.playhead.toFixed(2)})`);
  await R('Espace puis Espace : relance depuis la base (0,5 attendu)', `togglePlay(); await new Promise(r=>setTimeout(r,200)); togglePlay(); await new Promise(r=>setTimeout(r,300)); return JSON.stringify({playing:state.playing, ph:+state.playhead.toFixed(2)})`);
};
