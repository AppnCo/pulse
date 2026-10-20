// 18/10 : outil Ciseaux du piano roll (touche 4) : une note cliquée est coupée en deux
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
  const c = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-cv').getBoundingClientRect(); return {l:r.left,t:r.top}})())`));
  const notes = `JSON.stringify(state.project.tracks.at(-1).clips[0].midi.notes.map(n=>n.p+'@'+n.s+'+'+n.d))`;
  const y = c.t + 200;
  await mouse('mouseMoved', c.l + 300, y, { buttons: 0 });
  await mouse('mousePressed', c.l + 300, y); await mouse('mouseMoved', c.l + 360, y, { buttons: 1 }); await mouse('mouseMoved', c.l + 560, y, { buttons: 1 }); await mouse('mouseReleased', c.l + 560, y); await sleep(900);
  await R('une note longue posée au crayon', `return ${notes}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '4', code: 'Digit4', text: '4', windowsVirtualKeyCode: 52 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', code: 'Digit4', windowsVirtualKeyCode: 52 }); await sleep(200);
  await R('touche 4', `return [...document.querySelectorAll('.me-toolseg button')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join(' ')`);
  await mouse('mousePressed', c.l + 430, y); await mouse('mouseReleased', c.l + 430, y); await sleep(900);
  await R('clic au milieu avec les ciseaux : deux notes', `return ${notes}`);
};
