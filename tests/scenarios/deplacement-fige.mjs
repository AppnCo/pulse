// Shift pendant le déplacement d'un clip = position figée ; ⌘G = mode intelligent / libre ; BPM 120 par défaut
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'df1',name:'Fige',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',clips:[{id:'a',name:'A',start:2,duration:3,offset:0}]},{name:'Back',type:'audio',color:'#22D3EE',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const ME = (t, x, y, extra = '') => `new MouseEvent('${t}',{bubbles:true,clientX:${x},clientY:${y},button:0${extra}})`;
  await R('départ', `setSnapMode('grid',true); state.gridRes='beat'; const c=state.project.tracks[0].clips[0]; return 'start='+c.start+' pxPerSecond='+state.pxPerSecond`);
  await R('glisser, figer avec Shift, changer de piste, libérer', `
    const el=document.querySelector('.timeline-track[data-i="0"] .clip'); const r=el.getBoundingClientRect();
    const t2=document.querySelector('.timeline-track[data-i="1"]').getBoundingClientRect();
    const x0=r.left+r.width/2, y0=r.top+r.height/2, px=state.pxPerSecond;
    el.dispatchEvent(${ME('mousedown','x0','y0')});
    document.dispatchEvent(${ME('mousemove','x0+px*1','y0')});            // +1 s
    const s1=state.project.tracks[0].clips[0].start;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));   // figer
    document.dispatchEvent(${ME('mousemove','x0+px*0.3','t2.top+10')});   // surtout vers le bas : piste 2, temps figé
    const s2=state.project.tracks[0].clips[0].start;
    const locked=document.body.classList.contains('axis-locked');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));   // libérer
    document.dispatchEvent(${ME('mousemove','x0+px*4','t2.top+10')});
    const s3=state.project.tracks[0].clips[0].start;
    document.dispatchEvent(${ME('mouseup','x0+px*4','t2.top+10')});
    await new Promise(r=>setTimeout(r,80));
    const t0=state.project.tracks[0].clips.length, t1=state.project.tracks[1].clips.length;
    return 'après +1 s='+s1+' | figé='+s2+' (verrou='+locked+') | libéré='+s3+' | piste1='+t0+' clip, piste2='+t1+' clip, start final='+(state.project.tracks[1].clips[0]||{}).start`);
  await R('⌘G coupe l aimant', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'g',code:'KeyG',metaKey:true,bubbles:true})); return 'snap='+state.snap+' bouton='+document.querySelector('.snap-btn.active').dataset.snap`);
  await R('⌘G le remet', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'g',code:'KeyG',metaKey:true,bubbles:true})); return 'snap='+state.snap`);
  await nav('http://localhost:8765/index.html'); await ev(`localStorage.removeItem('pulse_current_project')`);
  await nav('http://localhost:8765/studio.html'); await sleep(500);
  await R('projet vide : BPM par défaut', `return state.project.bpm`);
};
