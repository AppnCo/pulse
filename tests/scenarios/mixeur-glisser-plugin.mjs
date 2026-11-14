// Mixeur (14/11) : glisser un plugin d'une tranche à une autre le déplace, ⌥ + glisser le copie (comme Logic)
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 860 });
  await ev(`(()=>{ state.project.tracks[2].effects=['eq','comp']; state.project.tracks[3].effects=[]; state.project.tracks[4].effects=[]; if(!state.mixerOpen) toggleMixer(); renderMixer(); bindMixerEvents(); })()`); await sleep(700);
  const pos = (sel) => J(ev, `const e=document.querySelector('${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}`);
  const drag = async (a, b, mods = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers: mods });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
    for (let k = 1; k <= 8; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * k / 8, y: a.y + (b.y - a.y) * k / 8, buttons: 1, modifiers: mods }); await sleep(30); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
    await sleep(500);
  };
  const src = await pos('.mixer-strips .strip[data-kind="track"][data-i="2"] .insp-fx-row[data-fx="comp"]');
  const dst = await pos('.mixer-strips .strip[data-kind="track"][data-i="3"] .insp-fx-box');
  check('tranches trouvées', !!src && !!dst, JSON.stringify([src, dst]));
  await drag(src, dst);
  const r1 = await J(ev, `return [state.project.tracks[2].effects.join(), state.project.tracks[3].effects.join()]`);
  check('glisser : Compresseur déplacé sur la piste 4', r1[0] === 'eq' && r1[1] === 'comp', JSON.stringify(r1));
  const s2 = await pos('.mixer-strips .strip[data-kind="track"][data-i="2"] .insp-fx-row[data-fx="eq"]');
  const d2 = await pos('.mixer-strips .strip[data-kind="track"][data-i="4"] .insp-fx-box');
  await drag(s2, d2, 1);
  const r2 = await J(ev, `return [state.project.tracks[2].effects.join(), state.project.tracks[4].effects.join()]`);
  check('⌥ + glisser : EQ copié (gardé sur la source)', r2[0] === 'eq' && r2[1] === 'eq', JSON.stringify(r2));
};
