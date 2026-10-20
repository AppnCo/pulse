// Aides communes des scénarios QA (ne se lance pas seul)
export async function boot({ ev, nav, send, sleep }, project = null, { mic = true, w = 1440, h = 860, ls = {} } = {}) {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1');
    ${project ? `localStorage.setItem('pulse_current_project', ${JSON.stringify(JSON.stringify(project))});` : ''}
    ${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')}`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  if (mic) await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false);
    window.__dl=[]; const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__dl.push(this.download); return; } return oc.call(this); }; })()`);
}
export const instru = (ev, sec = 6, track = 0, at = 0) => ev(`(async()=>{ const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr*${sec},sr); for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=Math.sin(i/40)*0.3; await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'instru.wav',{type:'audio/wav'}),${track},${at}); return state.project.tracks.length })()`);
export const J = (ev, code) => ev(`JSON.stringify((()=>{${code}})())`).then(s => { try { return JSON.parse(s); } catch { return s; } });
export const SNAP = `JSON.stringify(state.project)`;
export const pos = async (ev, sel, fx = 0.5, fy = 0.5) => JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width*${fx},y:r.top+r.height*${fy},w:r.width,h:r.height}})())`));
export const mouse = (send) => ({
  M: (type, x, y, button = 'left', buttons = type === 'mouseReleased' ? 0 : 1, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount }),
  async click(x, y, cc = 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: cc }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: cc }); },
  async rclick(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 }); },
  async drag(x1, y1, x2, y2, steps = 6, mods = 0) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
    for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, buttons: 1, modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); },
});
export const key = (send) => async (k, mods = 0, code) => { const vk = { Escape: 27, Delete: 46, Backspace: 8, Enter: 13, ' ': 32 }[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || (k.length === 1 ? (k === ' ' ? 'Space' : 'Key' + k.toUpperCase()) : k), windowsVirtualKeyCode: vk, modifiers: mods, text: mods ? undefined : (k.length === 1 ? k : undefined) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || (k.length === 1 ? (k === ' ' ? 'Space' : 'Key' + k.toUpperCase()) : k), windowsVirtualKeyCode: vk, modifiers: mods }); };
export const CMD = 4; // modificateur Meta CDP (Alt=1 Ctrl=2 Meta=4 Shift=8)
export const RAP = { id: 'rap1', name: 'Rap Studio', templateId: 'rap-studio', bpm: 120,
  tracks: [
    { name: 'Instru', type: 'audio', preset: 'instru', output: 'mixbus1', color: '#60A5FA', clips: [] },
    { name: 'Rec', type: 'audio', isCapture: true, armed: true, output: 'allvocal', color: '#F472B6', clips: [] },
    { name: 'Lead', type: 'audio', output: 'vocal1', color: '#A855F7', clips: [] },
    { name: 'Back', type: 'audio', output: 'back', color: '#C084FC', sends: { revlong: 20 }, clips: [] },
    { name: 'Ambiance', type: 'audio', output: 'ambiance', color: '#F0ABFC', sends: { revlong: 25 }, clips: [] }],
  buses: [
    { id: 'vocal1', name: 'Vocal 1', isGroup: true, output: 'allvocal', color: '#A855F7', sound: { preset: 'lead', tone: 0, hold: 35, drive: 0, space: 0, deess: 30 } },
    { id: 'back', name: 'Back', isGroup: true, output: 'allvocal', color: '#C084FC', sound: { preset: 'back', tone: 0, hold: 55, drive: 0, space: 0, deess: 40 } },
    { id: 'ambiance', name: 'Ambiance', isGroup: true, output: 'allvocal', color: '#F0ABFC', sound: { preset: 'adlib', tone: 0, hold: 50, drive: 15, space: 0, deess: 30 } },
    { id: 'allvocal', name: 'All Vocal', isGroup: true, preset: 'bus-allvocal', output: 'mixbus1', color: '#7C3AED', sound: { preset: 'glue', tone: 0, hold: 25, drive: 0, space: 0, deess: 0 } },
    { id: 'mixbus1', name: 'Mix Bus 1', preset: 'bus-mix1', output: 'mixbus2', noFolder: true, row: true, premaster: true, color: '#7C3AED' },
    { id: 'mixbus2', name: 'Mix Bus 2', preset: 'bus-safety', output: 'master', locked: true, hidden: true, effects: ['limit'], color: '#DC2626' }] };
// Contrôle d'invariants du projet : renvoie la liste des anomalies
export const INVARIANTS = `(()=>{ const p=state.project, out=[]; const ids=new Set((p.buses||[]).map(b=>b.id)); ids.add('master');
  const dup=(p.buses||[]).map(b=>b.id).filter((x,i,a)=>a.indexOf(x)!==i); if(dup.length) out.push('ids de groupes en double: '+dup);
  p.tracks.forEach((t,i)=>{ if(!ids.has(t.output||'master')) out.push('piste '+i+' '+t.name+' sortie inconnue '+t.output);
    for (const k of ['volume','pan']) if (t[k]!==undefined && !Number.isFinite(t[k])) out.push('piste '+t.name+' '+k+' non fini '+t[k]);
    (t.clips||[]).forEach((c,j)=>{ for (const k of ['start','duration','offset']) if (c[k]!==undefined && !Number.isFinite(c[k])) out.push('piste '+t.name+' clip '+j+' '+k+'='+c[k]);
      if (c.duration<=0) out.push('clip '+t.name+'#'+j+' durée '+c.duration); if (c.start<0) out.push('clip '+t.name+'#'+j+' début négatif '+c.start); }); });
  (p.buses||[]).forEach(b=>{ if(!ids.has(b.output||'master')) out.push('groupe '+b.id+' sortie inconnue '+b.output); let s=b, n=0; while(s && s.output && s.output!=='master' && n++<50) s=(p.buses||[]).find(x=>x.id===s.output); if(n>=50) out.push('cycle de groupes '+b.id); });
  if (state.selectedTrack<0 || state.selectedTrack>=p.tracks.length) { if (p.tracks.length) out.push('selectedTrack hors limites '+state.selectedTrack); }
  if (!Number.isFinite(state.playhead) || state.playhead<0) out.push('playhead '+state.playhead);
  if (!Number.isFinite(state.pxPerSecond) || state.pxPerSecond<=0) out.push('zoom '+state.pxPerSecond);
  if (!Number.isFinite(p.bpm) || p.bpm<=0) out.push('bpm '+p.bpm);
  return out; })()`;
