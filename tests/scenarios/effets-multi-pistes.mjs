// 30/10 : comme Logic — plusieurs pistes choisies : ajouter / retirer / allumer-éteindre un effet le fait sur toutes ;
// les réglages restent propres à chaque piste ; une piste seule ne touche qu'elle-même
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'emp',name:'Multi',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#A855F7'},{name:'C',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const click = async (sel) => { const r = JSON.parse(await ev(`JSON.stringify((()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`)); if (!r) return false; for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type==='mousePressed'?1:0, clickCount: 1 }); await sleep(300); return true; };
  const fx = async () => JSON.parse(await R(`return JSON.stringify(state.project.tracks.map(t=>(t.effects||[]).join(',')))`));
  // A et C choisies (A active)
  await R(`selectTrack(0); state.selectedTracks=new Set([0,2]); renderAll(); return 1`);
  await click('.insp-add-fx'); await R(`document.querySelector('.track-ctx-menu .fam-fx[data-fx="chorus"]').click(); return 1`); await sleep(300);
  let f = await fx();
  check('ajout avec A et C choisies : chorus sur A et C, pas sur B', f[0] === 'chorus' && f[1] === '' && f[2] === 'chorus', JSON.stringify(f));
  // réglage propre à chaque piste
  await R(`state.project.tracks[0].effectParams.chorus.mix=77; return 1`);
  check('réglage de A sans toucher C', (await R(`return state.project.tracks[2].effectParams.chorus.mix`)) !== 77);
  // éteindre / rallumer depuis A
  await R(`setFxOn(state.project.tracks[0],'chorus',false); return 1`); f = await fx();
  check('éteint sur A et C', f[0] === '' && f[2] === '', JSON.stringify(f));
  await R(`setFxOn(state.project.tracks[0],'chorus',true); return 1`); f = await fx();
  check('rallumé sur A et C, toujours pas sur B', f[0] === 'chorus' && f[1] === '' && f[2] === 'chorus', JSON.stringify(f));
  check('réglage de A gardé après éteindre/rallumer', (await R(`return state.project.tracks[0].effectParams.chorus.mix`)) === 77);
  // retirer
  await R(`await removeFx('chorus', state.project.tracks[2]); return 1`); f = await fx();
  check('supprimé de A et C', f[0] === '' && f[2] === '', JSON.stringify(f));
  await R(`undoAction(); return 1`); await sleep(200); f = await fx();
  check('⌘Z remet l\'effet sur les deux', f[0] === 'chorus' && f[2] === 'chorus', JSON.stringify(f));
  // une seule piste choisie : seulement elle
  await R(`selectTrack(1); renderAll(); return 1`);
  await click('.insp-add-fx'); await R(`document.querySelector('.track-ctx-menu .fam-fx[data-fx="phaser"]').click(); return 1`); await sleep(300);
  f = await fx();
  check('piste seule : phaser seulement sur B', f[1] === 'phaser' && !f[0].includes('phaser') && !f[2].includes('phaser'), JSON.stringify(f));
  // piste touchée hors de la sélection : seulement elle
  await R(`selectTrack(0); state.selectedTracks=new Set([0,2]); renderAll(); await removeFx('phaser', state.project.tracks[1]); return 1`); f = await fx();
  check('piste hors sélection : seulement elle', f[1] === '' && f[0] === 'chorus' && f[2] === 'chorus', JSON.stringify(f));
};
