// Shift + clic AJOUTE une région à la sélection ; pistes alignées avec la timeline ; curseur pleine hauteur ; accueil atteignable
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  const tracks = Array.from({ length: 14 }, (_, i) => `{name:'P${i+1}',type:'audio',color:'#A855F7',clips:[{id:'c${i}',name:'C${i+1}',start:${i % 3},duration:4,offset:0}]}`).join(',');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rg2',name:'Rég',bpm:120,buses:[],tracks:[${tracks}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(700);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const ME = (t, el, extra = '') => `(()=>{ const r=${el}.getBoundingClientRect(); return new MouseEvent('${t}',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0${extra}}); })()`;
  await R('alignement pistes / timeline', `const a=document.querySelector('.track-item[data-i="0"]').getBoundingClientRect().top, b=document.querySelector('.timeline-track[data-i="0"]').getBoundingClientRect().top; const c=document.querySelector('.track-item[data-i="9"]').getBoundingClientRect().top, d=document.querySelector('.timeline-track[data-i="9"]').getBoundingClientRect().top; return 'écart piste 1 = '+(a-b).toFixed(1)+' px, piste 10 = '+(c-d).toFixed(1)+' px'`);
  await R('clic sur une région', `const el=document.querySelector('.timeline-track[data-i="0"] .clip'); el.dispatchEvent(${ME('mousedown','el')}); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,50)); return 'sélection='+document.querySelectorAll('.clip.is-selected, .clip.is-multi-selected').length`);
  await R('Shift + clic sur 2 autres : elles sajoutent', `for(const i of [1,2]){ const el=document.querySelector('.timeline-track[data-i="'+i+'"] .clip'); el.dispatchEvent(${ME('mousedown','el',',shiftKey:true')}); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,50)); } return 'sélectionnées='+document.querySelectorAll('.clip.is-selected, .clip.is-multi-selected').length+' (attendu 3) : '+[...state.selectedClips].join(' ')`);
  await R('Shift + clic sur une déjà choisie la retire', `const el=document.querySelector('.timeline-track[data-i="1"] .clip'); el.dispatchEvent(${ME('mousedown','el',',shiftKey:true')}); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,50)); return [...state.selectedClips].join(' ')`);
  await R('défiler : curseur pleine hauteur', `document.querySelector('.timeline').scrollTop=400; await new Promise(r=>setTimeout(r,100)); const ph=document.getElementById('playhead'); const tl=document.querySelector('.timeline'); return 'curseur='+Math.round(ph.getBoundingClientRect().height)+' px, contenu='+tl.scrollHeight+' px, panneau scrollTop='+document.querySelector('.tracks-panel').scrollTop`);
  await R('zoom à la molette : un dessin par image', `const tl=document.querySelector('.timeline'); const z0=state.pxPerSecond; for(let i=0;i<10;i++) tl.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,metaKey:true,clientX:600,clientY:300})); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return 'zoom '+z0.toFixed(0)+' → '+state.pxPerSecond.toFixed(0)+' px/s'`);
  // accueil : fenêtre basse, tout reste atteignable
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 420, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html'); await sleep(900);
  await R('accueil en fenêtre basse', `const a=document.querySelector('.app'); a.scrollTop=0; const first=a.firstElementChild.getBoundingClientRect().top; a.scrollTop=99999; const last=a.lastElementChild.getBoundingClientRect().bottom; return 'haut visible='+(first>=0)+' (top='+Math.round(first)+') ; bas atteignable='+(last<=innerHeight+1)+' (bottom='+Math.round(last)+' / '+innerHeight+') ; contenu='+a.scrollHeight+' px'`);
  await send('Emulation.clearDeviceMetricsOverride', {});
};
