// 01/11 : marqueurs comme Logic — glisser = déplacer (aimanté, ⌘Z), clic = curseur, double-clic = renommer
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mks',name:'MKS',bpm:120,buses:[],markers:[{time:2,name:'Couplet'},{time:8,name:'Refrain'}],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = (c) => ev(`(async()=>{${c}})()`);
  await R(`setSnapMode('beat'); state.pxPerSecond=60; renderAll(); return 1`);
  const pos = async (i) => JSON.parse(await ev(`JSON.stringify((()=>{const b=document.querySelector('.marker[data-idx="${i}"] .marker-label').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`));
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, extra));
  // glisser le 1er marqueur de 5 s vers la droite (60 px/s = 300 px)
  let p = await pos(0);
  await mouse('mousePressed', p.x, p.y);
  for (let k = 1; k <= 10; k++) await mouse('mouseMoved', p.x + k * 30.5, p.y, { buttons: 1 });
  await mouse('mouseReleased', p.x + 305, p.y); await sleep(200);
  let mk = JSON.parse(await R(`return JSON.stringify(state.project.markers)`));
  check('marqueur déplacé et aimanté au temps (≈ 7 s)', mk[0].name === 'Couplet' && Math.abs(mk[0].time - 7) < 1e-6, JSON.stringify(mk));
  check('curseur pas bougé par le glisser', (await R(`return state.playhead`)) !== 7);
  await R(`undoAction(); await new Promise(r=>setTimeout(r,150)); return 1`);
  mk = JSON.parse(await R(`return JSON.stringify(state.project.markers)`));
  check('⌘Z : marqueur revenu à 2 s', mk[0].time === 2, JSON.stringify(mk));
  // déplacé après le 2e : l'ordre suit le temps (pavé 1 = le premier dans le temps)
  p = await pos(0);
  await mouse('mousePressed', p.x, p.y);
  for (let k = 1; k <= 10; k++) await mouse('mouseMoved', p.x + k * 48, p.y, { buttons: 1 });
  await mouse('mouseReleased', p.x + 480, p.y); await sleep(200);
  mk = JSON.parse(await R(`return JSON.stringify(state.project.markers.map(m=>m.name))`));
  check('rangés dans l\'ordre du temps', mk[0] === 'Refrain' && mk[1] === 'Couplet', JSON.stringify(mk));
  // simple clic : curseur
  p = await pos(0);
  await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); await sleep(150);
  check('clic : curseur sur le marqueur', (await R(`return state.playhead`)) === 8);
  // double-clic : renommer
  await R(`document.querySelector('.marker[data-idx="0"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,150)); const i=document.querySelector('.ask-input'); if(!i) return 'pas de champ'; i.value='Pont'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await new Promise(r=>setTimeout(r,150)); return 1`);
  check('double-clic : renommé', (await R(`return state.project.markers[0].name`)) === 'Pont', await R(`return state.project.markers[0].name`));
};
