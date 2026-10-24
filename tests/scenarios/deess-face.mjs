// De-esser : la façade s'ouvre, les réglages s'écrivent, la zone des « s » glisse en bloc, les « s » s'allument pendant la lecture,
// l'écoute se coupe à la fermeture, un ancien réglage (Force) passe au nouveau moteur quand on touche un bouton
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'df',name:'DF',bpm:120,sends:[],buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  // « voix » : 300 Hz, et un « s » (bruit) toutes les 0,8 s
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++){const t=i/sr, s=(t%0.8)>0.55&&(t%0.8)<0.68; d[i]=0.3*Math.sin(2*Math.PI*300*t)+(s?0.3*(Math.random()*2-1):0);} await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(600);
  // ancien réglage d'abord
  await ev(`(()=>{const t=state.project.tracks[0]; t.effects=['deess']; t.effectParams={deess:{amount:40,freq:5500}}; openEffectPanel(0,'deess',document.body); const p=document.querySelector('.ds-panel'); p.style.left='20px'; p.style.top='40px';})()`); await sleep(200);
  await R('façade', `const p=document.querySelector('.ds-panel'); return 'écran='+!!p.querySelector('.ds-svg')+' boutons='+[...p.querySelectorAll('.pk .pk-l')].map(e=>e.textContent).join(',')+' zone='+!!p.querySelector('.ds-rg')+' modes='+[...p.querySelectorAll('.lim-seg span')].map(s=>s.textContent+(s.classList.contains('on')?'✓':'')).join(',')+' | '+p.querySelector('.ds-hint').textContent`);
  await R('Large', `document.querySelector('.ds-md [data-v="1"]').click(); await new Promise(r=>setTimeout(r,50)); return JSON.stringify(state.project.tracks[0].effectParams.deess)`);
  await R('Séparé + Tout-terrain', `document.querySelector('.ds-md [data-v="0"]').click(); document.querySelector('.ds-rel [data-v="1"]').click(); await new Promise(r=>setTimeout(r,50)); return JSON.stringify(state.project.tracks[0].effectParams.deess)`);
  await ev(`document.querySelector('.ds-rel [data-v="0"]').click()`);
  await R('seuil tiré', `const h=document.querySelector('.ds-thrh .gate-pill'), b=h.getBoundingClientRect(); const x=b.left+10, y=b.top+b.height/2;
    h.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:x,clientY:y+30})); document.dispatchEvent(new MouseEvent('mouseup',{clientX:x,clientY:y+30}));
    return 'seuil '+state.project.tracks[0].effectParams.deess.thr+' dB (avant -26) | bouton '+document.querySelector('.ds-fp .pk .pk-v').textContent`);
  await R('zone glissée en bloc', `const f=document.querySelector('.ds-rg .gate-rf'), bar=document.querySelector('.ds-rg').getBoundingClientRect(), d=state.project.tracks[0].effectParams.deess, l1=d.lo, h1=d.hi;
    const fb=f.getBoundingClientRect(); f.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:fb.left+fb.width/2,clientY:fb.top+5})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:fb.left+fb.width/2-bar.width*0.1,clientY:fb.top+5})); document.dispatchEvent(new MouseEvent('mouseup',{}));
    return l1+'-'+h1+' Hz → '+d.lo+'-'+d.hi+' Hz | même largeur='+(Math.abs(Math.log(h1/l1)-Math.log(d.hi/d.lo))<0.03)+' | affiché '+document.querySelector('.ds-rg').parentElement.querySelector('.gate-rv').textContent`);
  await R('poignée gauche', `const a=document.querySelector('.ds-rg .gate-h.a'), ab=a.getBoundingClientRect(), bar=document.querySelector('.ds-rg').getBoundingClientRect();
    a.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:ab.left+7,clientY:ab.top+7})); document.dispatchEvent(new MouseEvent('mousemove',{clientX:bar.left+bar.width*0.15,clientY:ab.top})); document.dispatchEvent(new MouseEvent('mouseup',{}));
    const d=state.project.tracks[0].effectParams.deess; return d.lo+'-'+d.hi+' Hz'`);
  await ev(`(()=>{const d=state.project.tracks[0].effectParams.deess; d.lo=4000; d.hi=12000; d.thr=-34; refreshPlaybackSoon();})()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(3500);
  await R('en lecture', `const p=document.querySelector('.ds-panel'); return '« s » allumés='+p.querySelectorAll('.ds-s').length+' pastilles='+[...p.querySelectorAll('.ds-pillt')].slice(0,3).map(e=>e.textContent).join(' ')+' | '+p.querySelector('.ds-r').textContent+' | anneau='+(p.querySelector('.ds-lvl-a')||{getAttribute:()=>''}).getAttribute('stroke')`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/deess.jpg');
  await R('écouter', `document.querySelector('.ds-listen').click(); await new Promise(r=>setTimeout(r,50)); const on=state.project.tracks[0].effectParams.deess.listen; document.querySelector('.ds-panel .fx-panel-close').click(); await new Promise(r=>setTimeout(r,50)); return 'allumé='+on+' après fermeture='+state.project.tracks[0].effectParams.deess.listen`);
  await ev(`togglePlay()`);
  await R('annuler', `undoAction(); await new Promise(r=>setTimeout(r,100)); return JSON.stringify(state.project.tracks[0].effectParams.deess)`);
};
