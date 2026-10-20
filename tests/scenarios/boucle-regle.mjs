// 18/10 : règle façon Logic. Bande du haut = boucle (glisser = créer, clic = allumer/éteindre, bords = étirer, milieu = déplacer) ; reste de la règle = curseur (clic ou glissé)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'bl',name:'Bl',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (l, c) => console.log(l + ':', await ev(`(async()=>{${c}})()`));
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.getElementById('timelineRuler').getBoundingClientRect(); return {left:document.querySelector('.timeline').getBoundingClientRect().left, ym:r.top+r.height/2+4, ys:r.top+4, px:state.pxPerSecond}})())`));
  const X = (s) => g.left + s * g.px;
  await R('snap grille', `state.snapMode='off'; return 'ok'`);
  await mouse('mousePressed', X(2), g.ym); await mouse('mouseReleased', X(2), g.ym); await sleep(150);
  await R('clic dans la règle : curseur à 2 s, pas de boucle', `return JSON.stringify({ph:+state.playhead.toFixed(2), loop:state.loop})`);
  await mouse('mousePressed', X(1), g.ym); await mouse('mouseMoved', X(2.5), g.ym, { buttons: 1 }); await mouse('mouseMoved', X(4), g.ym, { buttons: 1 }); await mouse('mouseReleased', X(4), g.ym); await sleep(200);
  await R('glissé dans la règle : le curseur suit (4 s), pas de boucle', `return JSON.stringify({ph:+state.playhead.toFixed(2), loop:state.loop})`);
  await mouse('mousePressed', X(1), g.ys); await mouse('mouseMoved', X(2.5), g.ys, { buttons: 1 }); await mouse('mouseMoved', X(4), g.ys, { buttons: 1 }); await mouse('mouseReleased', X(4), g.ys); await sleep(200);
  await R('glissé dans la bande du haut de 1 à 4 s : boucle créée, allumée, curseur au début', `return JSON.stringify({loop:state.loop&&[+state.loop.start.toFixed(2),+state.loop.end.toFixed(2)], looping:state.looping, ph:+state.playhead.toFixed(2)})`);
  await mouse('mousePressed', X(2.5), g.ys); await mouse('mouseReleased', X(2.5), g.ys); await sleep(150);
  await R('clic sur la boucle : éteinte', `return 'looping='+state.looping`);
  await mouse('mousePressed', X(4), g.ys); await mouse('mouseMoved', X(5), g.ys, { buttons: 1 }); await mouse('mouseMoved', X(6), g.ys, { buttons: 1 }); await mouse('mouseReleased', X(6), g.ys); await sleep(150);
  await R('bord droit tiré vers 6 s', `return JSON.stringify([+state.loop.start.toFixed(2), +state.loop.end.toFixed(2)])`);
  await mouse('mousePressed', X(3), g.ys); await mouse('mouseMoved', X(4), g.ys, { buttons: 1 }); await mouse('mouseMoved', X(5), g.ys, { buttons: 1 }); await mouse('mouseReleased', X(5), g.ys); await sleep(150);
  await R('milieu tiré de +2 s (1→6 devient 3→8)', `return JSON.stringify([+state.loop.start.toFixed(2), +state.loop.end.toFixed(2)])`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', text: 'c', windowsVirtualKeyCode: 67 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 }); await sleep(150);
  await R('touche C : boucle rallumée', `return 'looping='+state.looping`);
};
