// 18/10 : clic droit sur une région > « Caler le début sur la grille » (plusieurs régions choisies : toutes) ; en anglais, G / D du pan → L / R
const HOV = (n) => `{const r=[...document.querySelectorAll('.clip-ctx-menu .ctx-has-sub')].find(e=>new RegExp('^\\s*${n}').test(e.textContent)); if(r) r.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));}`;   // les entrées sont rangées en sous-menus : on survole d'abord le bon
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  const R = (c) => ev(`(async()=>{${c}})()`);
  const boot = async (lang) => {
    await nav('http://localhost:8765/index.html');
    await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_lang','${lang}'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cg',name:'Cg',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#60A5FA'}]}))`);
    await nav('http://localhost:8765/studio.html'); await sleep(800);
  };
  await boot('fr');
  await R(`const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate); PulseAudio.registerBuffer('cg',b); state.project.tracks[0].clips=[{id:'cg',start:2.13,duration:1,name:'A'}]; state.project.tracks[1].clips=[{id:'cg',start:0.9,duration:1,name:'B'}]; state.gridRes='beat'; state.selectedClips=new Set(['0:0','1:0']); renderTimelineTracks(); return 1`);
  const starts = `state.project.tracks.map(t=>t.clips.map(c=>+c.start.toFixed(3)).join(',')).join(' | ')`;
  await R(`openClipContextMenu(400, 300, 0, 0); await new Promise(r=>setTimeout(r,200)); ${HOV('Édition')} const it=[...document.querySelectorAll('.ctx-item')].find(e=>/Caler le début sur la grille/.test(e.textContent)); if(!it) return 'pas de menu'; it.click(); await new Promise(r=>setTimeout(r,200)); return 1`);
  const s = await R(`return ${starts}`);
  check('les deux régions choisies sont calées sur le temps (2,13 → 2 ; 0,9 → 1)', s === '2 | 1', s);
  await R(`undoAction(); await new Promise(r=>setTimeout(r,200)); return 1`);
  check('⌘Z remet les positions', (await R(`return ${starts}`)) === '2.13 | 0.9');
  await boot('en');
  const pan = await R(`state.selectedTrack=0; renderInspector(); await new Promise(r=>setTimeout(r,200)); return [...document.querySelectorAll('#inspector .insp-pan span')].map(e=>e.textContent).join('/')`);
  check('anglais : le réglage gauche / droite affiche L / R', pan === 'L/R', pan);
  check('anglais : la touche D de la fiche de raccourcis reste « D »', (await R(`openCheatSheet(); await new Promise(r=>setTimeout(r,250)); const ok=[...document.querySelectorAll('#cheatModal kbd, #cheatModal .cheat-key, #cheatModal td, #cheatModal dt')].some(e=>e.textContent.trim()==='D'); closeCheatSheet(); return ok`)) === true);
};
