// Retour terrain 17/10 : plage sur plusieurs pistes / Shift+clic -> déplacer, volume, direction agissent sur tout
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  const mk = (n, c) => ({ name: n, type: 'audio', color: c });
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sm1',name:'Sel',bpm:120,buses:[{id:'grp_a',name:'Groupe A',isGroup:true,output:'master',volume:100}],tracks:[${JSON.stringify(mk('A', '#A855F7'))},${JSON.stringify(mk('B', '#60A5FA'))},${JSON.stringify(mk('C', '#34D399'))}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' && !extra.down ? 0 : 1, clickCount: 1, ...extra });
  await R('prépare', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.2*Math.sin(2*Math.PI*220*i/sr); PulseAudio.registerBuffer('sm',b); state.project.tracks.forEach(t=>{t.clips=[{id:'sm',start:2,duration:3,name:t.name}]}); state.snapMode='off'; renderTimelineTracks(); return state.pxPerSecond`);
  const geo = JSON.parse(await ev(`JSON.stringify((()=>{const tl=document.querySelector('.timeline').getBoundingClientRect(); const rows=[...document.querySelectorAll('.timeline-track')].map(r=>r.getBoundingClientRect()); return {left:tl.left, px:state.pxPerSecond, rows:rows.map(r=>({top:r.top,h:r.height}))}})())`));
  const X = (sec) => geo.left + sec * geo.px;
  const Y = (i, f = 0.9) => geo.rows[i].top + geo.rows[i].h * f;
  // 1. plage glissée de la piste A à la piste C, depuis un endroit vide (avant les régions)
  await mouse('mouseMoved', X(0.5), Y(0, 0.9)); await mouse('mousePressed', X(0.5), Y(0, 0.9));
  await mouse('mouseMoved', X(3), Y(1, 0.9), { down: true }); await mouse('mouseMoved', X(6), Y(2, 0.9), { down: true }); await mouse('mouseReleased', X(6), Y(2, 0.9)); await sleep(300);
  await R('plage : régions choisies', `return [...state.selectedClips].sort().join(' ')+' | plage='+!!state.selection`);
  // 2. on saisit la région de la piste B et on la tire de 1 s
  const cy = Y(1, 0.7);
  await mouse('mouseMoved', X(3.5), cy); await mouse('mousePressed', X(3.5), cy);
  await mouse('mouseMoved', X(3.9), cy, { down: true }); await mouse('mouseMoved', X(4.5), cy, { down: true }); await mouse('mouseReleased', X(4.5), cy); await sleep(300);
  await R('déplacement groupé (+1 s attendu partout)', `return state.project.tracks.map(t=>t.clips.map(c=>c.start.toFixed(2)).join(',')).join(' | ')`);
  // 3. volume de plusieurs régions
  await R('gain groupé', `const acted=clipsActedOn(1,0); return 'régions concernées='+acted.length`);
  // 4. pistes choisies : fader et direction
  await R('pistes choisies', `state.selectedTracks=new Set([0,1,2]); state.selectedTrack=0; renderTracksPanel(); bindTrackEvents(); renderInspector(); return selectedTrackIdxs().join(',')`);
  await R('fader : -6 dB sur la piste affichée', `const f=document.querySelector('.insp-fader'); f.value=volToPos(50); f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); return state.project.tracks.map(t=>t.volume).join(',')+' (attendu 50,50,50)'`);
  await R('direction vers Groupe A', `const b=document.querySelector('.insp-output'); b.click(); await new Promise(r=>setTimeout(r,100)); const it=[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes('Groupe A')); it.click(); await new Promise(r=>setTimeout(r,200)); return state.project.tracks.map(t=>t.output).join(',')`);
};
