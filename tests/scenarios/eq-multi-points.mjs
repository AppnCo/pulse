// EQ : plusieurs points à la fois (rectangle, ⇧ + clic), déplacés ensemble, retirés avec Suppr
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  // Un EQ neuf s'ouvre vide : ce scénario part des 4 points de l'ancien réglage de départ
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effects=[...new Set([...(t.effects||[]),'eq'])]; t.effectParams=t.effectParams||{}; t.effectParams.eq={bands:[{type:'hpf',freq:80,gain:0,q:1.0839},{type:'bell',freq:300,gain:-2,q:1},{type:'bell',freq:4000,gain:2,q:0.7},{type:'highshelf',freq:10000,gain:1,q:0.7}]}; })()`);
  await ev(`openEqPanel(0, document.body)`); await sleep(300);
  const bandsStr = `JSON.stringify(eqBandsOf(state.project.tracks[0].effectParams.eq||{}).map(b=>[b.type,Math.round(b.freq),(b.gain||0)]))`;
  await R('points au départ', `return ${bandsStr}`);
  const M = (type, x, y, mod = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mod });
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.eq-svg').getBoundingClientRect(); return {l:r.left,t:r.top,w:r.width,h:r.height}})())`));
  // rectangle sur toute la partie gauche (points 1 et 2 : coupe-bas + creux)
  await M('mousePressed', g.l + 2, g.t + 4); await M('mouseMoved', g.l + 150, g.t + 80); await M('mouseMoved', g.l + 170, g.t + g.h - 20); await M('mouseReleased', g.l + 170, g.t + g.h - 20);
  await sleep(200);
  await R('rectangle : points choisis', `return document.querySelectorAll('.eq-pt.sel').length+' choisis'`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/eq-multi.jpg');
  // tirer l'un des deux vers le haut : les deux suivent
  const before = JSON.parse(await ev(bandsStr));
  const pt = JSON.parse(await ev(`JSON.stringify((()=>{const p=document.querySelector('.eq-pt.sel').getBoundingClientRect(); return {x:p.left+p.width/2,y:p.top+p.height/2}})())`));
  await M('mousePressed', pt.x, pt.y); await M('mouseMoved', pt.x + 20, pt.y - 20); await M('mouseMoved', pt.x + 40, pt.y - 40); await M('mouseReleased', pt.x + 40, pt.y - 40);
  await sleep(200);
  const after = JSON.parse(await ev(bandsStr));
  console.log('avant:', JSON.stringify(before), '\naprès:', JSON.stringify(after));
  await R('Suppr retire les points choisis', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,150)); return ${bandsStr}`);
  await R('la région n a pas été touchée / panneau encore là', `return 'panneau='+!!document.querySelector('.eq-panel')`);
};
