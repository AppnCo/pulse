// Multibande : dans le menu « + Effet », bande créée par double-clic, rond (déplacer / seuil), poignées, modes, solo / muet / ✕,
// la forme bouge pendant la lecture, ⌘Z exact
import { mouse } from './qa-lib.mjs';
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mf',name:'MF',bpm:120,sends:[],buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const m = mouse(send);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++){const t=i/sr; d[i]=0.5*Math.sin(2*Math.PI*250*t)*(0.6+0.4*Math.sin(2*Math.PI*1.5*t))+0.1*Math.sin(2*Math.PI*3000*t);} await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(600);
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="track"] .slot-plus[data-plus="fx"]').click()`); await sleep(200);
  await R('menu + Effet', `const it=document.querySelector('.fx-add-menu .fam-fx[data-fx="mband"]'); return 'présent='+!!it+' texte='+(it&&it.textContent.trim().slice(0,40))`);
  await ev(`document.querySelector('.fx-add-menu .fam-fx[data-fx="mband"]').click()`); await sleep(400);
  await R('ouvert', `const p=document.querySelector('.mb-panel'); if(p){p.style.left='20px'; p.style.top='30px';} return 'fenêtre='+!!p+' effets='+JSON.stringify(state.project.tracks[0].effects)+' bandes='+JSON.stringify(state.project.tracks[0].effectParams.mband)+' | '+(p&&p.querySelector('.mb-n').textContent)`);
  await sleep(200);
  const box = JSON.parse(await ev(`JSON.stringify(document.querySelector('.mb-svg').getBoundingClientRect())`));
  const k = box.width / 900, X = (f) => box.x + Math.log(f / 20) / Math.log(1000) * 850 * k, Yp = (y) => box.y + y * k;
  await m.click(X(250), Yp(150), 1); await m.click(X(250), Yp(150), 2); await sleep(200);
  await R('bande créée', `const b=state.project.tracks[0].effectParams.mband.bands; return JSON.stringify(b)+' | panneau='+[...document.querySelectorAll('.mb-fp .pk-l')].map(e=>e.textContent).join(',')+' | '+document.querySelector('.mb-fp .lim-t').textContent`);
  // le rond : vers la droite (la bande se déplace) et vers le haut (seuil)
  const dot = JSON.parse(await ev(`JSON.stringify(document.querySelector('.mb-dot[data-i="0"] circle:last-child').getBoundingClientRect())`));
  await m.drag(dot.x + dot.width / 2, dot.y + dot.height / 2, dot.x + dot.width / 2 + 60, dot.y + dot.height / 2 - 30, 8); await sleep(150);
  await R('rond tiré', `const b=state.project.tracks[0].effectParams.mband.bands[0]; return b.lo+'-'+b.hi+' Hz, seuil '+b.thr+' | largeur gardée='+(Math.abs(Math.log(b.hi/b.lo)-Math.log(2))<0.02)`);
  const tri = JSON.parse(await ev(`JSON.stringify(document.querySelector('.mb-tri[data-k="hi"] path').getBoundingClientRect())`));
  await m.drag(tri.x + tri.width / 2, tri.y + tri.height / 2, tri.x + tri.width / 2 + 40, tri.y + tri.height / 2, 6); await sleep(150);
  await R('poignée droite', `const b=state.project.tracks[0].effectParams.mband.bands[0]; return b.lo+'-'+b.hi+' Hz'`);
  await R('Remonter', `[...document.querySelectorAll('.mb-md span')].find(s=>s.dataset.v==='e').click(); await new Promise(r=>setTimeout(r,50)); return 'plage='+state.project.tracks[0].effectParams.mband.bands[0].range`);
  await R('Compresser', `[...document.querySelectorAll('.mb-md span')].find(s=>s.dataset.v==='c').click(); await new Promise(r=>setTimeout(r,50)); return 'plage='+state.project.tracks[0].effectParams.mband.bands[0].range`);
  await R('solo puis muet', `document.querySelector('.mb-so').click(); const a=JSON.stringify(state.project.tracks[0].effectParams.mband.bands[0]); document.querySelector('.mb-mu').click(); const b0=state.project.tracks[0].effectParams.mband.bands[0]; const r='solo='+a.includes('"solo":true')+' → muet='+!!b0.mute+' solo='+!!b0.solo; document.querySelector('.mb-mu').click(); return r`);
  // seuil bas pour que la bande travaille, puis lecture
  await ev(`(()=>{const b=state.project.tracks[0].effectParams.mband.bands[0]; b.lo=180; b.hi=360; b.thr=-40; b.range=-10; refreshPlaybackSoon();})()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(2500);
  await R('en lecture', `const p=document.querySelector('.mb-panel'); return 'analyseur='+!!p.querySelector('.mb-spec')+' courbe totale='+!!p.querySelector('.mb-total')`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/mband.jpg');
  await ev(`togglePlay()`);
  // l'export suit : la bande de 250 Hz baisse
  await R('export', `const t=state.project.tracks[0]; const ctx=PulseAudio.getContext(); const lv=async()=>{ const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()), L=x.getChannelData(0); let s=0; for(let i=48000;i<96000;i++) s+=L[i]*L[i]; return Math.sqrt(s/48000); };
    const a=await lv(); t.effects=t.effects.filter(e=>e!=='mband'); const z=await lv(); t.effects.push('mband'); return 'avec '+a.toFixed(4)+' / sans '+z.toFixed(4)+(a<z*0.8?' PASS':' FAIL')`);
  // double-clic ailleurs = 2e bande, puis ✕
  await m.click(X(6000), Yp(150), 1); await m.click(X(6000), Yp(150), 2); await sleep(150);
  await R('2e bande', `return state.project.tracks[0].effectParams.mband.bands.map(b=>mbName(b)+' '+b.lo+'-'+b.hi).join(' | ')+' | affiché '+document.querySelector('.mb-n').textContent`);
  await R('✕', `document.querySelector('.mb-del').click(); await new Promise(r=>setTimeout(r,50)); return state.project.tracks[0].effectParams.mband.bands.length+' bande(s)'`);
  await R('⌘Z', `undoAction(); await new Promise(r=>setTimeout(r,100)); return state.project.tracks[0].effectParams.mband.bands.length+' bande(s)'`);
};
