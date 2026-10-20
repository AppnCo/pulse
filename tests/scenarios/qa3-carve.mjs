// QA3 n°1 : priorité de la région posée (carveBehind) - régions bouclées, autre piste, alt-glisser, coller, MIDI, annuler
import { boot, mouse, pos, key, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const Ms = mouse(send); const K = key(send);
  const proj = (tracks) => ({ id: 'cv', name: 'CV', bpm: 120, buses: [], tracks });
  const dump = (t = 0) => ev(`JSON.stringify(state.project.tracks[${t}].clips.map(c=>[c.name,+c.start.toFixed(2),+c.duration.toFixed(2),c.loopEnd?+c.loopEnd.toFixed(2):null,+(c.offset||0).toFixed(2)]))`);
  const drag = async (t, ci, dxSec, dyPx = 0, mods = 0) => { const p = await pos(c.ev, `.timeline-track[data-i="${t}"] .clip[data-ci="${ci}"]`, 0.5, 0.6); const px = +(await ev('state.pxPerSecond'));
    await Ms.drag(p.x, p.y, p.x + dxSec * px, p.y + dyPx, 8, mods); await sleep(150); };
  const fresh = async (tracks) => { await boot(c, proj(tracks)); await ev(`setSnapMode('off',true)`); };

  // A. Région bouclée (0-2, répétée jusqu'à 6) ; on pose X (2 s) sur la queue de boucle, à 4 s
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [
    { id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 },
    { id: 'b', name: 'X', start: 8, duration: 1, offset: 0 }] }]);
  await drag(0, 1, -4);
  console.log('A. X posée à 4 s sur la queue de la boucle :', await dump());
  // B. région bouclée posée sur une région fixe : l'étendue réelle (loopEnd) recouvre-t-elle ?
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [
    { id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 },
    { id: 'b', name: 'Fond', start: 8, duration: 2, offset: 0 }] }]);
  await drag(0, 0, 7);   // Boucle -> start 7, étendue 7..13 recouvre Fond 8..10
  console.log('B. Boucle (étendue 6 s) posée à 7 s sur Fond 8-10 :', await dump());
  // C. autre piste
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Haut', start: 1, duration: 2, offset: 0 }] },
               { name: 'B', type: 'audio', color: '#60A5FA', clips: [{ id: 'b', name: 'Bas', start: 0, duration: 6, offset: 0 }] }]);
  await drag(0, 0, 0, 80);
  console.log('C. Haut glissé sur la piste B : A=', await dump(0), ' B=', await dump(1), ' sel=', await ev(`JSON.stringify(state.selectedClip)`));
  await K('z', CMD); await sleep(200);
  console.log('C2. après ⌘Z : A=', await dump(0), ' B=', await dump(1));
  // D. alt-glisser = duplique
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Haut', start: 0, duration: 2, offset: 0 }, { id: 'b', name: 'Bas', start: 4, duration: 4, offset: 0 }] }]);
  await drag(0, 0, 5, 0, 1);   // Alt = 1
  console.log('D. alt-glisser Haut de 0 à 5 s sur Bas 4-8 :', await dump());
  await K('z', CMD); await sleep(200);
  console.log('D2. après ⌘Z :', await dump());
  // E. coller sur une autre région : curseur à 5 s
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Petit', start: 0, duration: 2, offset: 0 }, { id: 'b', name: 'Grand', start: 3, duration: 6, offset: 0 }] }]);
  await ev(`state.selectedClip={trackIdx:0,clipIdx:0}; copySelectedClip(); state.playhead=5; state.selectedTrack=0; pasteClip();`);
  console.log('E. collé à 5 s sur Grand 3-9 :', await dump(), ' sel=', await ev(`JSON.stringify(state.selectedClip)`));
  await K('z', CMD); await sleep(200);
  console.log('E2. après ⌘Z :', await dump());
  // F. coller une région bouclée sur une autre
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 }, { id: 'b', name: 'Grand', start: 7, duration: 4, offset: 0 }] }]);
  await ev(`state.selectedClip={trackIdx:0,clipIdx:0}; copySelectedClip(); state.playhead=6; state.selectedTrack=0; pasteClip();`);
  console.log('F. Boucle (0-6) collée à 6 s : étendue 6-12 vs Grand 7-11 :', await dump());
  // G. coller sur la piste choisie (autre piste) : dropped sur une région de B
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Src', start: 0, duration: 2, offset: 0 }] },
               { name: 'B', type: 'audio', color: '#60A5FA', clips: [{ id: 'b', name: 'Cible', start: 0, duration: 6, offset: 0 }] }]);
  await ev(`state.selectedClip={trackIdx:0,clipIdx:0}; copySelectedClip(); state.playhead=2; state.selectedTrack=1; pasteClip();`);
  console.log('G. collé sur B : B=', await dump(1), ' sel=', await ev(`JSON.stringify(state.selectedClip)`));
  // H. MIDI : une région posée sur une autre -> les 2 morceaux partagent-ils l'objet midi ?
  await fresh([{ name: 'P', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }]);
  await ev(`createMidiClip(0,0,true)`); await sleep(400); await ev(`PulsePianoRoll.close(true)`);
  await ev(`(()=>{ const t=state.project.tracks[0]; const c=t.clips[0]; c.midi.notes=[{s:0,d:1,p:60,v:90},{s:2,d:1,p:62,v:90}]; const d=JSON.parse(JSON.stringify(c)); d.start=c.start+c.duration+0.0; d.start=c.start+c.duration; t.clips.push(d); renderTimelineTracks(); })()`);
  console.log('H0. 2 régions MIDI :', await dump());
  await drag(0, 1, -(+(await ev(`state.project.tracks[0].clips[1].duration`)) / 2));
  console.log('H. 2e posée à moitié sur la 1re :', await dump());
  console.log('H. objets midi partagés ?', await ev(`(()=>{const cl=state.project.tracks[0].clips; const o=[]; for(let i=0;i<cl.length;i++)for(let j=i+1;j<cl.length;j++) if(cl[i].midi&&cl[i].midi===cl[j].midi) o.push(i+'='+j); return o.join(',')||'aucun'})()`));
  // I. posée entièrement dans une autre (milieu) -> 2 morceaux
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Large', start: 0, duration: 8, offset: 1, fadeIn: 0.5, fadeOut: 0.5 }, { id: 'b', name: 'Petit', start: 10, duration: 1, offset: 0 }] }]);
  await drag(0, 1, -6);
  console.log('I. Petit posé à 4 s au milieu de Large :', await dump(), ' fades:', await ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>[c.fadeIn||0,c.fadeOut||0]))`));
};
