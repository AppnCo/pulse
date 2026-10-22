// Outil (pas un test) : parcourt Pulse en anglais et liste les textes affichés qui n'ont pas encore de traduction.
// Résultat : tests/i18n-manquants.txt (une ligne par texte). Lancer : bash tests/run-win.sh tests/scenarios/i18n-collecte.mjs
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  const all = new Set();
  const grab = async () => { const m = await ev(`JSON.stringify(window.PulseI18n && PulseI18n.missing ? PulseI18n.missing() : [])`); JSON.parse(m).forEach(x => all.add(x)); };
  const R = (c) => ev(`(async()=>{try{${c}}catch(e){return 'ERR '+e}})()`);
  // Accueil + modèles
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_lang','en')`);
  await nav('http://localhost:8765/index.html'); await sleep(600);
  await R(`const c=[...document.querySelectorAll('.card, button, [data-i18n]')].find(e=>/Template|Modèle/.test(e.textContent)); c && c.click(); await new Promise(r=>setTimeout(r,500)); return 1`);
  await grab();
  // Studio, modèle Rap, visite guidée
  await R(`createProjectFromTemplate('rap-studio'); return 1`); await sleep(1500);
  for (let i = 0; i < 5; i++) { await grab(); await R(`const b=document.getElementById('onboardNext'); b && b.click(); await new Promise(r=>setTimeout(r,250)); return 1`); }
  await grab();
  const steps = [
    `document.getElementById('btnAddTrack').click()`,
    `closeAllMenus(); document.getElementById('btnSettings').click()`,
    `document.querySelector('#settingsClose') && document.querySelector('#settingsClose').click(); openCheatSheet()`,
    `closeCheatSheet(); document.getElementById('btnMixer').click()`,
    `document.getElementById('btnMixer').click(); document.getElementById('btnExport').click()`,
    `document.querySelectorAll('.modal-backdrop').forEach(m=>m.remove()); const t=document.querySelector('.track-item'); t && t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200}))`,
    `closeAllMenus(); const s=document.querySelector('#inspector .insp-sound'); s && s.click()`,
    `document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); const a=document.querySelector('.insp-add-fx'); a && a.click()`,
    `closeAllMenus(); const o=document.querySelector('.insp-output'); o && o.click()`,
    `closeAllMenus(); document.getElementById('btnAddTrack').click(); await new Promise(r=>setTimeout(r,200)); const p=[...document.querySelectorAll('.track-ctx-menu *')].find(e=>/Piano/.test(e.textContent)&&e.children.length===0); p && p.dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    `const sc=document.querySelector('.me-scale'); if (sc) { sc.value=[...sc.options][3].value; sc.dispatchEvent(new Event('change',{bubbles:true})); }`,
    `const m=document.querySelector('.me-more'); m && m.click()`,
    `PulsePianoRoll.close(); const c=document.querySelector('.clip'); c && c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:600,clientY:300}))`,
  ];
  for (const s of steps) { await R(`${s}; return 1`); await sleep(500); await grab(); }
  // Projet vide (carte d'aide), Réglages ouverts plus longtemps
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'vide',name:'Vide',bpm:120,buses:[],tracks:[{name:'Piste 1',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(1200); await grab();
  await R(`openSettings(); await new Promise(r=>setTimeout(r,600)); document.querySelectorAll('.settings-modal .pulse-select, .settings-modal [class*="select"]').forEach(b=>b.click&&b.click()); await new Promise(r=>setTimeout(r,300)); return 1`); await grab();
  const list = [...all].filter(s => s.length > 1).sort();
  (await import('fs')).writeFileSync(new URL('../i18n-manquants.txt', import.meta.url), list.join('\n') + '\n');
  console.log('textes sans traduction :', list.length);
};
