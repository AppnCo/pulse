// Bouton Mix (14/11) : présent sur chaque plugin qui n'a pas déjà son propre mélange, rangé dans effectParams._mix
import { boot, J, RAP } from './qa-lib.mjs';
const FX = ['eq','filter','gate','sat','deess','util','width','tremolo','pre73','eqp1','eq550','stripe','massif','horizon','eclat','souffle','prev76','techo','limit','comp','fet76','plate','delay','reverb','chorus'];
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 900 });
  await ev(`(()=>{ const t=state.project.tracks[2]; t.effects=${JSON.stringify(FX)}; })()`);
  const res = {};
  for (const fx of FX) {
    await ev(`document.querySelectorAll('.fx-panel').forEach(p => p.remove()); openEffectPanel(2, '${fx}', document.body)`); await sleep(250);
    res[fx] = await J(ev, `const p=[...document.querySelectorAll('.fx-panel:not(.eq-embed)')].pop(); return p ? [!!p.querySelector('.fx-mix-host'), p.querySelectorAll('[data-key="mix"],[data-key="wet"],[data-key="_mix"]').length] : null`);
  }
  const withMix = FX.filter(f => res[f] && res[f][1] >= 1);
  check('chaque plugin a un Mix (le sien ou le commun)', withMix.length === FX.length, JSON.stringify(res));
  check('pas de double Mix', FX.every(f => !res[f] || !(res[f][0] && res[f][1] > 1)), JSON.stringify(res));
  // tourner le Mix de l'EQ
  await ev(`document.querySelectorAll('.fx-panel').forEach(p => p.remove()); openEffectPanel(2, 'eq', document.body)`); await sleep(300);
  const k = await J(ev, `const e=document.querySelector('.fx-mix-host .pk'); const r=e.getBoundingClientRect(); return {x:r.left+12,y:r.top+12}`);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: k.x, y: k.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 5; i++) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: k.x, y: k.y + 30 * i, buttons: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: k.x, y: k.y + 150, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
  const m = await J(ev, `return (state.project.tracks[2].effectParams._mix || {}).eq`);
  check('Mix de l\'EQ baissé et rangé', m === 50, String(m));
};
