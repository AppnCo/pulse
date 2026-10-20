import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, { id: 'd1', name: 'Beat', bpm: 100, buses: [], tracks: [{ name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#7C3AED', clips: [] }] });
  await ev(`createMidiClip(0,0,true)`); await sleep(800);
  const cv = await pos(ev, '.me-cv', 0, 0);
  const S = JSON.parse(await ev(`JSON.stringify((()=>{const s=PulsePianoRoll._state(); return {pxBeat:s.pxBeat,sx:s.sx,rh:s.stepRowH,view:s.view,h:s.h,w:s.w}})())`));
  console.log('S', JSON.stringify(S), 'cv', JSON.stringify(cv));
  const LW = 66 + 44, RULER = 22;
  const stepXY = (lane, step) => ({ x: cv.x + LW + (step / 4) * S.pxBeat + S.pxBeat / 8 - S.sx, y: cv.y + RULER + lane * S.rh + S.rh / 2 });
  // kick pas 0,8 ; hi-hat (lane 4) pas 0,2,4,6
  for (const [l, s] of [[0, 0], [0, 8], [4, 0], [4, 2], [4, 4], [4, 6], [1, 4]]) { const p = stepXY(l, s); await Mo.click(p.x, p.y); await sleep(60); }
  const notes = async () => ev(`JSON.stringify(PulsePianoRoll._state().notes.map(n=>[n.p,n.s]))`);
  console.log('notes', await notes());
  // glisser pour peindre tout un rang
  const a = stepXY(5, 0), b = stepXY(5, 15); await Mo.drag(a.x, a.y, b.x, b.y, 10);
  console.log('après peinture rang 5', await ev(`PulsePianoRoll._state().notes.filter(n=>n.p===46).length`));
  // ⌘A puis flèche haut
  await Mo.M('mouseMoved', cv.x + 300, cv.y + 100);
  await K('a', CMD); await K('ArrowUp'); await sleep(100);
  console.log('après ⌘A + ↑', await ev(`JSON.stringify([...new Set(PulsePianoRoll._state().notes.map(n=>n.p))])`));
  await shot('/private/tmp/claude-501/qa/pas-1.jpg');
  // Annuler dans l'éditeur 
  await K('z', CMD); await sleep(100);
  console.log('après ⌘Z', await ev(`JSON.stringify([...new Set(PulsePianoRoll._state().notes.map(n=>n.p))])`));
  // Raccourcir à 1 mesure puis ajouter longueur
  await ev(`document.querySelector('.me-longer').click(); document.querySelector('.me-longer').click()`); await sleep(100);
  console.log('longueur', await ev(`document.querySelector('.me-len-n').textContent`));
  // Échap
  await K('Escape'); await sleep(500);
  console.log('région', await ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>[c.start,c.duration,c.midi.beats,c.midi.notes.length]))`));
  // Lecture de la région : audible ? rendu offline
  const pk = await ev(`(async()=>{ const w=await PulseAudio.exportWav(state.project); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const d=x.getChannelData(0); let m=0; for(let i=0;i<d.length;i++) m=Math.max(m,Math.abs(d[i])); return [x.duration,m] })()`);
  console.log('export', JSON.stringify(pk));
};
