// Retour terrain 17/10 : sur Windows les raccourcis doivent se lire Ctrl / Alt (et marcher avec Ctrl)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'platform',{get:()=> 'Win32'}); Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'});` });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tw1',name:'Win',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('bouton Sauvegarder', `return document.getElementById('btnSave').getAttribute('data-tooltip')`);
  await R('aide (touche H)', `openCheatSheet(); await new Promise(r=>setTimeout(r,300)); const t=document.getElementById('cheatModal').textContent; const out='⌘ restant='+/[⌘⌥]/.test(t)+' | Ctrl+S présent='+t.includes('Ctrl+S'); closeCheatSheet(); return out`);
  await R('message flash', `flash('Essaie ⌘Z pour annuler, ⌘⌥S pour enregistrer sous'); await new Promise(r=>setTimeout(r,200)); return document.getElementById('flash').textContent`);
  await R('un nouveau panneau (menu clic droit région)', `const m=document.createElement('div'); m.textContent='Plus de couleurs…  (⌥C)'; document.body.appendChild(m); await new Promise(r=>setTimeout(r,200)); const o=m.textContent; m.remove(); return o`);
};
