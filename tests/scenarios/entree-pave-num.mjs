// 18/10 : Entrée du pavé numérique = Entrée normale (retour au début)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'en',name:'En',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  for (const [nom, code] of [['Entrée', 'Enter'], ['Entrée pavé num', 'NumpadEnter']]) {
    await ev(`state.playhead=7; updatePlayhead(); document.activeElement && document.activeElement.blur()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code, windowsVirtualKeyCode: 13, location: code === 'NumpadEnter' ? 3 : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code, windowsVirtualKeyCode: 13, location: code === 'NumpadEnter' ? 3 : 0 });
    await sleep(200);
    console.log(nom + ' : curseur après =', await ev('state.playhead'), '(0 attendu)');
  }
};
