// Correctifs issus du rapport QA : routage, export, import, coller, annuler, sauvegarde auto, nom de fichier
import { boot, RAP, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  const bad = [];
  const ok = (cond, label) => { console.log((cond ? '✓ ' : '✗ ') + label); if (!cond) bad.push(label); };
  const J = async (code) => JSON.parse(await ev(`JSON.stringify((()=>{${code}})())`));

  await boot(c, RAP);
  // 1. Sortir Rec d'All Vocal ne laisse aucune sortie dans le vide
  await ev(`removeTrackFromGroup(1)`); await sleep(200);
  ok(await J(`const ids=new Set(state.project.buses.map(b=>b.id)); return state.project.buses.every(b=>!b.output||b.output==='master'||ids.has(b.output))`), 'sortie de Rec : aucun groupe orphelin');
  await ev(`undoAction()`);

  // 3. Queue de reverb quand l'envoi vient d'un groupe
  const dur = await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.2*Math.sin(i/30); PulseAudio.registerBuffer('ton',b);
    const p=state.project; p.tracks[2].clips=[{id:'ton',start:0,duration:1}]; p.tracks.forEach(t=>t.sends={}); p.buses.forEach(g=>g.sends={}); p.buses.find(g=>g.id==='vocal1').sends={revlong:80};
    const w=await PulseAudio.exportWav(p); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); return x.duration })()`);
  ok(dur > 2, `queue de reverb gardée avec un envoi de groupe (${dur.toFixed(2)} s)`);

  // 2. Chaque piste séparée inclut la piste Rec
  await boot(c, RAP);
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr); for(let i=0;i<sr;i++)b.getChannelData(0)[i]=0.2*Math.sin(i/30); PulseAudio.registerBuffer('v',b); state.project.tracks[1].clips=[{id:'v',start:0,duration:1}]; renderAll(); await doExportStems(); })()`);
  await sleep(800);
  ok(await ev(`(window.__dl||[]).some(n=>/Rec/.test(n))`), 'export séparé : la piste Rec est exportée');

  // 5/6. Coller sur la piste choisie ; Suppr n'efface pas un clip qu'on ne voit plus choisi
  await boot(c, { id: 'p', name: 'Été à Mantes', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }, { name: 'B', type: 'audio', color: '#22D3EE', clips: [] }] });
  await instru(ev, 2, 0, 0); await sleep(300);
  await ev(`state.selectedTrack=0; state.selectedClip={trackIdx:0,clipIdx:0}; copySelectedClip&&copySelectedClip()`);
  const hasCopy = await ev(`!!state.clipboard`);
  if (hasCopy) {
    await ev(`selectTrack(1); seekPlayhead(5); pasteClip()`); await sleep(200);
    ok(await J(`return state.project.tracks[1].clips.length===1`), 'coller : la copie arrive sur la piste choisie');
  }
  await ev(`state.selectedClip={trackIdx:0,clipIdx:0}; selectTrack(1)`);
  ok(await ev(`state.selectedClip===null`), 'changer de piste vide la sélection de clip');

  // 7. Dupliquer : copie profonde
  await ev(`state.project.tracks[0].sends={revlong:10}; state.project.tracks[0].effectParams={eq:{a:1}}; duplicateTrack(0)`);
  await ev(`state.project.tracks[1].sends.revlong=99`);
  ok(await ev(`state.project.tracks[0].sends.revlong===10`), 'dupliquer une piste : réglages indépendants');

  // 9/10. Import : tempo inchangé si le projet a déjà du son ; liste mise à jour
  await ev(`state.project.bpm=100`);
  await instru(ev, 8, 2, 0); await sleep(500);
  ok(await ev(`state.project.bpm===100`), 'import : le tempo ne change pas quand il y a déjà du son');

  // 11. BPM invalide : message et valeur remise
  await ev(`(()=>{const i=document.getElementById('bpmInput'); i.value='999'; i.dispatchEvent(new Event('change'))})()`);
  ok(await ev(`document.getElementById('bpmInput').value==='100'`), 'BPM invalide : champ remis à la valeur du projet');

  // 12. ⌘Z avec l'éditeur de notes ouvert : une note à la fois
  await ev(`addTrack('keys')`); await sleep(500);
  ok(await ev(`typeof PulsePianoRoll.undoNote==='function'`), 'éditeur de notes : annulation note par note exposée');

  // 22. Accents dans le nom de fichier
  await ev(`window.__dl=[]; (async()=>{ await exportPulseFile(); })()`); await sleep(500);
  ok(await ev(`(window.__dl||[]).some(n=>/Été_à_Mantes/.test(n))`), 'nom de fichier : accents gardés');

  if (bad.length) throw new Error('Régressions : ' + bad.join(' ; '));
};
