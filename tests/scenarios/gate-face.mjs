// Gate : la façade s'ouvre, les styles et les réglages s'écrivent, la voix défile pendant la lecture, l'écoute se coupe à la fermeture
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gf',name:'GF',bpm:120,sends:[],buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  // « voix » : des phrases à 300 Hz, et du souffle très bas entre elles
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++){const t=i/sr, on=(t%1.2)<0.7; d[i]=on?0.4*Math.sin(2*Math.PI*300*t):0.004*(Math.random()*2-1);} await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(600);
  await ev(`(()=>{const t=state.project.tracks[0]; t.effects=['gate']; t.effectParams={gate:{threshold:-40,release:150,reduction:40}}; openEffectPanel(0,'gate',document.body); const p=document.querySelector('.gate-panel'); p.style.left='20px'; p.style.top='40px';})()`); await sleep(200);
  await R('façade ouverte', `const p=document.querySelector('.gate-panel'); return 'écran='+!!p.querySelector('.gate-svg')+' boutons='+p.querySelectorAll('.pk').length+' déclencheur='+!!p.querySelector('.gate-rg')+' styles='+[...p.querySelectorAll('.gate-sty span')].map(s=>s.textContent+(s.classList.contains('on')?'✓':'')).join(',')+' courbe='+!!p.querySelector('.gate-curve')`);
  await R('style Voix', `document.querySelector('.gate-sty [data-sty="voix"]').click(); await new Promise(r=>setTimeout(r,50)); return JSON.stringify(state.project.tracks[0].effectParams.gate)+' | coché='+document.querySelector('.gate-sty [data-sty="voix"]').classList.contains('on')`);
  await R('style Classique', `document.querySelector('.gate-sty [data-sty="classique"]').click(); await new Promise(r=>setTimeout(r,50)); return JSON.stringify(state.project.tracks[0].effectParams.gate)`);
  // tirer la ligne du seuil vers le haut
  await R('seuil tiré', `const h=document.querySelector('.gate-thrh .gate-pill'), b=h.getBoundingClientRect(); const x=b.left+10, y=b.top+b.height/2;
    h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:x,clientY:y-30})); document.dispatchEvent(new MouseEvent('mouseup',{clientX:x,clientY:y-30}));
    return 'seuil '+state.project.tracks[0].effectParams.gate.threshold+' dB (avant -40) | bouton '+document.querySelector('.gate-fp .pk .pk-v').textContent`);
  // déclencheur : la zone entière glisse
  await R('déclencheur', `const f=document.querySelector('.gate-rf'), bar=document.querySelector('.gate-rg').getBoundingClientRect();
    const a=document.querySelector('.gate-h.a'), ab=a.getBoundingClientRect();
    a.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:ab.left+7,clientY:ab.top+7})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:bar.left+bar.width*0.2,clientY:ab.top})); document.dispatchEvent(new MouseEvent('mouseup',{}));
    const b=document.querySelector('.gate-h.b'), bb=b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:bb.left+7,clientY:bb.top+7})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:bar.left+bar.width*0.7,clientY:bb.top})); document.dispatchEvent(new MouseEvent('mouseup',{}));
    const g=state.project.tracks[0].effectParams.gate, l1=g.hp, h1=g.lp;
    const fb=f.getBoundingClientRect(); f.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:fb.left+fb.width/2,clientY:fb.top+5})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:fb.left+fb.width/2+bar.width*0.1,clientY:fb.top+5})); document.dispatchEvent(new MouseEvent('mouseup',{}));
    const r1=Math.log(h1/l1), r2=Math.log(g.lp/g.hp);
    return 'poignées '+l1+'-'+h1+' Hz → zone glissée '+g.hp+'-'+g.lp+' Hz | même largeur='+(Math.abs(r1-r2)<0.05)+' | affiché '+document.querySelector('.gate-rv').textContent`);
  await ev(`(()=>{const g=state.project.tracks[0].effectParams.gate; delete g.hp; delete g.lp; g.threshold=-40; refreshPlaybackSoon();})()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(3000);
  await R('en lecture', `const p=document.querySelector('.gate-panel'); return 'voix dessinée='+!!p.querySelector('.gate-out')+' zones baissées='+p.querySelectorAll('.gate-svg rect[fill="url(#gateht)"]').length+' baisse max '+p.querySelector('.gate-g').textContent`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/gate.jpg');
  await R('écouter', `document.querySelector('.gate-listen').click(); await new Promise(r=>setTimeout(r,50)); const on=state.project.tracks[0].effectParams.gate.listen; document.querySelector('.gate-panel .fx-panel-close').click(); await new Promise(r=>setTimeout(r,50)); return 'allumé='+on+' après fermeture='+state.project.tracks[0].effectParams.gate.listen`);
  await ev(`togglePlay()`);
};
