// PulseTune, vue Graphique : les notes en blocs ; tirer un bloc pose la note à la main (gardée dans le projet), double-clic = retour à l'automatique
import fs from 'fs';
import { boot, J, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check, shot } = c;
  const JA = (code) => ev(`(async()=>JSON.stringify(await (async()=>{${code}})()))()`).then(x => { try { return JSON.parse(x); } catch { return x; } });
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false });
  await instru(ev, 8, 0, 0); await sleep(300);
  // voix d'essai : 8 notes tenues un peu fausses, avec vibrato
  const made = await ev(`(async()=>{ try { const ctx=await PulseAudio.init(), sr=ctx.sampleRate, n=sr*6, b=ctx.createBuffer(1,n,sr), d=b.getChannelData(0); let ph=0; const mel=[60.3,62.4,63.2,67.35,65.3,63.4,62.2,60.4];
    for(let i=0;i<n;i++){ const t=i/sr, k=Math.min(7,Math.floor(t/0.75)), u=t/0.75-k, m=mel[k]+0.2*Math.sin(2*Math.PI*5.5*t)*Math.min(1,u*2), f=440*Math.pow(2,(m-69)/12); ph+=2*Math.PI*f/sr; const env=(u>0.9?0:1)*Math.min(1,u*30);
      let s=0; for(let h=1;h<=10;h++) s+=Math.sin(h*ph)/(h*(1+Math.abs(h*f-700)/900)); d[i]=0.35*env*s; }
    PulseAudio.registerBuffer('voixfausse', b); const t=state.project.tracks[2]; t.clips=[{id:'voixfausse',name:'Voix',start:0,duration:6,offset:0}];
    t.autotune={on:true,notes:[1,0,1,1,0,1,0,1,1,0,1,0].map(Boolean),source:'clavier',tonic:0,minor:true,strength:0.85};
    await tuneWholeTrack(2); localStorage.setItem('pulse_tune_view','graph'); openTunePanel(2,-1,300,60,true); return 'ok' } catch(e) { return 'ERR '+e } })()`);
  await sleep(700);
  const st = await J(ev, `const p=document.querySelector('.tune-panel'), cl=state.project.tracks[2].clips[0], tr=TUNE_TRACES.get(cl.id); return { made: ${JSON.stringify(made)}, graph: p.classList.contains('tp-graph'), knobs: getComputedStyle(p.querySelector('.tp-knobs')).display, trace: getComputedStyle(p.querySelector('.tp-trace')).display, notes: tr ? tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>s.note) : null }`);
  check('vue Graphique : le tracé remplace les cadrans, 8 notes trouvées', st.graph && st.knobs === 'none' && st.trace === 'block' && st.notes && st.notes.length === 8, JSON.stringify(st));
  check('notes automatiques dans la gamme (Do mineur)', JSON.stringify(st.notes) === JSON.stringify([60, 62, 63, 67, 65, 63, 62, 60]), JSON.stringify(st.notes));
  // tirer la 4e note (Sol) de deux demi-tons vers le bas → Fa
  const geo = async (k) => J(ev, `const p=document.querySelector('.tune-panel'), cv=p.querySelector('.tp-trace canvas'), r=cv.getBoundingClientRect(), cl=state.project.tracks[2].clips[0], tr=TUNE_TRACES.get(cl.id);
    const f0=tr.f0; let i0=0,i1=f0.length-1; while(!(f0[i0]>0))i0++; while(!(f0[i1]>0))i1--; const segs=tr.notes.filter(s=>s.i1-s.i0>=8), sg=segs[${k}];
    const mid=(hz)=>69+12*Math.log2(hz/440); const vals=[]; for(let i=i0;i<=i1;i+=2) if(f0[i]>0) vals.push(mid(f0[i])); vals.sort((a,b)=>a-b);
    let lo=Math.floor(vals[Math.floor(vals.length*0.02)]-1.5), hi=Math.ceil(vals[Math.floor(vals.length*0.98)]+1.5); for(const s of tr.notes){lo=Math.min(lo,s.note-2);hi=Math.max(hi,s.note+2);}
    const W=r.width,H=cv.clientHeight; return { x: r.left+((sg.i0+sg.i1)/2-i0)/(i1-i0)*W, y: r.top+H-(sg.note-lo)/(hi-lo)*H, row: H/(hi-lo), note: sg.note, forced: sg.forced }`);
  let g = await geo(3);
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  await mouse('mouseMoved', g.x, g.y, { buttons: 0 }); await mouse('mousePressed', g.x, g.y);
  for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', g.x, g.y + g.row * 2 * k / 8); await sleep(20); }
  await mouse('mouseReleased', g.x, g.y + g.row * 2); await sleep(1800);
  let r = await JA(`const cl=state.project.tracks[2].clips[0], tr=TUNE_TRACES.get(cl.id); const b=PulseAudio.getBuffer(cl.id); const f=await PulseTune.trackPitch(b.getChannelData(0), b.sampleRate); const v=[]; for(let i=Math.round(2.45/0.005); i<Math.round(2.8/0.005); i++) if(f[i]>0) v.push(f[i]); v.sort((a,b)=>a-b);
    return { edits: cl.tune.edits, notes: tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>[s.note,s.forced]), hz: v[v.length>>1] }`);
  check('bloc tiré de 2 demi-tons : note posée à la main, gardée sur le clip', r.edits && r.edits.length === 1 && r.edits[0].note === 65 && r.notes[3][0] === 65 && r.notes[3][1] === true, JSON.stringify({ edits: r.edits, n: r.notes[3] }));
  check('le son suit : la 4e note chante maintenant un Fa (349,2 Hz)', Math.abs(1200 * Math.log2(r.hz / 349.23)) < 25, (r.hz || 0).toFixed(1) + ' Hz');
  if (process.env.VISU_DIR) { const b = await J(ev, `const r=document.querySelector('.tune-panel').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}`); const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: b.x - 8, y: Math.max(0, b.y - 8), width: b.w + 16, height: Math.min(860, b.h + 16), scale: 1.5 } }); fs.writeFileSync(process.env.VISU_DIR + '/tune-graph.png', Buffer.from(shot.result.data, 'base64')); }
  // un autre réglage (Humain) ne perd pas la note posée à la main
  await ev(`(async()=>{ const t=state.project.tracks[2]; t.autotune.human=0.3; await tuneWholeTrack(2); })()`); await sleep(1500);
  r = await J(ev, `const cl=state.project.tracks[2].clips[0]; return { edits: cl.tune.edits, sig: cl.tune.sig }`);
  check('réglage changé (Humain) : la prise est recorrigée et la note à la main reste', r.edits && r.edits.length === 1 && /\\|0\\.3\\|/.test(r.sig), JSON.stringify(r));
  // double-clic sur la note blanche : retour à l'automatique
  g = await geo(3);
  await mouse('mousePressed', g.x, g.y, { clickCount: 1 }); await mouse('mouseReleased', g.x, g.y, { clickCount: 1 });
  await mouse('mousePressed', g.x, g.y, { clickCount: 2 }); await mouse('mouseReleased', g.x, g.y, { clickCount: 2 }); await sleep(1800);
  r = await J(ev, `const cl=state.project.tracks[2].clips[0], tr=TUNE_TRACES.get(cl.id); return { edits: cl.tune.edits || [], notes: tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>s.note) }`);
  check('double-clic : la note revient à la correction automatique (Sol)', r.edits.length === 0 && r.notes[3] === 67, JSON.stringify(r));

  // zoom (⌘ + molette) autour de la souris puis défilement (molette), et le glisser d'une note marche encore zoomé
  {
    const b = await J(ev, `const r=document.querySelector('.tune-panel .tp-trace canvas').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}`);
    await ev('state.baseCleared = true');   // pas de curseur posé : le zoom se fait autour de la souris (comme sur les pistes)
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x, y: b.y, deltaX: 0, deltaY: -120, modifiers: 4 }); await sleep(200);
    const z = await J(ev, `const v=document.querySelector('.tune-panel')._trView; return {a:v.a,b:v.b}`);
    check('⌘ + molette : zoom autour de la souris (un cran = ×1,15, comme les pistes)', z.b - z.a < 0.9 && Math.abs((z.a + z.b) / 2 - 0.5) < 0.02, JSON.stringify(z));
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x, y: b.y, deltaX: 40, deltaY: 0 }); await sleep(200);
    const z2 = await J(ev, `const v=document.querySelector('.tune-panel')._trView; return {a:v.a,b:v.b}`);
    check('molette horizontale : la vue défile dans le temps, même largeur', z2.a > z.a + 0.02 && Math.abs((z2.b - z2.a) - (z.b - z.a)) < 1e-6, JSON.stringify(z2));
    await ev(`(()=>{ const v=document.querySelector('.tune-panel')._trView; v.a=0; v.b=1; v.vspan=0; document.dispatchEvent(new CustomEvent('pulse-tune-done')); })()`); await sleep(200);
  }

  // clic = choisir la note → barre de réglages ; vibrato de cette note seulement
  {
    const g2 = await geo(1);
    await mouse('mouseMoved', g2.x, g2.y, { buttons: 0 }); await mouse('mousePressed', g2.x, g2.y); await mouse('mouseReleased', g2.x, g2.y); await sleep(200);
    const bar = await J(ev, `const b=document.querySelector('.tune-panel .tp-notebar'); return { on: b.classList.contains('on'), name: b.querySelector('.tp-nb-name').textContent }`);
    check('clic sur une note : la barre de la note s\'ouvre', bar.on && /^D/.test(bar.name), JSON.stringify(bar));
    await ev(`(()=>{ const i=document.querySelector('.tune-panel .tp-nb-vib'); i.value=80; i.dispatchEvent(new Event('change')); })()`); await sleep(1800);
    const r2 = await J(ev, `const cl=state.project.tracks[2].clips[0], tr=TUNE_TRACES.get(cl.id); return { edits: cl.tune.edits, n: tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>[s.note,s.forced]) }`);
    check('Vibrato 80 % sur cette note seulement (gardée en Ré)', r2.edits && r2.edits.length === 1 && r2.edits[0].vib === 0.8 && r2.edits[0].note === 62 && r2.n[1][1] === true, JSON.stringify(r2));
    // ⌥ + clic au milieu de la 6e note : coupée en deux
    const g5 = await geo(5);
    await mouse('mouseMoved', g5.x, g5.y, { buttons: 0, modifiers: 1 }); await mouse('mousePressed', g5.x, g5.y, { modifiers: 1 }); await mouse('mouseReleased', g5.x, g5.y, { modifiers: 1 }); await sleep(1800);
    const r3 = await J(ev, `const tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id); return tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>s.note)`);
    check('⌥ + clic : la note est coupée en deux (9 blocs)', r3.length === 9 && r3[5] === 63 && r3[6] === 63, JSON.stringify(r3));
    // ⌥ + glisser : au cent près
    const g0 = await geo(0);
    await mouse('mouseMoved', g0.x, g0.y, { buttons: 0, modifiers: 1 }); await mouse('mousePressed', g0.x, g0.y, { modifiers: 1 });
    for (let k = 1; k <= 4; k++) { await mouse('mouseMoved', g0.x, g0.y - g0.row * 0.3 * k / 4, { modifiers: 1 }); await sleep(20); }
    await mouse('mouseReleased', g0.x, g0.y - g0.row * 0.3, { modifiers: 1 }); await sleep(1800);
    const r4 = await J(ev, `const cl=state.project.tracks[2].clips[0]; return cl.tune.edits.map(e=>e.note)`);
    check('⌥ + glisser : note posée au cent près (Do + ~30 ct)', r4.some(n => n > 60.2 && n < 60.4), JSON.stringify(r4));
  }



  // barre : + / − / Tout voir, Écouter ce passage (boucle sur l'écran puis boucle d'avant rendue), Agrandir / Échap
  {
    const clk = (sel) => ev('document.querySelector(".tune-panel ' + sel + '").click()');
    await ev('state.baseCleared = true');
    await clk('.tp-g-zi'); await sleep(150); let v = await J(ev, `const v=document.querySelector('.tune-panel')._trView; return {a:v.a,b:v.b}`);
    check('bouton + : zoom ×2 au centre', Math.abs((v.b - v.a) - 0.5) < 1e-6 && Math.abs(v.a - 0.25) < 1e-6, JSON.stringify(v));
    await clk('.tp-g-zo'); await clk('.tp-g-zi'); await clk('.tp-g-zi'); await clk('.tp-g-all'); await sleep(150);
    v = await J(ev, `const v=document.querySelector('.tune-panel')._trView; return {a:v.a,b:v.b}`);
    check('Tout voir : toute la prise', v.a === 0 && v.b === 1, JSON.stringify(v));
    await clk('.tp-g-zi'); await sleep(150);
    await ev(`state.loop={start:20,end:24}; state.looping=false;`);
    await clk('.tp-g-play'); await sleep(900);
    const pl = await J(ev, `return { playing: state.playing, loop: state.loop, looping: state.looping, ph: state.playhead, txt: document.querySelector('.tune-panel .tp-g-play').textContent }`);
    check('Écouter ce passage : lecture en boucle sur la partie à l\'écran (~1,5 → 4,5 s)', pl.playing && pl.looping && pl.loop.start > 1.2 && pl.loop.start < 1.9 && pl.loop.end > 4.1 && pl.loop.end < 4.8 && /Arrêter/.test(pl.txt), JSON.stringify(pl));
    await clk('.tp-g-play'); await sleep(500);
    const st = await J(ev, `return { playing: state.playing, loop: state.loop, looping: state.looping }`);
    check('2e clic : arrêt et boucle d\'avant rendue', !st.playing && st.loop.start === 20 && st.loop.end === 24 && st.looping === false, JSON.stringify(st));
    await clk('.tp-g-big'); await sleep(300);
    const bg = await J(ev, `const p=document.querySelector('.tune-panel'), r=p.getBoundingClientRect(), t=p.querySelector('.tp-trace').getBoundingClientRect(); return { big: p.classList.contains('tp-big'), w: r.width, iw: innerWidth, th: t.height, bottom: r.bottom, ih: innerHeight }`);
    check('Agrandir : la fenêtre prend l\'écran, tracé plus haut, rien ne dépasse', bg.big && bg.w > bg.iw - 40 && bg.th > 330 && bg.bottom <= bg.ih, JSON.stringify(bg));
    if (process.env.VISU_DIR) await shot(process.env.VISU_DIR + '/tune-big.jpg');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200);
    const es = await J(ev, `const p=document.querySelector('.tune-panel'); return { open: !!p, big: p && p.classList.contains('tp-big') }`);
    check('Échap : la fenêtre revient à sa taille (et reste ouverte)', es.open && !es.big, JSON.stringify(es));
    await clk('.tp-g-all');
  }

  // mêmes gestes que les pistes, après un clic dans le Graphique : E / Z, ⇧F, molette = haut / bas, ⌥ + molette = zoom vertical, ↑ / ↓ = note choisie
  {
    const key = async (k, code, mods = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : (code === 'ArrowUp' ? 38 : 40) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods }); await sleep(250); };
    const V = () => J(ev, `const v=document.querySelector('.tune-panel')._trView; return {a:v.a,b:v.b,vspan:v.vspan||0,vlo:v.vlo||0}`);
    const b = await J(ev, `const r=document.querySelector('.tune-panel .tp-trace canvas').getBoundingClientRect(); return {x:r.left+r.width*0.5,y:r.top+8,cx:r.left+r.width/2,cy:r.top+r.height/2}`);
    await mouse('mouseMoved', b.x, b.y, { buttons: 0 }); await mouse('mousePressed', b.x, b.y); await mouse('mouseReleased', b.x, b.y); await sleep(200);
    const foc = await ev(`document.querySelector('.tune-panel').classList.contains('tp-focus')`);
    await key('e', 'KeyE'); let v = await V();
    check('clic dans le Graphique puis E : c\'est le tracé qui zoome', foc === true && v.b - v.a < 0.85, JSON.stringify({ foc, v }));
    const tlz = await ev('state.pxPerSecond');
    await key('z', 'KeyZ'); await key('z', 'KeyZ'); let v2 = await V();
    check('Z : le tracé dézoome (les pistes ne bougent pas)', v2.b - v2.a > v.b - v.a && (await ev('state.pxPerSecond')) === tlz, JSON.stringify(v2));
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.cx, y: b.cy, deltaX: 0, deltaY: 120 }); await sleep(250); v = await V();
    check('molette : on descend dans les notes (fenêtre de hauteur à la main)', v.vspan > 0, JSON.stringify(v));
    const vs = v.vspan; await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.cx, y: b.cy, deltaX: 0, deltaY: -150, modifiers: 1 }); await sleep(250); v = await V();
    check('⌥ + molette : zoom vertical (moins de demi-tons à l\'écran)', v.vspan > 0 && v.vspan < vs, JSON.stringify({ avant: vs, apres: v.vspan }));
    await key('F', 'KeyF', 8); v = await V();
    check('⇧F : tout voir (temps et hauteur automatique)', v.a === 0 && v.b === 1 && v.vspan === 0, JSON.stringify(v));
    // clic dans la timeline : le logiciel reprend la main (E zoome les pistes)
    const tb = await J(ev, `const r=document.querySelector('.timeline').getBoundingClientRect(); return {x:r.right-60,y:r.bottom-60}`);
    await mouse('mousePressed', tb.x, tb.y); await mouse('mouseReleased', tb.x, tb.y); await sleep(200);
    const z0 = await ev('state.pxPerSecond'); await key('e', 'KeyE'); const z1 = await ev('state.pxPerSecond');
    check('clic sur la timeline puis E : ce sont les pistes qui zooment', z1 > z0 && !(await ev(`document.querySelector('.tune-panel').classList.contains('tp-focus')`)), JSON.stringify({ z0, z1 }));
    // appui sur une note : on entend sa voix (lecture de la prise corrigée)
    await ev(`(()=>{ window.__starts=0; const o=AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start=function(...a){ if (this.buffer && this.buffer.duration > 3) window.__starts++; return o.apply(this,a); }; })()`);
    const g2 = await geo(1);
    await mouse('mouseMoved', g2.x, g2.y, { buttons: 0 }); await mouse('mousePressed', g2.x, g2.y); await sleep(300);
    const st = await ev('window.__starts'); await mouse('mouseReleased', g2.x, g2.y); await sleep(200);
    check('appui sur une note : sa voix se fait entendre', st >= 1, String(st));
    // ↑ : la note choisie monte d'un demi-ton (Ré → Ré#)
    await key('ArrowUp', 'ArrowUp'); await sleep(1800);
    const up = await J(ev, `const tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id); return tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>s.note)`);
    check('↑ : la note choisie monte d\'un demi-ton (Ré → Ré#)', up[1] === 63, JSON.stringify(up));
    await key('Backspace', 'Backspace'); await sleep(1800);
    const back = await J(ev, `const tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id); return tr.notes.filter(s=>s.i1-s.i0>=8).map(s=>s.note)`);
    check('Effacer : la note revient à l\'automatique (Ré)', back[1] === 62, JSON.stringify(back));
  }
  // tête de lecture : clic sur le fond = la lecture part d'ici ; la ligne suit state.playhead
  {
    const b = await J(ev, `const r=document.querySelector('.tune-panel .tp-trace canvas').getBoundingClientRect(); return {x:r.left+r.width*0.5,y:r.top+8}`);
    await mouse('mouseMoved', b.x, b.y, { buttons: 0 }); await mouse('mousePressed', b.x, b.y); await mouse('mouseReleased', b.x, b.y); await sleep(300);
    const ph = await J(ev, `return { ph: state.playhead, v: document.querySelector('.tune-panel')._trView.ph }`);
    check('clic sur le fond : la tête de lecture va au milieu de la voix (~3 s)', ph.ph > 2.5 && ph.ph < 3.5 && ph.v > 0, JSON.stringify(ph));
  }

  // Espace (après un clic dans le tracé) : lecture / arrêt
  {
    const sp = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await sleep(600); return ev('state.playing'); };
    const p1 = await sp(), p2 = await sp();
    check('Espace dans PulseTune : lecture puis arrêt', p1 === true && p2 === false, JSON.stringify([p1, p2]));
  }

  // Crayon : on dessine un glissé Ré → Mi sur la 2e note ; la voix le suit ; double-clic = automatique
  {
    await ev(`(()=>{ const v=document.querySelector('.tune-panel')._trView; v.a=0; v.b=1; v.vspan=0; v.selI=-1; document.dispatchEvent(new CustomEvent('pulse-tune-done')); })()`); await sleep(200);
    await ev(`document.querySelector('.tune-panel .tp-g-pen').click()`);
    const g1 = await geo(1);
    const segX = await J(ev, `const p=document.querySelector('.tune-panel'), cv=p.querySelector('.tp-trace canvas'), r=cv.getBoundingClientRect(), tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id), sg=tr.notes.filter(s=>s.i1-s.i0>=8)[1], f0=tr.f0; let i0=0,i1=f0.length-1; while(!(f0[i0]>0))i0++; while(!(f0[i1]>0))i1--; return { a: r.left+(sg.i0+4-i0)/(i1-i0)*r.width, b: r.left+(sg.i1-4-i0)/(i1-i0)*r.width }`);
    await mouse('mouseMoved', segX.a, g1.y, { buttons: 0 }); await mouse('mousePressed', segX.a, g1.y);
    for (let k = 1; k <= 12; k++) { await mouse('mouseMoved', segX.a + (segX.b - segX.a) * k / 12, g1.y - g1.row * 2 * k / 12); await sleep(15); }
    await mouse('mouseReleased', segX.b, g1.y - g1.row * 2); await sleep(1800);
    await ev(`document.querySelector('.tune-panel .tp-g-pen').click()`);
    const cr = await JA(`const cl=state.project.tracks[2].clips[0], e=(cl.tune.edits||[]).find(x=>x.curve); const b=PulseAudio.getBuffer(cl.id); const f=await PulseTune.trackPitch(b.getChannelData(0), b.sampleRate);
      const at=(t)=>{ const v=[]; for(let i=Math.round((t-0.04)/0.005); i<Math.round((t+0.04)/0.005); i++) if(f[i]>0) v.push(69+12*Math.log2(f[i]/440)); v.sort((a,b)=>a-b); return v[v.length>>1]; };
      return { has: !!e, n: e ? e.curve.length : 0, a: e ? at(e.t0+0.05) : 0, z: e ? at(e.t1-0.06) : 0 }`);
    if (process.env.VISU_DIR) { const b = await J(ev, `const r=document.querySelector('.tune-panel .tp-trace').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}`); const sh = await send('Page.captureScreenshot', { format: 'png', clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1.5 } }); fs.writeFileSync(process.env.VISU_DIR + '/tune-crayon.png', Buffer.from(sh.result.data, 'base64')); }
    check('Crayon : courbe dessinée, la voix glisse de Ré vers Mi', cr.has && cr.n > 5 && Math.abs(cr.a - 62) < 0.4 && Math.abs(cr.z - 64) < 0.4, JSON.stringify(cr));
    const gc = await geo(1);
    await mouse('mousePressed', gc.x, gc.y - gc.row, { clickCount: 1 }); await mouse('mouseReleased', gc.x, gc.y - gc.row, { clickCount: 1 });
    await mouse('mousePressed', gc.x, gc.y - gc.row, { clickCount: 2 }); await mouse('mouseReleased', gc.x, gc.y - gc.row, { clickCount: 2 }); await sleep(1800);
    const gone = await ev(`!(state.project.tracks[2].clips[0].tune.edits||[]).some(x=>x.curve)`);
    check('double-clic sur la courbe : retour à l\'automatique', gone === true, String(gone));
  }

  // à l'horizontale : la 5e note (Fa) glisse de +0,1 s dans le temps ; double-clic = elle revient à sa place
  {
    await ev(`(()=>{ const v=document.querySelector('.tune-panel')._trView; v.a=0; v.b=1; v.vspan=0; v.selI=-1; document.dispatchEvent(new CustomEvent('pulse-tune-done')); })()`); await sleep(200);
    const onset = async () => JA(`const cl=state.project.tracks[2].clips[0], b=PulseAudio.getBuffer(cl.id); const f=await PulseTune.trackPitch(b.getChannelData(0), b.sampleRate); for(let i=Math.round(2.9/0.005); i<f.length; i++) if(f[i]>0 && Math.round(69+12*Math.log2(f[i]/440))===65) return i*0.005; return 0;`);
    const before = await onset();
    const g4 = await geo(4), dx = await J(ev, `const r=document.querySelector('.tune-panel .tp-trace canvas').getBoundingClientRect(), tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id), f0=tr.f0; let i0=0,i1=f0.length-1; while(!(f0[i0]>0))i0++; while(!(f0[i1]>0))i1--; return 0.1/tr.hop/(i1-i0)*r.width`);
    await mouse('mouseMoved', g4.x, g4.y, { buttons: 0 }); await mouse('mousePressed', g4.x, g4.y);
    for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', g4.x + dx * k / 8, g4.y); await sleep(20); }
    await mouse('mouseReleased', g4.x + dx, g4.y); await sleep(1800);
    const mv = await J(ev, `return state.project.tracks[2].clips[0].tune.moves || []`), after = await onset();
    check('↔ : la note glisse de +0,1 s (gardée sur le clip, le son suit)', mv.length === 1 && Math.abs(mv[0].d - 0.1) < 0.02 && Math.abs(after - before - 0.1) < 0.03, JSON.stringify({ mv, before, after }));
    const g4b = await J(ev, `const p=document.querySelector('.tune-panel'), cv=p.querySelector('.tp-trace canvas'), r=cv.getBoundingClientRect(), tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id), sg=tr.notes.filter(s=>s.i1-s.i0>=8)[4], f0=tr.f0, wp=tuneWarp(tr); let i0=0,i1=f0.length-1; while(!(f0[i0]>0))i0++; while(!(f0[i1]>0))i1--; return { x: r.left+((wp.fw(sg.i0)+wp.fw(sg.i1))/2-i0)/(i1-i0)*r.width }`);
    await mouse('mousePressed', g4b.x, g4.y, { clickCount: 1 }); await mouse('mouseReleased', g4b.x, g4.y, { clickCount: 1 });
    await mouse('mousePressed', g4b.x, g4.y, { clickCount: 2 }); await mouse('mouseReleased', g4b.x, g4.y, { clickCount: 2 }); await sleep(1800);
    const back = await J(ev, `return state.project.tracks[2].clips[0].tune.moves || []`), at2 = await onset();
    check('double-clic : la note revient à sa place', back.length === 0 && Math.abs(at2 - before) < 0.02, JSON.stringify({ back, at2, before }));
  }
  if (process.env.VISU_DIR) { await mouse('mousePressed', (await geo(2)).x, (await geo(2)).y); await mouse('mouseReleased', (await geo(2)).x, (await geo(2)).y); await sleep(300); const b = await J(ev, `const r=document.querySelector('.tune-panel').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}`); const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: b.x - 8, y: Math.max(0, b.y - 8), width: b.w + 16, height: Math.min(860, b.h + 16), scale: 1.5 } }); fs.writeFileSync(process.env.VISU_DIR + '/tune-graph-fin.png', Buffer.from(shot.result.data, 'base64')); }
};
