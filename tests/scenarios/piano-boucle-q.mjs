// 18/10 : bande de boucle dans la règle du piano roll (boucle du projet) ; Q quantifie
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra });
  await ev(`document.getElementById('btnAddTrack').click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('.track-ctx-menu *')].find(e=>/Piano/.test(e.textContent)&&e.children.length===0||/^Piano/.test(e.textContent.trim())).dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(1200);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-cv').getBoundingClientRect(); return {l:r.left,t:r.top}})())`));
  // une boucle dessinée dans la bande du haut de la règle du piano roll
  await mouse('mouseMoved', g.l + 200, g.t + 4, { buttons: 0 });
  await mouse('mousePressed', g.l + 200, g.t + 4); await mouse('mouseMoved', g.l + 300, g.t + 4, { buttons: 1 }); await mouse('mouseMoved', g.l + 420, g.t + 4, { buttons: 1 }); await mouse('mouseReleased', g.l + 420, g.t + 4); await sleep(200);
  await R('boucle dessinée dans le piano roll → boucle du projet', `return JSON.stringify({loop:state.loop&&[+state.loop.start.toFixed(2),+state.loop.end.toFixed(2)], looping:state.looping})`);
  await mouse('mousePressed', g.l + 300, g.t + 4); await mouse('mouseReleased', g.l + 300, g.t + 4); await sleep(150);
  await R('clic sur la boucle : éteinte', `return 'looping='+state.looping`);
  // Q : notes décalées, puis calées sur la grille
  await R('notes hors grille', `const ti=state.project.tracks.length-1; const t=state.project.tracks[ti]; PulsePianoRoll.close(true); t.clips[0].midi.notes=[{s:0.13,d:0.9,p:60,v:100},{s:1.4,d:0.6,p:64,v:100}]; openMidiEditor(ti,0); await new Promise(r=>setTimeout(r,500)); return 'ok'`);
  await mouse('mouseMoved', g.l + 400, g.t + 150, { buttons: 0 }); await sleep(100);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'q', code: 'KeyQ', text: 'q', windowsVirtualKeyCode: 81 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 }); await sleep(900);
  await R('après Q (grille 1/16 : 0,25)', `const t=state.project.tracks.at(-1); return JSON.stringify(t.clips[0].midi.notes.map(n=>[n.s,n.d]))`);
};
