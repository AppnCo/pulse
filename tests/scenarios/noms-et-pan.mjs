// Clic = sélectionner la piste, double-clic = renommer ; le rond gauche/droite disparaît quand la piste est basse
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'np1',name:'NP',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100},{name:'Basse',type:'audio',color:'#F472B6',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const pos = JSON.parse(await ev(`JSON.stringify((()=>{ const r=document.querySelector('.track-name[data-i="1"]').getBoundingClientRect(); return {x:r.left+10,y:r.top+r.height/2}; })())`));
  const click = async (n) => { for (let i = 1; i <= n; i++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: i }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: i }); } };
  await click(1); await sleep(150);
  await R('un clic : piste choisie, pas de saisie', `const el=document.querySelector('.track-name[data-i="1"]'); return 'piste='+state.selectedTrack+' (1) édition='+el.classList.contains('editing')+' (false) focus='+(document.activeElement===el)+' (false)'`);
  await ev(`window.__dbl=0; document.addEventListener('dblclick',e=>{window.__dbl++; window.__dblT=e.target.className},true); window.__md=0; document.addEventListener('mousedown',e=>{window.__md++},true)`);
  await click(2); await sleep(150);
  console.log('dblclick reçus:', await ev('window.__dbl+" cible="+window.__dblT+" mousedown="+window.__md'));
  await R('double-clic : édition', `const el=document.querySelector('.track-name[data-i="1"]'); return 'édition='+el.classList.contains('editing')+' (true) focus='+(document.activeElement===el)+' (true)'`);
  await ev(`(()=>{ const el=document.querySelector('.track-name[data-i="1"]'); el.textContent='Basse 808'; el.blur(); })()`); await sleep(150);
  await R('renommée', `return state.project.tracks[1].name+' ; editing retiré='+!document.querySelector('.track-name.editing')`);
  await R('rond gauche/droite visible, plus grand', `const k=document.querySelector('.t-knob'); const r=k.getBoundingClientRect(); return 'taille='+Math.round(r.width)+'x'+Math.round(r.height)+' visible='+(r.width>0)`);
  await ev(`(()=>{ document.querySelectorAll('.track-item').forEach(el=>el.style.setProperty('--track-h','44px')); })()`); await sleep(250);
  await R('piste basse (44 px) : rond caché', `const k=document.querySelector('.t-knob'); return 'caché='+(getComputedStyle(k).display==='none')+' hauteur='+Math.round(document.querySelector('.track-item').getBoundingClientRect().height)`);
  await ev(`(()=>{ document.querySelectorAll('.track-item').forEach(el=>el.style.setProperty('--track-h','90px')); })()`); await sleep(250);
  await R('piste haute (90 px) : rond revient', `const k=document.querySelector('.t-knob'); return 'visible='+(getComputedStyle(k).display!=='none')`);
  await ev(`(()=>{ document.querySelectorAll('.track-item').forEach(el=>el.style.setProperty('--track-h','72px')); })()`); await sleep(250);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/pan.jpg');
  await R('piste normale (72 px) : le rond tient dans la piste', `const it=document.querySelector('.track-item').getBoundingClientRect(), k=document.querySelector('.t-knob').getBoundingClientRect(); return 'dans la piste='+(k.top>=it.top&&k.bottom<=it.bottom)+' ('+Math.round(k.top-it.top)+'→'+Math.round(it.bottom-k.bottom)+' px de marge)'`);
};
