// QA3 n°2b : coupe maintenue + zoom / re-rendu pendant le geste
import { boot, mouse, pos, key, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  const dump = (t = 0) => ev(`JSON.stringify(state.project.tracks[${t}].clips.map(c=>[c.name,+c.start.toFixed(3),+c.duration.toFixed(3),c.loopEnd?+c.loopEnd.toFixed(2):null]))`);
  const P = (type, x, y, cc = 1, buttons = type === 'mouseReleased' ? 0 : 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: cc });
  await boot(c, { id: 'cv', name: 'CV', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R', start: 1, duration: 6, offset: 0 }] }] });
  await ev(`setSnapMode('off',true)`);
  let p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="0"]', 0.5, 0.7);
  await P('mouseMoved', p.x, p.y); await P('mousePressed', p.x, p.y, 1); await P('mouseReleased', p.x, p.y, 1); await P('mousePressed', p.x, p.y, 2);
  await sleep(100);
  console.log('trait avant :', await ev(`!!document.querySelector('.split-line')`));
  await ev(`setZoom(state.pxPerSecond*2)`); await sleep(200);
  console.log('trait après zoom ×2 :', await ev(`(()=>{const l=document.querySelector('.split-line'); return l? l.style.left+' attaché='+document.body.contains(l):'absent'})()`), 'px/s=', await ev('state.pxPerSecond'));
  await ev(`renderTimelineTracks()`); await sleep(100);
  console.log('trait après re-rendu :', await ev(`!!document.querySelector('.split-line')`), 'is-splitting=', await ev(`document.body.classList.contains('is-splitting')`));
  await P('mouseMoved', p.x + 5, p.y, 2, 1); await sleep(100);
  await P('mouseReleased', p.x + 5, p.y, 2, 0); await sleep(300);
  console.log('coupe :', await dump());
  // Suppression de la région pendant le maintien (Delete) puis relâché
  await boot(c, { id: 'cv', name: 'CV', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'R', start: 1, duration: 6, offset: 0 }, { id: 'b', name: 'S', start: 8, duration: 2, offset: 0 }] }] });
  await ev(`setSnapMode('off',true)`);
  p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.5, 0.7);
  await P('mouseMoved', p.x, p.y); await P('mousePressed', p.x, p.y, 1); await P('mouseReleased', p.x, p.y, 1); await P('mousePressed', p.x, p.y, 2);
  await sleep(100);
  await ev(`state.project.tracks[0].clips.splice(0,1); renderTimelineTracks()`);   // simule un ⌘Z / suppression pendant le maintien : les indices bougent
  await P('mouseReleased', p.x + 10, p.y, 2, 0); await sleep(300);
  console.log('indices décalés pendant le maintien :', await dump());
};
