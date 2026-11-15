// EQ de l'écho / de la reverb (14/11) : le VRAI EQ (même fenêtre, mêmes gestes, mêmes boutons) intégré en plus petit,
// branché sur les points de l'effet ; l'EQ de la piste n'est pas touché ; pas de sortie ni de point dynamique (l'effet n'en a pas)
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1920, h: 1080 });
  for (const fx of ['delay', 'reverb']) {
    await ev(`(()=>{ document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); const t=state.project.tracks[2]; t.effects=['${fx}', 'eq']; t.effectParams={ eq: { bands: [{ type: 'bell', freq: 500, gain: 3, q: 1 }] }, ${fx}: { eq: [] } }; openEffectPanel(2, '${fx}', document.body); const p=[...document.querySelectorAll('.fx-panel')].pop(); p.style.left='40px'; p.style.top='40px'; })()`); await sleep(400);
    const ui = await J(ev, `const e=document.querySelector('.eq-embed'); return e && { add: !!e.querySelector('.eq-add'), presets: !!e.querySelector('.eq-preset'), an: !!e.querySelector('.eq-an'), undo: !!e.querySelector('.eq-undo'), ag: getComputedStyle(e.querySelector('.eq-ag')).display }`);
    check(`${fx} : vrai EQ intégré (+ Point, modèles, analyseur, annuler ; pas d'auto gain)`, ui && ui.add && ui.presets && ui.an && ui.undo && ui.ag === 'none', JSON.stringify(ui));
    await ev(`document.querySelector('.eq-embed .eq-add').click()`); await sleep(200);
    const r = await J(ev, `const t=state.project.tracks[2]; return { fx: (t.effectParams['${fx}'].eq||[]).length, piste: t.effectParams.eq.bands.length, pts: document.querySelectorAll('.eq-embed .eq-pt').length }`);
    check(`${fx} : + Point → dans l'EQ de l'effet, l'EQ de la piste intact`, r.fx === 1 && r.piste === 1 && r.pts === 1, JSON.stringify(r));
    // clic sur le point : le petit menu du point s'ouvre en bas (formes, fréquence / gain / Q, pente, solo…), comme le grand EQ
    { const q = await J(ev, `const e=document.querySelector('.eq-embed .eq-pt'); const b=e.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
      const m = await J(ev, `const d=document.querySelector('.eq-embed .eq-detail'); return d && { vis: getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().height > 10, solo: !!d.querySelector('.eq-solo'), types: d.querySelectorAll('[data-type], .eq-type').length }`);
      check(`${fx} : clic sur le point → son menu (avec le casque)`, m && m.vis && m.solo, JSON.stringify(m)); await sleep(600); }
    // tirer le point : fréquence et gain changent
    const p = await J(ev, `const e=document.querySelector('.eq-embed .eq-pt'); const b=e.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 5; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 8 * i, y: p.y - 6 * i, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + 40, y: p.y - 30, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
    const b = await J(ev, `return state.project.tracks[2].effectParams['${fx}'].eq[0]`);
    check(`${fx} : point tiré (fréquence et gain)`, b && b.freq > 1100 && b.gain > 1, JSON.stringify([b, p]));
    await ev(`document.querySelector('.eq-embed .eq-undo').click()`); await sleep(150);
    check(`${fx} : ↶ annule le geste`, await J(ev, `const b=state.project.tracks[2].effectParams['${fx}'].eq[0]; return !b || Math.abs(b.gain) < 0.6`));
  }
};
