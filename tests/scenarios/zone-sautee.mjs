// 31/10 : = du pavé numérique (Logic : échanger les repères) → la boucle devient une zone sautée, la lecture passe par-dessus
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'zs',name:'Zs',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const press = async () => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: '=', code: 'NumpadEqual', windowsVirtualKeyCode: 187, location: 3 });
    await sleep(250);
  };
  const S = async () => JSON.parse(await ev(`JSON.stringify({ph:state.playhead, playing:state.playing, skip:!!state.loopSkip, on:!!state.looping})`));
  await ev(`document.activeElement && document.activeElement.blur()`);
  await press();
  check('= sans boucle : rien ne change', !(await S()).skip);
  await ev(`state.loop={start:2,end:2.6}; state.looping=true; renderLoopOverlay(); updateLoopButton()`);
  await press();
  let s = await S();
  check('= : la boucle devient une zone sautée', s.skip && s.on, JSON.stringify(s));
  check('zone sautée dessinée à part', !!(await ev(`!!document.querySelector('.timeline-ruler .loop-region.is-skip')`)));
  await ev(`seekPlayhead(1.6)`);
  await ev(`togglePlay()`);
  let min = 99, max = 0, inZone = 0;
  for (let i = 0; i < 25; i++) { await sleep(80); const p = (await S()).ph; max = Math.max(max, p); if (p > 2.05 && p < 2.55) inZone++; }
  check('la lecture saute par-dessus la zone (2 → 2,6 s)', max > 2.7 && inZone === 0, `max ${max.toFixed(2)}, ${inZone} passages dans la zone`);
  await ev(`togglePlay()`);
  await ev(`seekPlayhead(2.2)`); await ev(`togglePlay()`); await sleep(150);
  check('départ dans la zone sautée : on part juste après', (await S()).ph >= 2.6, String((await S()).ph));
  await ev(`togglePlay()`);
  await press();
  s = await S();
  check('= encore : boucle normale', !s.skip && s.on, JSON.stringify(s));
  await ev(`seekPlayhead(2.1)`); await ev(`togglePlay()`);
  for (let i = 0; i < 20; i++) { await sleep(80); max = (await S()).ph; if (max > 2.65) break; }
  check('boucle normale : la lecture reste dans 2 → 2,6 s', max <= 2.65, String(max));
  await ev(`togglePlay()`);
};
