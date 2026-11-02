// Plugins Pulse (VST3 / CLAP / AU) : chaque réglage du panneau de Pulse doit exister dans le plugin.
// Sinon le bouton se voit dans la fenêtre du plugin mais ne fait rien (Écho et Reverb avaient pris du retard).
// La liste des réglages du plugin est lue dans plugins/new-plugins.py et plugins/pulse-comp/src/lib.rs.
import fs from 'fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const gen = fs.readFileSync(ROOT + 'plugins/new-plugins.py', 'utf8');
const comp = fs.readFileSync(ROOT + 'plugins/pulse-comp/src/lib.rs', 'utf8');
const sat = fs.readFileSync(ROOT + 'plugins/pulse-sat/src/lib.rs', 'utf8');
// clés vues par le plugin : 2e élément de chaque tuple de SPECS (params et bools), par effet
function pluginKeys(fx) {
  if (fx === 'sat') return [...sat.matchAll(/link_[bfe]!\(p, "(\w+)"/g)].map(m => m[1]);
  if (fx === 'comp') return [...comp.matchAll(/link_[bfe]!\(p, "(\w+)"/g)].map(m => m[1]).filter(k => k !== "bypass");
  const start = gen.indexOf(`fx='${fx}'`); const end = gen.indexOf('\n \'', start + 1);
  const block = gen.slice(start, end > 0 ? end : undefined);
  return [...block.matchAll(/\('\w+', '(\w+)', /g)].map(m => m[1]);
}
export default async ({ ev, nav, sleep, check }) => {
  for (const fx of ['comp', 'delay', 'reverb', 'pitch', 'sat']) {
    await nav(`http://localhost:8765/plugins/ui/dev.html?fx=${fx}`); await sleep(500);
    const keys = pluginKeys(fx);
    const panel = JSON.parse(await ev(`JSON.stringify(FX_PANEL_DEFS[${JSON.stringify(fx)}].map(d => d.key))`));
    const missing = panel.filter(k => !keys.includes(k) && !(fx === 'comp' && k === 'makeup'));
    check(`${fx} : chaque réglage du panneau existe dans le plugin`, missing.length === 0, missing.length ? 'manque ' + missing.join(', ') : keys.length + ' réglages');
    // Un préréglage de Pulse choisi dans la fenêtre du plugin : toutes ses valeurs partent vers le plugin
    const out = JSON.parse(await ev(`(async () => {
      const sent = []; window.sendToPlugin = (m) => sent.push(m);
      const pre = (FX_PRESETS[${JSON.stringify(fx)}] || []).find(p => Object.keys(p.params || {}).length > 2) || (FX_PRESETS[${JSON.stringify(fx)}] || [])[0];
      if (!pre) return JSON.stringify({ none: true });
      const t = state.project.tracks[0]; t.effectParams[${JSON.stringify(fx)}] = { ...pre.params }; refreshPlaybackSoon();
      await new Promise(r => setTimeout(r, 50));
      const last = sent.filter(m => m.type === 'Set').pop();
      return JSON.stringify({ name: pre.name, params: pre.params, values: last && last.values });
    })()`));
    if (out.none) continue;
    const lost = Object.entries(out.params).filter(([k, v]) => typeof v === 'number' && keys.includes(k) && out.values?.[k] !== v).map(([k]) => k);
    const unknown = Object.entries(out.params).filter(([k, v]) => typeof v === 'number' && !keys.includes(k) && !k.startsWith('_') && !(fx === 'comp' && k === 'makeup')).map(([k]) => k);
    if (fx === 'delay' || fx === 'reverb') {
      // l'EQ de l'effet : un préréglage avec EQ le transmet, et un projet rechargé par le logiciel le rend à la fenêtre
      const q = JSON.parse(await ev(`(async () => {
        const sent = []; window.sendToPlugin = (m) => sent.push(m);
        const pre = FX_PRESETS[${JSON.stringify(fx)}].filter(p => (p.params.eq || []).length).pop()
          || { name: 'écho + EQ', params: { ...FX_PRESETS[${JSON.stringify(fx)}][0].params, eq: [{ type: 'hpf', freq: 400, gain: 0, q: 0.7071, slope: 12 }, { type: 'bell', freq: 3000, gain: -3, q: 1 }] } };
        const t = state.project.tracks[0]; t.effectParams[${JSON.stringify(fx)}] = JSON.parse(JSON.stringify(pre.params)); refreshPlaybackSoon();
        await new Promise(r => setTimeout(r, 50));
        const last = sent.filter(m => m.type === 'Set').pop();
        const back = [{ type: 'bell', freq: 1234, gain: -4, q: 1 }];
        onPluginMessage({ type: 'params', values: last.values, bypass: 0, eq: back });
        const got = (t.effectParams[${JSON.stringify(fx)}].eq || [])[0];
        onPluginMessage({ type: 'params', values: last.values, bypass: 0, eq: [] });
        return JSON.stringify({ name: pre.name, want: pre.params.eq.length, sent: (last.eq || []).length, back: got && got.freq, cleared: !(t.effectParams[${JSON.stringify(fx)}].eq || []).length });
      })()`));
      check(`${fx} : EQ du préréglage « ${q.name} » envoyé au plugin`, q.sent === q.want && q.want > 0, q.sent + '/' + q.want + ' points');
      check(`${fx} : EQ gardé par le logiciel rendu à la fenêtre (et effacé)`, q.back === 1234 && q.cleared, JSON.stringify(q));
    }
    check(`${fx} : préréglage « ${out.name} » transmis au plugin`, out.values && !lost.length && !unknown.length,
      lost.length ? 'perdu ' + lost.join(', ') : unknown.length ? 'inconnu du plugin ' + unknown.join(', ') : 'ok');
  }
  // Limiteur : son propre panneau (pas dans FX_PANEL_DEFS)
  await nav('http://localhost:8765/plugins/ui/dev.html?fx=limit'); await sleep(600);
  const keys = [...fs.readFileSync(ROOT + 'plugins/pulse-limit/src/lib.rs', 'utf8').matchAll(/link_[bfe]!\(p, "(\w+)"/g)].map(m => m[1]).filter(k => k !== "bypass");
  const L = JSON.parse(await ev(`(async () => {
    const sent = []; window.sendToPlugin = (m) => sent.push(m);
    const t = state.project.tracks[0];
    const open = !!document.querySelector('.lim-panel.plug-win');
    document.querySelector('.lim-sty [data-sty="2"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('.lim-tp').click();
    await new Promise(r => setTimeout(r, 60));
    const last = sent.filter(m => m.type === 'Set').pop();
    // le plugin renvoie un afficheur : la fenêtre doit s'en servir
    onPluginMessage({ type: 'meter', gr: 0, out: 0.9, lim: [1.4, 0.95, 0.5] });
    const m = PulseAudio.getLimiterMeter('t0');
    return JSON.stringify({ open, values: last && last.values, style: t.effectParams.limit.style, tp: t.effectParams.limit.tp, m });
  })()`));
  check('limiteur : le panneau de Pulse s\'ouvre dans le plugin', L.open);
  check('limiteur : chaque réglage envoyé existe dans le plugin', L.values && Object.keys(L.values).every(k => keys.includes(k)) && keys.every(k => k in L.values), JSON.stringify(L.values));
  check('limiteur : style Franc et pic réel coupé partent au plugin', L.values && L.values.style === 2 && L.values.tp === 0, JSON.stringify(L.values));
  check('limiteur : afficheur du plugin lu par la fenêtre', L.m && L.m.i === 1.4 && L.m.gr === 0.5, JSON.stringify(L.m));
  // De-esser : son propre panneau, avec « Écouter »
  await nav('http://localhost:8765/plugins/ui/dev.html?fx=deess'); await sleep(600);
  const dkeys = [...fs.readFileSync(ROOT + 'plugins/pulse-deess/src/lib.rs', 'utf8').matchAll(/link_[bfe]!\(p, "(\w+)"/g)].map(m => m[1]).filter(k => k !== 'bypass');
  const D = JSON.parse(await ev(`(async () => {
    const sent = []; window.sendToPlugin = (m) => sent.push(m);
    const t = state.project.tracks[0];
    const open = !!document.querySelector('.plug-win');
    document.querySelector('.ds-md [data-v="1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('.ds-listen').click();
    await new Promise(r => setTimeout(r, 60));
    const last = sent.filter(m => m.type === 'Set').pop();
    onPluginMessage({ type: 'meter', gr: 4, out: 0.5, ds: [0.5, 0.2, 6, 0.4] });
    const m = PulseAudio.getDeessMeter('t0');
    return JSON.stringify({ open, values: last && last.values, m, old: 'amount' in t.effectParams.deess });
  })()`));
  check('de-esser : le panneau de Pulse s\'ouvre dans le plugin', D.open);
  check('de-esser : chaque réglage envoyé existe dans le plugin', D.values && Object.keys(D.values).every(k => dkeys.includes(k)) && dkeys.every(k => k in D.values), JSON.stringify(D.values));
  check('de-esser : Large et Écouter partent au plugin', D.values && D.values.wide === 1 && D.values.listen === 1, JSON.stringify(D.values));
  check('de-esser : pas l\'ancien réglage (force / fréquence)', !D.old);
  check('de-esser : afficheur du plugin lu par la fenêtre', D.m && D.m.r === 6 && D.m.s === 0.2, JSON.stringify(D.m));
  // Gate : son propre panneau, ratio ∞ = gate franc, filtres du déclencheur
  await nav('http://localhost:8765/plugins/ui/dev.html?fx=gate'); await sleep(600);
  const gkeys = [...fs.readFileSync(ROOT + 'plugins/pulse-gate/src/lib.rs', 'utf8').matchAll(/link_[bfe]!\(p, "(\w+)"/g)].map(m => m[1]).filter(k => k !== 'bypass');
  const G = JSON.parse(await ev(`(async () => {
    const sent = []; window.sendToPlugin = (m) => sent.push(m);
    const t = state.project.tracks[0];
    const open = !!document.querySelector('.plug-win');
    document.querySelector('.gate-listen').click();
    await new Promise(r => setTimeout(r, 60));
    const last = sent.filter(m => m.type === 'Set').pop();
    // le logiciel recharge un gate en expandeur 4:1 avec coupe-bas 150 Hz
    onPluginMessage({ type: 'params', values: { ...last.values, ratio: 4, hp: 150, lp: 20000, listen: 0 }, bypass: 0 });
    const back = { ...t.effectParams.gate };
    onPluginMessage({ type: 'meter', gr: 0, out: 0.5, gt: [0.3, 0.1] });
    return JSON.stringify({ open, values: last && last.values, back, m: PulseAudio.getGateMeter('t0') });
  })()`));
  check('gate : le panneau de Pulse s\'ouvre dans le plugin', G.open);
  check('gate : chaque réglage envoyé existe dans le plugin', G.values && Object.keys(G.values).every(k => gkeys.includes(k)) && gkeys.every(k => k in G.values), JSON.stringify(G.values));
  check('gate : gate franc = ratio ∞ (100) et Écouter envoyés', G.values && G.values.ratio === 100 && G.values.listen === 1, JSON.stringify(G.values));
  check('gate : réglages du logiciel rendus à la fenêtre (ratio, coupe-bas, pas de coupe-haut)', G.back.ratio === 4 && G.back.hp === 150 && !('lp' in G.back) && !G.back.listen, JSON.stringify(G.back));
  check('gate : afficheur du plugin lu par la fenêtre', G.m && G.m.e === 0.3 && G.m.g === 0.1, JSON.stringify(G.m));
  // EQ : tout le réglage voyage d'un bloc ; le spectre vient du plugin
  await nav('http://localhost:8765/plugins/ui/dev.html?fx=eq'); await sleep(600);
  const E = JSON.parse(await ev(`(async () => {
    const sent = []; window.sendToPlugin = (m) => sent.push(m);
    const t = state.project.tracks[0];
    const open = !!document.querySelector('.eq-panel.plug-win');
    const empty = (t.effectParams.eq.bands || []).length;
    document.querySelector('.eq-panel .eq-add, .eq-panel button[class*="add"]') ? document.querySelector('.eq-panel .eq-add, .eq-panel button[class*="add"]').click()
      : [...document.querySelectorAll('.eq-panel button')].find(b => /Point/.test(b.textContent)).click();
    await new Promise(r => setTimeout(r, 80));
    const last = sent.filter(m => m.type === 'Set').pop();
    // le logiciel recharge un EQ avec deux points
    onPluginMessage({ type: 'params', values: {}, bypass: 0, eq: { bands: [{ type: 'hpf', freq: 100, gain: 0, q: 0.7071 }, { type: 'bell', freq: 3000, gain: -4, q: 1 }] } });
    await new Promise(r => setTimeout(r, 150));
    const back = (t.effectParams.eq.bands || []).length;
    const pts = document.querySelectorAll('.eq-panel .eq-pt').length;
    // un spectre envoyé par le plugin est lu par l'analyseur de la fenêtre
    onPluginMessage({ type: 'spec', bins: Array.from({ length: 1024 }, (_, i) => i === 42 ? -10 : -90), sr: 44100 });
    const an = PulseAudio.getTrackSpectrum(0); const b = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(b);
    return JSON.stringify({ open, empty, sentBands: last && last.eq && (last.eq.bands || []).length, back, pts, peak: b.indexOf(Math.max(...b)), sr: PulseAudio.getContext().sampleRate });
  })()`));
  check('eq : le panneau d\'EQ de Pulse s\'ouvre dans le plugin, vide au départ', E.open && E.empty === 0, JSON.stringify(E));
  check('eq : un point ajouté part au plugin (tout le réglage)', E.sentBands === 1, JSON.stringify(E));
  check('eq : les points gardés par le logiciel reviennent dans la fenêtre', E.back === 2 && E.pts >= 2, JSON.stringify(E));
  check('eq : spectre du plugin lu par l\'analyseur (bonne case, bonne fréquence)', E.peak === 84 && E.sr === 44100, JSON.stringify(E));
  // Multibande et Multi-saturation : même recette que l'EQ (réglage complet)
  for (const fx of ['mband', 'msat']) {
    await nav(`http://localhost:8765/plugins/ui/dev.html?fx=${fx}`); await sleep(600);
    const M = JSON.parse(await ev(`(async () => {
      const sent = []; window.sendToPlugin = (m) => sent.push(m);
      const t = state.project.tracks[0];
      const open = !!document.querySelector('.mb-panel.plug-win');
      const start = JSON.stringify(t.effectParams[${JSON.stringify(fx)}]);
      // le logiciel recharge deux bandes
      const two = ${fx === 'mband' ? `{ bands: [{ lo: 20, hi: 200, thr: -30, range: -6 }, { lo: 200, hi: 20000, thr: -20, range: -3 }] }` : `{ bands: [{ base: true, sty: 'bande', va: 1, heat: 30 }, { lo: 2000, hi: 20000, sty: 'lampe', heat: 50 }] }`};
      onPluginMessage({ type: 'params', values: {}, bypass: 0, eq: two });
      await new Promise(r => setTimeout(r, 150));
      const back = (t.effectParams[${JSON.stringify(fx)}].bands || []).length;
      refreshPlaybackSoon(); t.effectParams[${JSON.stringify(fx)}].bands[0].thr = -33; refreshPlaybackSoon();
      await new Promise(r => setTimeout(r, 60));
      const last = sent.filter(m => m.type === 'Set').pop();
      onPluginMessage({ type: 'mb', g: [-4.5, 0], e: [-20, -40] });
      return JSON.stringify({ open, start, back, sent: last && last.eq && last.eq.bands.length, thr: last && last.eq && last.eq.bands[0].thr, m: PulseAudio.getMbandMeter('t0') });
    })()`));
    check(`${fx} : le panneau de Pulse s'ouvre dans le plugin`, M.open, M.start);
    check(`${fx} : les bandes gardées par le logiciel reviennent dans la fenêtre`, M.back === 2, JSON.stringify(M));
    check(`${fx} : un réglage touché part au plugin (tout le réglage)`, M.sent === 2 && M.thr === -33, JSON.stringify(M));
    if (fx === 'mband') check('mband : afficheur du plugin lu par la fenêtre', M.m && M.m.g[0] === -4.5, JSON.stringify(M.m));
  }
  // Effets simples (générés par new-live-plugins.py) : chaque bouton du panneau existe dans le plugin et part au plugin
  for (const fx of ['filter', 'crush', 'util', 'width', 'tremolo', 'phaser', 'flanger', 'chorus', 'doubler', 'slapback']) {
    await nav(`http://localhost:8765/plugins/ui/dev.html?fx=${fx}`); await sleep(400);
    const lk = [...fs.readFileSync(ROOT + `plugins/pulse-${fx}/src/lib.rs`, 'utf8').matchAll(/link_[bfe]!\(p, "(\w+)"/g)].map(m => m[1]).filter(k => k !== 'bypass');
    const L = JSON.parse(await ev(`(async () => {
      const sent = []; window.sendToPlugin = (m) => sent.push(m);
      const t = state.project.tracks[0];
      const defs = FX_PANEL_DEFS[${JSON.stringify(fx)}];
      const p = {}; defs.forEach(d => p[d.key] = d.toggle ? 1 : d.max);
      t.effectParams[${JSON.stringify(fx)}] = p; refreshPlaybackSoon();
      await new Promise(r => setTimeout(r, 50));
      const last = sent.filter(m => m.type === 'Set').pop();
      return JSON.stringify({ open: !!document.querySelector('.plug-win'), keys: defs.map(d => d.key), p, values: last && last.values });
    })()`));
    const miss = L.keys.filter(k => !lk.includes(k)), lost = L.keys.filter(k => !L.values || L.values[k] !== L.p[k]);
    check(`${fx} : panneau ouvert, chaque bouton existe dans le plugin et y part`, L.open && !miss.length && !lost.length, miss.length ? 'manque ' + miss : lost.length ? 'perdu ' + lost : lk.join(', '));
  }
};
