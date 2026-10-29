// Retour terrain 29/10 : comme Logic — glisser dans la moitié HAUTE d'une piste (dans le vide) = cadre qui sélectionne
// les régions touchées en entier ; moitié BASSE = sélection d'une plage (inchangé)
export default async ({ ev, nav, send, sleep }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  const mk = (n) => ({ name: n, type: 'audio', color: '#A855F7' });
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cr1',name:'Cadre',bpm:120,buses:[],tracks:[${JSON.stringify(mk('A'))},${JSON.stringify(mk('B'))},${JSON.stringify(mk('C'))}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' && !extra.down ? 0 : 1, clickCount: 1, ...extra });
  await R('prépare', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*8,sr); PulseAudio.registerBuffer('cr',b); state.project.tracks.forEach((t,i)=>{t.clips=[{id:'cr',start:2,duration:3,name:t.name},{id:'cr',start:9,duration:2,name:t.name+'2'}]}); state.snapMode='off'; renderTimelineTracks(); return 'ok'`);
  const geo = JSON.parse(await ev(`JSON.stringify((()=>{const tl=document.querySelector('.timeline').getBoundingClientRect(); const rows=[...document.querySelectorAll('.timeline-track')].map(r=>r.getBoundingClientRect()); return {left:tl.left, px:state.pxPerSecond, rows:rows.map(r=>({top:r.top,h:r.height}))}})())`));
  const X = (sec) => geo.left + sec * geo.px;
  const Y = (i, f) => geo.rows[i].top + geo.rows[i].h * f;
  let ok = true; const check = (label, cond, info) => { console.log((cond ? '✓ ' : '✗ ') + label + ' — ' + info); if (!cond) ok = false; };
  // 1. cadre depuis le haut de la piste B (vide, à 0,5 s) jusqu'à la piste C, à 3 s : régions 1 de B et C
  await mouse('mouseMoved', X(0.5), Y(1, 0.2)); await mouse('mousePressed', X(0.5), Y(1, 0.2));
  await mouse('mouseMoved', X(2), Y(1, 0.8), { down: true });
  const live = await ev(`!!document.querySelector('.region-lasso')`);
  await mouse('mouseMoved', X(3), Y(2, 0.6), { down: true }); await mouse('mouseReleased', X(3), Y(2, 0.6)); await sleep(300);
  let r = JSON.parse(await ev(`JSON.stringify({sel:[...state.selectedClips].sort().join(' '), one: state.selectedClip && (state.selectedClip.trackIdx+':'+state.selectedClip.clipIdx), plage: !!state.selection, cadre: !!document.querySelector('.region-lasso'), vis: document.querySelectorAll('.clip.is-selected').length})`));
  check('cadre visible pendant le geste', live, String(live));
  check('cadre : régions B1 et C1 choisies en entier, pas de plage', r.sel === '1:0 2:0' && !r.plage && !r.cadre && r.vis === 2, JSON.stringify(r));
  // 2. Suppr efface les deux régions choisies
  await R('suppr', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true})); await new Promise(r=>setTimeout(r,200)); return 'ok'`);
  r = await ev(`state.project.tracks.map(t=>t.clips.length).join(',')`);
  check('Suppr retire les régions encadrées', r === '2,1,1', r);
  await R('annule', `undoAction(); return state.project.tracks.map(t=>t.clips.length).join(',')`);
  // 3. simple clic en haut dans le vide : plus rien de choisi
  await mouse('mouseMoved', X(7), Y(0, 0.2)); await mouse('mousePressed', X(7), Y(0, 0.2)); await mouse('mouseReleased', X(7), Y(0, 0.2)); await sleep(200);
  r = await ev(`String(state.selectedClips.size)+'/'+String(!!state.selectedClip)`);
  check('clic en haut dans le vide : désélection', r === '0/false', r);
  // 4. moitié basse : toujours la sélection de plage
  await mouse('mouseMoved', X(0.5), Y(0, 0.85)); await mouse('mousePressed', X(0.5), Y(0, 0.85));
  await mouse('mouseMoved', X(3), Y(1, 0.85), { down: true }); await mouse('mouseMoved', X(6), Y(1, 0.85), { down: true }); await mouse('mouseReleased', X(6), Y(1, 0.85)); await sleep(300);
  r = await ev(`JSON.stringify(state.selection && {tracks: state.selection.tracks})`);
  check('moitié basse : plage sur A et B', r && r.includes('[0,1]'), r);
  console.log(ok ? 'RESULTAT: OK' : 'RESULTAT: ECHEC'); if (!ok) throw new Error('cadre-regions en échec');
};
