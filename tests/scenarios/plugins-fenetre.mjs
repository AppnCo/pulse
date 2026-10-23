// Fenêtres de plugins : agrandir, préréglage « Clean » (tout à zéro), compresseur en vue analogique
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const M = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await ev(`document.getElementById('btnMixer').click()`); await sleep(400);
  // Un EQ neuf s'ouvre vide : ce scénario part des 4 points de l'ancien réglage de départ
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effects=[...new Set([...(t.effects||[]),'eq'])]; t.effectParams=t.effectParams||{}; t.effectParams.eq={bands:[{type:'hpf',freq:80,gain:0,q:1.0839},{type:'bell',freq:300,gain:-2,q:1},{type:'bell',freq:4000,gain:2,q:0.7},{type:'highshelf',freq:10000,gain:1,q:0.7}]}; })()`);
  await ev(`openEqPanel(0, document.querySelector('.strip-fx-slot,.strip button')||document.body)`); await sleep(500);
  await R('EQ : largeur de départ', `const p=document.querySelector('.eq-panel'); return p.offsetWidth+' px ; dessin '+document.querySelector('.eq-svg').clientWidth+' px'`);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.eq-panel .fx-grip').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})())`));
  await M('mousePressed', g.x, g.y); await M('mouseMoved', g.x + 150, g.y + 30); await M('mouseMoved', g.x + 300, g.y + 60); await M('mouseReleased', g.x + 300, g.y + 60);
  await sleep(300);
  await R('EQ agrandi', `const p=document.querySelector('.eq-panel'); return p.offsetWidth+' px ; dessin '+document.querySelector('.eq-svg').clientWidth+' px ; mémorisé='+localStorage.getItem('pulse_fxw_eq-panel')`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/eq-grand.jpg');
  // un point tiré dans la fenêtre agrandie suit bien la souris
  const pt = JSON.parse(await ev(`JSON.stringify((()=>{const p=document.querySelectorAll('.eq-pt')[2].getBoundingClientRect(); return {x:p.left+p.width/2,y:p.top+p.height/2}})())`));
  const before = JSON.parse(await ev(`JSON.stringify(eqBandsOf(state.project.tracks[0].effectParams.eq||{})[2])`));
  await M('mousePressed', pt.x, pt.y); await M('mouseMoved', pt.x, pt.y - 20); await M('mouseMoved', pt.x, pt.y - 40); await M('mouseReleased', pt.x, pt.y - 40);
  const after = JSON.parse(await ev(`JSON.stringify(eqBandsOf(state.project.tracks[0].effectParams.eq||{})[2])`));
  console.log('point tiré de 40 px vers le haut : gain', before.gain, '→', after.gain);
  // Clean
  await R('Clean : tout à zéro', `const s=document.querySelector('.eq-preset'); s.value='clean'; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,200)); return 'points='+eqBandsOf(state.project.tracks[0].effectParams.eq||{}).length+' ; options='+[...s.options].slice(0,3).map(o=>o.textContent).join(' / ')`);
  // Compresseur
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); openEffectPanel(0,'comp',(document.querySelector('.mixer-strips .strip button:nth-of-type(2)')||document.querySelector('.strip-fx-slot')||document.querySelector('#btnMixer')))`); await sleep(400);
  await R('compresseur : vue courbe au départ', `return 'courbe='+!!document.querySelector('.viz-comp')+' analogique='+!!document.querySelector('.viz-vu')+' ; bouton='+document.querySelector('.fx-view').textContent`);
  await ev(`document.querySelector('.fx-view').click()`); await sleep(200);
  await R('après le bouton', `return 'courbe='+!!document.querySelector('.viz-comp')+' analogique='+!!document.querySelector('.viz-vu')+' ; bouton='+document.querySelector('.fx-view').textContent`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/comp-analog.jpg');
};
