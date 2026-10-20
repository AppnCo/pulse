// Annuler / rétablir après chaque type d'action : l'état revient-il exactement ?
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 'u1', name: 'U', bpm: 120, buses: [{ id: 'g1', name: 'Voix', isGroup: true, output: 'master', color: '#A855F7', volume: 100 }, { id: 'g2', name: 'Fx', isGroup: true, output: 'master', color: '#22D3EE', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', volume: 80, output: 'g1', clips: [] }, { name: 'B', type: 'audio', color: '#22D3EE', volume: 80, output: 'g1', clips: [] }, { name: 'C', type: 'audio', color: '#34D399', volume: 80, output: 'master', clips: [] }, { name: 'D', type: 'audio', color: '#F472B6', volume: 80, output: 'master', clips: [] }] });
  await instru(ev, 6, 0, 0); await instru(ev, 4, 2, 1);
  await sleep(300);
  const strip = `(()=>{ const p=JSON.parse(JSON.stringify(state.project)); delete p.lyrics; return JSON.stringify(p); })()`;
  const actions = {
    'ajouter piste voix': `_doAddTrack('audio')`,
    'ajouter piano': `_doAddTrack('keys')`,
    'ajouter batterie': `_doAddTrack('drums')`,
    'dupliquer piste A': `duplicateTrack(0)`,
    'supprimer piste D': `state.selectedTrack=3; state.selectedTracks=new Set(); deleteSelectedTrack()`,
    'supprimer piste avec clip C': `state.selectedTrack=2; state.selectedTracks=new Set(); deleteSelectedTrack()`,
    'créer groupe avec C': `createGroupWithTrack(2)`,
    'C dans groupe g1': `moveTrackToGroup(2,'g1')`,
    'D dans groupe g2': `moveTrackToGroup(3,'g2')`,
    'wrapGroup g1': `wrapGroup('g1')`,
    'g2 dans g1': `moveGroupInto('g2','g1')`,
    'dupliquer groupe g1': `duplicateGroup('g1')`,
    'sortir A du groupe': `removeTrackFromGroup(0)`,
    'dissoudre g1': `dissolveGroup('g1')`,
    'couper clip A au curseur': `state.playhead=2; state.selectedTrack=0; state.selectedClip={trackIdx:0,clipIdx:0}; state.selectedClips=new Set(['0:0']); trimAtPlayhead('left')`,
    'split clip': `splitClipAt(0,0,2)`,
    'supprimer clip': `state.selectedClip={trackIdx:0,clipIdx:0}; state.selectedClips=new Set(['0:0']); deleteSelectedClip()`,
    'copier-coller clip': `state.selectedClip={trackIdx:0,clipIdx:0}; state.selectedClips=new Set(['0:0']); copySelectedClip(); state.playhead=3; state.selectedTrack=1; pasteClip()`,
    'muet piste': `toggleMute(0)`,
    'solo piste': `toggleSolo(1)`,
    'volume piste 0 (via pushUndo + slider)': `pushUndo(); state.project.tracks[0].volume=40; renderAll()`,
    'bpm': `pushUndo(); state.project.bpm=100; renderAll()`,
    'ajouter marqueur': `addMarker(2)`,
    'ajouter envoi': `addSend('reverb')`,
    'son de piste voix': `applySound(state.project.tracks[0])`,
  };
  for (const [label, code] of Object.entries(actions)) {
    await ev(`localStorage.setItem('x','1')`);
    const r = await ev(`(async()=>{ try{
      const before=${strip}; const u0=_undoStack.length;
      ${code};
      await new Promise(r=>setTimeout(r,150));
      const after=${strip}; const u1=_undoStack.length;
      const changed = before!==after;
      let msg = 'changé='+changed+' undo+'+(u1-u0);
      if (u1>u0) { undoAction(); await new Promise(r=>setTimeout(r,80)); const b2=${strip}; msg += ' undo-exact='+(b2===before);
        if (b2!==before) { const pa=JSON.parse(before), pb=JSON.parse(b2); const diff=[]; for (const k of new Set([...Object.keys(pa),...Object.keys(pb)])) if (JSON.stringify(pa[k])!==JSON.stringify(pb[k])) diff.push(k); msg+=' diff='+diff.join(','); }
        redoAction(); await new Promise(r=>setTimeout(r,80)); const a2=${strip}; msg += ' redo-exact='+(a2===after);
        undoAction(); await new Promise(r=>setTimeout(r,80));
      } else if (changed) { msg += ' !!PAS-D-ANNULATION'; }
      // remet l'état d'origine
      state.project = JSON.parse(before); renderAll();
      return msg; } catch(e){ return 'EXC '+e.message } })()`);
    console.log(label.padEnd(40), r);
  }
};
