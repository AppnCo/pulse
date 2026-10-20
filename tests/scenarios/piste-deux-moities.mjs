// 18/10 : piste coupée en deux (haut = sélection, retire la base ; bas = curseur, pose la base) ; la boucle dessinée part de son début
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'dm',name:'Dm',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (l, c) => console.log(l + ':', await ev(`(async()=>{${c}})()`));
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(150); };
  await R('prépare', `const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*20,ctx.sampleRate); PulseAudio.registerBuffer('dm',b); state.project.tracks[0].clips=[{id:'dm',start:0,duration:20,name:'A'}]; state.snapMode='off'; renderTimelineTracks(); return 'ok'`);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const t=document.querySelector('.timeline').getBoundingClientRect(); const r=document.querySelector('.timeline-track').getBoundingClientRect(); const ru=document.getElementById('timelineRuler').getBoundingClientRect(); return {left:t.left, top:r.top, h:r.height, px:state.pxPerSecond, ry:ru.top+4}})())`));
  const X = (s) => g.left + s * g.px, UP = g.top + g.h * 0.2, LOW = g.top + g.h * 0.8;
  await mouse('mouseMoved', X(9), UP, { buttons: 0 });
  await R('curseur souris moitié HAUTE (flèche attendue)', `const c=document.querySelector('.timeline-track .clip, .timeline-track'); const el=document.elementFromPoint(${X(9)}, ${UP}); return getComputedStyle(el).cursor.slice(0,12)+' <'+el.className.toString().split(' ')[0]+'>'`);
  await mouse('mouseMoved', X(9), LOW, { buttons: 0 }); await sleep(50); await mouse('mouseMoved', X(9.1), LOW, { buttons: 0 });
  await R('curseur souris moitié BASSE (croix attendue)', `const el=document.elementFromPoint(${X(9.1)}, ${LOW}); return getComputedStyle(el).cursor.slice(0,12)+' <'+el.className.toString().split(' ')[0]+'>'`);
  await click(X(3), LOW);
  await R('clic bas à 3 s : base posée', `return JSON.stringify({ph:+state.playhead.toFixed(2), cleared:!!state.baseCleared})`);
  await R('lecture, pause, relance (revient à 3)', `togglePlay(); await new Promise(r=>setTimeout(r,700)); togglePlay(); await new Promise(r=>setTimeout(r,100)); const pausee=+state.playhead.toFixed(2); togglePlay(); await new Promise(r=>setTimeout(r,200)); const rel=+state.playhead.toFixed(2); togglePlay(); return JSON.stringify({pausee, relance:rel})`);
  await click(X(3), LOW);
  await R('lecture puis pause', `togglePlay(); await new Promise(r=>setTimeout(r,700)); togglePlay(); await new Promise(r=>setTimeout(r,100)); return 'arrêt à '+state.playhead.toFixed(2)`);
  const stop = parseFloat(await ev(`state.playhead`));
  await click(X(12), UP);
  await R('clic HAUT à 12 s : base retirée, curseur inchangé', `return JSON.stringify({ph:+state.playhead.toFixed(2), cleared:!!state.baseCleared, origin:state.playOrigin})`);
  await R('relance : reprend là où ça s est arrêté (pas à 3)', `togglePlay(); await new Promise(r=>setTimeout(r,300)); const a=+state.playhead.toFixed(2); togglePlay(); await new Promise(r=>setTimeout(r,100)); togglePlay(); await new Promise(r=>setTimeout(r,200)); const b=+state.playhead.toFixed(2); togglePlay(); return JSON.stringify({pendantLecture:a, apresPauseEtRelance:b})`);
  // boucle depuis la règle
  await click(X(1), g.ry + 8);
  await mouse('mousePressed', X(5), g.ry); await mouse('mouseMoved', X(6.5), g.ry, { buttons: 1 }); await mouse('mouseMoved', X(8), g.ry, { buttons: 1 }); await mouse('mouseReleased', X(8), g.ry); await sleep(200);
  await R('boucle 5→8 depuis la règle, curseur à 1 : il passe au début de la boucle (5)', `return JSON.stringify({loop:[+state.loop.start.toFixed(1), +state.loop.end.toFixed(1)], ph:+state.playhead.toFixed(2)})`);
  await click(X(6), g.ry);
};
