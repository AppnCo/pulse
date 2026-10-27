// Saturation multibande : menu « + Effet », bande de départ, « + » / double-clic = bande libre, styles et variantes, rond, poignées, pente,
// S / M, retirer la bande de départ, auto gain, l'export suit, ⌘Z exact
import { mouse } from './qa-lib.mjs';
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'msf',name:'MSF',bpm:120,sends:[],buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const m = mouse(send);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*6,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++){const t=i/sr; d[i]=0.35*Math.sin(2*Math.PI*200*t)+0.12*Math.sin(2*Math.PI*3000*t);} await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(600);
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="track"] .slot-plus[data-plus="fx"]').click()`); await sleep(200);
  await R('menu', `const it=document.querySelector('.fx-add-menu .fam-fx[data-fx="msat"]'); return 'présent='+!!it`);
  await ev(`document.querySelector('.fx-add-menu .fam-fx[data-fx="msat"]').click()`); await sleep(400);
  await R('ouvert', `const p=document.querySelector('.ms-panel'); p.style.left='20px'; p.style.top='20px'; return 'réglage='+JSON.stringify(state.project.tracks[0].effectParams.msat)+' | '+p.querySelector('.ms-n').textContent+' | panneau='+p.querySelector('.ms-fp .lim-t').textContent`);
  await sleep(200);
  const box = JSON.parse(await ev(`JSON.stringify(document.querySelector('.ms-svg').getBoundingClientRect())`));
  const k = box.width / 900, X = (f) => box.x + Math.log(f / 20) / Math.log(1000) * 846 * k, Yp = (y) => box.y + y * k;
  // le « + » en haut, à 3 kHz
  await m.M('mouseMoved', X(3000), Yp(50), 'none', 0); await sleep(100);
  await R('+ visible', `return !!document.querySelector('.ms-plus')`);
  const plus = JSON.parse(await ev(`JSON.stringify(document.querySelector('.ms-plus circle').getBoundingClientRect())`));
  await m.click(plus.x + plus.width / 2, plus.y + plus.height / 2); await sleep(200);
  await R('bande ajoutée', `const b=state.project.tracks[0].effectParams.msat.bands; return b.map(x=>x.base?'départ':(x.lo+'-'+x.hi)).join(' | ')+' | panneau='+document.querySelector('.ms-fp .lim-t').textContent`);
  // double-clic à 200 Hz = 2e bande
  await m.click(X(200), Yp(200), 1); await m.click(X(200), Yp(200), 2); await sleep(200);
  await R('2e bande', `return state.project.tracks[0].effectParams.msat.bands.map(x=>x.base?'départ':(mbName(x)+' '+x.lo+'-'+x.hi)).join(' | ')`);
  await R('style Lampe, variante Cassée', `[...document.querySelectorAll('.ms-sty')].find(b=>b.dataset.k==='lampe').click(); await new Promise(r=>setTimeout(r,50)); [...document.querySelectorAll('.ms-va span')].find(s=>s.textContent==='Cassée').click(); await new Promise(r=>setTimeout(r,50));
    const b=state.project.tracks[0].effectParams.msat.bands.at(-1); return b.sty+' va='+b.va+' | variantes='+[...document.querySelectorAll('.ms-va span')].map(s=>s.textContent).join(',')`);
  const dot = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.mb-dot[data-i="2"] circle')].at(-1).getBoundingClientRect())`));
  await m.drag(dot.x + dot.width / 2, dot.y + dot.height / 2, dot.x + dot.width / 2 + 40, dot.y + dot.height / 2 - 40, 8); await sleep(150);
  await R('rond tiré', `const b=state.project.tracks[0].effectParams.msat.bands[2]; return b.lo+'-'+b.hi+' Hz, chaleur '+b.heat+' | bouton '+document.querySelector('.ms-fp .pk .pk-v').textContent`);
  await R('pente', `const s=document.querySelector('.ms-slp rect'), r=s.getBoundingClientRect(); s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+5,clientY:r.y+5})); await new Promise(r=>setTimeout(r,50)); return state.project.tracks[0].effectParams.msat.bands[2].slope`);
  await R('S puis M', `const s=document.querySelector('.ms-s[data-i="1"]'); s.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); const a=!!state.project.tracks[0].effectParams.msat.bands[1].solo; document.querySelector('.ms-m[data-i="1"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); const b=state.project.tracks[0].effectParams.msat.bands[1]; const r='solo='+a+' → muet='+!!b.mute+' solo='+!!b.solo; document.querySelector('.ms-m[data-i="1"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); return r`);
  await ev(`(()=>{ const ps=state.project.tracks[0].effectParams.msat.bands; ps[0].heat=80; ps[0].sty='ampli'; ps[0].va=2; refreshPlaybackSoon(); })()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(2000);
  await R('en lecture', `return 'spectre='+!!document.querySelector('.ms-spec')`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/msat.jpg');
  await ev(`togglePlay()`);
  await R('export : ça colore', `const t=state.project.tracks[0], ctx=PulseAudio.getContext(); const hf=async()=>{ const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()), L=x.getChannelData(0); let s=0,e=0; for(let i=48000;i<96000;i++){ const d=L[i]-2*L[i-1]+L[i-2]; s+=d*d; e+=L[i]*L[i]; } return [Math.sqrt(s/48000),Math.sqrt(e/48000)]; };
    const a=await hf(); t.effects=t.effects.filter(e=>e!=='msat'); const z=await hf(); t.effects.push('msat'); return 'aigus ajoutés '+(a[0]/z[0]).toFixed(2)+'× | niveau '+(20*Math.log10(a[1]/z[1])).toFixed(1)+' dB'+((a[0]>z[0]*1.05||Math.abs(20*Math.log10(a[1]/z[1]))>0.5)?' PASS le son change':' FAIL')`);
  await R('retirer la bande de départ', `state.project.tracks[0]; document.querySelector('.mb-col[data-i="0"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0})); await new Promise(r=>setTimeout(r,50)); document.querySelector('.ms-fp .mb-del').click(); await new Promise(r=>setTimeout(r,50));
    return state.project.tracks[0].effectParams.msat.bands.map(x=>x.base?'départ':mbName(x)).join(' | ')+' | '+document.querySelector('.ms-n').textContent+' | message='+!!document.querySelector('.ms-svg text.big')`);
  await R('auto gain', `document.querySelector('.ms-ag').click(); await new Promise(r=>setTimeout(r,50)); const a=state.project.tracks[0].effectParams.msat.ag; document.querySelector('.ms-ag').click(); return 'éteint='+(a===false)+' rallumé='+(state.project.tracks[0].effectParams.msat.ag===undefined)`);
  await R('⌘Z ×3 (auto gain, auto gain, retrait)', `undoAction(); undoAction(); undoAction(); await new Promise(r=>setTimeout(r,100)); return state.project.tracks[0].effectParams.msat.bands.map(x=>x.base?'départ':mbName(x)).join(' | ')`);
};
