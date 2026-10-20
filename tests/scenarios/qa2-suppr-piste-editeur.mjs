import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot, logs } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, { id: 'sp', name: 'SupprPiste', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] });
  await ev(`createMidiClip(1,0,true)`); await sleep(700);
  await ev(`deleteSelectedTrack()`); await sleep(300);
  console.log('piste supprimée, éditeur toujours ouvert ?', await ev(`PulsePianoRoll.isOpen()`), '| titre :', await ev(`document.querySelector('.me-title')?.textContent`), '| pistes', await ev(`state.project.tracks.length`));
  // l'éditeur se ferme avec la piste supprimée (voulu) : il n'y a alors plus de grille à cliquer
  const cv = await pos(ev, '.me-cv', 0, 0).catch(() => null);
  if (cv) { await Mo.click(cv.x + 120, cv.y + 120); await sleep(900); }
  console.log('après une note : éditeur ouvert ?', await ev(`PulsePianoRoll.isOpen()`), '|', await ev(`document.getElementById('flash').textContent`));
  const before = logs.length;
  console.log('exceptions', logs.slice(before).join(' | ') || 'aucune');
  // même chose avec ⌘Z (annuler l'ajout du clip)
  await ev(`undoAction()`); await sleep(300);
  console.log('⌘Z :', await ev(`PulsePianoRoll.isOpen()`), await ev(`state.project.tracks.length`));
};
