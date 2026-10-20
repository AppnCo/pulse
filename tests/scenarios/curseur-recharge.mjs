// Si la page se recharge (plantage de la fenêtre…), le curseur revient où il était
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cr9',name:'Reload',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(500);
  await ev(`state.playhead=7.5; updatePlayhead();`); await sleep(2600);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  console.log('curseur après rechargement:', await ev(`state.playhead`), '(attendu 7.5)');
};
