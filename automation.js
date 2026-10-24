// Pulse — automation façon Logic (chargé après studio.js, dont il utilise l'état et les fonctions)
// Courbes par réglage (owner.automation[paramId]), pastille + menu de réglage, autosélection en mode A,
// modes d'écriture Read / Touch / Latch / Write, faders et boutons de plugin qui suivent les courbes pendant la lecture.
// Plan et avancement : AUTOMATION-PLAN.md

function openAutomationFor() { flash('En mode A, touche un réglage (fader, envoi, plugin…) : sa courbe s\'affiche sur la piste'); }

let _autoClip = null;   // courbe copiée (points entre 0 et 1, collables sur n'importe quel réglage)

// === Automation façon Logic ===
// owner.automation[paramId] = { points: [{ t (secondes), v (0..1, position dans la plage du réglage) }] }
// paramId : 'volume' (v = fraction du niveau du fader), 'pan', 'send:<id>', 'busSend:<id>', 'fx:<effet>:<réglage>'
// owner.autoParam = le réglage dont la courbe est affichée sur la piste (Volume par défaut)
const VOL_PAD = 7;
function autoOwnerKey(o) { const i = state.project.tracks.indexOf(o); return i >= 0 ? 't' + i : 'b' + o.id; }
function autoOwnerFromKey(k) { return k[0] === 't' ? state.project.tracks[+k.slice(1)] : busById(k.slice(1)); }
// Réglages d'effet que le moteur sait suivre pendant la lecture (les autres viendront effet par effet)
const AUTO_FX = { comp: ['threshold', 'ratio', 'mix', 'attack', 'release', 'knee', 'makeup'], delay: ['wet', 'feedback', 'dry'], reverb: ['wet'], filter: ['hpf', 'lpf'],
    deess: ['amount'], gate: ['threshold', 'release', 'reduction'], crush: ['bits', 'down', 'mix'], util: ['gain'], width: ['width'], pitch: ['semi', 'mix'],
    tremolo: ['rate', 'depth'], phaser: ['rate', 'depth', 'feedback', 'mix'], flanger: ['rate', 'depth', 'feedback', 'mix'], chorus: ['rate', 'depth', 'mix'],
    doubler: ['width', 'mix'], slapback: ['time', 'feedback', 'mix'] };
// EQ libre : fréquence et gain de chaque bande (repérées par leur place dans la liste)
const EQ_GAIN_TYPES = ['bell', 'lowshelf', 'highshelf', 'tilt'];
function eqAutoDefs(o) {
    const bands = o ? eqBandsOf((o.effectParams || {}).eq || {}) : [];
    return bands.flatMap((b, i) => [
        { key: `b${i}-freq`, label: `Bande ${i + 1} (${EQ_TYPES[b.type] || b.type}) · fréquence`, unit: ' Hz', min: 20, max: 20000, log: true, def: b.freq, band: i, field: 'freq' },
        ...(EQ_GAIN_TYPES.includes(b.type) ? [{ key: `b${i}-gain`, label: `Bande ${i + 1} (${EQ_TYPES[b.type] || b.type}) · gain`, unit: ' dB', min: -18, max: 18, def: b.gain || 0, band: i, field: 'gain' }] : [])
    ]);
}
function fxNumericDefs(name, o) { if (name === 'eq') return eqAutoDefs(o); return (FX_PANEL_DEFS[name] || []).filter(d => !d.choices && !d.toggle && d.min !== undefined && (AUTO_FX[name] || []).includes(d.key)); }
// Le moteur audio reçoit les plages de ces réglages (les courbes sont rangées entre 0 et 1)
if (window.PulseAudio && PulseAudio.setAutoRanges) PulseAudio.setAutoRanges(Object.fromEntries(Object.entries(AUTO_FX).flatMap(([fx, keys]) =>
    keys.map(k => (FX_PANEL_DEFS[fx] || []).find(d => d.key === k)).filter(Boolean).map(d => [`fx:${fx}:${d.key}`, { min: d.min, max: d.max, log: !!(d.log && d.min > 0) }]))));
function autoInfo(o, pid) {
    if (pid === 'volume') return { label: 'Volume', cur: () => 1, norm: v => v, denorm: v => v, fmt: v => Math.round(v * 100) + ' %' };
    const lin = (label, min, max, cur, fmt) => ({ label, cur, norm: v => Math.max(0, Math.min(1, (v - min) / (max - min))), denorm: n => min + n * (max - min), fmt });
    if (pid === 'pan') return lin('Gauche / droite', -100, 100, () => o.pan || 0, v => panLabel(Math.round(v)));
    const [kind, a, b] = pid.split(':');
    if (kind === 'send') { const sd = projectSends().find(x => x.id === a); return sd ? lin('Envoi · ' + sd.name, 0, 100, () => (o.sends || {})[a] || 0, v => Math.round(v)) : null; }
    if (kind === 'busSend') { const bs = busById(a); return bs ? lin('Envoi → ' + bs.name, 0, 100, () => (o.busSends || {})[a] || 0, v => Math.round(v)) : null; }
    if (kind === 'fx') {
        const d = fxNumericDefs(a, o).find(x => x.key === b); if (!d) return null;
        const cur = a === 'eq'
            ? () => { const bd = eqBandsOf((o.effectParams || {}).eq || {})[d.band]; return bd && bd[d.field] !== undefined ? bd[d.field] : d.def; }
            : () => { const v = (o.effectParams || {})[a] ? o.effectParams[a][b] : undefined; return v !== undefined ? v : d.def; };
        const label = (FX_NAMES[a] || a) + ' · ' + d.label;
        if (d.log && d.min > 0) return { label, cur, norm: v => Math.max(0, Math.min(1, Math.log(Math.max(v, d.min) / d.min) / Math.log(d.max / d.min))), denorm: n => d.min * Math.pow(d.max / d.min, n), fmt: v => Math.round(v * 10) / 10 + (d.unit || '') };
        return { ...lin(label, d.min, d.max, cur, v => Math.round(v * 10) / 10 + (d.unit || '')) };
    }
    return null;
}
function autoPts(o, pid, create = true) {
    if (!o.automation || !o.automation[pid]) { if (!create) return []; o.automation = o.automation || {}; o.automation[pid] = { points: [] }; }
    return o.automation[pid].points;
}
function volPoints(t) { return autoPts(t, 'volume'); }
function autoCurrent(o) { const pid = o.autoParam || 'volume'; const info = autoInfo(o, pid); if (info) return { pid, info }; o.autoParam = 'volume'; return { pid: 'volume', info: autoInfo(o, 'volume') }; }
function autoStatic(o, pid, info) { return info.norm(info.cur()); }
// Hauteur de la ligne qui porte la courbe : une piste ou un groupe
function ownerH(o) { return (state.project.buses || []).includes(o) ? (o.height || 36) : trackH(o); }
function volY(v, h = state.trackHeight) { return VOL_PAD + (1 - v) * (h - 2 * VOL_PAD); }
function volFromY(y, h = state.trackHeight) { return Math.max(0, Math.min(1, 1 - (y - VOL_PAD) / (h - 2 * VOL_PAD))); }
function volCurveInner(t, widthPx) {
    const H = ownerH(t);
    const { pid, info } = autoCurrent(t);
    const pts = autoPts(t, pid, false).slice().sort((a, b) => a.t - b.t);
    const flat = autoStatic(t, pid, info);
    const first = pts.length ? pts[0].v : flat, last = pts.length ? pts[pts.length - 1].v : flat;
    const line = [`0,${volY(first, H)}`, ...pts.map(p => `${(p.t * state.pxPerSecond).toFixed(1)},${volY(p.v, H).toFixed(1)}`), `${widthPx},${volY(last, H)}`].join(' ');
    return `<polygon class="vol-fill" points="0,${H} ${line} ${widthPx},${H}"/>
        <polyline class="vol-line ${pts.length ? '' : 'is-flat'}" points="${line}"/>
        ${pts.map(p => `<circle class="vol-pt${autoIsSel(t, pid, p) ? ' is-sel' : ''}" cx="${(p.t * state.pxPerSecond).toFixed(1)}" cy="${volY(p.v, H).toFixed(1)}" r="5" data-t="${p.t}"><title>${esc(info.label)} : ${esc(String(info.fmt(info.denorm(p.v))))}</title></circle>`).join('')}`;
}
// Pastille « réglage affiché » (menu : tout ce qui peut s'automatiser), collée à gauche de la zone visible
function autoChip(o) {
    const { pid, info } = autoCurrent(o);
    return `<button class="auto-chip" data-owner="${esc(autoOwnerKey(o))}" data-mode="${autoModeOf(o)}" data-tooltip="Réglage dessiné sur cette piste et mode d'écriture : clique pour changer. En touchant un réglage (fader, envoi, plugin) en mode A, sa courbe s'affiche ici toute seule ; pendant la lecture, ton geste s'écrit (Touch)"><b>${esc((AUTO_MODES.find(m => m[0] === autoModeOf(o)) || AUTO_MODES[1])[1])}</b> ${esc(info.label)}${autoPts(o, pid, false).length ? ' ●' : ''} ▾</button>`;
}
function renderVolumeCurve(t, i, widthPx) {
    return `<svg class="vol-curve" data-i="${i}" width="${widthPx}" height="${trackH(t)}">${volCurveInner(t, widthPx)}</svg>`;   // pastille : dans l'en-tête de la piste
}
function renderBusCurve(bus, widthPx) {
    return `<svg class="vol-curve" data-bus="${esc(bus.id)}" width="${widthPx}" height="${ownerH(bus)}">${volCurveInner(bus, widthPx)}</svg>${autoChip(bus)}`;
}
// Pastilles (en-tête de piste ou ligne de groupe) : un seul écouteur pour toutes, et mise à jour sur place
document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.auto-chip')) e.stopPropagation(); }, true);
document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('.auto-chip'); if (!chip) return;
    e.stopPropagation();
    const o = autoOwnerFromKey(chip.dataset.owner); if (o) openAutoParamMenu(chip, o);
}, true);
function refreshAutoChips() {
    document.querySelectorAll('.auto-chip').forEach(chip => {
        const o = autoOwnerFromKey(chip.dataset.owner); if (!o) return;
        const tmp = document.createElement('div'); tmp.innerHTML = autoChip(o);
        const fresh = tmp.firstElementChild; if (fresh && fresh.outerHTML !== chip.outerHTML) chip.replaceWith(fresh);
    });
}
// Liste de ce qui s'automatise sur une piste ou un groupe
function autoParamGroups(o) {
    const groups = [['Réglages de base', ['volume', 'pan']]];
    if (!o.premaster && !o.locked) {
        const sd = projectSends().map(x => 'send:' + x.id).concat(Object.keys(o.busSends || {}).filter(id => busById(id)).map(id => 'busSend:' + id));
        if (sd.length) groups.push(['Envois', sd]);
        (o.effects || []).filter(n => n !== 'limit' && n !== 'master').forEach(n => {
            const ids = fxNumericDefs(n, o).map(d => `fx:${n}:${d.key}`);
            if (ids.length) groups.push([FX_NAMES[n] || n, ids]);
        });
    }
    return groups;
}
function openAutoParamMenu(anchor, o) {
    closeAllMenus();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.max(8, Math.min(r.left, window.innerWidth - 250))}px;top:${Math.max(8, Math.min(r.bottom + 2, window.innerHeight - 380))}px;z-index:300;min-width:230px;max-height:70vh;overflow:auto`;
    const cur = autoCurrent(o).pid;
    const mh = document.createElement('div'); mh.className = 'ctx-head'; mh.textContent = 'Mode d\'écriture'; menu.appendChild(mh);
    AUTO_MODES.forEach(([m, name, tip]) => {
        const it = document.createElement('div'); it.className = 'ctx-item';
        it.textContent = (autoModeOf(o) === m ? '✓ ' : '   ') + name + ' — ' + tip;
        it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); if (m === 'touch') delete o.autoMode; else o.autoMode = m; saveProject(); renderTimelineTracks(); refreshAutoChips(); flash(`Mode ${name} : ${tip}`); });
        menu.appendChild(it);
    });
    autoParamGroups(o).forEach(([title, ids]) => {
        const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = title; menu.appendChild(h);
        ids.forEach(pid => {
            const info = autoInfo(o, pid); if (!info) return;
            const it = document.createElement('div'); it.className = 'ctx-item';
            const has = autoPts(o, pid, false).length > 0;
            it.textContent = (pid === cur ? '✓ ' : '   ') + info.label.replace(/^.*? · /, '') + (has ? '  ●' : '');
            it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); o.autoParam = pid; saveProject(); renderTimelineTracks(); refreshAutoChips(); });
            menu.appendChild(it);
        });
    });
    // Copier / coller la courbe affichée (vers un autre réglage ou une autre piste)
    {
        const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = 'Courbe'; menu.appendChild(h);
        const add = (label, run) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.textContent = label; it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); run(); }); menu.appendChild(it); };
        if (autoPts(o, cur, false).length) add('Copier la courbe affichée', () => {
            _autoClip = { pts: JSON.parse(JSON.stringify(autoPts(o, cur, false))), label: autoInfo(o, cur).label };
            flash(`Courbe copiée (${_autoClip.label}) : choisis un autre réglage ou une autre piste, puis « Coller la courbe »`);
        });
        if (_autoClip) add(`Coller la courbe (${_autoClip.label})`, () => {
            pushUndo(); autoPts(o, cur, true).splice(0, Infinity, ...JSON.parse(JSON.stringify(_autoClip.pts)));
            saveProject(); refreshPlaybackSoon(); renderTimelineTracks(); refreshAutoChips();
            flash(`Courbe collée sur « ${autoInfo(o, cur).label} » (⌘Z pour annuler)`);
        });
    }
    // Effacer (comme Logic : « Supprimer l'automation visible » / « Supprimer toute l'automation de la piste »)
    const used = Object.keys(o.automation || {}).filter(k => autoPts(o, k, false).length);
    if (used.length) {
        const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = 'Effacer'; menu.appendChild(h);
        const add = (label, run) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.textContent = label; it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); pushUndo(); run(); saveProject(); refreshPlaybackSoon(); renderTimelineTracks(); refreshAutoChips(); }); menu.appendChild(it); };
        if (autoPts(o, cur, false).length) add(`Effacer la courbe affichée (${autoInfo(o, cur).label})`, () => { delete o.automation[cur]; flash('Courbe effacée (⌘Z pour la retrouver)'); });
        add(`Effacer toute l'automation de ${state.project.tracks.includes(o) ? 'la piste' : 'ce groupe'} (${used.length})`, () => { o.automation = {}; flash('Automation effacée (⌘Z pour la retrouver)'); });
    }
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
}
// Autosélection (comme Logic) : en mode A, toucher un réglage affiche sa courbe sur la piste
let _autoRaf = 0;
function autoSelectParam(o, pid) {
    if (!state.automationMode || !o || !autoInfo(o, pid) || (o.autoParam || 'volume') === pid) return;
    o.autoParam = pid; saveProject();
    cancelAnimationFrame(_autoRaf); _autoRaf = requestAnimationFrame(() => { renderTimelineTracks(); refreshAutoChips(); });
}
function autoTargetOf(el) {
    const fxp = el.closest('.fx-panel.plug-win');
    if (fxp) {
        const o = fxp._plugT, isOwner = o && (state.project.tracks.includes(o) || (state.project.buses || []).includes(o));   // pas les effets d'une région
        const c = el.closest('.fx-slider, .fx-knob, .fx-val'); return c && c.dataset.key && isOwner ? { o, pid: `fx:${fxp.dataset.fx}:${c.dataset.key}` } : null;
    }
    let o = null;
    const strip = el.closest('.insp-strip, .strip[data-kind]');
    if (strip) {
        const insp = strip.classList.contains('insp-strip');
        if (strip.dataset.kind === 'track') o = state.project.tracks[insp ? state.selectedTrack : +strip.dataset.i];
        else if (strip.dataset.kind === 'bus') o = insp ? busById(strip.dataset.id) : (state.project.buses || [])[+strip.dataset.i];
        if (!o) return null;
        const row = el.closest('.send-bar-row, .strip-send-row');
        if (row) return row.dataset.send ? { o, pid: 'send:' + row.dataset.send } : row.dataset.bsend ? { o, pid: 'busSend:' + row.dataset.bsend } : null;
        if (el.closest('.insp-pan, .strip-pan')) return { o, pid: 'pan' };
        if (el.closest('.fader, .strip-fader-wrap')) return { o, pid: 'volume' };
        return null;
    }
    const tv = el.closest('.t-vol, .t-knob');
    if (tv) { o = state.project.tracks[+tv.dataset.i]; return o ? { o, pid: tv.classList.contains('t-knob') ? 'pan' : 'volume' } : null; }
    return null;
}
['mousedown', 'wheel'].forEach(ev => document.addEventListener(ev, (e) => {
    if (!state.automationMode || !e.target.closest) return;
    const tg = autoTargetOf(e.target);
    if (!tg) return;
    const info = autoInfo(tg.o, tg.pid), k = autoOwnerKey(tg.o) + '|' + tg.pid;
    if (info && !_autoW.has(k)) _autoPre.set(k, { norm: info.norm(info.cur()), vol: tg.o.volume ?? 100 });
    autoSelectParam(tg.o, tg.pid);
}, { capture: true, passive: true }));
// === Écriture d'automation pendant la lecture (modes de Logic) ===
// Read : la courbe est lue, on n'écrit rien · Touch (défaut) : on écrit tant qu'on tient le réglage, au relâchement on retrouve la courbe
// Latch : on continue d'écrire la dernière valeur jusqu'à l'arrêt · Write : comme Latch, et la courbe est effacée depuis le départ de la lecture
const AUTO_MODES = [['read', 'Read', 'lit la courbe sans la changer'], ['touch', 'Touch', 'écrit tant que tu tiens le réglage, puis revient à la courbe'], ['latch', 'Latch', 'écrit jusqu\'à l\'arrêt de la lecture'], ['write', 'Write', 'réécrit tout depuis le départ de la lecture']];
function autoModeOf(o) { return o.autoMode || 'touch'; }
const _autoW = new Map();
const _autoPre = new Map();   // valeur de chaque réglage au moment où on le touche   // réglage en cours d'écriture → { o, pid, snap, start, lastT, lastV, base, held }
let _autoPlayFrom = 0, _autoTick = 0, _autoDrawRaf = 0;
function curveAt(pts, t, dflt) {
    if (!pts.length) return dflt;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t); }
    return pts[pts.length - 1].v;
}
function autoRedrawSoon() { cancelAnimationFrame(_autoDrawRaf); _autoDrawRaf = requestAnimationFrame(() => { if (state.automationMode) { renderTimelineTracks(); refreshAutoChips(); } }); }
// Ajoute la valeur v à l'instant t en effaçant ce qui était écrit depuis le dernier point
function autoPutPoint(w, t, v) {
    const pts = autoPts(w.o, w.pid);
    const from = w.lastT ?? w.start, tr = Math.round(t * 1000) / 1000;
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i].t > from + 1e-6 && pts[i].t <= tr) pts.splice(i, 1);
    pts.push({ t: tr, v: Math.round(v * 1000) / 1000 });
    pts.sort((a, b) => a.t - b.t);
    w.lastT = tr; w.lastV = v;
}
function autoWriteSample(o, pid) {
    if (!state.automationMode || !state.playing || state.recording || !o) return;
    const mode = autoModeOf(o); if (mode === 'read') return;
    const info = autoInfo(o, pid); if (!info) return;
    const now = PulseAudio.getPlaybackPosition();
    const k = autoOwnerKey(o) + '|' + pid;
    let w = _autoW.get(k);
    if (!w) {
        pushUndo();
        const pts = autoPts(o, pid);
        const snap = pts.slice().sort((a, b) => a.t - b.t);
        const pre = _autoPre.get(k);   // la valeur d'AVANT le geste (le réglage a déjà bougé quand on arrive ici)
        const flat = pre ? pre.norm : autoStatic(o, pid, info);
        w = { o, pid, snap, flat, start: mode === 'write' ? _autoPlayFrom : now, base: pid === 'volume' ? (pre ? pre.vol : (o.volume ?? 100)) : null, held: true };
        _autoW.set(k, w);
        // Point de départ : la valeur que la courbe avait juste avant (rien ne change avant ce moment)
        const t0 = Math.max(0, w.start - 0.01);
        const a = { t: Math.round(t0 * 1000) / 1000, v: curveAt(snap, t0, flat) };
        if (mode === 'write') { for (let i = pts.length - 1; i >= 0; i--) if (pts[i].t >= t0 && pts[i].t <= now) pts.splice(i, 1); }
        pts.push(a); pts.sort((x, y) => x.t - y.t);
        o.autoParam = pid;
        if (!_autoTick) _autoTick = setInterval(autoLatchTick, 60);
    }
    w.held = true;
    const v = pid === 'volume' ? Math.max(0, Math.min(1, (o.volume ?? 100) / Math.max(1, w.base))) : info.norm(info.cur());
    if (w.lastT !== undefined && now - w.lastT < 0.04 && Math.abs(v - w.lastV) < 0.002) return;
    autoPutPoint(w, now, v);
    autoRedrawSoon();
}
// Latch / Write : la dernière valeur continue de s'écrire même sans toucher
function autoLatchTick() {
    if (!state.playing || !_autoW.size) { clearInterval(_autoTick); _autoTick = 0; return; }
    const now = PulseAudio.getPlaybackPosition();
    _autoW.forEach(w => { if (!w.held && autoModeOf(w.o) !== 'touch' && now - (w.lastT ?? 0) > 0.05) autoPutPoint(w, now, w.lastV); });
}
// Relâchement : Touch rend la main à la courbe d'avant (et le fader revient à sa place)
function autoRelease() {
    if (!_autoW.size) return;
    const now = state.playing ? PulseAudio.getPlaybackPosition() : null;
    let done = false;
    _autoW.forEach((w, k) => {
        w.held = false;
        if (autoModeOf(w.o) !== 'touch') return;
        if (now !== null) { const t = now + 0.03; autoPutPoint(w, t, curveAt(w.snap, t, w.flat)); }
        autoEndWriter(w); _autoW.delete(k); done = true;
    });
    if (done) { saveProject(); autoRedrawSoon(); }
}
function autoEndWriter(w) {
    if (w.pid === 'volume' && w.base !== null) {   // le volume écrit est dans la courbe : le fader reprend son niveau de départ
        w.o.volume = w.base;
        const ti = state.project.tracks.indexOf(w.o);
        if (ti >= 0) { PulseAudio.updateTrackVolume(ti, w.base); syncInspectorVolume(ti); }
        else if (PulseAudio.updateBusVolume) PulseAudio.updateBusVolume(w.o.id, w.o.muted ? 0 : w.base);
    }
}
// Arrêt de la lecture : Latch / Write posent la dernière valeur à l'endroit de l'arrêt
function autoStopAll(pos) {
    if (!_autoW.size) return;
    _autoW.forEach(w => { if (pos !== null && w.lastV !== undefined) autoPutPoint(w, pos, w.lastV); autoEndWriter(w); });
    _autoW.clear(); clearInterval(_autoTick); _autoTick = 0;
    saveProject(); setTimeout(() => { if (state.automationMode) { renderTimelineTracks(); refreshAutoChips(); } }, 0);
}
document.addEventListener('input', (e) => {
    if (!state.automationMode || !state.playing || !e.target.closest) return;
    const tg = autoTargetOf(e.target);
    if (tg) autoWriteSample(tg.o, tg.pid);
});
document.addEventListener('mouseup', () => autoRelease(), true);
let _autoWheelT = 0;
document.addEventListener('wheel', () => { if (_autoW.size) { clearTimeout(_autoWheelT); _autoWheelT = setTimeout(autoRelease, 350); } }, true);
if (window.PulseAudio && !PulseAudio._autoWrapped) {
    const _play = PulseAudio.play, _stop = PulseAudio.stopAll;
    PulseAudio.play = function (project, from) { if (!_autoW.size) _autoPlayFrom = from || 0; return _play.apply(this, arguments); };
    PulseAudio.stopAll = function () { let pos = null; try { pos = PulseAudio.getPlaybackPosition(); } catch {} autoStopAll(pos); return _stop.apply(this, arguments); };
    PulseAudio._autoWrapped = true;
}

// Comme Logic : pendant la lecture, le fader, le gauche/droite et les envois de la tranche suivent leur courbe (affichage seulement)
function autoFollowTick() {
    if (!state.playing) return;
    const now = PulseAudio.getPlaybackPosition();
    document.querySelectorAll('#inspector .insp-strip[data-kind="track"], #inspector .insp-strip[data-kind="bus"]').forEach(strip => {
        const o = strip.dataset.kind === 'track' ? state.project.tracks[state.selectedTrack] : busById(strip.dataset.id);
        if (!o || !o.automation) return;
        const key = autoOwnerKey(o) + '|';
        const val = (pid) => { if (_autoW.has(key + pid)) return null; const pts = autoPts(o, pid, false); return pts.length ? curveAt(pts.slice().sort((a, b) => a.t - b.t), now, 0) : null; };
        const vv = val('volume');
        const f = strip.querySelector('.insp-fader');
        if (vv !== null && f && document.activeElement !== f) {
            const vol = (o.volume ?? 100) * vv;
            f.value = volToPos(vol);
            const d = strip.querySelector('.strip-db'); if (d) d.textContent = `${volumeToDb(vol)} dB`;
        }
        const pv = val('pan'), pan = strip.querySelector('.insp-pan-input');
        if (pv !== null && pan && document.activeElement !== pan) pan.value = Math.round(-100 + 200 * pv);
        strip.querySelectorAll('.send-bar-row').forEach(row => {
            const sv = val(row.dataset.send ? 'send:' + row.dataset.send : 'busSend:' + row.dataset.bsend);
            if (sv === null || row.classList.contains('turning')) return;
            const lv = Math.round(sv * 100);
            row.style.setProperty('--lvl', lv + '%'); const e = row.querySelector('.sb-val'); if (e) e.textContent = lv;
            row.classList.toggle('on', lv > 0);
        });
    });
}
// Fenêtres de plugin ouvertes : leurs boutons suivent aussi les courbes
const _plugShown = new Set();
function autoFollowPlugs() {
    const now = state.playing ? PulseAudio.getPlaybackPosition() : null;
    document.querySelectorAll('.fx-panel.plug-win').forEach(panel => {
        const o = panel._plugT, fx = panel.dataset.fx;
        if (!o || !o.automation || !panel._autoShow) return;
        Object.keys(o.automation).filter(k => k.startsWith(`fx:${fx}:`)).forEach(pid => {
            const key = pid.split(':')[2], tag = autoOwnerKey(o) + '|' + pid;
            const pts = autoPts(o, pid, false);
            if (now === null || !pts.length || _autoW.has(tag)) {
                if (_plugShown.has(tag)) { _plugShown.delete(tag); panel._autoRestore(key); }
                return;
            }
            const info = autoInfo(o, pid); if (!info) return;
            panel._autoShow(key, info.denorm(curveAt(pts.slice().sort((a, b) => a.t - b.t), now, 0)));
            _plugShown.add(tag);
        });
    });
}
setInterval(() => { autoFollowTick(); autoFollowPlugs(); }, 50);

// Points choisis (Maj + glisser = rectangle, Maj + clic = ajouter / retirer) : ils bougent ensemble, Suppr les efface
let _autoSel = null;   // { o, pid, set: Set(points) }
function autoIsSel(o, pid, p) { return !!(_autoSel && _autoSel.o === o && _autoSel.pid === pid && _autoSel.set.has(p)); }
function autoSelect(o, pid, list, add) {
    if (!add || !_autoSel || _autoSel.o !== o || _autoSel.pid !== pid) _autoSel = { o, pid, set: new Set() };
    list.forEach(p => { if (add && _autoSel.set.has(p) && list.length === 1) _autoSel.set.delete(p); else _autoSel.set.add(p); });
    if (!_autoSel.set.size) _autoSel = null;
}
document.addEventListener('keydown', (e) => {
    if (!_autoSel || !state.automationMode || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault(); e.stopPropagation();
    pushUndo();
    const { o, pid, set } = _autoSel;
    const pts = autoPts(o, pid, false);
    for (let i = pts.length - 1; i >= 0; i--) if (set.has(pts[i])) pts.splice(i, 1);
    if (!pts.length && o.automation) delete o.automation[pid];
    const n = set.size; _autoSel = null;
    saveProject(); refreshPlaybackSoon(); renderTimelineTracks(); refreshAutoChips();
    flash(`${n} point${n > 1 ? 's' : ''} d'automation effacé${n > 1 ? 's' : ''} (⌘Z pour annuler)`);
}, true);
function bindVolumeCurves() {
    document.querySelectorAll('.vol-curve').forEach(svg => {
        const track = svg.dataset.bus
            ? (state.project.buses || []).find(b => b.id === svg.dataset.bus)
            : state.project.tracks[parseInt(svg.dataset.i)];
        if (!track) return;
        const width = parseFloat(svg.getAttribute('width'));
        const redraw = () => { svg.innerHTML = volCurveInner(track, width); };
        const curPts = () => autoPts(track, autoCurrent(track).pid);
        const round = (v) => autoCurrent(track).pid === 'volume' ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000;
        svg.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            // Le point le plus proche du clic (le dessin est refait entre les deux clics, on ne peut pas se fier à la cible)
            const rect = svg.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            const pts = curPts();
            let k = -1, best = 12;
            pts.forEach((p, n) => { const d = Math.hypot(p.t * state.pxPerSecond - x, volY(p.v, ownerH(track)) - y); if (d < best) { best = d; k = n; } });
            if (k < 0) return;
            pushUndo();
            pts.splice(k, 1);
            redraw(); saveProject(); refreshPlaybackSoon();
        });
        svg.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const pos = (ev) => ({ t: Math.max(0, (ev.clientX - rect.left) / state.pxPerSecond), v: volFromY(ev.clientY - rect.top, ownerH(track)) });
            const cur = autoCurrent(track);
            const pts = curPts();
            // Point existant sous la souris ? (recherche par distance, plus fiable que la cible du clic)
            let pt = null, best = 9;
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            pts.forEach(p => { const d = Math.hypot(p.t * state.pxPerSecond - mx, volY(p.v, ownerH(track)) - my); if (d < best) { best = d; pt = p; } });
            // Maj : choisir plusieurs points (clic = ajouter / retirer, glisser dans le vide = rectangle)
            if (e.shiftKey) {
                if (pt) { autoSelect(track, cur.pid, [pt], true); redraw(); return; }
                const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                box.setAttribute('class', 'vol-sel-box'); svg.appendChild(box);
                const draw = (ev) => {
                    const x1 = ev.clientX - rect.left, y1 = ev.clientY - rect.top;
                    box.setAttribute('x', Math.min(mx, x1)); box.setAttribute('y', Math.min(my, y1));
                    box.setAttribute('width', Math.abs(x1 - mx)); box.setAttribute('height', Math.abs(y1 - my));
                };
                const end = (ev) => {
                    document.removeEventListener('mousemove', draw); document.removeEventListener('mouseup', end);
                    const x1 = ev.clientX - rect.left, y1 = ev.clientY - rect.top;
                    const [xa, xb, ya, yb] = [Math.min(mx, x1), Math.max(mx, x1), Math.min(my, y1), Math.max(my, y1)];
                    const inBox = pts.filter(p => { const px = p.t * state.pxPerSecond, py = volY(p.v, ownerH(track)); return px >= xa && px <= xb && py >= ya && py <= yb; });
                    autoSelect(track, cur.pid, inBox, true); redraw();
                    if (inBox.length) flash(`${_autoSel ? _autoSel.set.size : 0} point(s) choisi(s) : glisse-en un pour les déplacer ensemble, Suppr pour les effacer`);
                };
                draw(e);
                document.addEventListener('mousemove', draw); document.addEventListener('mouseup', end);
                return;
            }
            // Un point choisi parmi plusieurs : ils bougent tous du même écart
            const group = pt && autoIsSel(track, cur.pid, pt) && _autoSel.set.size > 1 ? [..._autoSel.set].map(p => ({ p, t0: p.t, v0: p.v })) : null;
            if (!group) _autoSel = pt ? { o: track, pid: cur.pid, set: new Set([pt]) } : null;
            const start = pos(e);
            // On ne touche au dessin que s'il y a un vrai changement : sinon le double-clic (suppression) ne passerait pas
            let changed = false;
            if (!pt) {
                pushUndo();
                const at = pos(e);
                // Premier point posé : on ancre aussi la valeur actuelle au tout début, sinon toute la piste changerait
                if (!pts.length && at.t > 0.05) pts.push({ t: 0, v: autoStatic(track, cur.pid, cur.info) });
                pt = { t: at.t, v: round(at.v) };
                pts.push(pt);
                changed = true;
                redraw();
            }
            const onMove = (ev) => {
                if (!changed) { pushUndo(); changed = true; }
                const at = pos(ev);
                if (group) group.forEach(g => { g.p.t = Math.max(0, g.t0 + at.t - start.t); g.p.v = round(Math.max(0, Math.min(1, g.v0 + at.v - start.v))); });
                else { pt.t = at.t; pt.v = round(at.v); }
                redraw();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (!changed) return;
                pts.sort((a, b) => a.t - b.t);
                redraw(); saveProject(); refreshPlaybackSoon();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

// === L'automation suit les régions déplacées (réglage, comme Logic) ===
function autoFollowRegions() { try { return localStorage.getItem('pulse_auto_follow_regions') === '1'; } catch { return false; } }
// Les points de la piste `from` entre a et b partent sur `to`, décalés de `delta` secondes.
// Autour, la courbe ne change pas : on pose des points d'appui aux bords (comme Logic).
function moveAutomationWithRegion(from, to, a, b, delta) {
    if (!from || !to || !from.automation || (from === to && Math.abs(delta) < 1e-6)) return;
    const r = (x) => Math.round(x * 1000) / 1000;
    Object.keys(from.automation).forEach(pid => {
        const src = autoPts(from, pid, false).slice().sort((p, q) => p.t - q.t);
        if (!src.length) return;
        const inside = src.filter(p => p.t >= a && p.t <= b);
        if (!inside.length) return;
        const dflt = src[0].v;
        const va = curveAt(src, a, dflt), vb = curveAt(src, b, dflt);
        // 1. la piste de départ : les points de la région partent, les bords gardent la courbe d'avant
        const rest = src.filter(p => p.t < a || p.t > b);
        const before = rest.filter(p => p.t < a), after = rest.filter(p => p.t > b);
        const keepA = before.length ? curveAt(src, a - 1e-3, dflt) : null, keepB = after.length ? curveAt(src, b + 1e-3, dflt) : null;
        from.automation[pid].points = [...before, ...(keepA !== null ? [{ t: r(a - 1e-3), v: keepA }] : []), ...(keepB !== null ? [{ t: r(b + 1e-3), v: keepB }] : []), ...after];
        if (!from.automation[pid].points.length) delete from.automation[pid];
        // 2. la piste d'arrivée : la courbe de la région remplace ce qu'il y avait à cet endroit
        const na = a + delta, nb = b + delta;
        const dst = autoPts(to, pid, true);
        const old = dst.slice().sort((p, q) => p.t - q.t);
        const outside = old.filter(p => p.t < na - 1e-3 || p.t > nb + 1e-3);
        // Points d'appui juste à l'extérieur : la courbe d'avant reprend exactement là où la région s'arrête
        const edgeA = old.some(p => p.t <= na) ? [{ t: r(Math.max(0, na - 2e-3)), v: curveAt(old, na, old[0].v) }] : [];
        const edgeB = old.some(p => p.t >= nb) ? [{ t: r(nb + 2e-3), v: curveAt(old, nb, old[0].v) }] : [];
        const moved = [{ t: r(Math.max(0, na)), v: va }, ...inside.map(p => ({ t: r(Math.max(0, p.t + delta)), v: p.v })), { t: r(nb), v: vb }];
        to.automation[pid].points = [...outside, ...edgeA, ...moved, ...edgeB].sort((p, q) => p.t - q.t);
    });
}
