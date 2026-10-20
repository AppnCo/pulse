// Sauvegarde : rechargement de page, export .pulse puis réouverture après effacement des sons du navigateur
import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, nav } = c;
  const proj = JSON.parse(JSON.stringify(RAP));
  proj.tracks.push({ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', output: 'master', clips: [] });
  proj.name = 'Été à Mantes';
  await boot(c, proj);
  await instru(ev, 6, 0, 0); await instru(ev, 3, 2, 1);
  await ev(`createMidiClip(5, 0)`); await sleep(1200);
  await ev(`(()=>{ const S=PulsePianoRoll._state(); S.notes.push({s:0,d:1,p:60,v:100},{s:1,d:1,p:64,v:90}); S.dirty=true; PulsePianoRoll.flush(); })()`); await sleep(1500);
  await ev(`PulsePianoRoll.close(true)`);
  await ev(`(()=>{ const t=state.project.tracks[2]; t.effectParams={eq:{bands:[{type:'bell',f:900,gain:4,q:1.2,on:true}]}, comp:{thresh:-20,ratio:3}}; t.effects=['eq','comp']; t.volume=77; t.pan=-30; t.sends={revlong:35}; t.muted=false;
    busById('vocal1').volume=90; busById('vocal1').pan=20; state.project.lyrics='Ligne 1\\nLigne 2 é à ç'; state.project.markers=[{time:2,name:'Couplet'}]; state.project.bpm=97; state.project.key={tonic:2,minor:true}; saveProject(); })()`);
  await sleep(1200);
  const norm = `(()=>{ const p=JSON.parse(JSON.stringify(state.project)); delete p.lastOpen; p.tracks.forEach(t=>(t.clips||[]).forEach(c=>{ c.peaks=c.peaks?c.peaks.length:0; })); return JSON.stringify(p); })()`;
  const before = await ev(norm);
  await nav('http://localhost:8765/studio.html'); await sleep(1800);
  const after = await ev(norm);
  const diff = (a, b) => { const A = JSON.parse(a), B = JSON.parse(b), out = []; const walk = (x, y, path) => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path + '.' + k); } else out.push(path + ': ' + JSON.stringify(x)?.slice(0, 60) + ' -> ' + JSON.stringify(y)?.slice(0, 60)); }; walk(A, B, ''); return out; };
  console.log('rechargement : différences =', JSON.stringify(diff(before, after)));
  console.log('sons présents:', await ev(`state.project.tracks.flatMap(t=>t.clips||[]).map(c=>c.id.slice(0,8)+':'+PulseAudio.hasBuffer(c.id)).join(' ')`));
  // export .pulse
  await ev(`window.__blob=null; const o=triggerDownload; window.triggerDownload=function(b,n){ window.__blob=b; window.__bn=n; }; 0`);
  await ev(`(async()=>{ const orig=URL.createObjectURL; const a=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__bn=this.download; fetch(this.href).then(r=>r.blob()).then(b=>{window.__blob=b;}); return;} return a.call(this); }; })()`);
  await ev(`exportPulseFile()`); await sleep(2500);
  console.log('fichier:', await ev(`window.__bn+' '+(window.__blob&&window.__blob.size)`), 'flash=', await ev(`document.getElementById('flash').textContent`));
  const b64 = await ev(`new Promise(r=>{const fr=new FileReader(); fr.onload=()=>r(fr.result.split(',')[1]); fr.readAsDataURL(window.__blob)})`);
  // on efface tous les sons du navigateur et le projet courant
  await ev(`(async()=>{ const dbs=await indexedDB.databases(); for (const d of dbs) await new Promise(r=>{const q=indexedDB.deleteDatabase(d.name); q.onsuccess=q.onerror=q.onblocked=()=>r();}); localStorage.removeItem('pulse_current_project'); localStorage.removeItem('pulse_autosave'); })()`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  console.log('après effacement: pistes=', await ev(`state.project.tracks.map(t=>t.name).join(',')`));
  await ev(`(async()=>{ const bin=atob(${JSON.stringify(b64)}); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); window.__f=new File([u],'Ete.pulse'); })()`);
  await ev(`openPulseFileInStudio(window.__f)`); await sleep(3500);
  const after2 = await ev(norm);
  console.log('réouverture : différences =', JSON.stringify(diff(before, after2)));
  console.log('sons présents:', await ev(`state.project.tracks.flatMap(t=>t.clips||[]).map(c=>c.id.slice(0,8)+':'+PulseAudio.hasBuffer(c.id)).join(' ')`));
};
