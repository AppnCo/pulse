// Retour terrain 18/10 : déplacement vertical d'un groupe de régions, ⌘X sur une plage, Auto-Tune seulement sur demande, supprimer un effet
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  const mk = (n, c) => ({ name: n, type: 'audio', color: c });
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'r18',name:'R18',bpm:120,buses:[],tracks:[${['A','B','C','D'].map((n, i) => JSON.stringify(mk(n, '#A855F7'))).join(',')}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' && !extra.down ? 0 : 1, clickCount: 1, ...extra });
  await R('prépare', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.2*Math.sin(2*Math.PI*220*i/sr); PulseAudio.registerBuffer('r18',b); state.project.tracks.forEach((t,i)=>{t.clips=i<2?[{id:'r18',start:2,duration:3,name:t.name}]:[]}); state.snapMode='off'; renderTimelineTracks(); return state.pxPerSecond`);
  const geo = JSON.parse(await ev(`JSON.stringify((()=>{const tl=document.querySelector('.timeline').getBoundingClientRect(); const rows=[...document.querySelectorAll('.timeline-track')].map(r=>r.getBoundingClientRect()); return {left:tl.left, px:state.pxPerSecond, rows:rows.map(r=>({top:r.top,h:r.height}))}})())`));
  const X = (sec) => geo.left + sec * geo.px;
  const Y = (i, f = 0.9) => geo.rows[i].top + geo.rows[i].h * f;
  const plage = async () => {
    await mouse('mouseMoved', X(0.5), Y(0, 0.9)); await mouse('mousePressed', X(0.5), Y(0, 0.9));
    await mouse('mouseMoved', X(3), Y(1, 0.9), { down: true }); await mouse('mouseMoved', X(6), Y(1, 0.9), { down: true }); await mouse('mouseReleased', X(6), Y(1, 0.9)); await sleep(300);
  };
  const where = `return state.project.tracks.map(t=>t.clips.map(c=>c.start.toFixed(1)).join(',')||'-').join(' | ')`;
  // 1. plage A-B, on tire la région de B d'une piste vers le bas : A→B et B→C
  await plage();
  await R('départ (A | B | - | -)', where);
  const cy = Y(1, 0.7);
  await mouse('mouseMoved', X(3.5), cy); await mouse('mousePressed', X(3.5), cy);
  await mouse('mouseMoved', X(3.5), cy + 20, { down: true }); await mouse('mouseMoved', X(3.5), Y(2, 0.7), { down: true }); await mouse('mouseReleased', X(3.5), Y(2, 0.7)); await sleep(300);
  await R('après descente d\'une piste (attendu - | 2.0 | 2.0 | -)', where);
  // 2. plage puis ⌘X : la zone part
  await R('remise', `state.project.tracks.forEach((t,i)=>{t.clips=i<2?[{id:'r18',start:2,duration:3,name:t.name}]:[]}); clearRangeSelection(); renderTimelineTracks(); return 'ok'`);
  await plage();
  await R('⌘X sur la plage (attendu : clips partis)', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'x',metaKey:true,bubbles:true})); await new Promise(r=>setTimeout(r,200)); ${where.replace('return ', 'return ')}`);
  // 3. Auto-Tune : absent d'un projet vide, présent dans le modèle Rap, ajoutable, supprimable
  await R('projet vide : ligne Auto-Tune (attendu 0)', `state.selectedTrack=0; renderInspector(); return document.querySelectorAll('#inspector [data-fx="tune"]').length`);
  await R('+ Effet > Auto-Tune', `document.querySelector('.insp-add-fx').click(); await new Promise(r=>setTimeout(r,100)); const it=[...document.querySelectorAll('.track-ctx-menu .fam-fx[data-fx="tune"]')]; const first=it[0].textContent; it[0].click(); await new Promise(r=>setTimeout(r,200)); const rows=[...document.querySelectorAll('#inspector .insp-fx-row')].map(r=>r.dataset.fx); return 'menu 1er='+first+' | lignes='+rows.join(',')+' | tuneSlot='+state.project.tracks[0].tuneSlot`);
  await R('supprimer Auto-Tune (clic droit)', `document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); const row=document.querySelector('#inspector [data-fx="tune"]'); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100})); await new Promise(r=>setTimeout(r,100)); const it=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes('Supprimer')); if(!it) return 'PAS DE MENU SUPPRIMER'; it.click(); await new Promise(r=>setTimeout(r,300)); return 'lignes tune restantes='+document.querySelectorAll('#inspector [data-fx="tune"]').length`);
  await R('ajout Compresseur puis suppression', `state.project.tracks[0].effects=['comp']; renderInspector(); const row=document.querySelector('#inspector [data-fx="comp"]'); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100})); await new Promise(r=>setTimeout(r,100)); const it=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes('Supprimer')); it.click(); await new Promise(r=>setTimeout(r,200)); return JSON.stringify(state.project.tracks[0].effects)`);
  // 4. Option + molette sur la timeline : toutes les pistes grandissent, même la piste choisie
  await R('hauteurs avant', `return state.project.tracks.map(trackH).join(',')+' base='+state.trackHeight`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: X(8), y: Y(2, 0.5), deltaX: 0, deltaY: -120, modifiers: 1 });
  await sleep(400);
  await R('hauteurs après ⌥+molette sur la timeline', `return state.project.tracks.map(trackH).join(',')+' base='+state.trackHeight`);
};
