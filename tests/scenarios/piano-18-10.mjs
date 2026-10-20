// 18/10 : piano roll — Espace après un clic sur un accord = lecture ; touches hors gamme foncées ; double-clic sur la région rouvre l'éditeur
export default async ({ ev, nav, send, sleep, shot }) => {
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
  // gamme La mineur
  await R('gamme', `const sc=document.querySelector('.me-scale'); const o=[...sc.options].find(x=>/La mineur/.test(x.textContent)); sc.value=o.value; sc.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,300)); return 'pads='+document.querySelectorAll('.me-pad').length+' repli='+document.querySelector('.me-fold').checked`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/piano-gamme.jpg');
  // vrai clic sur un accord, puis Espace
  const p = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-pad').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})())`));
  await mouse('mousePressed', p.x, p.y, { clickCount: 1 }); await mouse('mouseReleased', p.x, p.y, { clickCount: 1 }); await sleep(300);
  await R('après clic accord : bouton gardé en focus ?', `return document.activeElement && document.activeElement.className`);
  await R('notes avant Espace', `window.__n=PulsePianoRoll.isOpen()?document.querySelectorAll('.me-pad').length:0; return 'ok'`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(500);
  await R('Espace : lecture lancée ?', `return JSON.stringify({playing:state.playing, region:state.project.tracks.at(-1).clips[0].midi.notes.length+' notes'})`);
  await R('on arrête', `if (state.playing) togglePlay(); PulsePianoRoll.close(); await new Promise(r=>setTimeout(r,300)); return 'éditeur ouvert='+PulsePianoRoll.isOpen()`);
  // double-clic sur la région
  const c = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.timeline-track .clip, .clip').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})())`));
  await mouse('mousePressed', c.x, c.y, { clickCount: 1 }); await mouse('mouseReleased', c.x, c.y, { clickCount: 1 }); await sleep(80);
  await mouse('mousePressed', c.x, c.y, { clickCount: 2 }); await mouse('mouseReleased', c.x, c.y, { clickCount: 2 }); await sleep(500);
  await R('double-clic sur la région : éditeur rouvert ?', `return PulsePianoRoll.isOpen()`);
};
