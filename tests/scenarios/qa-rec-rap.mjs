// Modèle Rap Studio : instru -> R -> arrêt -> 2e prise -> annuler -> export
import { boot, instru, RAP, key, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  const K = key(send);
  await instru(ev, 8, 0, 0); await sleep(300);
  const info = () => ev(`JSON.stringify({rec:state.recording,play:state.playing,ph:+state.playhead.toFixed(2),pistes:state.project.tracks.map(t=>t.name+':'+(t.clips||[]).filter(c=>!c.recording).map(c=>c.start.toFixed(1)+'+'+c.duration.toFixed(1)).join('|')+(t.takes&&t.takes.length?' takes='+t.takes.length:'')), undo:_undoStack.length})`);
  await K('r'); await sleep(2500);
  console.log('R 2.5 s:', await info());
  await shot('/private/tmp/claude-501/qa/rap-rec.jpg');
  await K(' '); await sleep(800);
  console.log('Espace:', await info(), 'flash=', await ev(`document.getElementById('flash').textContent`));
  await shot('/private/tmp/claude-501/qa/rap-rec2.jpg');
  // 2e prise par-dessus
  await K('r'); await sleep(2000); await K('r'); await sleep(500);
  console.log('2e prise (R puis R):', await info());
  await K(' '); await sleep(800);
  console.log('Espace:', await info());
  await K('z', 4); await sleep(300);
  console.log('⌘Z:', await info());
  await K('z', 4); await sleep(300);
  console.log('⌘Z:', await info());
  await shot('/private/tmp/claude-501/qa/rap-rec3.jpg');
};
