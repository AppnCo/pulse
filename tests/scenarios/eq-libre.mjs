// EQ libre (points à volonté), fondu qui suit le spectre, dB tapé au clavier
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'eq1',name:'EQ',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const peak = `const ctx=PulseAudio.getContext(); const b=await ctx.decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer()); let m=0; const d=b.getChannelData(0); for(let i=0;i<d.length;i++) m=Math.max(m,Math.abs(d[i]));`;
  await ev(`toggleRec()`); await sleep(1500); await ev(`togglePlay()`); await sleep(500);
  await R('prise faite', `return state.project.tracks[0].clips.length+' clip(s)'`);
  await R('crête sans EQ', `state.project.tracks[0].effects=[]; ${peak} return m.toFixed(4)`);
  await ev(`state.project.tracks[0].effects=['eq']; const a=document.createElement('button'); a.id='tmpAnchor'; a.style.cssText='position:fixed;left:10px;top:10px'; document.body.appendChild(a); openEffectPanel(0,'eq',a)`);
  await sleep(200);
  await R('EQ ouvert : 4 points de départ', `return document.querySelectorAll('.eq-pt').length+' points / courbe='+!!document.querySelector('.eq-svg .viz-line')`);
  await R('double-clic dans le vide = un point en plus', `const svg=document.querySelector('.eq-svg'); const r=svg.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+150,clientY:r.top+40})); await new Promise(r=>setTimeout(r,50)); const b=state.project.tracks[0].effectParams.eq.bands; return document.querySelectorAll('.eq-pt').length+' points, dernier='+JSON.stringify(b[b.length-1])`);
  await R('écrire la fréquence et le gain', `const f=document.querySelector('.eq-f'); f.value='220'; f.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); const g=document.querySelector('.eq-g'); g.value='12'; g.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); const b=state.project.tracks[0].effectParams.eq.bands; return JSON.stringify(b[b.length-1])`);
  await R('+12 dB à 220 Hz à l export', `${peak} return 'crête='+m.toFixed(4)`);
  await R('tirer un point', `const pt=document.querySelector('.eq-pt[data-i="1"]'); const r=document.querySelector('.eq-svg').getBoundingClientRect(); const before=JSON.stringify(state.project.tracks[0].effectParams.eq.bands[1]);
    pt.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.left+200,clientY:r.top+100})); document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+260,clientY:r.top+60})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    await new Promise(r=>setTimeout(r,50)); return before+' → '+JSON.stringify(state.project.tracks[0].effectParams.eq.bands[1])`);
  await R('molette = Q', `const q0=state.project.tracks[0].effectParams.eq.bands[1].q; document.querySelector('.eq-pt[data-i="1"]').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100})); await new Promise(r=>setTimeout(r,30)); return q0.toFixed(2)+' → '+state.project.tracks[0].effectParams.eq.bands[1].q.toFixed(2)`);
  await R('double-clic sur un point = le retirer', `const n=document.querySelectorAll('.eq-pt').length; document.querySelector('.eq-pt[data-i="0"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); return n+' → '+document.querySelectorAll('.eq-pt').length`);
  await R('réinitialiser', `document.querySelector('.eq-panel .fx-reset').click(); await new Promise(r=>setTimeout(r,30)); return document.querySelectorAll('.eq-pt').length+' points, eq='+JSON.stringify(state.project.tracks[0].effectParams.eq)`);
  await R('modèle d EQ : Voix rap', `const sel=document.querySelector('.eq-preset'); sel.value='voix'; sel.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,60)); const b=state.project.tracks[0].effectParams.eq.bands; return b.length+' points : '+b.map(x=>x.type+'@'+x.freq).join(', ')+' ; affichés='+document.querySelectorAll('.eq-pt').length`);
  await ev(`document.querySelector('.eq-panel').remove()`);

  // Fondu : le spectre suit
  await R('fondu : le spectre s amincit', `const c=state.project.tracks[0].clips[0]; const w=(cl)=>{ const h=[...document.createElement('div').children]; const d=document.createElement('div'); d.innerHTML=renderClipWaveform(cl, 400); return [...d.querySelector('path').getAttribute('d').matchAll(/v([0-9.]+)/g)].map(m=>parseFloat(m[1])); };
    c.peaks=c.peaks||new Array(200).fill(0.8); const a=w({...c,fadeIn:0,fadeOut:0}); const b=w({...c,fadeIn:c.duration*0.5,fadeOut:0}); return 'début sans fondu='+a[0].toFixed(1)+' avec fondu='+b[0].toFixed(1)+' milieu='+b[Math.floor(b.length/2)].toFixed(1)`);

  // dB tapé
  await ev(`document.getElementById('btnMixer')?.click()`); await sleep(400);
  await R('clic sur dB, taper -6', `const el=document.querySelector('.mixer-strips .strip[data-kind="track"] .strip-db'); el.click(); const i=el.querySelector('input'); if(!i) return 'pas de champ'; i.value='-6'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await new Promise(r=>setTimeout(r,80)); return 'volume='+state.project.tracks[0].volume+' (-6 dB = 50) affiché='+document.querySelector('.mixer-strips .strip[data-kind="track"] .strip-db').textContent`);
  await R('taper -inf', `const el=document.querySelector('.mixer-strips .strip[data-kind="track"] .strip-db'); el.click(); const i=el.querySelector('input'); i.value='-inf'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await new Promise(r=>setTimeout(r,80)); return 'volume='+state.project.tracks[0].volume`);
};
