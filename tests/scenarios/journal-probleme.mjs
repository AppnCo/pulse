// Journal de problèmes : une page rechargée sans fermeture propre est notée
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'jp1',name:'J',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(500);
  // comme si la page avait planté en pleine lecture : au chargement suivant, la session précédente est restée « ouverte »
  await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('pulse_session', JSON.stringify({open:true,doing:'lecture',at:Date.now()}))}catch(e){}` });
  await nav('http://localhost:8765/studio.html'); await sleep(500);
  console.log('journal:', await ev(`JSON.stringify(diagLog().map(d=>d.kind+' : '+d.detail))`));
  await ev(`openSettings()`); await sleep(300);
  console.log('affiché dans les Réglages:', await ev(`document.querySelector('.settings-modal').textContent.includes('a redémarré sans se fermer')`));
};
