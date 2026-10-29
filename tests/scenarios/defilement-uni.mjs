// 29/10 : pistes et timeline défilent comme une seule zone (pas de barre entre les deux, pas de décalage) ;
// sans curseur de base posé, le zoom se fait autour de la souris
export default async ({ ev, nav, send, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  const tracks = Array.from({ length: 16 }, (_, i) => ({ name: 'P' + (i + 1), type: 'audio' }));
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'du1',name:'Defile',bpm:120,buses:[],tracks:${JSON.stringify(tracks)}})); 1`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*60,ctx.sampleRate); PulseAudio.registerBuffer('d',b); state.project.tracks.forEach(t=>t.clips=[{id:'d',start:0,duration:60,name:t.name}]); renderTimelineTracks(); return 1 })()`);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{ const tp=document.querySelector('.tracks-panel'), tl=document.querySelector('.timeline'); const a=tp.getBoundingClientRect(), b=tl.getBoundingClientRect();
    return { tp:{x:a.left+a.width/2,y:a.top+a.height/2}, tl:{x:b.left+b.width/2,y:b.top+b.height/2}, barV: tp.offsetWidth-tp.clientWidth-(parseFloat(getComputedStyle(tp).borderLeftWidth)||0)-(parseFloat(getComputedStyle(tp).borderRightWidth)||0), barH: tp.offsetHeight-tp.clientHeight, insp: (()=>{const i=document.querySelector('.inspector'); return i? i.offsetHeight-i.clientHeight : 0})(), can: tl.scrollHeight>tl.clientHeight } })())`));
  check('assez de pistes pour défiler', g.can);
  check('pas de barre verticale entre pistes et timeline', g.barV === 0, String(g.barV));
  check('pas de barre horizontale sous les pistes', g.barH === 0, String(g.barH));
  check('pas de barre horizontale sous les faders de gauche', g.insp === 0, String(g.insp));
  const wheel = async (p, dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: dy }); };
  // molette au-dessus des pistes : les deux bougent ensemble, au même endroit
  await wheel(g.tp, 200);
  let r = JSON.parse(await ev(`JSON.stringify({a:document.querySelector('.tracks-panel').scrollTop, b:document.querySelector('.timeline').scrollTop})`));
  check('molette sur les pistes : les deux défilent pareil', r.a > 0 && Math.abs(r.a - r.b) < 1, JSON.stringify(r));
  await wheel(g.tl, 150);
  r = JSON.parse(await ev(`JSON.stringify({a:document.querySelector('.tracks-panel').scrollTop, b:document.querySelector('.timeline').scrollTop})`));
  check('molette sur la timeline : les deux défilent pareil', r.b > 200 && Math.abs(r.a - r.b) < 1, JSON.stringify(r));
  // alignement : la piste 10 est à la même hauteur des deux côtés
  r = await ev(`(()=>{ const a=document.querySelector('.track-item[data-i="9"]').getBoundingClientRect().top, b=document.querySelector('.timeline-track[data-i="9"]').getBoundingClientRect().top; return Math.abs(a-b) })()`);
  check('pistes alignées avec la timeline', r < 1.5, String(r));
  // zoom sans curseur de base : le temps sous la souris ne bouge pas
  await ev(`clearPlayBase(); state.playhead=0; updatePlayhead(); setZoom(40,0); document.querySelector('.timeline').scrollLeft=0; 1`);
  const mx = g.tl.x + 200, my = g.tl.y;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my });
  const sec = () => ev(`(()=>{ const tl=document.querySelector('.timeline'), r=tl.getBoundingClientRect(); return (${mx}-r.left+tl.scrollLeft)/state.pxPerSecond })()`);
  const s0 = await sec();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mx, y: my, deltaX: 0, deltaY: -100, modifiers: 4 }); await sleep(300);
  const s1 = await sec(), z1 = await ev(`state.pxPerSecond`);
  check('⌘ + molette sans base : zoom autour de la souris', z1 > 40 && Math.abs(s1 - s0) < 0.1, `${s0.toFixed(2)} → ${s1.toFixed(2)} à ${z1}`);
  await ev(`(()=>{ document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true})); return 1 })()`); await sleep(200);
  const s2 = await sec();
  check('E sans base : zoom autour de la souris', Math.abs(s2 - s0) < 0.1, `${s0.toFixed(2)} → ${s2.toFixed(2)}`);
  // avec une base posée : centré sur la base
  await ev(`state.playhead=20; state.userBaseSec=20; state.baseCleared=false; updatePlayhead(); 1`);
  await ev(`(()=>{ document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true})); return 1 })()`); await sleep(200);
  r = await ev(`(()=>{ const tl=document.querySelector('.timeline'); return Math.abs((20*state.pxPerSecond - tl.scrollLeft) - tl.clientWidth/2) })()`);
  check('E avec base : la base au milieu de l’écran', r < 2, String(r));
};
