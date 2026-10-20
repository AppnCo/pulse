// 18/10 : la règle de l'éditeur de notes place le curseur du projet ; double-clic = lecture d'ici
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
  await R('prépare', `state.playhead=0; updatePlayhead(); const t=state.project.tracks.at(-1); return 'région à '+t.clips[0].start+' s, '+t.clips[0].midi.beats+' temps, bpm '+state.project.bpm`);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-cv').getBoundingClientRect(); return {l:r.left,t:r.top}})())`));
  const x = g.l + 66 + 2 * 56, y = g.t + 10;   // règle, à 2 temps (clavier 66 px, 56 px par temps au zoom de départ)
  await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y, { clickCount: 1 }); await mouse('mouseReleased', x, y, { clickCount: 1 }); await sleep(200);
  await R('clic règle ≈ 2 temps (1,0 s attendu ± zoom)', `const t=state.project.tracks.at(-1); return JSON.stringify({ph:+state.playhead.toFixed(2), playing:state.playing, base:!state.baseCleared})`);
  await mouse('mousePressed', x, y, { clickCount: 1 }); await mouse('mouseReleased', x, y, { clickCount: 1 });
  await mouse('mousePressed', x, y, { clickCount: 2 }); await mouse('mouseReleased', x, y, { clickCount: 2 }); await sleep(500);
  await R('double-clic : lecture lancée d ici', `const r=JSON.stringify({playing:state.playing, ph:+state.playhead.toFixed(2)}); if (state.playing) togglePlay(); return r`);
};
