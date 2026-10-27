// Région : Transposer, Vitesse, Normaliser à un niveau, Fondus chiffrés, Boucler, Convertir en nouvelle prise
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rs1',name:'RS',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*2,sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.25*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('k',b);
    state.project.tracks[0].clips=[{id:'k',start:0,duration:1,offset:0,name:'a'},{id:'k',start:3,duration:1,offset:0,name:'b'}]; state.selectedTrack=0; renderAll();
    window.__exp=async(ci)=>{ const t=JSON.parse(JSON.stringify(state.project.tracks[0])); t.clips=[t.clips[ci]]; const p={buses:[],sends:[],tracks:[t]}; return (await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0); };
    window.__zc=(x,a,z)=>{let n=0; for(let i=a+1;i<z;i++) if((x[i-1]<0)!==(x[i]<0)) n++; return n;}; })()`);
  await sleep(300);
  await R('menu : premier niveau', `openClipContextMenu(300,200,0,0); await new Promise(r=>setTimeout(r,120)); return [...document.querySelector('.clip-ctx-menu').children].filter(e=>e.classList.contains('ctx-item')).map(e=>e.textContent.trim()).join(' | ')`);
  await R('sous-menu Hauteur et vitesse', `const row=[...document.querySelectorAll('.clip-ctx-menu .ctx-has-sub')].find(e=>/Hauteur/.test(e.textContent)); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,80)); return [...document.querySelectorAll('.ctx-subpanel .ctx-item')].map(e=>e.textContent.trim()).join(' | ')`);
  await R('export de départ : passages par zéro de la sinusoïde (≈ 880 sur 0,5 s)', `closeAllMenus(); const x=await __exp(0); return __zc(x,4800,28800)`);
  await R('Transposer +12 : le son monte d une octave (≈ 2×)', `transposeClips(0,0,12); await new Promise(r=>setTimeout(r,200)); const c=state.project.tracks[0].clips[0]; const x=await __exp(0); return 'fx='+JSON.stringify(c.fx&&c.fx.effectParams)+' passages='+__zc(x,9600,38400)+' (sur 0,6 s, attendu ≈ 2×1056)'`);
  await R('Hauteur d origine : effet retiré', `transposeClips(0,0,0); const c=state.project.tracks[0].clips[0]; return 'fx='+JSON.stringify(c.fx||null)`);
  await R('Normaliser à −6 dB : crête exportée', `normalizeClipTo(0,0,-6); await new Promise(r=>setTimeout(r,100)); const x=await __exp(0); let pk=0; for(let i=0;i<48000;i++) pk=Math.max(pk,Math.abs(x[i])); return 'gain='+state.project.tracks[0].clips[0].gain+' crête='+pk.toFixed(3)+' (attendu 0,501)'`);
  await R('Fondus chiffrés : entrée 250 ms, sortie 50 ms', `setClipFade(0,0,'in',0.25); setClipFade(0,0,'out',0.05); const c=state.project.tracks[0].clips[0]; return 'fadeIn='+c.fadeIn+' fadeOut='+c.fadeOut`);
  await R('Boucler jusqu à la région suivante (début à 3 s)', `loopClipUntilNext(0,0); return 'loopEnd='+state.project.tracks[0].clips[0].loopEnd`);
  await R('Convertir en nouvelle prise : effets + fondus + répétition dans le son', `const t=state.project.tracks[0]; const before=await __exp(0); const rms=(x,a,z)=>{let s=0; for(let i=a;i<z;i++) s+=x[i]*x[i]; return 20*Math.log10(Math.sqrt(s/(z-a))+1e-9)}; const r0=rms(before,24000,72000); await joinSelectedClips(0,0,{single:true}); await new Promise(r=>setTimeout(r,500)); const c=t.clips[0]; const after=await __exp(0); const r1=rms(after,24000,72000); return 'id='+String(c.id).slice(0,5)+' fx='+!!c.fx+' fondu='+(c.fadeIn||0)+' boucle='+(c.loopEnd||0)+' durée='+c.duration.toFixed(2)+' | niveau avant '+r0.toFixed(2)+' après '+r1.toFixed(2)+' dB'`);
  await R('⌘Z remet la région d origine', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,300)); const c=state.project.tracks[0].clips[0]; return 'id='+c.id+' boucle='+c.loopEnd`);
  await R('Vitesse × 2 : la durée est divisée par deux', `const c=state.project.tracks[0].clips[1]; const d0=c.duration; await speedClip(0,1,2); await new Promise(r=>setTimeout(r,1500)); const c2=state.project.tracks[0].clips.find(o=>o.name==='b'); return 'durée '+d0+' → '+c2.duration.toFixed(2)`);
};
