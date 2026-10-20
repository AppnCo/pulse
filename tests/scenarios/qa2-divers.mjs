import { boot, RAP, instru, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot, nav } = c;
  await boot(c, { id: 'dv', name: 'Divers', bpm: 120, buses: [], tracks: [{ name: 'Piste 1', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Piste 2', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Piste 3', type: 'audio', color: '#A855F7', clips: [] }] });
  // noms en double
  await ev(`state.selectedTrack=1; deleteSelectedTrack(); addTrack('audio')`); await sleep(200);
  console.log('noms après suppression de « Piste 2 » + ajout :', await ev(`JSON.stringify(state.project.tracks.map(t=>t.name))`));
  await ev(`addTrack('keys')`); await sleep(500); await ev(`PulsePianoRoll.close(true)`);
  console.log('noms piano :', await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+' / '+(t.clips||[]).map(c=>c.name).join(',')))`));
  // fader master non sauvegardé
  await ev(`PulseAudio.setMasterVolume(60); saveProject()`);
  await nav('http://localhost:8765/studio.html'); await sleep(1500);
  console.log('master après rechargement :', await ev(`PulseAudio.getMasterVolume()`), '| pulse_current_project contient master ?', await ev(`/master/i.test(JSON.stringify(Object.keys(state.project)))`));
  // flash : durée d'affichage de l'avertissement stockage plein
  const dur = await ev(`(async()=>{ const o=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){ if(k==='pulse_current_project') throw new DOMException('full','QuotaExceededError'); return o.call(this,k,v); }; saveProject(); const t0=performance.now(); const el=document.getElementById('flash'); const msg=el.textContent; await new Promise(r=>setTimeout(r,2100)); const vis=getComputedStyle(el).opacity; Storage.prototype.setItem=o; return JSON.stringify({msg, opaciteApres2s:vis}) })()`);
  console.log('stockage plein :', dur);
};
