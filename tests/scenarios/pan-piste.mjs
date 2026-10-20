// Gauche / droite directement sur la piste
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pn1',name:'Pan',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',pan:20},{name:'Back',type:'audio',color:'#22D3EE'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('boutons ronds présents', `const p=[...document.querySelectorAll('.track-item .t-knob')]; return p.length+' boutons, valeurs='+p.map(x=>x.dataset.pan).join('/')+' taille='+Math.round(p[0].getBoundingClientRect().width)+'px, boule+arc='+!!p[0].querySelector('.knob-dot')+'/'+!!p[0].querySelector('.knob-arc')`);
  await R('glisser vers la gauche', `const k=document.querySelector('.t-knob[data-i="1"]'); const r=k.getBoundingClientRect(); const x=r.left+12,y=r.top+12;
    k.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y,button:0})); document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x-40,clientY:y}));
    const mid=state.project.tracks[1].pan+' badge='+document.querySelector('.knob-badge')?.textContent;
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,30));
    return 'pendant='+mid+' | final pan='+state.project.tracks[1].pan+' info='+k.dataset.tooltip`);
  await R('molette', `const k=document.querySelector('.t-knob[data-i="1"]'); k.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100})); return 'pan='+state.project.tracks[1].pan`);
  await R('double-clic = centre', `const k=document.querySelector('.t-knob[data-i="1"]'); k.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); return 'pan='+state.project.tracks[1].pan+' arc='+!!k.querySelector('.knob-arc')`);
  await R('pas de chevauchement avec les boutons', `const i=document.querySelector('.track-item[data-i="0"]'); const r=i.getBoundingClientRect(); const btns=[...i.querySelectorAll('.track-buttons > *')].map(e=>e.getBoundingClientRect()); return 'boutons dans la ligne='+btns.every(b=>b.right<=r.right+1)+' (largeur ligne '+Math.round(r.width)+')'`);
};
