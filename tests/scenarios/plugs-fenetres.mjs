// Fenêtres de plugs façon Logic : plusieurs ouvertes, restent ouvertes au clic ailleurs, déplaçables, pas de doublon
import { boot, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check, shot } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [
    { name: 'A', type: 'audio', color: '#A855F7', effects: ['comp'], clips: [] },
    { name: 'B', type: 'audio', color: '#22D3EE', effects: ['filter'], clips: [] }] });
  const M = mouse(send);
  const n = () => ev(`document.querySelectorAll('.fx-panel.plug-win').length`);
  await ev(`openEffectPanel(0, 'comp', document.querySelector('.track-item') || document.body)`); await sleep(200);
  await ev(`openEffectPanel(1, 'filter', document.querySelectorAll('.track-item')[1] || document.body)`); await sleep(200);
  await ev(`openEqPanel(1, document.querySelectorAll('.track-item')[1] || document.body)`); await sleep(200);
  check('trois plugs ouverts en même temps', await n() === 3, await n());
  await ev(`openEffectPanel(0, 'comp', document.body)`); await sleep(100);
  check('rouvrir le même plug ne fait pas de doublon', await n() === 3, await n());
  check('le compresseur repasse devant', await ev(`isFrontPlug(document.querySelector('.plug-win[data-fx="comp"]'))`));
  await M.click(700, 840); await sleep(200);
  check('clic ailleurs : les plugs restent ouverts', await n() === 3, await n());
  const h = await ev(`(() => { const r = document.querySelector('.plug-win[data-fx="comp"] .fx-title').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 6 }; })()`);
  const before = await ev(`document.querySelector('.plug-win[data-fx="comp"]').getBoundingClientRect().left`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x - 40 * i, y: h.y + 30 * i, button: 'left' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.x - 200, y: h.y + 150, button: 'left', clickCount: 1 });
  const after = await ev(`document.querySelector('.plug-win[data-fx="comp"]').getBoundingClientRect().left`);
  check('le compresseur se déplace à la souris', Math.abs((before - after) - 200) < 2, `${before} → ${after}`);
  await ev(`document.querySelector('.plug-win[data-fx="comp"] .fx-size button[data-z="1.5"]')?.click()`); await sleep(100);
  check('à 150 % : agrandi avec zoom (net), pas une image étirée', await ev(`(()=>{ const p=document.querySelector('.plug-win[data-fx="comp"]'); return p.style.zoom==='1.5' && getComputedStyle(p).transform==='none'; })()`));
  {
    const h2 = await ev(`(() => { const r = document.querySelector('.plug-win[data-fx="comp"] .fx-title').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 6 }; })()`);
    const b2 = await ev(`(()=>{ const r=document.querySelector('.plug-win[data-fx="comp"]').getBoundingClientRect(); return [r.left, r.top]; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h2.x, y: h2.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h2.x + 20 * i, y: h2.y + 10 * i, button: 'left' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h2.x + 100, y: h2.y + 50, button: 'left', clickCount: 1 });
    const a2 = await ev(`(()=>{ const r=document.querySelector('.plug-win[data-fx="comp"]').getBoundingClientRect(); return [r.left, r.top]; })()`);
    check('à 150 % : la fenêtre suit la souris au pixel près', Math.abs(a2[0] - b2[0] - 100) < 2 && Math.abs(a2[1] - b2[1] - 50) < 2, `${b2.map(Math.round)} → ${a2.map(Math.round)}`);
  }
  check('à 150 % : pas d\'animation (net)', await ev(`getComputedStyle(document.querySelector('.plug-win[data-fx="comp"]')).animationName`) === 'none');
  await shot(process.env.TMPDIR + '/plugs-fenetres.jpg');
  await ev(`removeFx('filter', state.project.tracks[1])`); await sleep(200);
  check('retirer le Filtre ferme seulement sa fenêtre', await n() === 2, await n());
  await ev(`state.project.tracks.splice(0, 1)`); await sleep(700);
  check('piste supprimée : sa fenêtre se ferme', await ev(`!document.querySelector('.plug-win[data-fx="comp"]')`));
};
