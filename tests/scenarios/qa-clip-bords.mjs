// Étirer / déplacer des régions au-delà des limites ; chevauchements ; annulation exacte
import { boot, instru, mouse, pos, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }, { name: 'B', type: 'audio', color: '#22D3EE', clips: [] }] });
  const Ms = mouse(send);
  await instru(ev, 4, 0, 2); await sleep(300);
  const info = () => ev(`JSON.stringify(state.project.tracks.map(t=>t.clips.map(c=>({s:+c.start.toFixed(2),d:+c.duration.toFixed(2),o:+(c.offset||0).toFixed(2)}))))`);
  console.log('départ', await info());
  let r = await ev(`JSON.stringify((()=>{const e=document.querySelector('.timeline-track[data-i="0"] .clip').getBoundingClientRect(); return {l:e.left,r:e.right,t:e.top,b:e.bottom}})())`); r = JSON.parse(r);
  const ym = (r.t + r.b) / 2;
  // bord droit vers la droite loin (l'audio ne dure que 4 s)
  await Ms.drag(r.r - 2, ym, r.r + 400, ym, 8); await sleep(200);
  console.log('bord droit tiré +400 px', await info());
  r = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.timeline-track[data-i="0"] .clip').getBoundingClientRect(); return {l:e.left,r:e.right,t:e.top,b:e.bottom}})())`));
  // bord gauche loin vers la gauche
  await Ms.drag(r.l + 2, ym, r.l - 600, ym, 8); await sleep(200);
  console.log('bord gauche tiré -600 px', await info());
  r = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.timeline-track[data-i="0"] .clip').getBoundingClientRect(); return {l:e.left,r:e.right,t:e.top,b:e.bottom}})())`));
  // bord gauche vers la droite jusque après le bord droit
  await Ms.drag(r.l + 2, ym, r.r + 300, ym, 8); await sleep(200);
  console.log('bord gauche tiré au-delà du bord droit', await info());
  // déplacer le clip loin à gauche (avant 0)
  r = JSON.parse(await ev(`JSON.stringify((()=>{const e=document.querySelector('.timeline-track[data-i="0"] .clip'); if(!e) return null; const q=e.getBoundingClientRect(); return {l:q.left,r:q.right,t:q.top,b:q.bottom}})())`));
  if (r) { await Ms.drag((r.l + r.r) / 2, ym, 100, ym + 80, 8); await sleep(200); console.log('déplacé vers x=100 et piste B', await info()); }
  console.log('invariants', await ev(`JSON.stringify(${INVARIANTS})`));
  for (let i = 0; i < 5; i++) { await ev(`undoAction()`); await sleep(100); }
  console.log('après 5 annulations', await info());
  await shot('/private/tmp/claude-501/qa/bords.jpg');
};
