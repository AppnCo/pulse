// 01/11 : pistes choisies — M / S au clavier = même état pour toutes ; pan de l'en-tête suit la sélection ; × hors sélection = elle seule
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pce',name:'PCE',bpm:120,buses:[],tracks:['A','B','C','D'].map(n=>({name:n,type:'audio',color:'#A855F7'}))}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const col = (k) => R(`return state.project.tracks.map(t=>t.${k}?1:0).join('')`);
  const key = async (k, code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }); await sleep(200); };
  await R(`state.project.tracks[2].muted=true; selectTrack(1); state.selectedTracks=new Set([1,2]); renderAll(); document.activeElement&&document.activeElement.blur(); return 1`);
  await key('m', 'KeyM');
  check('M avec B (non muette, active) et C (muette) : les deux muettes', (await col('muted')) === '0110', await col('muted'));
  await key('m', 'KeyM');
  check('M encore : les deux rallumées', (await col('muted')) === '0000', await col('muted'));
  await key('s', 'KeyS');
  check('S : B et C en solo', (await col('solo')) === '0110', await col('solo'));
  check('boutons S à jour', (await R(`return [...document.querySelectorAll('.track-item .m-s')].map(b=>b.classList.contains('active')?1:0).join('')`)) === '0110');
  await key('s', 'KeyS');
  // pan de l'en-tête de B : C suit du même écart, A et D ne bougent pas
  await R(`state.project.tracks[2].pan=-20; renderAll(); return 1`);
  const r = JSON.parse(await ev(`JSON.stringify((()=>{const b=document.querySelector('.t-knob[data-i="1"]').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 6; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + k * 5, y: r.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 30, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
  const pans = await R(`return state.project.tracks.map(t=>t.pan||0).join(',')`);
  const [pa, pb, pc, pd] = pans.split(',').map(Number);
  check('pan : B a bougé, C du même écart, A et D intacts', pb > 0 && pc === -20 + pb && pa === 0 && pd === 0, pans);
  check('pistes toujours choisies', (await R(`return selectedTrackIdxs().join(',')`)) === '1,2');
  // × sur D (hors sélection) : D seule
  await R(`renderAll(); return 1`);
  await R(`document.querySelector('.m-del[data-del="3"]').click(); await new Promise(r=>setTimeout(r,200)); return 1`);
  check('× sur une piste hors sélection : elle seule', (await R(`return state.project.tracks.map(t=>t.name).join(',')`)) === 'A,B,C', await R(`return state.project.tracks.map(t=>t.name).join(',')`));
};
