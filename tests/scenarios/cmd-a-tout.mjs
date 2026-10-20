// 18/10 : ⌘A choisit toutes les régions de toutes les pistes ; Q quantifie dans le piano roll
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ca',name:'Ca',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#60A5FA'},{name:'C',type:'audio',color:'#34D399'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (l, c) => console.log(l + ':', await ev(`(async()=>{${c}})()`));
  await R('prépare', `const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate); PulseAudio.registerBuffer('ca',b); state.project.tracks[0].clips=[{id:'ca',start:0,duration:2,name:'A'},{id:'ca',start:3,duration:1,name:'A2'}]; state.project.tracks[1].clips=[{id:'ca',start:1,duration:2,name:'B'}]; state.project.tracks[2].clips=[]; renderTimelineTracks(); return 'ok'`);
  const key = async (opts) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ...opts }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ...opts }); await sleep(200); };
  await key({ modifiers: 4 });   // Ctrl (Windows) = ⌘
  await R('Ctrl/⌘ + A : 3 régions sur 2 pistes', `return [...state.selectedClips].sort().join(' ')`);
  await R('Suppr les efface toutes', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})); await new Promise(r=>setTimeout(r,200)); return state.project.tracks.map(t=>t.clips.length).join(',')`);
};
