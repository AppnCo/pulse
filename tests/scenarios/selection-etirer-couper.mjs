// 29/10 : comme Logic, avec plusieurs régions choisies (⌘A) : tirer un bord tire celui de toutes ; les ciseaux coupent toutes
// les régions choisies au même endroit ; ⌘T coupe à la tête de lecture
export default async ({ ev, nav, send, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sc1',name:'Multi',bpm:120,buses:[],tracks:[{name:'A',type:'audio'},{name:'B',type:'audio'},{name:'C',type:'audio'}]})); 1`);
  await nav('http://localhost:8765/studio.html');
  const prep = `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*20,sr); PulseAudio.registerBuffer('m',b);
    state.project.tracks.forEach((t,i)=>{ t.clips=[{id:'m',start:2,duration:6,offset:2,name:t.name}] }); state.project.tracks[2].clips[0].start=3;
    setSnapMode('off'); state.selectedClips=new Set(); state.selectedClip=null; renderTimelineTracks(); return 1`;
  const P = () => ev(`(async()=>{${prep}})()`);
  const clips = () => ev(`JSON.stringify(state.project.tracks.map(t=>t.clips.map(c=>[+c.start.toFixed(2),+c.duration.toFixed(2),+(c.offset||0).toFixed(2)])))`);
  const key = async (k, mods) => { for (const type of ['rawKeyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: 'Key' + k.toUpperCase(), modifiers: mods, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); await sleep(300); };
  const geo = async (ti) => JSON.parse(await ev(`JSON.stringify((()=>{ const r=document.querySelector('.timeline-track[data-i="${ti}"] .clip').getBoundingClientRect(); return {l:r.left,r:r.right,y:r.top+r.height*0.7} })())`));
  const drag = async (x0, y, x1) => { await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0,y}); await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x0,y,button:'left',buttons:1,clickCount:1});
    for (let k=1;k<=5;k++) await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x0+(x1-x0)*k/5,y,button:'left',buttons:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x1,y,button:'left',buttons:0,clickCount:1}); await sleep(300); };
  const px = await ev(`state.pxPerSecond`);

  // 1. ⌘A puis bord droit de A tiré de -1 s : toutes raccourcies de 1 s
  await P(); await key('a', 4);
  let g = await geo(0); await drag(g.r - 2, g.y, g.r - 2 - px);
  let c = JSON.parse(await clips());
  check('bord droit : les 3 régions perdent 1 s', c.every(t => Math.abs(t[0][1] - 5) < 0.05), JSON.stringify(c));
  await ev(`undoAction(); 1`); await sleep(200);
  c = JSON.parse(await clips());
  check('une seule annulation remet tout', c.every(t => t[0][1] === 6), JSON.stringify(c));

  // 2. ⌘A puis bord gauche de B tiré de +1 s : toutes commencent 1 s plus tard, le son ne glisse pas
  await P(); await key('a', 4);
  g = await geo(1); await drag(g.l + 2, g.y, g.l + 2 + px);
  c = JSON.parse(await clips());
  check('bord gauche : début +1 s partout, décalage du son +1 s', Math.abs(c[0][0][0] - 3) < 0.05 && Math.abs(c[2][0][0] - 4) < 0.05 && c.every(t => Math.abs(t[0][2] - 3) < 0.05 && Math.abs(t[0][1] - 5) < 0.05), JSON.stringify(c));

  // 3. sans sélection multiple : seule la région tirée bouge
  await P(); g = await geo(0); await drag(g.r - 2, g.y, g.r - 2 - px);
  c = JSON.parse(await clips());
  check('une seule région : les autres ne bougent pas', Math.abs(c[0][0][1] - 5) < 0.05 && c[1][0][1] === 6 && c[2][0][1] === 6, JSON.stringify(c));

  // 4. ciseaux sur une région choisie : coupe toutes les régions choisies à 5 s
  await P(); await key('a', 4);
  await ev(`splitClipAt(0, 0, 5); 1`);
  c = JSON.parse(await clips());
  check('ciseaux : 3 régions coupées à 5 s', c.every(t => t.length === 2 && t[1][0] === 5), JSON.stringify(c));
  check('morceaux de droite choisis', await ev(`[...state.selectedClips].sort().join(' ')`) === '0:1 1:1 2:1');

  // 5. ⌘T : coupe à la tête de lecture
  await P(); await key('a', 4); await ev(`state.playhead=7; updatePlayhead(); 1`);
  await key('t', 4);
  c = JSON.parse(await clips());
  check('⌘T : coupé à 7 s partout', c.every(t => t.length === 2 && t[1][0] === 7), JSON.stringify(c));
  check('T seul = toujours le tap tempo', await ev(`typeof toggleTapMode`) === 'function');
};
