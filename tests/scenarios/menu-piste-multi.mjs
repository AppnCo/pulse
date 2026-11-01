// 01/11 : clic droit sur une des pistes choisies = la commande vaut pour toutes (comme Logic) ; hors sélection = elle seule
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mpm',name:'MPM',bpm:120,buses:[],sends:[],tracks:['A','B','C','D'].map(n=>({name:n,type:'audio',color:'#60A5FA',volume:100,clips:[]}))}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const pick = (idx, path) => R(`closeAllMenus(); const t=state.project.tracks[${idx}]; openTrackContextMenu(300,200,${idx},t); await new Promise(r=>setTimeout(r,100));
    const path=${JSON.stringify(path)}; let el;
    if (path.length===2) { const row=[...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e=>e.textContent.trim().startsWith(path[0])); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,80)); el=[...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e=>e.textContent.includes(path[1])); }
    else el=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes(path[0]));
    if(!el) return 'introuvable'; el.click(); await new Promise(r=>setTimeout(r,250)); return el.textContent.trim();`);
  const col = (k) => R(`return state.project.tracks.map(t=>t.${k}?1:0).join('')`);
  await R(`selectTrack(1); state.selectedTracks=new Set([1,2]); renderAll(); return 1`);
  const lbl = await pick(2, ['Mute']);
  check('libellé indique le nombre de pistes', /2 pistes/.test(lbl), lbl);
  check('Mute : B et C', (await col('muted')) === '0110', await col('muted'));
  await pick(1, ['Réglages', 'Verrouiller']);
  check('Verrouiller : B et C', (await col('locked')) === '0110', await col('locked'));
  await pick(1, ['Réglages', 'Déverrouiller']);
  check('Déverrouiller : B et C', (await col('locked')) === '0000', await col('locked'));
  await pick(2, ['Son', 'Inverser la phase']);
  check('Phase : B et C', (await R(`return state.project.tracks.map(t=>(t.effectParams&&t.effectParams.util&&t.effectParams.util.invert)?1:0).join('')`)) === '0110');
  const u0 = await R(`return _undoStack.length`);
  await pick(1, ['Dupliquer']);
  check('Dupliquer : B copie et C copie, sous chacune', (await R(`return state.project.tracks.map(t=>t.name).join(',')`)) === 'A,B,B copie,C,C copie,D', await R(`return state.project.tracks.map(t=>t.name).join(',')`));
  check('un seul ⌘Z pour la duplication', (await R(`return _undoStack.length`)) - u0 === 1);
  await R(`undoAction(); await new Promise(r=>setTimeout(r,200)); return 1`);
  check('⌘Z retire les deux copies', (await R(`return state.project.tracks.map(t=>t.name).join(',')`)) === 'A,B,C,D');
  // piste hors sélection : elle seule, même pour Supprimer
  await R(`selectTrack(1); state.selectedTracks=new Set([1,2]); renderAll(); return 1`);
  await pick(3, ['Supprimer']);
  check('Supprimer sur une piste hors sélection : elle seule', (await R(`return state.project.tracks.map(t=>t.name).join(',')`)) === 'A,B,C', await R(`return state.project.tracks.map(t=>t.name).join(',')`));
  await R(`selectTrack(1); state.selectedTracks=new Set([1,2]); renderAll(); return 1`);
  await pick(0, ['Mute']);
  check('Mute sur une piste hors sélection : elle seule', (await col('muted')) === '111', await col('muted'));
};
