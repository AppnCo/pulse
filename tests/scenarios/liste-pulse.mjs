// Listes déroulantes : la liste Pulse remplace la liste du système (choisir, clavier, fermeture)
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const click = async (sel) => { const r = JSON.parse(await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`)); for (const t of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: r.x, y: r.y, button: 'left', buttons: t==='mousePressed'?1:0, clickCount: 1 }); };
  await ev(`openEqPanel(0, document.querySelector('#btnMixer'))`); await sleep(300);
  await click('.eq-preset'); await sleep(250);
  await R('la liste Pulse s ouvre', `const m=document.querySelector('.pulse-menu'); return m? m.querySelectorAll('.pulse-menu-item').length+' choix' : 'absente'`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/liste.jpg');
  // choisir un modèle : le panneau EQ ne doit pas se fermer
  const r = JSON.parse(await ev(`(()=>{const i=document.querySelectorAll('.pulse-menu-item')[2].getBoundingClientRect(); return JSON.stringify({x:i.left+20,y:i.top+i.height/2})})()`));
  for (const t of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: r.x, y: r.y, button: 'left', buttons: t==='mousePressed'?1:0, clickCount: 1 });
  await sleep(400);
  await R('modèle choisi, panneau encore là', `return 'panneau='+!!document.querySelector('.eq-panel')+' menu fermé='+!document.querySelector('.pulse-menu')+' points='+(state.project.tracks[0].effectParams.eq&&state.project.tracks[0].effectParams.eq.bands?state.project.tracks[0].effectParams.eq.bands.length:0)`);
  // clavier sur les Réglages
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); openSettings()`); await sleep(400);
  await R('réglages : liste Pulse + changement', `const s=document.querySelector('.modal select'); s.focus(); const before=s.value; s.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,100)); const open=!!document.querySelector('.pulse-menu'); document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,100)); return 'ouverte='+open+' valeur '+before+' → '+s.value+' fermée='+!document.querySelector('.pulse-menu')`);
};
