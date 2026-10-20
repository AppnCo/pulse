// Éditeur de notes : la région disparaît pendant qu'une note est en attente de validation, puis Échap
import { boot, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, logs } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, { id: 'cc', name: 'Crash', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] });
  await ev(`createMidiClip(0,0,true)`); await sleep(700);
  const cv = await pos(ev, '.me-cv', 0, 0);
  await Mo.click(cv.x + 100, cv.y + 120);              // pose une note : validation dans 350 ms
  await ev(`state.project.tracks[0].clips.length=0; renderAll()`);   // la région disparaît (suppression, annulation…)
  const before = logs.length;
  await Mo.M('mouseMoved', cv.x + 300, cv.y + 100);
  await K('Escape'); await sleep(600);
  console.log('exceptions nouvelles :', logs.slice(before).join(' | ') || 'aucune', '| éditeur ouvert :', await ev(`PulsePianoRoll.isOpen()`));
  console.log('clavier ensuite : lecture →', await (async()=>{ await K(' '); await sleep(200); return ev(`state.playing`) })());
};
