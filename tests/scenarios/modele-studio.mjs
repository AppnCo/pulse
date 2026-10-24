// Modèle « Studio » (disposition B) + effets ponctuels à la demande
import { instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, nav, send, sleep, check, shot } = c;
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); 1`);
  await nav('http://localhost:8765/index.html');
  await ev(`createProjectFromTemplate('studio')`); await sleep(2500);
  check('projet Studio ouvert', await ev(`state.project.templateId`) === 'studio');
  check('pistes visibles : Prod, REC, Back Auto-Tune, Amb Auto-Tune', await ev(`state.project.tracks.map(t=>t.name).join()`) === 'Prod,REC,Back Auto-Tune,Amb Auto-Tune');
  check('REC passe par Vocal 1 → All Vocal → Mix Bus 1', await ev(`(()=>{ const b=id=>state.project.buses.find(x=>x.id===id); return state.project.tracks[1].output==='vocal1' && b('vocal1').output==='allvocal' && b('allvocal').output==='mixbus1' && b('mixbus1').output==='mixbus2'; })()`));
  check('aucun retour ni bus d’envoi imposé (Ridwane les fera lui-même)', await ev(`projectSends().length + (state.project.buses||[]).filter(b=>b.isAux).length`) === 0);
  check('bouton ✦ sur Vocal 1', await ev(`!!document.querySelector('.group-header[data-bus="vocal1"] .g-spots')`));
  await instru(ev, 6, 1, 0); await sleep(400);
  // Del 1/4 sur 2 s → 3 s : copie, la prise reste entière
  await ev(`state.selection={start:2,end:3,tracks:[1,1]}; addSpotEffect(state.project.buses.find(b=>b.id==='vocal1'),'del14')`); await sleep(300);
  const s1 = await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+':'+t.clips.map(c=>c.start.toFixed(1)+'+'+c.duration.toFixed(1)).join('|')))`);
  check('Del 1/4 : piste créée sous Vocal 1 avec le passage, la prise reste entière', /"Del 1\/4:2.0\+1.0"/.test(s1) && /"REC:0.0\+6.0"/.test(s1), s1);
  check('Del 1/4 : écho seul (voix d’origine 0)', await ev(`state.project.tracks.find(t=>t.spot==='del14').effectParams.delay.dry`) === 0);
  // Pitch − sur 4 s → 5 s : déplacé
  await ev(`state.selection={start:4,end:5,tracks:[1,1]}; addSpotEffect(state.project.buses.find(b=>b.id==='vocal1'),'pitchm')`); await sleep(300);
  const s2 = await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+':'+t.clips.map(c=>c.start.toFixed(1)+'+'+c.duration.toFixed(1)).join('|')))`);
  check('Pitch − : passage déplacé (retiré de la prise)', /"Pitch −:4.0\+1.0"/.test(s2) && /"REC:0.0\+4.0\|5.0\+1.0"/.test(s2), s2);
  await shot(process.env.TMPDIR + '/modele-studio.jpg');
  const wav = await ev(`(async()=>{ const w=await PulseAudio.exportWav(state.project); return w ? w.size : 0 })()`);
  check('export du morceau OK', wav > 100000, wav);
  await ev(`(()=>{ const t=state.project.tracks.find(t=>t.spot==='del14'); pushUndo(); t.clips=[]; renderAll(); })()`); await sleep(200);
  check('piste d’effet vidée : elle disparaît', await ev(`!state.project.tracks.some(t=>t.spot==='del14')`));
  await ev(`undoAction()`); await sleep(200);
  check('⌘Z la remet', await ev(`state.project.tracks.some(t=>t.spot==='del14')`));
  await ev(`clearRangeSelection(); state.selectedClip=null; state.selectedClips=new Set(); addSpotEffect(state.project.buses.find(b=>b.id==='vocal1'),'phone')`); await sleep(100);
  check('sans passage choisi : rien n’est créé', await ev(`!state.project.tracks.some(t=>t.spot==='phone')`));
};
