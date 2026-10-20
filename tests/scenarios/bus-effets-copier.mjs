// Retour terrain 17/10 : créer un bus de zéro, choisir ses effets, copier/coller un réglage d'effet
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'bf1',name:'Bus',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const click = async (sel, text) => { const r = JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${text?`els.find(e=>e.textContent.includes(${JSON.stringify(text)}))`:'els[0]'}; if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`)); if (!r) { console.log('introuvable', sel, text); return; } for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type==='mousePressed'?1:0, clickCount: 1 }); await sleep(300); };
  await click('.track-item');
  await click('.insp-output');
  await R('menu direction', `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join(' | ')`);
  await click('.track-ctx-menu .ctx-item', 'Nouveau bus');
  await R('bus créé, piste A dedans', `const b=state.project.buses.filter(b=>b.isGroup); return b.length+' bus : '+b.map(x=>x.name).join(',')+' | sortie A='+state.project.tracks[0].output+' | bus choisi='+state.selectedBus`);
  await click('.insp-add-fx');
  await R('effets proposés', `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join(' | ')`);
  await click('.track-ctx-menu .ctx-item', 'Saturation');
  await R('Saturation posée sur le bus', `const b=state.project.buses.find(x=>x.isGroup); return JSON.stringify(b.effects)+' '+JSON.stringify(b.effectParams)+' | panneau='+document.querySelectorAll('.fx-panel').length`);
  // copier / coller sur les pistes : compresseur de A -> B
  await R('prépare un comp réglé sur A', `document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); const a=state.project.tracks[0]; a.effects=['comp']; a.effectParams={comp:{threshold:-30,ratio:6,attack:5,release:80,mix:70}}; state.selectedBus=null; state.selectedTrack=0; renderTracksPanel(); bindTrackEvents(); renderInspector(); return 'ok'`);
  await R('copier', `const row=document.querySelector('#inspector .insp-fx-row[data-fx="comp"]'); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200})); await new Promise(r=>setTimeout(r,100)); [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes('Copier')).click(); return 'ok'`);
  await R('coller sur B', `state.selectedTrack=1; renderTracksPanel(); bindTrackEvents(); renderInspector(); const b=state.project.tracks[1]; b.effects=['comp']; renderInspector(); const row=document.querySelector('#inspector .insp-fx-row[data-fx="comp"]'); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200})); await new Promise(r=>setTimeout(r,100)); [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes('Coller')).click(); await new Promise(r=>setTimeout(r,100)); return JSON.stringify(b.effectParams)`);
  await R('⌘Z annule le collage', `undoAction(); return JSON.stringify(state.project.tracks[1].effectParams||{})`);
};
