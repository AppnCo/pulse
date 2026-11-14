// ⌘ + clic sur n'importe quel bouton de plugin = valeur de départ (14/11) : boutons ronds Pulse, machines analogiques, fenêtres standard, Mix
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 900 });
  const cmdClick = async (sel) => {
    const p = await J(ev, `const e=document.querySelector('${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+Math.min(r.height/2, 20)}`);
    if (!p) return false;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: 4 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 4 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 4 });
    await sleep(250); return true;
  };
  const open = async (fx, params) => { await ev(`(()=>{ document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); const t=state.project.tracks[2]; t.effects=['${fx}']; t.effectParams = ${JSON.stringify(params)}; openEffectPanel(2, '${fx}', document.body); const p=[...document.querySelectorAll('.fx-panel')].pop(); p.style.left='40px'; p.style.top='40px'; })()`); await sleep(400); };
  const P = (fx, k) => J(ev, `return (state.project.tracks[2].effectParams['${fx}']||{})['${k}']`);
  await open('gate', { gate: { threshold: -20 } });
  check('pointeur trouvé (gate)', await cmdClick('.fx-panel .pk[data-key="threshold"]'));
  check('Gate : seuil remis à sa valeur de départ', (await P('gate', 'threshold')) !== -20, String(await P('gate', 'threshold')));
  await open('comp', { comp: { threshold: -35 } });
  await cmdClick('.fx-panel .fx-knob[data-key="threshold"]');
  check('Compresseur : seuil remis (-22)', (await P('comp', 'threshold')) === -22, String(await P('comp', 'threshold')));
  await open('fet76', { fet76: { input: 60 } });
  await cmdClick('.fx-panel .pk[data-key="input"] circle');
  check('Éclair 76 : entrée remise', (await P('fet76', 'input')) !== 60, String(await P('fet76', 'input')));
  await open('eq', { eq: { bands: [] }, _mix: { eq: 40 } });
  await sleep(200);
  await cmdClick('.fx-panel .fx-mix-host .pk');
  check('Mix remis à 100 %', await J(ev, `return ((state.project.tracks[2].effectParams._mix)||{}).eq`) === null || await J(ev, `return ((state.project.tracks[2].effectParams._mix)||{}).eq === undefined`));
};
