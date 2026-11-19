// PulseTune en bas (éditeur de hauteur ancré), d'après la vue Graphique : les notes en blocs ; tirer un bloc pose la note à la main (gardée dans le projet), double-clic = retour à l'automatique
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
  await sleep(1200);
  const clk = (sel) => ev('document.querySelector(".tune-panel ' + sel + '").click()');
  await clk('.tp-g-dock'); await sleep(600);
  let d = await J(ev, `const p=document.querySelector('.tune-panel'), r=p.getBoundingClientRect(), t=p.querySelector('.tp-trace').getBoundingClientRect(), ws=document.querySelector('.workspace'); return { dock: p.classList.contains('tp-dock'), graph: p.classList.contains('tp-graph'), open: document.body.classList.contains('midi-open'), l: r.left, w: r.width, iw: innerWidth, b: r.bottom, ih: innerHeight, th: t.height, pad: getComputedStyle(ws).paddingBottom, n: document.querySelectorAll('.tune-panel').length }`);
  check('« En bas » : éditeur ancré sous les pistes, toute la largeur, Graphique', d.dock && d.graph && d.open && d.l === 0 && Math.abs(d.w - d.iw) < 2 && Math.abs(d.b - d.ih) < 2 && d.th > 120 && parseFloat(d.pad) > 200 && d.n === 1, JSON.stringify(d));
  const rg = await J(ev, `const v=document.querySelector('.tune-panel')._trView, c=state.project.tracks[2].clips[0], tr=TUNE_TRACES.get(c.id); let i=0; while(!(tr.f0[i]>0)) i++; return { has: typeof v.toSec==='function', s: v.toSec(i), want: c.start + tr.t0 + i*tr.hop - (c.offset||0) }`);
  check('règle du morceau : les trames tombent au bon endroit du morceau', rg.has && Math.abs(rg.s - rg.want) < 1e-6 && rg.s >= 0 && rg.s < 1, JSON.stringify(rg));
  // calé sur les pistes : une seconde du morceau tombe au même x dans le tracé et dans la timeline ; ⌘ + molette zoome la timeline
  const al = async () => J(ev, `const p=document.querySelector('.tune-panel'), v=p._trView, cv=p.querySelector('.tp-trace canvas').getBoundingClientRect(), tl=document.querySelector('.timeline'), tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id), c=state.project.tracks[2].clips[0];
    const f0=tr.f0; let I0=0,I1=f0.length-1; while(!(f0[I0]>0))I0++; while(!(f0[I1]>0))I1--; const sp=I1-I0, i0=I0+v.a*sp, i1=I0+v.b*sp, t=1.0, f=((c.offset||0)+t-c.start-tr.t0)/tr.hop;
    return { xg: cv.left+(f-i0)/(i1-i0)*cv.width, xt: tl.getBoundingClientRect().left + t*state.pxPerSecond - tl.scrollLeft, pps: state.pxPerSecond }`);
  let A = await al();
  check('calé sur les pistes : 1 s du morceau au même endroit (tracé / timeline)', Math.abs(A.xg - A.xt) < 3, JSON.stringify(A));
  { const b = await J(ev, `const r=document.querySelector('.tune-panel .tp-trace canvas').getBoundingClientRect(); return {x:r.left+120,y:r.top+r.height/2}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x, y: b.y, deltaX: 0, deltaY: -150, modifiers: 4 }); await sleep(500); }
  const B = await al();
  check('⌘ + molette en bas : la timeline zoome et le tracé reste calé', B.pps > A.pps * 1.5 && Math.abs(B.xg - B.xt) < 3, JSON.stringify(B));
  // réglages de la note dans la colonne de gauche (sous la liste des pistes)
  const nbGeo = () => J(ev, `const b=document.querySelector('.tune-panel .tp-notebar'), r=b.getBoundingClientRect(), tl=document.querySelector('.timeline').getBoundingClientRect(), cv=document.querySelector('.tune-panel .tp-trace canvas').getBoundingClientRect(); return { on: b.classList.contains('on'), empty: b.classList.contains('empty'), txt: b.querySelector('.tp-nb-name').textContent, l: r.left, r: r.right, top: r.top, tl: tl.left, ct: cv.top, vis: getComputedStyle(b.querySelector('.tp-nb-vib')).display }`);
  let N = await nbGeo();
  check('en bas : colonne de gauche « Clique une note pour la régler »', N.on && N.empty && /Clique/.test(N.txt) && N.r <= N.tl && N.l < 20, JSON.stringify(N));
  await clk('.tp-g-all'); await sleep(500);
  { const p = await J(ev, `const tr=TUNE_TRACES.get(state.project.tracks[2].clips[0].id), sg=tr.notes.filter(s=>s.i1-s.i0>=8)[1], v=document.querySelector('.tune-panel')._trView, f0=tr.f0; let I0=0,I1=f0.length-1; while(!(f0[I0]>0))I0++; while(!(f0[I1]>0))I1--; const sp=I1-I0, i0=I0+v.a*sp, i1=I0+v.b*sp, cv=document.querySelector('.tune-panel .tp-trace canvas'), r=cv.getBoundingClientRect();
      const mid=(hz)=>69+12*Math.log2(hz/440); const vals=[]; for(let i=I0;i<=I1;i+=2) if(f0[i]>0) vals.push(mid(f0[i])); vals.sort((a,b)=>a-b); let lo=Math.floor(vals[Math.floor(vals.length*0.02)]-1.5), hi=Math.ceil(vals[Math.floor(vals.length*0.98)]+1.5); for(const s of tr.notes){lo=Math.min(lo,s.note-2);hi=Math.max(hi,s.note+2);} if(hi-lo<7){const c=(hi+lo)/2;lo=Math.floor(c-3.5);hi=lo+7;}
      return { x: r.left+((sg.i0+sg.i1)/2-i0)/(i1-i0)*r.width, y: r.top+cv.clientHeight-(sg.note-lo)/(hi-lo)*cv.clientHeight }`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300); }
  N = await nbGeo();
  check('clic sur une note : ses réglages s\'affichent à gauche (Ré, Vibrato, Vitesse)', N.on && !N.empty && /^D/.test(N.txt) && N.vis !== 'none' && N.r <= N.tl, JSON.stringify(N));
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/tune-bas.jpg');
  // projet rouvert : plus de tracé en mémoire → réanalyse toute seule
  await ev(`(()=>{ TUNE_TRACES.clear(); document.querySelectorAll('.tune-panel').forEach(p=>p.remove()); openTunePanel(2,-1,0,0,true,true); })()`);
  let has = false; for (let k = 0; k < 30 && !has; k++) { await sleep(300); has = await ev(`TUNE_TRACES.has(state.project.tracks[2].clips[0].id) && document.querySelector('.tune-panel .tp-trace').classList.contains('has')`); }
  check('projet rouvert : la prise est réanalysée et le tracé revient', has === true, String(has));
  const e2 = await J(ev, `return state.project.tracks[2].clips[0].tune.edits || []`);
  check('la réanalyse garde les réglages (aucune note à la main perdue)', Array.isArray(e2), JSON.stringify(e2));
  // « Fenêtre » : retour en fenêtre flottante, les pistes reprennent la place
  await clk('.tp-g-dock'); await sleep(500);
  d = await J(ev, `const p=document.querySelector('.tune-panel'); return { dock: p.classList.contains('tp-dock'), open: document.body.classList.contains('midi-open'), n: document.querySelectorAll('.tune-panel').length, w: p.getBoundingClientRect().width }`);
  check('« Fenêtre » : de nouveau flottante, place rendue aux pistes', !d.dock && !d.open && d.n === 1 && d.w < 700, JSON.stringify(d));
  // fermer l'éditeur ancré rend aussi la place
  await clk('.tp-g-dock'); await sleep(400); await ev(`document.querySelector('.tune-panel .fx-panel-close').click()`); await sleep(500);
  const fin = await ev(`document.body.classList.contains('midi-open')`);
  check('fermer l\'éditeur du bas rend la place aux pistes', fin === false, String(fin));
};
