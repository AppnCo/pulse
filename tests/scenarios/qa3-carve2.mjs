// QA3 n°1b : régions bouclées déplacées / dupliquées / scindées, MIDI posé au milieu, trim par-dessus un voisin
import { boot, mouse, pos, key, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const Ms = mouse(send); const K = key(send);
  const dump = (t = 0) => ev(`JSON.stringify(state.project.tracks[${t}].clips.map(c=>[c.name,+c.start.toFixed(2),+c.duration.toFixed(2),c.loopEnd?+c.loopEnd.toFixed(2):null,+(c.offset||0).toFixed(2)]))`);
  const fresh = async (tracks) => { await boot(c, { id: 'cv', name: 'CV', bpm: 120, buses: [], tracks }); await ev(`setSnapMode('off',true)`); };
  const drag = async (t, ci, dxSec, dyPx = 0, mods = 0, fx = 0.5) => { const p = await pos(ev, `.timeline-track[data-i="${t}"] .clip[data-ci="${ci}"]`, fx, 0.6); const px = +(await ev('state.pxPerSecond'));
    await Ms.drag(p.x, p.y, p.x + dxSec * px, p.y + dyPx, 8, mods); await sleep(150); };
  // 1. Déplacer une région bouclée de +1 s : la fin de répétition suit-elle ?
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 }] }]);
  await drag(0, 0, 1);
  console.log('1. Boucle 0-2 (répétée jusqu\'à 6) glissée de +1 s :', await dump(), '(attendu : start 1, loopEnd 7)');
  // 2. Menu Dupliquer deux fois sur la même région, avec un voisin collé
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R1', start: 0, duration: 2, offset: 0 }, { id: 'b', name: 'R2', start: 2, duration: 2, offset: 0 }] }]);
  const dup = async () => { const p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="0"]', 0.5, 0.6); await Ms.rclick(p.x, p.y); await sleep(150);
    await ev(`(()=>{ const it=[...document.querySelectorAll('.clip-ctx-menu .ctx-item, .clip-ctx-menu div')].find(e=>e.textContent.trim()==='Dupliquer'); it&&it.click(); })()`); await sleep(150); };
  await dup();
  console.log('2a. Dupliquer R1 (voisin R2 collé) :', await dump());
  await ev(`state.selectedClip={trackIdx:0,clipIdx:0}`); await dup();
  console.log('2b. Dupliquer R1 une 2e fois :', await dump());
  // 3. Dupliquer une région bouclée
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 }] }]);
  await dup();
  console.log('3. Dupliquer une région bouclée 0-2 (jusqu\'à 6) :', await dump());
  // 4. MIDI : petit au milieu d'un grand
  await fresh([{ name: 'P', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }]);
  await ev(`createMidiClip(0,0,true)`); await sleep(400); await ev(`PulsePianoRoll.close(true)`);
  await ev(`(()=>{ const t=state.project.tracks[0]; const c=t.clips[0]; c.midi.notes=[{s:0,d:1,p:60,v:90},{s:2,d:1,p:62,v:90}]; const d=JSON.parse(JSON.stringify(c)); d.start=10; d.duration=0.5; d.midi.beats=1; d.midi.notes=[{s:0,d:1,p:70,v:90}]; t.clips.push(d); renderTimelineTracks(); })()`);
  await drag(0, 1, -9);
  console.log('4. petit MIDI posé à 1 s dans le grand :', await dump());
  console.log('4. morceaux midi partagés ?', await ev(`(()=>{const cl=state.project.tracks[0].clips; const o=[]; for(let i=0;i<cl.length;i++)for(let j=i+1;j<cl.length;j++) if(cl[i].midi&&cl[i].midi===cl[j].midi) o.push(i+'='+j); return o.join(',')||'aucun'})()`));
  await ev(`setBpm ? 0 : 0`);
  await ev(`(()=>{ const i=document.getElementById('bpmInput')||document.querySelector('[id*=bpm]'); return i?i.id:'?' })()`).then(x=>console.log('champ bpm', x));
  // 5. Trim droit d'une région par-dessus sa voisine (glisser le bord)
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R1', start: 0, duration: 2, offset: 0 }, { id: 'b', name: 'R2', start: 3, duration: 2, offset: 0 }] }]);
  { const p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="0"]', 0.99, 0.8); const px = +(await ev('state.pxPerSecond')); await Ms.drag(p.x, p.y, p.x + 2 * px, p.y, 6); await sleep(150); }
  console.log('5. bord droit de R1 tiré de +2 s (sur R2 3-5) :', await dump(), '(sans trim : R1 déborde sous R2 ?)');
  // 6. Trim gauche d'une région sur sa voisine
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R1', start: 0, duration: 2, offset: 0 }, { id: 'b', name: 'R2', start: 3, duration: 2, offset: 1 }] }]);
  { const p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.01, 0.8); const px = +(await ev('state.pxPerSecond')); await Ms.drag(p.x, p.y, p.x - 2 * px, p.y, 6); await sleep(150); }
  console.log('6. bord gauche de R2 tiré de -2 s :', await dump());
  // 7. Scinder une région bouclée (menu), curseur dans le 1er motif
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 }] }]);
  await ev(`state.playhead=1; splitClipAt(0,0,1)`);
  console.log('7. Boucle scindée à 1 s :', await dump());
  await fresh([{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'Boucle', start: 0, duration: 2, offset: 0, loopEnd: 6 }] }]);
  await ev(`splitClipAt(0,0,4)`);
  console.log('7b. Boucle scindée à 4 s (dans la répétition) :', await dump());
};
