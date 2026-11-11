// Retour terrain 11/11 : comme Logic, un clic sur le nom d'un plugin ouvre sa fenêtre, un 2e clic la referme ;
// le panneau « Son de la piste » ne s'ouvre plus tout seul ; ⏻ à gauche et ⇅ à droite visibles au survol
import { boot, J, mouse } from '/Volumes/KINGSTON/CLAUDE/PULSE/tests/scenarios/qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep } = c; const m = mouse(send);
  await boot(c, { id: 'pc', name: 'PC', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#3B82F6', output: 'master', effects: ['eq', 'comp'], clips: [] }] }, { mic: false });
  await ev(`document.querySelector('.track-item').click()`); await sleep(400);
  const at = async () => J(ev, `const r=[...document.querySelectorAll('#inspector .insp-fx-row')].find(e=>e.dataset.fx==='comp'); const b=r.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2,l:b.left,r:b.right}`);
  const check = (n, ok, d = '') => console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));
  let p = await at(); await m.click(p.x, p.y); await sleep(500);
  check('1er clic : fenêtre ouverte', await J(ev, `return document.querySelectorAll('.fx-panel.plug-win[data-fx="comp"]').length`) === 1);
  check('pas de panneau « Son »', await J(ev, `return document.querySelectorAll('.sound-panel').length`) === 0);
  p = await at(); await m.click(p.x, p.y); await sleep(400);
  check('2e clic : fenêtre fermée', await J(ev, `return document.querySelectorAll('.fx-panel.plug-win[data-fx="comp"]').length`) === 0);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(200);
  const z = await J(ev, `const r=[...document.querySelectorAll('#inspector .insp-fx-row')].find(e=>e.dataset.fx==='comp'); const a=r.querySelector('.fx-pow').getBoundingClientRect(), b=r.querySelector('.fx-swap').getBoundingClientRect(); return {pw:a.width,ph:a.height,sw:b.width,vis:getComputedStyle(r.querySelector('.fx-swap')).display}`);
  check('survol : ⏻ et ⇅ visibles et assez grands', z.vis === 'grid' && z.pw >= 14 && z.ph >= 14 && z.sw >= 14, JSON.stringify(z));
  await m.click(p.l + 8, p.y); await sleep(300);
  check('clic à gauche : éteint, sans ouvrir', await J(ev, `return (state.project.tracks[0].fxOff||[]).includes('comp') && !document.querySelector('.fx-panel.plug-win')`), await J(ev, `return JSON.stringify(state.project.tracks[0].fxOff||null)`));
};
