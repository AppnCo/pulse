// Geler une piste (comme Logic) : le rendu (régions + effets, avant le fader) joue à la place, même mix ; régions figées ; dégel.
// Même règle que geler_piste (Rust).
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gp1',name:'GP',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]},{name:'Stéréo',type:'audio',color:'#A78BFA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000, wait=(ms)=>new Promise(r=>setTimeout(r,ms));
    const tone=(f,a)=>{ const d=new Float32Array(sr); for(let i=0;i<sr;i++) d[i]=a*Math.sin(2*Math.PI*f*i/sr); return d; };
    const m=ctx.createBuffer(1,sr,sr); m.getChannelData(0).set(tone(220,0.6)); PulseAudio.registerBuffer('gm',m);
    const s=ctx.createBuffer(2,sr,sr); s.getChannelData(0).set(tone(220,0.5)); s.getChannelData(1).set(tone(330,0.3)); PulseAudio.registerBuffer('gs',s);
    const [v,st]=state.project.tracks;
    // piste mono : effets (filtre + gain +9 dB), fader, pan, délai de piste, automation d'un effet
    Object.assign(v,{volume:60,pan:30,delayMs:5,effects:['filter','util'],effectParams:{filter:{hpf:80},util:{gain:9}},clips:[{id:'gm',start:0.5,duration:1,offset:0,fadeIn:0.05,name:'m'}]});
    Object.assign(st,{volume:80,pan:-40,effects:['util'],effectParams:{util:{gain:-3}},clips:[{id:'gs',start:0.2,duration:1,offset:0,name:'s'}]});
    renderAll();
    const dec=async(blob)=>{ const b=await new OfflineAudioContext(2,1,48000).decodeAudioData(await blob.arrayBuffer()); return [b.getChannelData(0),b.getChannelData(1)]; };
    const mix=async()=>dec(await PulseAudio.exportWav(state.project));
    const ecart=(a,b)=>{ let d=0; const n=Math.min(a[0].length,b[0].length); for(let c=0;c<2;c++) for(let i=0;i<n;i++) d=Math.max(d,Math.abs(a[c][i]-b[c][i])); return d; };
    const crete=(a)=>{ let p=0; for(const c of a) for(const x of c) p=Math.max(p,Math.abs(x)); return p; };
    const avant=await mix();
    const geler=async(i)=>{ openTrackContextMenu(300,200,i,state.project.tracks[i]); await wait(100);
      const row=[...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e=>/^Son/.test(e.textContent)); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await wait(80);
      const it=[...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e=>/Geler la piste|Dégeler la piste/.test(e.textContent)); const lbl=it?it.textContent:''; it&&it.click(); await wait(1500); return lbl; };
    const menu1=await geler(0), menu2=await geler(1);
    const apres=await mix();
    const fz=v.frozen||{}, fs=st.frozen||{};
    const bufM=PulseAudio.hasBuffer(fz.id), ids=PulsePersist.mediaIds(state.project);
    const blob=await PulsePersist.loadBlob(fz.id);
    const cM=(await ctx.decodeAudioData(await blob.arrayBuffer())).numberOfChannels;
    const cS=(await ctx.decodeAudioData(await (await PulsePersist.loadBlob(fs.id)).arrayBuffer())).numberOfChannels;
    // région figée : le déplacement est refusé
    const bloque=!!v.locked && clipIsLocked(v.clips[0]);
    // le fader reste actif sur une piste gelée
    v.volume=30; const fader=await mix(); v.volume=60;
    // effets changés pendant le gel : sans effet sur le son (ils sont figés)
    v.effectParams.util.gain=0; const fige=await mix(); v.effectParams.util.gain=9;
    const menu3=await geler(0);
    const degel=await mix();
    return JSON.stringify({ menu1, menu2, menu3, ecart:ecart(avant,apres), crete:crete(avant), gain:fz.gain, bufM, inIds:ids.includes(fz.id)&&ids.includes(fs.id), cM, cS,
      verrou:bloque, faderBaisse:crete(fader)<crete(apres)*0.7, fige:ecart(fige,apres), degele:!v.frozen && !v.locked, ecartDegel:ecart(avant,degel), stGelee:!!st.frozen && !!st.locked });
  })()`));
  console.log(JSON.stringify(r));
  check('menu « Geler la piste » puis « Dégeler la piste »', /Geler la piste/.test(r.menu1) && /Geler la piste/.test(r.menu2) && /Dégeler/.test(r.menu3), r.menu1 + ' / ' + r.menu3);
  check('même mix gelé ou vivant (écart < 0,002, effets + fader + pan + délai)', r.crete > 0.1 && r.ecart < 0.002, r.ecart);
  check('rendu au-dessus de 0 dBFS ramené (gain réappliqué à la lecture)', r.gain > 1.5, r.gain);
  check('rendu en mémoire et dans la liste des sons du projet (.pulse, nettoyage)', r.bufM && r.inIds);
  check('piste mono → rendu mono (même loi de pan), piste stéréo → rendu stéréo', r.cM === 1 && r.cS === 2, r.cM + ' / ' + r.cS);
  check('régions figées pendant le gel', r.verrou);
  check('le fader reste actif sur une piste gelée', r.faderBaisse);
  check('effets figés : les changer ne change pas le son gelé', r.fige < 1e-6, r.fige);
  check('dégel : piste déverrouillée, même son qu\'avant le gel', r.degele && r.ecartDegel < 1e-6 && r.stGelee, r.ecartDegel);
};
