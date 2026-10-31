// 31/10 : pavé numérique = réglages d'origine de Logic. Entrée (grand clavier) = retour au début ;
// Entrée du pavé = lecture ; 0 = stop (à l'arrêt : début) ; . = pause ; * = enregistrer ; / = aller à la position ;
// 1-9 = marqueur n° ; Ctrl + 0-9 = marqueur 10-19
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  const markers = Array.from({ length: 12 }, (_, i) => ({ time: 2 + i * 2, name: 'M' + (i + 1) }));
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'en',name:'En',bpm:120,buses:[],markers:${JSON.stringify(markers)},tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const VK = { Enter: 13, Numpad0: 96, Numpad1: 97, Numpad3: 99, NumpadDecimal: 110, NumpadMultiply: 106, NumpadDivide: 111, NumpadEnter: 13 };
  const KEY = { Enter: 'Enter', NumpadEnter: 'Enter', Numpad0: '0', Numpad1: '1', Numpad3: '3', NumpadDecimal: '.', NumpadMultiply: '*', NumpadDivide: '/' };
  const press = async (code, modifiers = 0) => {
    const loc = code.startsWith('Numpad') ? 3 : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: KEY[code], code, windowsVirtualKeyCode: VK[code], location: loc, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: KEY[code], code, windowsVirtualKeyCode: VK[code], location: loc, modifiers });
    await sleep(250);
  };
  const S = async () => JSON.parse(await ev(`JSON.stringify({ph:state.playhead, playing:state.playing, rec:!!state.recording})`));
  await ev(`state.playhead=7; updatePlayhead(); document.activeElement && document.activeElement.blur()`);
  await press('Enter');
  check('Entrée (grand clavier) : retour au début', (await S()).ph === 0);
  await ev(`seekPlayhead(3)`);
  await press('NumpadEnter'); await sleep(500);
  let s = await S();
  check('Entrée du pavé : lecture', s.playing && s.ph > 3.1, JSON.stringify(s));
  await press('NumpadEnter');
  check('Entrée du pavé en lecture : continue', (await S()).playing);
  await press('NumpadDecimal');
  s = await S(); const at = s.ph;
  check('. : pause, le curseur reste là', !s.playing && at > 3.3, JSON.stringify(s));
  await press('NumpadEnter'); await sleep(300); s = await S();
  check('après la pause, la lecture repart d\'ici (pas du point de départ)', s.playing && s.ph >= at - 0.05, `pause ${at.toFixed(2)} → ${s.ph.toFixed(2)}`);
  await press('Numpad0'); s = await S();
  check('0 : stop', !s.playing, JSON.stringify(s));
  await press('Numpad0');
  check('0 à l\'arrêt : retour au début', (await S()).ph === 0);
  await press('Numpad3');
  check('3 : marqueur n° 3 (6 s)', Math.abs((await S()).ph - 6) < 1e-6);
  await press('Numpad1', 2);
  check('Ctrl + 1 : marqueur n° 11 (22 s)', Math.abs((await S()).ph - 22) < 1e-6);
  await press('NumpadDivide');
  check('/ : la fenêtre « aller à la position » s\'ouvre', !!(await ev(`!!document.querySelector('.ask-modal .ask-input')`)));
  await ev(`(()=>{ const i=document.querySelector('.ask-modal .ask-input'); i.value='5.3'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
  await sleep(300);
  // 120 BPM en 4/4 : mesure 5 = 8 s, temps 3 = +1 s
  check('/ puis 5.3 : mesure 5, temps 3 (9 s)', Math.abs((await S()).ph - 9) < 1e-6, String((await S()).ph));
  // * : lance l'enregistrement (la page de test n'a pas de micro : on vérifie juste que la commande part)
  await ev(`window.__recCalls=0; window.__toggleRecOrig=toggleRec; toggleRec=function(){ window.__recCalls++; }`);
  await press('NumpadMultiply');
  check('* : enregistrer', (await ev(`window.__recCalls`)) === 1);
  await ev(`toggleRec=window.__toggleRecOrig`);
};
