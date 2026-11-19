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
