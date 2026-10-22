// Vérifications AUTOMATIQUES (PASS / FAIL, code de sortie 1 en cas d'échec) de tout ce qui a été fait le 18/10/2026.
// Lancer : bash tests/run-win.sh tests/scenarios/verif-18-10.mjs   (ou tests/run.sh sur Mac)
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  const R = (code) => ev(`(async()=>{${code}})()`);
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (x, y, n = 1) => { await mouse('mouseMoved', x, y, { buttons: 0 }); for (let i = 1; i <= n; i++) { await mouse('mousePressed', x, y, { clickCount: i }); await mouse('mouseReleased', x, y, { clickCount: i }); } await sleep(150); };
  const drag = async (x0, y0, x1, y1) => { await mouse('mouseMoved', x0, y0, { buttons: 0 }); await mouse('mousePressed', x0, y0); await mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2, { buttons: 1 }); await mouse('mouseMoved', x1, y1, { buttons: 1 }); await mouse('mouseReleased', x1, y1); await sleep(250); };
  const key = async (k, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: vk, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(200); };
  const boot = async (project, extraLs = '') => {
    await nav('http://localhost:8765/index.html');
    await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); ${extraLs} ${project ? `localStorage.setItem('pulse_current_project', ${JSON.stringify(JSON.stringify(project))})` : ''}`);
    await nav('http://localhost:8765/studio.html'); await sleep(700);
  };
  const tracks = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ name: 'ABCDEF'[i], type: 'audio', color: '#A855F7', ...extra }));
  const buf = (id, sec = 6) => `{ const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*${sec},ctx.sampleRate); PulseAudio.registerBuffer('${id}',b); }`;
  const geo = async () => JSON.parse(await ev(`JSON.stringify((()=>{const tl=document.querySelector('.timeline').getBoundingClientRect(); const rows=[...document.querySelectorAll('.timeline-track')].map(r=>{const b=r.getBoundingClientRect(); return {top:b.top,h:b.height}}); const ru=document.getElementById('timelineRuler').getBoundingClientRect(); return {left:tl.left,px:state.pxPerSecond,rows,ys:ru.top+4,ym:ru.top+ru.height/2+4}})())`));

  // ---------- 1. Timeline : plage sur plusieurs pistes, ⌘X, ⌘A ----------
  await boot({ id: 'v1', name: 'V1', bpm: 120, buses: [], tracks: tracks(4) });
  await R(`${buf('v1', 8)} state.project.tracks.forEach((t,i)=>{t.clips=i<2?[{id:'v1',start:2,duration:3,name:t.name}]:[]}); state.snapMode='off'; renderTimelineTracks(); return 1`);
  let g = await geo();
  const X = (s) => g.left + s * g.px, Y = (i, f) => g.rows[i].top + g.rows[i].h * f;
  const reset = () => R(`state.project.tracks.forEach((t,i)=>{t.clips=i<2?[{id:'v1',start:2,duration:3,name:t.name}]:[]}); clearRangeSelection(); renderTimelineTracks(); return 1`);
  const plage = async () => { await drag(X(0.5), Y(0, 0.9), X(6), Y(1, 0.9)); };
  await plage();
  await drag(X(3.5), Y(1, 0.7), X(3.5), Y(2, 0.7));
  const counts = await R(`return state.project.tracks.map(t=>t.clips.length).join(',')`);
  check('plage A-B glissée d\'une piste vers le bas : les régions descendent ensemble', counts === '0,1,1,0', counts);
  await reset(); await plage();
  await key('x', 'KeyX', 88, 4);
  check('⌘X sur une plage : la zone part', (await R(`return state.project.tracks.map(t=>t.clips.length).join(',')`)) === '0,0,0,0');
  await reset();
  await key('a', 'KeyA', 65, 4);
  check('⌘A : toutes les régions choisies', (await R(`return state.selectedClips.size`)) === 2);
  await R(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})); return 1`); await sleep(200);
  check('Suppr efface tout ce qui est choisi', (await R(`return state.project.tracks.map(t=>t.clips.length).join(',')`)) === '0,0,0,0');

  // ---------- 2. Option + molette ----------
  await reset(); g = await geo();
  const before = await R(`return state.project.tracks.map(trackH).join(',')`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: X(8), y: Y(2, 0.5), deltaX: 0, deltaY: -120, modifiers: 1 }); await sleep(400);
  const after = await R(`return state.project.tracks.map(trackH).join(',')`);
  const aa = after.split(',').map(Number);
  check('⌥ + molette sur la timeline : toutes les pistes grandissent pareil', after !== before && new Set(aa).size === 1, before + ' → ' + after);

  // ---------- 3. Auto-Tune et effets ----------
  await boot({ id: 'v3', name: 'V3', bpm: 120, buses: [], tracks: tracks(1, { effects: ['eq', 'comp'] }) });
  await R(`state.selectedTrack=0; renderInspector(); return 1`);
  check('projet vide : pas d\'Auto-Tune par défaut', (await R(`return document.querySelectorAll('#inspector [data-fx="tune"]').length`)) === 0);
  await R(`document.querySelector('.insp-add-fx').click(); await new Promise(r=>setTimeout(r,100)); const cat=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/Voix et hauteur/.test(e.textContent)); if(cat){cat.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); cat.click();} await new Promise(r=>setTimeout(r,100)); document.querySelector('.track-ctx-menu .ctx-item[data-fx="tune"]').click(); await new Promise(r=>setTimeout(r,250)); document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); return 1`);
  check('+ Effet > Auto-Tune : il apparaît en 1er', (await R(`return [...document.querySelectorAll('#inspector .insp-fx-row')].map(r=>r.dataset.fx)[0]`)) === 'tune');
  await R(`document.querySelector('#inspector [data-fx="comp"] .insp-del').click(); await new Promise(r=>setTimeout(r,200)); return 1`);
  check('croix × : l\'effet est supprimé', (await R(`return JSON.stringify(state.project.tracks[0].effects)`)) === '["eq"]');
  await R(`document.querySelector('#inspector [data-fx="tune"] .insp-del').click(); await new Promise(r=>setTimeout(r,300)); return 1`);
  check('croix × sur l\'Auto-Tune : supprimé', (await R(`return document.querySelectorAll('#inspector [data-fx="tune"]').length`)) === 0);

  // ---------- 4. Lecture, base du curseur, moitiés de piste ----------
  await boot({ id: 'v4', name: 'V4', bpm: 120, buses: [], tracks: tracks(1) });
  await R(`${buf('v4', 20)} state.project.tracks[0].clips=[{id:'v4',start:0,duration:2,name:'A'}]; state.snapMode='off'; state.playhead=0.5; renderTimelineTracks(); return 1`);
  await R(`togglePlay(); return 1`); await sleep(3500);
  check('la lecture continue après la fin de la région', (await R(`return state.playing`)) === true);
  await R(`togglePlay(); return 1`);
  g = await geo();
  await R(`state.project.tracks[0].clips=[{id:'v4',start:0,duration:20,name:'A'}]; renderTimelineTracks(); return 1`); g = await geo();
  const UP = g.rows[0].top + g.rows[0].h * 0.2, LOW = g.rows[0].top + g.rows[0].h * 0.8;
  await click(X(3), LOW);
  check('clic moitié basse : le curseur est posé à 3 s', Math.abs((await R(`return state.playhead`)) - 3) < 0.1);
  await R(`togglePlay(); await new Promise(r=>setTimeout(r,600)); togglePlay(); await new Promise(r=>setTimeout(r,100)); togglePlay(); await new Promise(r=>setTimeout(r,200)); const p=state.playhead; togglePlay(); return p`).then((p) => check('pause puis relance : retour à la base (≈ 3 s)', Math.abs(p - 3) < 0.6, 'ph=' + p));
  await click(X(3), LOW);
  await R(`togglePlay(); await new Promise(r=>setTimeout(r,600)); togglePlay(); return 1`);
  const stopAt = await R(`return state.playhead`);
  await click(X(12), UP);
  check('clic moitié haute : la base est retirée, le curseur ne bouge pas', (await R(`return state.baseCleared===true && state.playOrigin===null`)) && Math.abs((await R(`return state.playhead`)) - stopAt) < 0.05);
  const resumed = await R(`togglePlay(); await new Promise(r=>setTimeout(r,250)); const a=state.playhead; togglePlay(); return a`);
  check('relance sans base : reprend là où ça s\'est arrêté', resumed >= stopAt - 0.05 && resumed < stopAt + 1, `arrêt ${stopAt.toFixed(2)} → relance ${resumed.toFixed(2)}`);
  await R(`state.playhead=7; updatePlayhead(); return 1`);
  await key('Enter', 'NumpadEnter', 13);
  check('Entrée du pavé numérique : retour au début', (await R(`return state.playhead`)) === 0);

  // ---------- 5. Règle : boucle et curseur ----------
  await R(`state.baseCleared=false; return 1`); g = await geo();
  await click(X(2), g.ym);
  check('règle : un clic place le curseur (sans boucle)', Math.abs((await R(`return state.playhead`)) - 2) < 0.05 && (await R(`return state.loop`)) === null);
  await drag(X(1), g.ym, X(4), g.ym);
  check('règle : un glissé déplace le curseur, sans boucle', Math.abs((await R(`return state.playhead`)) - 4) < 0.1 && (await R(`return state.loop`)) === null);
  await drag(X(1), g.ys, X(4), g.ys);
  const L = JSON.parse(await R(`return JSON.stringify({l:state.loop,on:state.looping,ph:state.playhead})`));
  check('bande du haut : un glissé crée la boucle (1→4), allumée, curseur au début', L.l && Math.abs(L.l.start - 1) < 0.05 && Math.abs(L.l.end - 4) < 0.05 && L.on && Math.abs(L.ph - 1) < 0.05, JSON.stringify(L));
  await click(X(2.5), g.ys);
  check('clic sur la boucle : éteinte', (await R(`return state.looping`)) === false);
  await drag(X(4), g.ys, X(6), g.ys);
  check('bord droit tiré : boucle 1→6', Math.abs((await R(`return state.loop.end`)) - 6) < 0.1);
  await drag(X(3), g.ys, X(5), g.ys);
  const ML = JSON.parse(await R(`return JSON.stringify([state.loop.start,state.loop.end])`));
  check('milieu tiré de +2 s : boucle 3→8', Math.abs(ML[0] - 3) < 0.1 && Math.abs(ML[1] - 8) < 0.1, JSON.stringify(ML));
  await key('c', 'KeyC', 67);
  check('touche C : rallume la boucle', (await R(`return state.looping`)) === true);

  // ---------- 6. Piano roll ----------
  await boot(null);
  await ev(`document.getElementById('btnAddTrack').click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('.track-ctx-menu *')].find(e=>/Piano/.test(e.textContent)&&e.children.length===0||/^Piano/.test(e.textContent.trim())).dispatchEvent(new MouseEvent('click',{bubbles:true}))`); await sleep(1200);
  const cv = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-cv').getBoundingClientRect(); return {l:r.left,t:r.top}})())`));
  const pnotes = `JSON.stringify(state.project.tracks.at(-1).clips[0].midi.notes.map(n=>[n.p,n.s,n.d]))`;
  check('piano roll ouvert avec les 4 outils', (await R(`return [...document.querySelectorAll('.me-toolseg button')].map(b=>b.textContent).join(',')`)) === 'Crayon,Pointeur,Gomme,Ciseaux');
  await R(`const sc=document.querySelector('.me-scale'); const o=[...sc.options].find(x=>/La mineur/.test(x.textContent)); sc.value=o.value; sc.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,300)); return 1`);
  const pad = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-pad').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})())`));
  await click(pad.x, pad.y);
  check('clic sur un accord : pas de focus laissé sur le bouton', !(await R(`return !!(document.activeElement&&document.activeElement.classList&&document.activeElement.classList.contains('me-pad'))`)));
  await key(' ', 'Space', 32); await sleep(700);
  check('Espace après un accord : la lecture démarre', (await R(`return state.playing`)) === true);
  check('Espace n\'a pas rejoué l\'accord (3 notes seulement)', JSON.parse(await R(`return ${pnotes}`)).length === 3);
  await R(`if (state.playing) togglePlay(); return 1`);
  // règle du piano roll : curseur, boucle (la zone des accords a décalé le canvas : on le remesure)
  Object.assign(cv, JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-cv').getBoundingClientRect(); return {l:r.left,t:r.top}})())`)));
  await click(cv.l + 66 + 120, cv.t + 14);
  check('règle de l\'éditeur : un clic déplace le curseur du projet', (await R(`return state.playhead`)) > 0.05);
  await drag(cv.l + 200, cv.t + 4, cv.l + 420, cv.t + 4);
  check('bande du haut de l\'éditeur : dessine la boucle du projet', (await R(`return !!state.loop && state.looping`)) === true, await R(`return JSON.stringify({loop:state.loop,on:state.looping})`));
  await click(cv.l + 300, cv.t + 4);
  check('clic sur cette boucle : éteinte', (await R(`return state.looping`)) === false);
  // outils
  await R(`const ti=state.project.tracks.length-1, t=state.project.tracks[ti]; PulsePianoRoll.close(true); t.clips[0].midi.notes=[{s:0.13,d:0.9,p:60,v:100},{s:1.4,d:0.6,p:64,v:100}]; openMidiEditor(ti,0); await new Promise(r=>setTimeout(r,500)); return 1`);
  await mouse('mouseMoved', cv.l + 400, cv.t + 150, { buttons: 0 }); await sleep(100);
  await key('q', 'KeyQ', 81); await sleep(700);
  const q = JSON.parse(await R(`return ${pnotes}`));
  check('Q : les notes sont calées sur la grille', q.every(n => Math.abs(n[1] * 4 - Math.round(n[1] * 4)) < 1e-6), JSON.stringify(q));
  await R(`const ti=state.project.tracks.length-1; PulsePianoRoll.close(true); state.project.tracks[ti].clips[0].midi.notes=[]; openMidiEditor(ti,0); await new Promise(r=>setTimeout(r,500)); return 1`);
  await mouse('mouseMoved', cv.l + 300, cv.t + 200, { buttons: 0 });
  await key('2', 'Digit2', 50);
  await click(cv.l + 300, cv.t + 200); await sleep(700);
  check('Pointeur : un simple clic dans le vide ne pose pas de note', JSON.parse(await R(`return ${pnotes}`)).length === 0);
  await click(cv.l + 300, cv.t + 200, 2); await sleep(700);
  check('Pointeur : un double-clic pose une note', JSON.parse(await R(`return ${pnotes}`)).length === 1);
  // Gomme : la note posée par le double-clic est sous la souris → un clic l'efface
  await key('3', 'Digit3', 51);
  await click(cv.l + 300, cv.t + 200); await sleep(700);
  check('Gomme : un clic sur la note l\'efface', JSON.parse(await R(`return ${pnotes}`)).length === 0);
  // Ciseaux : une note longue posée au crayon, coupée en son milieu → deux notes
  await key('1', 'Digit1', 49);
  await drag(cv.l + 300, cv.t + 200, cv.l + 560, cv.t + 200); await sleep(700);
  const longN = JSON.parse(await R(`return ${pnotes}`));
  await key('4', 'Digit4', 52);
  await click(cv.l + 430, cv.t + 200); await sleep(700);
  const cutN = JSON.parse(await R(`return ${pnotes}`));
  check('Ciseaux : une note cliquée est coupée en deux', longN.length === 1 && cutN.length === 2 && cutN[0][0] === cutN[1][0], JSON.stringify(longN) + ' → ' + JSON.stringify(cutN));
  // double-clic sur la région : rouvre (une région MIDI vide est supprimée à la fermeture : on remet une note)
  await R(`const ti=state.project.tracks.length-1; PulsePianoRoll.close(true); state.project.tracks[ti].clips[0].midi.notes=[{s:0,d:1,p:60,v:100}]; renderTimelineTracks(); await new Promise(r=>setTimeout(r,300)); return 1`);
  const crs = await ev(`JSON.stringify((()=>{const e=document.querySelector('.timeline-track .clip'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})())`);
  const cr = crs && crs !== 'null' ? JSON.parse(crs) : null;
  if (cr) { await click(cr.x, cr.y, 2); await sleep(500); }
  check('double-clic sur la région MIDI : l\'éditeur se rouvre', (await R(`return PulsePianoRoll.isOpen()`)) === true);

  // ---------- 7. Comping + graduation des faders ----------
  await boot({ id: 'v7', name: 'V7', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], takes: [], takeSeq: 2, takesOpen: true }] }, `localStorage.setItem('pulse_comping','1');`);
  await R(`${buf('ta')} ${buf('tb')} const t=state.project.tracks[0]; t.clips=[{id:'ta',start:0,duration:6,name:'Voix',take:1}]; t.takes=[{id:'tb',start:0,duration:6,offset:0,take:2}]; t.takesOpen=true; rerenderTracks(); await new Promise(r=>setTimeout(r,300)); return 1`);
  const pc = JSON.parse(await ev(`JSON.stringify((()=>{const p=document.querySelector('.take-piece[data-pi]').getBoundingClientRect(); return {l:p.left,y:p.top+p.height/2,px:state.pxPerSecond}})())`));
  await drag(pc.l + 2 * pc.px, pc.y, pc.l + 4 * pc.px, pc.y); await sleep(300);
  const comp = await R(`const t=state.project.tracks[0]; return t.clips.slice().sort((a,b)=>a.start-b.start).map(c=>c.take+'['+c.start.toFixed(0)+'-'+(c.start+c.duration).toFixed(0)+']').join(' ')`);
  check('comping : glisser 2→4 s sur la prise B la met devant sur ce passage', comp === '1[0-2] 2[2-4] 1[4-6]', comp);
  await R(`undoAction(); await new Promise(r=>setTimeout(r,250)); return 1`);
  check('comping : ⌘Z remet l\'état d\'avant', (await R(`const t=state.project.tracks[0]; return t.clips.length+'/'+t.takes.length`)) === '1/1');
  await R(`document.getElementById('btnMixer').click(); await new Promise(r=>setTimeout(r,500)); return 1`);
  check('graduation en dB sur les faders (+6 0 -6 -12 -24)', (await R(`const sc=document.querySelector('#mixerStrips .fader-scale'); return sc? [...sc.querySelectorAll('i')].map(i=>i.textContent).join(' '):''`)) === '+6 0 -6 -12 -24');

  // ---------- 8. Fiche de raccourcis ----------
  check('fiche de raccourcis (?) : s\'ouvre', (await R(`openCheatSheet(); await new Promise(r=>setTimeout(r,300)); const ok=!!document.getElementById('cheatModal'); closeCheatSheet(); return ok`)) === true);
};
