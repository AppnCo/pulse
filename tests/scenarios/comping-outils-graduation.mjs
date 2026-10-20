// 18/10 : comping (option) ; outils Crayon/Pointeur/Gomme du piano roll ; graduation en dB des faders
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_comping','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cp',name:'Cp',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',clips:[],takes:[],takeSeq:2,takesOpen:true}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (l, c) => console.log(l + ':', await ev(`(async()=>{${c}})()`));
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const fmt = `const f=(l,a)=>a.map(c=>l+(c.take?String.fromCharCode(64+c.take):'')+'['+c.start.toFixed(1)+'→'+(c.start+c.duration).toFixed(1)+']').join(' ')`;
  await R('prépare : A devant (0-6 s), B rangée (0-6 s)', `${fmt}; const ctx=await PulseAudio.init(); const mk=(id)=>{const b=ctx.createBuffer(1,ctx.sampleRate*6,ctx.sampleRate); PulseAudio.registerBuffer(id,b); return id}; const t=state.project.tracks[0]; t.clips=[{id:mk('ta'),start:0,duration:6,name:'Voix',take:1}]; t.takes=[{id:mk('tb'),start:0,duration:6,offset:0,take:2}]; t.takesOpen=true; rerenderTracks(); await new Promise(r=>setTimeout(r,300)); return f('devant ',t.clips)+' | '+f('rangé ',t.takes)`);
  const g = JSON.parse(await ev(`JSON.stringify((()=>{const p=document.querySelector('.take-piece[data-pi]').getBoundingClientRect(); return {l:p.left, y:p.top+p.height/2, px:state.pxPerSecond}})())`));
  await mouse('mouseMoved', g.l + 2 * g.px, g.y, { buttons: 0 }); await mouse('mousePressed', g.l + 2 * g.px, g.y); await mouse('mouseMoved', g.l + 3 * g.px, g.y, { buttons: 1 }); await mouse('mouseMoved', g.l + 4 * g.px, g.y, { buttons: 1 }); await mouse('mouseReleased', g.l + 4 * g.px, g.y); await sleep(400);
  await R('glissé de 2 à 4 s sur la prise B : B devant sur 2-4, A autour', `${fmt}; const t=state.project.tracks[0]; return f('devant ',t.clips.slice().sort((a,b)=>a.start-b.start))+' | '+f('rangé ',t.takes.slice().sort((a,b)=>a.start-b.start))`);
  await R('⌘Z annule', `undoAction(); await new Promise(r=>setTimeout(r,300)); ${fmt}; const t=state.project.tracks[0]; return f('devant ',t.clips)+' | '+f('rangé ',t.takes)`);
  // graduation des faders
  await R('mixeur ouvert : graduation sur les faders', `document.getElementById('btnMixer').click(); await new Promise(r=>setTimeout(r,500)); const sc=document.querySelectorAll('#mixerStrips .fader-scale'); return 'échelles mixeur='+sc.length+' | repères='+[...(sc[0]?sc[0].querySelectorAll('i'):[])].map(i=>i.textContent).join(' ')+' | inspecteur='+document.querySelectorAll('#inspector .fader-scale').length`);
  await ev(`document.getElementById('btnMixer').click()`); await sleep(400);
  // outils du piano roll
  await ev(`document.getElementById('btnAddTrack').click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('.track-ctx-menu *')].find(e=>/Piano/.test(e.textContent)&&e.children.length===0||/^Piano/.test(e.textContent.trim())).dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(1200);
  const c = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.me-cv').getBoundingClientRect(); return {l:r.left,t:r.top}})())`));
  const notes = `JSON.stringify(state.project.tracks.at(-1).clips[0].midi.notes.map(n=>n.p+'@'+n.s))`;
  await R('outils présents', `return [...document.querySelectorAll('.me-toolseg button')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join(' ')`);
  await mouse('mouseMoved', c.l + 300, c.t + 200, { buttons: 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', text: '2', windowsVirtualKeyCode: 50 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 }); await sleep(200);
  await R('touche 2 : Pointeur', `return [...document.querySelectorAll('.me-toolseg button')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join(' ')`);
  await mouse('mousePressed', c.l + 300, c.t + 200); await mouse('mouseReleased', c.l + 300, c.t + 200); await sleep(900);
  await R('Pointeur : un simple clic dans le vide ne pose PAS de note', `return ${notes}`);
  await mouse('mousePressed', c.l + 300, c.t + 200, { clickCount: 1 }); await mouse('mouseReleased', c.l + 300, c.t + 200, { clickCount: 1 });
  await mouse('mousePressed', c.l + 300, c.t + 200, { clickCount: 2 }); await mouse('mouseReleased', c.l + 300, c.t + 200, { clickCount: 2 }); await sleep(900);
  await R('Pointeur : un double-clic pose une note', `return ${notes}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '3', code: 'Digit3', text: '3', windowsVirtualKeyCode: 51 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51 }); await sleep(200);
  await mouse('mousePressed', c.l + 300, c.t + 200); await mouse('mouseReleased', c.l + 300, c.t + 200); await sleep(900);
  await R('Gomme : un clic sur la note l efface', `return ${notes}`);
};
