// 29/10 : déposer plusieurs sons = fenêtre « Ajouter les fichiers » comme Logic (nouvelles pistes / une piste / pistes existantes)
export default async ({ ev, nav, sleep, check }) => {
  const setup = async () => {
    await nav('http://localhost:8765/index.html');
    await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ip1',name:'Stems',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',fx:[],clips:[]},{name:'Choeur',type:'audio',color:'#A855F7',fx:[],clips:[]}]})); 1`);
    await nav('http://localhost:8765/studio.html');
    await ev(`(async()=>{ await PulseAudio.init(); window.__mk=(n,sec)=>{ const c=PulseAudio.getContext(),b=c.createBuffer(1,c.sampleRate*sec,c.sampleRate),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.2*Math.sin(i/9); return new File([PulseAudio.audioBufferToWav(b)],n,{type:'audio/wav'}); }; return 1 })()`);
  };
  // dépose 3 fichiers sur la timeline à 2 s, à la hauteur de la 1re piste
  const drop = () => ev(`(()=>{ const dt=new DataTransfer(); [['kick.wav',2],['basse.wav',3],['melo.wav',2]].forEach(([n,s])=>dt.items.add(__mk(n,s)));
    const tl=document.querySelector('.timeline'), tr=document.querySelector('.timeline-track'); const r=tl.getBoundingClientRect(), rr=tr.getBoundingClientRect();
    const x=r.left - tl.scrollLeft + 2*state.pxPerSecond, y=rr.top+rr.height*0.7;
    tr.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:x,clientY:y})); return 1 })()`);
  const choose = (v) => ev(`(()=>{ const m=document.querySelector('.multi-import-modal'); if(!m) return 'pas de fenêtre'; m.querySelector('input[value=${v}]').click(); m.querySelector('.ask-ok').click(); return 'ok' })()`);
  const tracks = () => ev(`JSON.stringify(state.project.tracks.map(t=>({n:t.name,type:t.type,c:(t.clips||[]).map(c=>[c.name,+c.start.toFixed(2)])})))`);

  await setup(); await drop(); await sleep(300);
  check('fenêtre de choix affichée', await ev(`!!document.querySelector('.multi-import-modal')`));
  check('choix « nouvelles pistes »', (await choose('new')) === 'ok'); await sleep(2500);
  let t = JSON.parse(await tracks());
  check('3 pistes créées, toutes à 2 s', t.length === 5 && t.slice(2).every(x => x.c.length === 1 && x.c[0][1] === 2), JSON.stringify(t));
  check('aucune transformée en « Instru »', t.slice(2).every(x => x.type === 'audio'));
  check('une seule annulation remet tout', await ev(`(async()=>{ undoAction(); await new Promise(r=>setTimeout(r,300)); return state.project.tracks.length })()`) === 2);

  await setup(); await drop(); await sleep(300); await choose('one'); await sleep(2500);
  t = JSON.parse(await tracks());
  check('« une seule piste » : 3 régions à la suite', t.length === 3 && t[2].c.map(c => c[1]).join() === '2,4,7', JSON.stringify(t[2]));

  await setup(); await drop(); await sleep(300); await choose('existing'); await sleep(2500);
  t = JSON.parse(await tracks());
  check('« pistes existantes » : Voix, Choeur puis 1 nouvelle', t.length === 3 && t[0].c.length === 1 && t[1].c.length === 1 && t[2].c.length === 1 && t[0].c[0][1] === 2, JSON.stringify(t));

  await setup(); await drop(); await sleep(300);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1`); await sleep(300);
  check('Échap annule sans rien ajouter', await ev(`!document.querySelector('.multi-import-modal') && state.project.tracks.length === 2`));
};
