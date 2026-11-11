// Table de mixage : glisser un plugin sur une autre tranche = le déplacer ; ⌥ = le copier (réglage compris) ; même tranche = changer l'ordre
import { boot, J, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c; const m = mouse(send);
  await boot(c, { id: 'pgt', name: 'P', bpm: 120, sends: [], buses: [], tracks: [
    { name: 'Lead', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['eq', 'comp'], effectParams: { comp: { threshold: -31, ratio: 6 } } },
    { name: 'Back', type: 'audio', color: '#C084FC', volume: 100, clips: [], effects: ['comp'], effectParams: { comp: { threshold: -10, ratio: 2 } } }] }, { mic: false, w: 1440, h: 900 });
  await ev(`toggleMixer()`); await sleep(500);
  const at = (ti, fx) => J(ev, `const r = document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="${ti}"] .insp-fx-row[data-fx="${fx}"]') || [...document.querySelectorAll('.mixer-strips .strip[data-kind="track"]')].filter(s => (s.dataset.i ?? s.dataset.id) == ${ti}).map(s => s.querySelector('.insp-fx-row[data-fx="${fx}"]'))[0]; if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }`);
  const box = (ti) => J(ev, `const s = [...document.querySelectorAll('.mixer-strips .strip[data-kind="track"]')].find(s => (s.dataset.i ?? s.dataset.id) == ${ti}); const b = s.querySelector('.insp-fx-box').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.bottom - 6 }`);
  const drag = async (a, b, alt) => { const mods = alt ? 1 : 0; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, buttons: 1, modifiers: mods }); await sleep(20); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods }); await sleep(500); };
  // 1. ⌥ + glisser l'EQ de Lead vers Back : copie
  await drag(await at(0, 'eq'), await box(1), true);
  let s = await J(ev, `return state.project.tracks.map(t => t.effects)`);
  check('⌥ + glisser : EQ copié sur Back, toujours sur Lead', s[0].includes('eq') && s[1].includes('eq'), JSON.stringify(s));
  // 2. glisser le Compresseur de Lead vers Back : déplacé, Back en a deux (comp + comp#2 avec le réglage de Lead)
  await drag(await at(0, 'comp'), await box(1), false);
  s = await J(ev, `return state.project.tracks.map(t => ({ e: t.effects, p: t.effectParams }))`);
  const c2 = s[1].e.find(f => f.startsWith('comp#'));
  check('glisser : Compresseur déplacé de Lead vers Back (2e exemplaire, réglage de Lead)', !s[0].e.includes('comp') && c2 && s[1].p[c2].threshold === -31 && s[1].p.comp.threshold === -10, JSON.stringify(s));
  // 3. même tranche : changer l'ordre (Back : eq en premier)
  const before = await J(ev, `return chainOf(state.project.tracks[1])`);
  const top = await at(1, before[0]);
  await drag(await at(1, before[before.length - 1]), { x: top.x, y: top.y - 8 }, false);
  const after = await J(ev, `return chainOf(state.project.tracks[1])`);
  check('même tranche : l\'ordre change', after[0] === before[before.length - 1], JSON.stringify({ before, after }));
  check('⌘Z annule le dernier geste', await J(ev, `undoAction(); return chainOf(state.project.tracks[1]).join()`) === before.join(), '');
};
