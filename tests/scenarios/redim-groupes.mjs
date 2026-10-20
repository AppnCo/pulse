// Hauteur des groupes / bus (tirer le bord bas) + largeur du bloc de faders à gauche
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.removeItem('pulse_insp_w'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rg1',name:'Grp',bpm:120,
    buses:[{id:'v1',name:'Voix 1',isGroup:true,output:'master',color:'#A855F7'},{id:'v2',name:'Back',isGroup:true,output:'master',color:'#60A5FA'}],
    tracks:[{name:'Lead',type:'audio',output:'v1',color:'#A855F7'},{name:'Back 1',type:'audio',output:'v2',color:'#C084FC'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(700);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const me = (t, x, y, extra = '') => `new MouseEvent('${t}',{bubbles:true,clientX:${x},clientY:${y},button:0${extra}})`;
  const H = `const hs=()=>[...document.querySelectorAll('.group-header')].map(h=>Math.round(h.getBoundingClientRect().height)+'/'+Math.round(document.querySelector('.timeline-group-row[data-bus="'+h.dataset.bus+'"]').getBoundingClientRect().height));`;
  await R('hauteurs de départ (en-tête/timeline)', `${H} return hs().join(' ')`);
  await R('tirer le bord du 1er groupe de +30 px', `${H} const h=document.querySelector('.group-resize'); h.dispatchEvent(${me('mousedown', 100, 100)}); document.dispatchEvent(${me('mousemove', 100, 130)}); document.dispatchEvent(${me('mouseup', 100, 130)}); await new Promise(r=>setTimeout(r,100)); return hs().join(' ')+' ; bus.height='+state.project.buses[0].height`);
  await R('rétrécir le 2e groupe de -12 px', `${H} const h=document.querySelectorAll('.group-resize')[1]; h.dispatchEvent(${me('mousedown', 100, 100)}); document.dispatchEvent(${me('mousemove', 100, 88)}); document.dispatchEvent(${me('mouseup', 100, 88)}); await new Promise(r=>setTimeout(r,100)); return hs().join(' ')`);
  await R('double-clic = taille normale', `${H} const h=document.querySelector('.group-resize'); h.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,100)); return hs().join(' ')`);
  await R('alignement pistes / timeline après redimensionnement', `const a=document.querySelector('.track-item[data-i="1"]').getBoundingClientRect().top, b=document.querySelector('.timeline-track[data-i="1"]').getBoundingClientRect().top; return 'écart='+(a-b).toFixed(1)+' px'`);
  // Bloc de faders
  await ev(`if(document.getElementById('inspector').hidden) document.getElementById('btnInspector').click()`); await sleep(500);
  await R('bloc de faders ouvert', `const i=document.getElementById('inspector'); return 'largeur='+Math.round(i.getBoundingClientRect().width)+' px, poignée='+!!document.getElementById('inspResizer')+' visible='+(document.getElementById('inspResizer').style.display!=='none')`);
  await R('tirer le bord de -60 px', `const b=document.getElementById('inspResizer'); const x=b.getBoundingClientRect().left+3; b.dispatchEvent(${me('mousedown','x',300).replace('clientX:x','clientX:x')}); document.dispatchEvent(${me('mousemove','x-60',300).replace('clientX:x-60','clientX:x-60')}); document.dispatchEvent(${me('mouseup','x-60',300).replace('clientX:x-60','clientX:x-60')}); await new Promise(r=>setTimeout(r,150)); const i=document.getElementById('inspector'); const t=document.querySelector('.tracks-panel').getBoundingClientRect(); return 'largeur='+Math.round(i.getBoundingClientRect().width)+' px (148 attendu), panneau pistes à x='+Math.round(t.left)+', stocké='+localStorage.getItem('pulse_insp_w')`);
  await R('les deux tranches restent lisibles', `const s=[...document.querySelectorAll('#inspector .insp-strip')].map(e=>Math.round(e.getBoundingClientRect().width)); return 'tranches='+s.join(',')+' ; débordement='+(document.getElementById('inspector').scrollWidth>document.getElementById('inspector').clientWidth+1)`);
  await R('double-clic = 208 px', `const b=document.getElementById('inspResizer'); b.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,100)); return Math.round(document.getElementById('inspector').getBoundingClientRect().width)+' px'`);
};
