// Retour terrain 17/10 : panneau de couleurs ⌥C, ⌘X, S/D, ⌘Q hors logiciel, flèches en lecture, aimant sur le curseur
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cr1',name:'Couleurs',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const key = async (k, code, mods = 0) => { for (const type of ['rawKeyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, modifiers: mods, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); await sleep(150); };
  await R('prépare', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*6,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(2*Math.PI*220*i/sr); PulseAudio.registerBuffer('cr',b); state.project.tracks[0].clips=[{id:'cr',start:0,duration:6,name:'x'}]; state.selectedClip={trackIdx:0,clipIdx:0}; renderTimelineTracks(); return 'ok'`);
  await key('c', 'KeyC', 1);   // Alt+C
  await R('panneau ouvert', `return document.querySelectorAll('.color-panel .ctx-swatch').length+' couleurs'`);
  await R('clic sur une couleur', `const sw=document.querySelectorAll('.color-panel .ctx-swatch[data-c]')[7]; sw.click(); return 'clip.color='+state.project.tracks[0].clips[0].color+' (attendu '+sw.dataset.c+')'`);
  await key('Escape', 'Escape'); 
  await R('D efface à gauche du curseur', `state.selectedClip=null; state.playhead=2; updatePlayhead(); return 'ok'`);
  await key('d', 'KeyD');
  await R('après D (gauche)', `const c=state.project.tracks[0].clips; return JSON.stringify(c.map(x=>[+x.start.toFixed(2),+x.duration.toFixed(2)]))+' (attendu [[2,4]])'`);
  await R('F efface à droite', `state.playhead=5; updatePlayhead(); return 'ok'`);
  await key('f', 'KeyF');
  await R('après F (droite)', `const c=state.project.tracks[0].clips; return JSON.stringify(c.map(x=>[+x.start.toFixed(2),+x.duration.toFixed(2)]))+' (attendu [[2,3]])'`);
  await R('⌘X coupe la région', `state.selectedClip={trackIdx:0,clipIdx:0}; return 'ok'`);
  await key('x', 'KeyX', 4);   // Meta+X
  await R('après ⌘X', `return 'clips='+state.project.tracks[0].clips.length+' presse-papier='+!!state.clipboard+' (attendu 0 et true)'`);
  await R('⌘V recolle', `pasteClip(); return 'clips='+state.project.tracks[0].clips.length`);
  await R('flèches en lecture : curseur de base', `state.playhead=0; updatePlayhead(); await togglePlay(); await new Promise(r=>setTimeout(r,600)); const live0=state.playhead; const o0=state.playOrigin; return 'origine='+o0+' live='+live0.toFixed(2)`);
  await key('ArrowRight', 'ArrowRight');
  await R('après →', `const out='origine='+state.playOrigin+' (attendu 0.5) live='+state.playhead.toFixed(2)+' (continue, pas ramené à 0.5) lecture='+state.playing; await togglePlay(); return out+' | à l arrêt, curseur='+state.playhead.toFixed(2)`);
};
