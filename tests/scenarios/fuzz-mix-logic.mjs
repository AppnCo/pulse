// Fuzz « mix comme Logic » : les gestes de mix de la semaine (groupes, S / M, sorties, envois, faders fins,
// ⏻ des plugins, EQ, table de mixage, ⌘Z) au hasard sur un projet type, avec vérification de cohérence à chaque pas.
// QA_SEED (graine), QA_N (nombre de gestes)
import { boot, J, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check, logs } = c;
  const seed0 = parseInt(process.env.QA_SEED || '7'), N = parseInt(process.env.QA_N || '220');
  let seed = seed0; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const peaks = () => Array.from({ length: 120 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 4)));
  const R = (s, d) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), name: 'r', start: s, duration: d, offset: 0, peaks: peaks() });
  const T = (name, out, fx = [], extra = {}) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [R(0, 8), R(10, 6)], effects: fx, ...extra });
  const G = (id, name, out = 'master') => ({ id, name, isGroup: true, output: out, color: '#A855F7', volume: 100 });
  await boot(c, { id: 'fml', name: 'Fuzz mix', bpm: 92, sends: [],
    buses: [G('dr', 'Drums'), G('vx', 'Voix'), G('mx', 'Mix Bus 1')],
    tracks: [T('Kick', 'dr', ['eq']), T('Snare', 'dr'), T('Hats', 'dr', ['comp']), T('Bass', 'master', ['sat', 'eq']), T('Instru', 'master'),
      T('Lead', 'vx', ['eq', 'comp', 'sat'], { effectParams: { eq: { bands: [{ type: 'hpf', freq: 90, gain: 0, q: 0.71, slope: 24 }, { type: 'bell', freq: 3000, gain: 3, q: 1 }] } } }),
      T('Back', 'vx', ['eq']), T('Ad-libs', 'vx')] }, { mic: false, w: 1440, h: 900 });
  await sleep(800);
  const M = (type, x, y, button = 'left', buttons = 1, modifiers = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : button, buttons, clickCount, modifiers });
  const click = async (p, mods = 0, button = 'left', cc = 1) => { if (!p) return; await M('mouseMoved', p.x, p.y, 'none', 0, mods); await M('mousePressed', p.x, p.y, button, button === 'right' ? 2 : 1, mods, cc); await M('mouseReleased', p.x, p.y, button, 0, mods, cc); };
  const drag = async (a, b, mods = 0, steps = 5) => { if (!a) return; await M('mouseMoved', a.x, a.y, 'none', 0, mods); await M('mousePressed', a.x, a.y, 'left', 1, mods);
    for (let i = 1; i <= steps; i++) await M('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 'left', 1, mods); await M('mouseReleased', b.x, b.y, 'left', 0, mods); };
  const KEYS = { s: ['s', 'KeyS', 83], m: ['m', 'KeyM', 77], z: ['z', 'KeyZ', 90], ArrowUp: ['ArrowUp', 'ArrowUp', 38], ArrowDown: ['ArrowDown', 'ArrowDown', 40], Escape: ['Escape', 'Escape', 27], c: ['c', 'KeyC', 67], v: ['v', 'KeyV', 86], x: ['x', 'KeyX', 88], ' ': [' ', 'Space', 32] };
  const key = async (k, mods = 0) => { const [kk, code, vk] = KEYS[k]; await send('Input.dispatchKeyEvent', { type: 'keyDown', key: kk, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: kk, code, windowsVirtualKeyCode: vk, modifiers: mods }); };
  // Points visibles d'un sélecteur (au centre, dans l'écran)
  const pts = (sel) => J(ev, `return [...document.querySelectorAll(${JSON.stringify(sel)})].map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; }).filter(p => p.w > 2 && p.h > 2 && p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight)`);
  const MOD = () => pick([0, 0, 0, 8, 4, 1]); // rien, ⇧, ⌘, ⌥
  const actions = {
    async groupe() { await click(pick(await pts('#tracksList .group-header .group-name')), MOD()); },
    async piste() { await click(pick(await pts('#tracksList .track-header, #tracksList .track-name')), MOD()); },
    async touche() { const k = pick(['s', 'm', 's', 'm', 'ArrowUp', 'ArrowDown', 'Escape', 'z', 'z', 'c', 'v', ' ']); await key(k, k === 'z' ? pick([4, 4, 12]) : k === 'c' || k === 'v' ? pick([0, 5]) : 0); },
    async fader() { const f = pick(await pts('.fader, input.group-vol, input[type=range]')); if (f) await drag(f, { x: f.x + (rnd() - 0.5) * 30, y: f.y + (rnd() - 0.5) * 120 }, pick([0, 8, 0])); },
    async alt() { await click(pick(await pts('.fader, .send-bar-row, input[type=range], .pan-knob, .strip-pan')), 1); },
    async menuSortie() { await click(pick(await pts('.strip-output, .insp-output'))); await sleep(120); await this.menuItem(); },
    async clicDroit() { await click(pick(await pts('#tracksList .track-header, #tracksList .group-header, .mixer-strips .strip-name, .clip')), 0, 'right'); await sleep(120); await this.menuItem(); },
    async menuItem() { for (let k = 0; k < 2; k++) { const it = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item, .ctx-menu .ctx-item')].filter(e => !/Quitter|Exporter|Importer|Ouvrir un fichier|Enregistrer sous/i.test(e.textContent)).map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: e.textContent.trim().slice(0, 30) }; }).filter(p => p.y > 0 && p.y < innerHeight)`);
      if (!it.length) return; await click(pick(it)); await sleep(150); } await key('Escape'); },
    async pow() { const p = await pts('.fx-pow'); if (!p.length) return; if (rnd() < 0.6) await click(pick(p)); else { const a = pick(p); await drag(a, { x: a.x, y: a.y + 60 }); } },
    async eq() { const ti = Math.floor(rnd() * 8); await ev(`(() => { document.querySelectorAll('.eq-panel').forEach(p => p.remove()); const t = state.project.tracks[${ti}]; if (t) { openEqPanel(${ti}, document.body); const p = document.querySelector('.eq-panel'); if (p) { p.style.left = '200px'; p.style.top = '120px'; } } })()`); await sleep(200);
      const g = pick(await pts('.eq-panel .eq-pt')); if (g) await drag(g, { x: g.x + (rnd() - 0.5) * 200, y: g.y + (rnd() - 0.5) * 120 }); if (rnd() < 0.3) { const u = pick(await pts('.eq-panel button')); if (u) await click(u); } },
    async fermerPlugins() { await ev(`document.querySelectorAll('.eq-panel .fx-panel-close, .fx-panel .fx-panel-close').forEach(b => b.click())`); },
    async mixer() { await ev(`toggleMixer()`); await sleep(300); },
    async mixClic() { const p = pick(await pts('.mixer.open .strip-name, .mixer.open .strip button, .mixer.open .strip-fx-slot')); const m = MOD();
      if (p && process.env.QA_DBG) console.log('  mixClic sur', await J(ev, `const e = document.elementFromPoint(${p.x}, ${p.y}); const s = e && e.closest('.strip'); return (e ? e.className + ' «' + e.textContent.trim().slice(0, 20) + '»' : '?') + ' tranche=' + (s ? (s.querySelector('.strip-name')||{}).textContent : '?')`), 'mod', m);
      await click(p, m); },
    async zoom() { await ev(`(() => { const zt = zoomTarget(); setZoom(state.pxPerSecond * (${rnd()} < 0.5 ? 1.25 : 0.8), zt.sec, zt.center); })()`); },
    async soloTout() { await click(pick(await pts('#btnSoloAll'))); },
    async envoi() { await click(pick(await pts('.strip-sends .insp-slot-empty'))); await sleep(150); await this.menuItem(); },
    async ajoutEffet() { await click(pick(await pts('.insp-fx .insp-slot-empty'))); await sleep(150); await this.menuItem(); },
    async ouvrirPlugin() { await click(pick(await pts('.insp-fx-row, .strip-fx-slot'))); await sleep(200); if (rnd() < 0.5) await this.fermerPlugins(); },
    async replier() { await click(pick(await pts('.group-toggle'))); },
    async combo() { const [k, m] = pick([['c', 5], ['v', 5], ['s', 7], ['m', 7], ['ArrowUp', 4], ['ArrowDown', 4]]); await key(k, m); },
    async regionAlt() { const r = pick(await pts('.clip')); if (r) await drag(r, { x: r.x + (rnd() - 0.3) * 200, y: r.y + (rnd() < 0.3 ? 70 : 0) }, pick([1, 0, 8])); },
    async envoiBar() { const r = pick(await pts('.send-bar-row')); if (r) await drag(r, { x: r.x + (rnd() - 0.5) * 60, y: r.y }, pick([0, 8])); },
  };
  const names = Object.keys(actions).filter(n => n !== 'menuItem');
  const weights = { groupe: 3, piste: 3, touche: 4, fader: 3, alt: 1, menuSortie: 2, clicDroit: 2, pow: 2, eq: 1, fermerPlugins: 1, mixer: 1, mixClic: 2, zoom: 1, soloTout: 1, envoi: 2, ajoutEffet: 1, ouvrirPlugin: 2, replier: 1, combo: 2, regionAlt: 2, envoiBar: 1 };
  const bag = names.flatMap(n => Array(weights[n] || 1).fill(n));
  let bad = [], done = [];
  const CHECK = `(() => { const out = ${INVARIANTS}; try { JSON.stringify(state.project); } catch (e) { out.push('projet non sérialisable ' + e.message); }
    const p = state.project, ids = new Set((p.buses || []).map(b => b.id)); (p.tracks || []).forEach(t => (t.sends || []).forEach(s => { if (s.bus && !ids.has(s.bus)) out.push('envoi vers bus inconnu ' + t.name + '→' + s.bus); }));
    if (${process.env.QA_PLAY ? 'true' : 'false'} && state.playing) { const live = PulseAudio.debugLive(); if (live.length) window.__liveChecks = (window.__liveChecks || 0) + 1; if (live.length) live.forEach(n => { const t = p.tracks[n.i]; if (!t) out.push('lecture : piste ' + n.i + ' disparue'); else if (t.name !== n.name) out.push('lecture : piste ' + n.i + ' = ' + n.name + ' mais à l écran ' + t.name); else if (PulseAudio.isTrackAudible(p, t) !== n.audible) out.push('lecture : ' + t.name + (n.audible ? ' s entend alors qu elle devrait être coupée' : ' coupée alors qu elle devrait s entendre')); }); }
    return out; })()`;
  for (let i = 0; i < N; i++) {
    const a = pick(bag); done.push(a);
    try { await actions[a](); } catch (e) { bad.push(i + ' ' + a + ' : action ' + e.message); }
    await sleep(40);
    if (process.env.QA_DBG) console.log('DBG', i, a, await J(ev, `return state.project.tracks.map(t => t.name.slice(0,4) + (t.muted ? 'M' : '') + (t.solo ? 'S' : '') + (t.output !== 'master' ? '>' + t.output : '')).join(' ') + ' | buses ' + (state.project.buses||[]).map(b => b.id + (b.muted ? 'M' : '') + (b.solo ? 'S' : '')).join(' ') + ' | live ' + (state.playing ? PulseAudio.debugLive().map(n => n.name.slice(0,4) + (n.audible ? '+' : '-')).join(' ') : 'stop') + ' | flash=' + ((document.querySelector('.flash, .toast, #flash')||{}).textContent||'').slice(0,60) + ' || ' + (state.project.buses||[]).map(b => b.id + '→' + (b.output||'master')).join(' ') + ' | chosen=' + (typeof mixChosenBuses === 'function' ? mixChosenBuses().map(b=>b.id).join(',') : '?') + ' | msg=' + ((document.querySelector('.flash, .toast')||{}).textContent||'').slice(0,80)`));
    if (process.env.QA_PLAY && (i % 5 === 3)) { await ev(`if (!state.playing) { state.playhead = 0; togglePlay(); }`); }
    if (process.env.QA_PLAY && (i % 5 === 4)) await sleep(250);
    if (i % 5 === 4 || i === N - 1) { const inv = await J(ev, `return ${CHECK}`); if (Array.isArray(inv) && inv.length && /^lecture/.test(inv[0])) { await sleep(1500); const inv2 = await J(ev, `return ${CHECK}`); console.log('DECALAGE', i, done.slice(-6).join(','), '| tout de suite :', inv.join(' ; '), '| 1,5 s après :', Array.isArray(inv2) && inv2.length ? inv2.join(' ; ') : 'rattrapé'); if (Array.isArray(inv2) && !inv2.length) continue; }
      if (!Array.isArray(inv) || inv.length) { bad.push(i + ' après ' + done.slice(-5).join(',') + ' : ' + (Array.isArray(inv) ? inv.join(' | ') : String(inv).slice(0, 300))); break; } }
    const exc = logs.filter(l => /^EXC/.test(l)); if (exc.length) { bad.push(i + ' après ' + done.slice(-5).join(',') + ' : ' + exc[0]); break; }
  }
  console.log('bilan', await J(ev, `const p = state.project; return { sorties: p.tracks.map(t => t.output).join(','), groupes: (p.buses || []).map(b => b.id + '→' + (b.output || 'master') + (b.solo ? ' S' : '') + (b.mute ? ' M' : '')).join(', '), solos: p.tracks.filter(t => t.solo).length, mutes: p.tracks.filter(t => t.mute || t.muted).length, vols: p.tracks.map(t => Math.round(t.volume ?? 100)).join(','), fxOff: p.tracks.reduce((n, t) => n + ((t.fxOff || []).length || 0), 0), envois: p.tracks.reduce((n, t) => n + (t.sends || []).length, 0), pistes: p.tracks.length, undo: (state.undoStack || []).length }`));
  if (process.env.QA_PLAY) console.log('contrôles en lecture :', await ev(`window.__liveChecks || 0`));
  check(`graine ${seed0} : ${N} gestes de mix sans exception ni incohérence`, !bad.length, bad.slice(0, 3).join(' || '));
  // Tout annuler puis tout refaire : le projet reste cohérent
  await ev(`document.querySelectorAll('.eq-panel,.fx-panel,.track-ctx-menu').forEach(p => p.remove())`);
  for (let k = 0; k < 80; k++) await key('z', 4);
  await sleep(600);
  const inv1 = await J(ev, `return ${CHECK}`);
  for (let k = 0; k < 80; k++) await key('z', 12);
  await sleep(600);
  const inv2 = await J(ev, `return ${CHECK}`);
  const exc = logs.filter(l => /^EXC/.test(l));
  check('tout annuler / tout refaire : cohérent, aucune exception', !inv1.length && !inv2.length && !exc.length, JSON.stringify([inv1, inv2, exc.slice(0, 2)]));
};
