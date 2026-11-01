// 01/11 : choisir les pistes depuis le mixeur (clic, ⇧ + clic, ⌘ + clic), marquées ; un fader déplacé fait suivre les choisies
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mxc',name:'MXC',bpm:120,buses:[],tracks:['A','B','C','D'].map(n=>({name:n,type:'audio',color:'#A855F7',volume:80}))}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = (c) => ev(`(async()=>{${c}})()`);
  await R(`if(!state.mixerOpen) toggleMixer(); await new Promise(r=>setTimeout(r,300)); return 1`);
  // point de clic : le bas de la tranche, sous le fader (zone sans réglage) — on cherche un point libre
  const pt = async (i) => JSON.parse(await ev(`JSON.stringify((()=>{const s=document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="${i}"]'); const b=s.getBoundingClientRect();
     for (let y=b.top+4; y<b.bottom-2; y+=3) for (let x=b.left+3; x<b.right-3; x+=6) { const el=document.elementFromPoint(x,y); if (el && s.contains(el) && !el.closest('input, button, select, textarea, [contenteditable="true"], .fader, .strip-pan-knob, .insert-slot, .send-slot, [role="slider"]')) return {x,y}; }
     return null; })())`));
  const click = async (i, mods = 0) => { const p = await pt(i); if (!p) return false; for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, modifiers: mods }); await sleep(200); return true; };
  const sel = () => R(`return selectedTrackIdxs().join(',')`);
  const marks = () => R(`return [...document.querySelectorAll('.mixer-strips .strip[data-kind="track"]')].map(e=>e.classList.contains('is-chosen')?1:0).join('')`);
  check('un point cliquable sur la tranche', !!(await pt(1)));
  await click(1);
  check('clic : B choisie', (await sel()) === '1', await sel());
  await click(3, 8);   // Shift
  check('⇧ + clic : B, C, D', (await sel()) === '1,2,3', await sel());
  await click(2, 4);   // ⌘
  check('⌘ + clic : C retirée', (await sel()) === '1,3', await sel());
  check('tranches marquées B et D', (await marks()) === '0101', await marks());
  check('liste des pistes à jour', (await R(`return [...document.querySelectorAll('.track-item')].map(e=>e.classList.contains('selected')?1:0).join('')`)).includes('1'));
  // un fader déplacé sur B : D suit
  await R(`const f=document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="1"] input.fader'); f.value=String(parseFloat(f.value)-20); f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  const v = await R(`return state.project.tracks.map(t=>t.volume).join(',')`);
  const [va, vb, vc, vd] = v.split(',').map(Number);
  check('fader de B : D suit, A et C non', vb < 80 && vd === vb && va === 80 && vc === 80, v);
};
