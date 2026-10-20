// Aimant : Libre par défaut, Intelligent (petit aimant), Temps (grille) ; commande intégrée à Pulse
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'am1',name:'Aimant',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('départ', `return 'mode='+state.snap+' actif='+document.querySelector('.snap-btn.active').textContent+' puce cachée='+document.getElementById('snapRes').hidden+' pxPerSecond='+state.pxPerSecond+' (1 temps = 0,5 s)'`);
  await R('Libre : rien ne se cale', `return [1.05,1.2,1.4].map(t=>snapTime(t).toFixed(3)).join(' / ')`);
  await R('Intelligent : colle seulement tout près', `document.querySelector('.snap-btn[data-snap="magnet"]').click(); state.gridRes='beat'; return [1.05,1.2,1.4,1.48].map(t=>snapTime(t).toFixed(3)).join(' / ')+' (attendu 1.000 / 1.200 / 1.400 / 1.500)'`);
  await R('Temps : tout se cale', `document.querySelector('.snap-btn[data-snap="grid"]').click(); state.gridRes='beat'; return [1.05,1.2,1.4].map(t=>snapTime(t).toFixed(3)).join(' / ')+' (attendu 1.000 / 1.000 / 1.500)'`);
  await R('⌘ tenu = libre le temps du geste', `return snapTime(1.2, true).toFixed(3)`);
  await R('puce de finesse', `const chip=document.getElementById('snapRes'); const a=chip.textContent; chip.click(); const b=chip.textContent; chip.click(); return a+' → '+b+' → '+chip.textContent+' visible='+!chip.hidden`);
  await R('⌘G revient en Libre puis au dernier aimant', `const k=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'g',code:'KeyG',metaKey:true,bubbles:true})); k(); const a=state.snap; k(); return a+' puis '+state.snap`);
  await R('mémorisé', `return localStorage.getItem('pulse_snap')`);
};
