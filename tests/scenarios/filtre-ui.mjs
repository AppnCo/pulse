// Retour terrain 17/10 : « quand je veux ajouter un plugin ça ne fonctionne pas » (clics réels)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ae1',name:'Fx',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const click = async (sel, text) => { const r = JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${text?`els.find(e=>e.textContent.includes(${JSON.stringify(text)}))`:'els[0]'}; if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`)); if (!r) { console.log('introuvable', sel, text); return; } for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type==='mousePressed'?1:0, clickCount: 1 }); await sleep(300); };
  await click('.track-item'); 
  await click('.insp-add-fx'); await sleep(200);
  await click('.fam-cat', 'Égaliseur'); await sleep(150);   // menu en deux colonnes : la catégorie, puis l'effet
  await click('.fam-fx', 'Filtre'); await sleep(400);
  await R('effets de la piste', `return JSON.stringify(state.project.tracks[0].effects)+' params='+JSON.stringify(state.project.tracks[0].effectParams.filter)`);
  await R('panneau Filtre', `const p=document.querySelector('.fx-panel'); return p? p.querySelector('.fx-panel-header span').textContent+' | curseurs='+p.querySelectorAll('.fx-slider').length : 'AUCUN PANNEAU'`);
  await R('réglage Coupe-bas à 300', `const sl=document.querySelector('.fx-slider[data-key=hpf]'); sl.value=300; sl.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,300)); return JSON.stringify(state.project.tracks[0].effectParams.filter)`);
  await R('ligne dans l\'inspecteur', `return document.querySelector('#inspector .insp-fx-row[data-fx=filter]')? 'présente':'ABSENTE'`);
};