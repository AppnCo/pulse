// QA3 n°5/7/8 : armement exclusif, enregistrement sur piste armée, refaire une prise, volumes par défaut, verrou Shift
import { boot, instru, mouse, pos, key, RAP, INVARIANTS, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, nav } = c; const Ms = mouse(send); const K = key(send);
  const armed = () => ev(`JSON.stringify(state.project.tracks.map((t,i)=>t.armed?t.name:null).filter(Boolean))`);
  // ---- 8. volumes par défaut ----
  await nav('http://localhost:8765/index.html'); await sleep(800);
  console.log('8a. volumes explicites dans les modèles :', await ev(`JSON.stringify(TEMPLATES.map(t=>[t.id, t.tracks.filter(x=>x.volume!==undefined).map(x=>x.name+'='+x.volume), (t.buses||[]).filter(x=>x.volume!==undefined).map(x=>x.id+'='+x.volume)]))`));
  // ---- 5. armement ----
  await boot(c, JSON.parse(JSON.stringify(RAP)));
  console.log('5a. à l\'ouverture :', await armed());
  let p = await pos(ev, '.track-item[data-i="2"] .m-r'); await Ms.click(p.x, p.y); await sleep(150);
  console.log('5b. clic R sur Lead :', await armed());
  p = await pos(ev, '.track-item[data-i="2"] .m-r'); await Ms.click(p.x, p.y); await sleep(150);
  console.log('5c. re-clic R sur Lead (désarme) :', await armed());
  // Dupliquer une piste armée
  await ev(`armTrackExclusive(2); renderTracksPanel(); bindTrackEvents(); duplicateTrack(2)`); await sleep(200);
  console.log('5d. dupliquer la piste armée Lead :', await armed());
  await ev(`undoAction()`); await sleep(100);
  // Dupliquer un groupe dont une piste est armée
  await ev(`armTrackExclusive(2); duplicateGroup('vocal1')`); await sleep(200);
  console.log('5e. dupliquer le groupe Vocal 1 (Lead armée) :', await armed());
  // Ajouter une piste
  await ev(`undoAction()`); await sleep(100);
  // Ouvrir un projet sans piste Rec avec 2 pistes armées (ancien format)
  await boot(c, { id: 'old', name: 'Old', bpm: 100, buses: [], tracks: [{ name: 'A', type: 'audio', armed: true, color: '#A855F7', clips: [] }, { name: 'B', type: 'audio', armed: true, color: '#60A5FA', clips: [] }] });
  console.log('5f. ancien projet sans piste Rec, 2 pistes armées :', await armed());
  // Rec armé sur Lead : où va la prise ?
  await boot(c, JSON.parse(JSON.stringify(RAP)));
  await ev(`armTrackExclusive(2); renderTracksPanel(); bindTrackEvents(); state.playhead=1; updatePlayhead && updatePlayhead();`);
  await ev(`toggleRec()`); await sleep(1800); await ev(`toggleRec ? 0:0`); await K(' '); await sleep(1000);
  const rec1 = await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).map(c=>[String(c.id).slice(0,4),+c.start.toFixed(2),+c.duration.toFixed(2),c.recording?1:0])]).filter(x=>x[1].length))`);
  console.log('5g. prise sur Lead armée :', rec1, ' rec=', await ev('state.recording'), ' lecture=', await ev('state.playing'));
  // Refaire cette prise alors que Rec est armée
  await ev(`armTrackExclusive(1); renderTracksPanel(); bindTrackEvents();`);
  const li = await ev(`state.project.tracks[2].clips.findIndex(c=>String(c.id).startsWith('rec_'))`);
  console.log('5h. index prise sur Lead :', li);
  if (li >= 0) {
    await ev(`redoTake(2, ${li})`); await sleep(1500);
    console.log('5i. après Refaire cette prise : armées=', await armed(), ' rec=', await ev('state.recording'), ' lecture=', await ev('state.playing'), ' playhead=', await ev('+state.playhead.toFixed(2)'));
    await K(' '); await sleep(1200);
    console.log('5j. après arrêt :', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).map(c=>[+c.start.toFixed(2),+c.duration.toFixed(2)]),'takes='+((t.takes||[]).length)]))`));
  }
  // piste armée supprimée -> rien armé -> R
  await boot(c, JSON.parse(JSON.stringify(RAP)));
  await ev(`armTrackExclusive(3); state.selectedTrack=3; deleteSelectedTrack && deleteSelectedTrack()`); await sleep(300);
  console.log('5k. piste armée supprimée :', await armed(), 'pistes=', await ev('state.project.tracks.length'));
};
