// Retour terrain 29/10 : les 3 menus d'outils de Logic (clic / ⌘ + clic / clic droit) et tous les outils
export default async ({ ev, nav, send, sleep }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ol1',name:'Outils',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' && !extra.down ? 0 : 1, clickCount: 1, ...extra });
  const click = async (x, y, extra = {}) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, extra); await mouse('mouseReleased', x, y, extra); await sleep(250); };
  const drag = async (x1, y1, x2, y2, extra = {}) => { await mouse('mouseMoved', x1, y1); await mouse('mousePressed', x1, y1, extra); await mouse('mouseMoved', (x1 + x2) / 2, (y1 + y2) / 2, { down: true, ...extra }); await mouse('mouseMoved', x2, y2, { down: true, ...extra }); await mouse('mouseReleased', x2, y2, extra); await sleep(300); };
  const reset = async () => ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.2*Math.sin(2*Math.PI*220*i/sr); PulseAudio.registerBuffer('ol',b); state.project.tracks.forEach(t=>{t.clips=[{id:'ol',start:2,duration:3,offset:0,name:t.name+'1'},{id:'ol',start:6,duration:2,offset:0,name:t.name+'2'}]}); state.selectedClip=null; state.selectedClips=new Set(); if(state.selection) clearRangeSelection(); state.snapMode='off'; setZoom(48,0); renderTimelineTracks(); document.querySelectorAll('*').forEach(e=>{if(e.scrollLeft>0)e.scrollLeft=0}); await new Promise(r=>setTimeout(r,150)); return 1})()`);
  const tool = async (which, k) => ev(`setMouseTool('${which}','${k}',true); 1`);
  const geo = async () => JSON.parse(await ev(`JSON.stringify((()=>{const tl=document.querySelector('.timeline').getBoundingClientRect(); const rows=[...document.querySelectorAll('.timeline-track')].map(r=>r.getBoundingClientRect()); return {left:tl.left, px:state.pxPerSecond, rows:rows.map(r=>({top:r.top,h:r.height}))}})())`));
  let ok = true; const check = (label, cond, info) => { console.log((cond ? '✓ ' : '✗ ') + label + ' — ' + info); if (!cond) ok = false; };
  await reset(); let g = await geo();
  const X = (sec) => g.left + sec * g.px, Y = (i, f) => g.rows[i].top + g.rows[i].h * f;
  // menus affichés
  let r = await ev(`[...document.querySelectorAll('#toolCtl .tool-pick')].map(b=>b.dataset.which+'='+b.dataset.tool).join(' ')`);
  check('3 menus : clic Pointeur, ⌘ Muet, droit Gain', r === 'left=pointer cmd=mute right=gain', r);
  r = await ev(`(async()=>{document.querySelector('.tool-pick[data-which="left"]').click(); await new Promise(r=>setTimeout(r,50)); const items=[...document.querySelectorAll('.tool-menu .tool-menu-item')].map(i=>i.dataset.tool); document.querySelector('.tool-menu .tool-menu-item[data-tool="erase"]').click(); return items.length+' outils, choisi='+mouseTool('left')+' menu fermé='+!document.querySelector('.tool-menu')})()`);
  check('menu du clic : 12 outils, choix Gomme', r === '12 outils, choisi=erase menu fermé=true', r);
  // Gomme
  await click(X(3), Y(0, 0.7));
  r = await ev(`state.project.tracks.map(t=>t.clips.map(c=>c.name).join(',')).join(' | ')`);
  check('Gomme efface la région cliquée', r === 'A2 | B1,B2', r);
  // Muet
  await reset(); await tool('left', 'mute'); await click(X(3), Y(1, 0.3));
  r = await ev(`String(!!state.project.tracks[1].clips[0].muted)`); check('Outil Muet', r === 'true', r);
  // Texte
  await reset(); await tool('left', 'text'); await click(X(3), Y(0, 0.5));
  r = await ev(`String(!!document.querySelector('.clip input, .clip [contenteditable="true"], .clip-rename, input.clip-name-input'))`); check('Outil Texte ouvre le renommage', r === 'true', r);
  await ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur(); 1`); await sleep(200);
  // Ciseaux
  await reset(); await tool('left', 'cut'); await click(X(3.5), Y(0, 0.5));
  r = await ev(`state.project.tracks[0].clips.length+' tool='+state.tool`); check('Outil Ciseaux coupe', r === '3 tool=scissors', r);
  // Fondu
  await reset(); await tool('left', 'fade'); await drag(X(2.3), Y(0, 0.5), X(3.2), Y(0, 0.5));
  r = await ev(`String((state.project.tracks[0].clips[0].fadeIn||0).toFixed(2))`); check('Outil Fondu : fondu d\'entrée', parseFloat(r) > 0.3, r);
  // Gain
  await reset(); await tool('left', 'gain'); await drag(X(3), Y(0, 0.5), X(3), Y(0, 0.5) + 50);
  r = await ev(`String(state.project.tracks[0].clips[0].gain)`); check('Outil Gain baisse le volume', parseFloat(r) < 1, r);
  // Marquee : plage même dans la moitié haute et sur une région
  await reset(); await tool('left', 'marquee'); await drag(X(1), Y(0, 0.2), X(4), Y(1, 0.2));
  r = await ev(`JSON.stringify(state.selection && [Math.round(Math.min(state.selection.start,state.selection.end)), Math.round(Math.max(state.selection.start,state.selection.end)), state.selection.tracks])`);
  check('Outil Marquee : plage 1–4 s sur A et B', r === '[1,4,[0,1]]', r);
  // Loupe
  await reset(); await tool('left', 'zoom'); await click(X(10), Y(0, 0.5));
  r = await ev(`String(state.pxPerSecond)`); check('Outil Loupe zoome', parseFloat(r) > 48, r);
  // Colle : 2 régions choisies au cadre, puis clic
  await reset(); g = await geo(); await tool('left', 'pointer'); await drag(X(1), Y(0, 0.2), X(7), Y(0, 0.4));
  r = await ev(`[...state.selectedClips].sort().join(' ')`); check('Pointeur : cadre sur les 2 régions de A', r === '0:0 0:1', r);
  await tool('left', 'glue'); await click(X(3), Y(0, 0.7)); await sleep(800);
  r = await ev(`state.project.tracks[0].clips.length+''`); check('Outil Colle joint les régions', r === '1', r);
  // ⌘ + clic = autre outil (Gomme), clic normal Pointeur
  await reset(); await tool('left', 'pointer'); await tool('cmd', 'erase');
  await click(X(3), Y(1, 0.7), { modifiers: 4 });
  r = await ev(`state.project.tracks[1].clips.map(c=>c.name).join(',')`); check('⌘ + clic avec la Gomme', r === 'B2', r);
  // clic droit = menu des outils
  await tool('right', 'toolmenu'); await mouse('mouseMoved', X(10), Y(0, 0.5)); await mouse('mousePressed', X(10), Y(0, 0.5), { button: 'right', buttons: 2 }); await mouse('mouseReleased', X(10), Y(0, 0.5), { button: 'right' }); await sleep(200);
  r = await ev(`String(!!document.querySelector('.tool-menu'))`); check('clic droit ouvre le menu des outils', r === 'true', r);
  await ev(`document.querySelectorAll('.tool-menu').forEach(m=>m.remove()); 1`);
  // B : bascule Ciseaux / Pointeur, et le menu suit
  await tool('right', 'gain'); await tool('cmd', 'mute');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); 1`); await sleep(100);
  r = await ev(`mouseTool('left')+'/'+document.querySelector('.tool-pick[data-which="left"]').dataset.tool`); check('B = Ciseaux dans le menu', r === 'cut/cut', r);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true})); 1`); await sleep(100);
  r = await ev(`mouseTool('left')`); check('B à nouveau = Pointeur', r === 'pointer', r);
  // Y = menu des outils sous la souris
  await mouse('mouseMoved', X(8), Y(0, 0.5));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',bubbles:true})); 1`); await sleep(150);
  r = await ev(`(()=>{const m=document.querySelector('.tool-menu'); if(!m) return 'aucun'; const b=m.getBoundingClientRect(); document.querySelectorAll('.tool-menu').forEach(x=>x.remove()); return Math.abs(b.left-${X(8)})<40?'sous la souris':'ailleurs'})()`);
  check('Y ouvre le menu des outils sous la souris', r === 'sous la souris', r);
  r = await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true})); String(!!document.querySelector('.tool-menu'))`);
  check('T reste le tap tempo (pas de menu)', r === 'false', r);
  console.log(ok ? 'RESULTAT: OK' : 'RESULTAT: ECHEC'); if (!ok) throw new Error('outils-logic en échec');
};
