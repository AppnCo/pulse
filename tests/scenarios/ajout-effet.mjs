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
  await R('bouton + Effet présent', `return document.querySelectorAll('.insp-add-fx').length`);
  await click('.insp-add-fx');
  await R('menu ouvert', `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join(' | ')`);
  await click('.track-ctx-menu .ctx-item', 'Compresseur');
  await R('effets de la piste après clic réel', `return JSON.stringify(state.project.tracks[0].effects)+' | panneau='+document.querySelectorAll('.fx-panel').length`);
};
