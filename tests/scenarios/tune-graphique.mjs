// PulseTune, vue Graphique : les notes en blocs ; tirer un bloc pose la note à la main (gardée dans le projet), double-clic = retour à l'automatique
import fs from 'fs';
import { boot, J, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
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
};
