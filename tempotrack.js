// Pulse — piste de tempo façon Logic (chargé après studio.js, dont il utilise l'état et les fonctions)
// Une fine piste « Tempo » sous la règle : la ligne monte et descend en paliers.
//   Double-clic : nouveau changement à la mesure cliquée. Glisser un point : le tempo change (↕) ou le changement se déplace (↔, calé sur la mesure).
//   Clic droit : changer le tempo, la signature, supprimer. Pastille bleue de la règle : changer la signature.
// Données : project.tempos = [{ beat, bpm }], project.signatures = [{ bar, beats }] (calculs : tempo.js, PulseTempo)
// Le premier palier est le tempo du projet (project.bpm) : il se règle ici aussi, mais ne se supprime pas.

const TEMPO_MIN = 40, TEMPO_MAX = 240;
const TEMPO_KEY = 'pulse_tempo_lane';
const roundBpm = (b) => Math.round(Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, b)) * 10) / 10;

// Piste de tempo affichée ? (choix de chacun, retenu ; affichée d'office quand le morceau change de tempo)
function tempoLaneWanted() { try { return localStorage.getItem(TEMPO_KEY); } catch { return null; } }
function tempoLaneShown() { const w = tempoLaneWanted(); return w === '1' || (w !== '0' && tempoVaries()); }
function toggleTempoLane(force) {
    const on = force === undefined ? !tempoLaneShown() : !!force;
    try { localStorage.setItem(TEMPO_KEY, on ? '1' : '0'); } catch {}
    renderTempoLane();
    flash(on ? 'Piste de tempo : double-clic pour changer le tempo à une mesure, glisse un point pour régler (⌥T pour la cacher)' : 'Piste de tempo cachée (⌥T pour la revoir)');
}

// Remet la carte au propre : triée, sans doublon, sans changement qui ne change rien, jamais au début
function normalizeTempoMap(p = state.project) {
    const tempos = (p.tempos || []).filter(e => e && Number.isFinite(e.beat) && e.beat > 1e-6)
        .map(e => ({ beat: Math.round(e.beat * 1e6) / 1e6, bpm: roundBpm(e.bpm) })).sort((a, b) => a.beat - b.beat);
    const tOut = [];
    let prev = p.bpm;
    tempos.forEach(e => {
        if (tOut.length && Math.abs(tOut[tOut.length - 1].beat - e.beat) < 1e-6) { tOut[tOut.length - 1].bpm = e.bpm; prev = e.bpm; return; }
        tOut.push(e); prev = e.bpm;
    });
    // un changement vers le même tempo que le palier d'avant ne sert à rien
    const tClean = []; prev = p.bpm;
    tOut.forEach(e => { if (Math.abs(e.bpm - prev) > 1e-6) { tClean.push(e); prev = e.bpm; } });
    if (tClean.length) p.tempos = tClean; else delete p.tempos;

    const sigs = (p.signatures || []).filter(e => e && Number.isInteger(e.bar) && e.bar > 0)
        .map(e => ({ bar: e.bar, beats: Math.max(1, Math.min(12, Math.round(e.beats) || 4)) })).sort((a, b) => a.bar - b.bar);
    const sOut = []; let pb = bpb();
    sigs.forEach(e => {
        if (sOut.length && sOut[sOut.length - 1].bar === e.bar) { sOut[sOut.length - 1].beats = e.beats; return; }
        sOut.push(e);
    });
    const sClean = [];
    sOut.forEach(e => { if (e.beats !== pb) { sClean.push(e); pb = e.beats; } });
    if (sClean.length) p.signatures = sClean; else delete p.signatures;
}

// Après chaque modification : régions MIDI et clips calés, grille, règle, compteur, son
function tempoMapChanged() {
    normalizeTempoMap();
    syncBpmField();
    if (window.PulseAudio) PulseAudio.setMetronomeBpm(state.project.bpm);
    tempoWatchTick();
    renderRuler(); renderTimelineTracks(); updateChrono(); saveProject(); refreshPlaybackSoon();
}

// Paliers affichés : [{ beat, bpm, sec, first }]
function tempoPoints() {
    return PulseTempo.tempoSegments(state.project).map((s, i) => ({ beat: s.beat, bpm: s.bpm, sec: s.sec, first: i === 0 }));
}
// Échelle verticale de la piste (BPM → px), avec un peu d'air au-dessus et en dessous
function tempoScale(pts, h) {
    let lo = Math.min(...pts.map(p => p.bpm)), hi = Math.max(...pts.map(p => p.bpm));
    if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
    lo -= (hi - lo) * 0.15; hi += (hi - lo) * 0.15;
    const top = 5, bot = h - 5;
    return { y: (b) => bot - (b - lo) / (hi - lo) * (bot - top), perPx: (hi - lo) / (bot - top) };
}

function ensureTempoLane() {
    let lane = document.getElementById('tempoLane');
    if (lane) return lane;
    const ruler = document.getElementById('timelineRuler');
    lane = document.createElement('div');
    lane.className = 'tempo-lane'; lane.id = 'tempoLane'; lane.hidden = true;
    ruler.after(lane);
    const head = document.createElement('div');
    head.className = 'tempo-lane-head'; head.id = 'tempoLaneHead'; head.hidden = true;
    head.innerHTML = '<span class="tl-name">Tempo</span><span class="tl-bpm" id="tempoLaneBpm"></span><button class="tl-hide" data-tooltip="Cacher la piste de tempo (⌥T)" aria-label="Cacher la piste de tempo">×</button>';
    document.querySelector('.tracks-header').after(head);
    head.querySelector('.tl-hide').addEventListener('click', () => toggleTempoLane(false));
    bindTempoLane(lane);
    return lane;
}

function renderTempoLane() {
    if (!window.PulseTempo || !state.project || !document.getElementById('timelineRuler')) return;
    const lane = ensureTempoLane(), head = document.getElementById('tempoLaneHead');
    const shown = tempoLaneShown();
    lane.hidden = head.hidden = !shown;
    document.body.classList.toggle('tempo-lane-on', shown);
    const btn = document.getElementById('btnTempoLane');
    if (btn) btn.classList.toggle('active', shown);
    if (!shown) return;
    const pps = state.pxPerSecond, total = Math.max(180, computeProjectEndSec() + 60), W = Math.ceil(total * pps), H = lane.clientHeight || 30;
    lane.style.width = W + 'px'; lane.style.minWidth = '100%';
    const pts = tempoPoints(), sc = tempoScale(pts, H);
    let d = '', labels = '';
    pts.forEach((p, i) => {
        const x = p.sec * pps, y = sc.y(p.bpm);
        d += i ? ` V${y.toFixed(1)}` : `M0 ${y.toFixed(1)}`;
        const nx = i + 1 < pts.length ? pts[i + 1].sec * pps : W;
        d += ` H${nx.toFixed(1)}`;
        labels += `<span class="tl-lbl" style="left:${(x + 7).toFixed(1)}px;top:${Math.max(0, Math.min(H - 14, y - 15)).toFixed(1)}px">${p.bpm}</span>`;
    });
    const dots = pts.map((p, i) => `<circle class="tl-pt${p.first ? ' first' : ''}" data-i="${i}" cx="${(p.sec * pps).toFixed(1)}" cy="${sc.y(p.bpm).toFixed(1)}" r="4"/>`).join('');
    lane.innerHTML = `<svg class="tl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path class="tl-line" d="${d}"/>${dots}</svg>${labels}`;
    const bpmEl = document.getElementById('tempoLaneBpm');
    if (bpmEl) bpmEl.textContent = tempoVaries() ? `${pts.length} tempo${pts.length > 1 ? 's' : ''}` : '';
}

// Instant → mesure la plus proche (début), en temps
function nearestBarBeat(sec) {
    const p = state.project, b = PulseTempo.secToBeats(p, sec), pos = PulseTempo.beatsToBar(p, b);
    const a = PulseTempo.barToBeats(p, pos.bar), z = PulseTempo.barToBeats(p, pos.bar + 1);
    return { beat: b - a < z - b ? a : z, bar: b - a < z - b ? pos.bar : pos.bar + 1 };
}
const laneTime = (lane, e) => Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / state.pxPerSecond);

// Changer le tempo à partir d'une mesure (bar 0 = le tempo du projet)
function setTempoAtBeat(beat, bpm) {
    bpm = roundBpm(bpm);
    if (beat < 1e-6) { state.project.bpm = bpm; return; }
    const list = (state.project.tempos || []).filter(e => Math.abs(e.beat - beat) > 1e-6);
    list.push({ beat, bpm });
    state.project.tempos = list;
}
function removeTempoAtBeat(beat) {
    state.project.tempos = (state.project.tempos || []).filter(e => Math.abs(e.beat - beat) > 1e-6);
}
function setSignatureAtBar(bar, beats) {
    beats = Math.max(1, Math.min(12, Math.round(beats) || 4));
    if (bar <= 0) { state.project.beatsPerBar = beats; return; }
    const list = (state.project.signatures || []).filter(e => e.bar !== bar);
    list.push({ bar, beats });
    state.project.signatures = list;
}

async function askTempoAt(beat, current) {
    const p = state.project, bar = PulseTempo.beatsToBar(p, beat).bar + 1;
    const v = await pulseAsk(beat < 1e-6 ? 'Tempo du début du morceau (BPM)' : `Tempo à partir de la mesure ${bar} (BPM)`, String(current));
    if (v === null) return;
    const n = parseFloat(String(v).replace(',', '.'));
    if (!(n >= TEMPO_MIN && n <= TEMPO_MAX)) { flash(`Le tempo va de ${TEMPO_MIN} à ${TEMPO_MAX} BPM`); return; }
    if (Math.abs(roundBpm(n) - current) < 1e-6) { flash('Même tempo qu\'avant : rien ne change'); return; }
    pushUndo();
    setTempoAtBeat(beat, n);
    tempoMapChanged();
    flash(beat < 1e-6 ? `Le morceau commence à ${roundBpm(n)} BPM` : `À partir de la mesure ${bar} : ${roundBpm(n)} BPM — les régions MIDI, la grille et le métronome suivent, l'audio ne bouge pas`);
}
async function askSignatureAt(bar) {
    const p = state.project, cur = PulseTempo.beatsToBar(p, PulseTempo.barToBeats(p, bar)).beats;
    const v = await pulseAsk(bar === 0 ? 'Temps par mesure au début du morceau (3 = valse, 4 = le plus courant)' : `Temps par mesure à partir de la mesure ${bar + 1}`, String(cur));
    if (v === null) return;
    const n = parseInt(v, 10);
    if (!(n >= 1 && n <= 12)) { flash('Entre 1 et 12 temps par mesure'); return; }
    if (n === cur) { flash('Même signature qu\'avant : rien ne change'); return; }
    pushUndo();
    setSignatureAtBar(bar, n);
    tempoMapChanged();
    flash(bar === 0 ? `Le morceau commence en ${n}/4` : `À partir de la mesure ${bar + 1} : ${n}/4`);
}

// Petit menu (même look que les autres menus de Pulse)
function tempoMenu(x, y, items) {
    closeAllMenus();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200`;
    menu.innerHTML = items.map(it => it.sep ? '<div class="ctx-sep"></div>' : `<div class="ctx-item${it.danger ? ' ctx-danger' : ''}">${esc(it.label)}</div>`).join('');
    const real = items.filter(it => !it.sep);
    menu.querySelectorAll('.ctx-item').forEach((el, i) => el.addEventListener('click', () => { closeAllMenus(); real[i].action(); }));
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
}
// Clic droit sur la piste de tempo ou dans la règle, à l'instant `sec`
function openTempoMenuAt(x, y, sec, pointIdx = null) {
    const p = state.project, pts = tempoPoints();
    if (pointIdx !== null && pts[pointIdx]) {
        const pt = pts[pointIdx], bar = PulseTempo.beatsToBar(p, pt.beat).bar;
        tempoMenu(x, y, [
            { label: `Changer ce tempo (${pt.bpm} BPM)…`, action: () => askTempoAt(pt.beat, pt.bpm) },
            { label: 'Changer la signature ici…', action: () => askSignatureAt(bar) },
            ...(pt.first ? [] : [{ sep: true }, { label: 'Supprimer ce changement de tempo', danger: true, action: () => { pushUndo(); removeTempoAtBeat(pt.beat); tempoMapChanged(); flash('Changement de tempo supprimé'); } }])
        ]);
        return;
    }
    const nb = nearestBarBeat(sec);
    tempoMenu(x, y, [
        { label: `Changer le tempo à la mesure ${nb.bar + 1}…`, action: () => askTempoAt(nb.beat, PulseTempo.bpmAt(p, PulseTempo.beatsToSec(p, nb.beat))) },
        { label: `Changer la signature à la mesure ${nb.bar + 1}…`, action: () => askSignatureAt(nb.bar) },
        ...(tempoVaries() ? [{ sep: true }, { label: 'Revenir à un seul tempo (supprimer tous les changements)', danger: true, action: () => {
            pushUndo(); delete p.tempos; delete p.signatures; tempoMapChanged(); flash(`Un seul tempo : ${p.bpm} BPM, ${bpb()}/4`);
        } }] : []),
        { sep: true },
        { label: tempoLaneShown() ? 'Cacher la piste de tempo (⌥T)' : 'Afficher la piste de tempo (⌥T)', action: () => toggleTempoLane() }
    ]);
}

function bindTempoLane(lane) {
    lane.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        const dot = e.target.closest('.tl-pt');
        openTempoMenuAt(e.clientX, e.clientY, laneTime(lane, e), dot ? +dot.dataset.i : null);
    });
    // Double-clic dans le vide : nouveau changement à la mesure la plus proche, au tempo de l'endroit (puis on glisse ou on tape la valeur)
    lane.addEventListener('dblclick', (e) => {
        if (e.target.closest('.tl-pt')) { const pt = tempoPoints()[+e.target.closest('.tl-pt').dataset.i]; if (pt) askTempoAt(pt.beat, pt.bpm); return; }
        const p = state.project, nb = nearestBarBeat(laneTime(lane, e));
        askTempoAt(nb.beat, PulseTempo.bpmAt(p, PulseTempo.beatsToSec(p, nb.beat)));
    });
    // Glisser un point : ↕ change le tempo (Maj = au dixième), ↔ déplace le changement de mesure en mesure
    lane.addEventListener('mousedown', (e) => {
        const dot = e.target.closest('.tl-pt');
        if (!dot || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const p = state.project, pts = tempoPoints(), i = +dot.dataset.i, pt = pts[i];
        const sc = tempoScale(pts, lane.clientHeight || 30), y0 = e.clientY, x0 = e.clientX;
        let undone = false, beat = pt.beat, moved = false;
        const prevBeat = i > 0 ? pts[i - 1].beat : 0, nextBeat = i + 1 < pts.length ? pts[i + 1].beat : Infinity;
        const onMove = (ev) => {
            if (!moved && Math.abs(ev.clientY - y0) < 2 && Math.abs(ev.clientX - x0) < 4) return;
            if (!undone) { pushUndo(); undone = true; }
            moved = true;
            const step = ev.shiftKey ? 0.1 : 1;
            const bpm = Math.round(roundBpm(pt.bpm + (y0 - ev.clientY) * sc.perPx * (ev.shiftKey ? 0.2 : 1)) / step) * step;
            let nbeat = beat;
            if (!pt.first) {
                const nb = nearestBarBeat(Math.max(0, pt.sec + (ev.clientX - x0) / state.pxPerSecond));
                if (nb.beat > prevBeat + 1e-6 && nb.beat < nextBeat - 1e-6) nbeat = nb.beat;
            }
            if (!pt.first && Math.abs(nbeat - beat) > 1e-6) { removeTempoAtBeat(beat); beat = nbeat; }
            setTempoAtBeat(beat, bpm);
            renderTempoLane();
            const bar = PulseTempo.beatsToBar(p, beat).bar + 1;
            showTempoBubble(ev.clientX, ev.clientY, `${roundBpm(bpm)} BPM · mesure ${bar}`);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            hideTempoBubble();
            if (moved) tempoMapChanged();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

let _tempoBubble = null;
function showTempoBubble(x, y, txt) {
    if (!_tempoBubble) { _tempoBubble = document.createElement('div'); _tempoBubble.className = 'tempo-bubble'; document.body.appendChild(_tempoBubble); }
    _tempoBubble.textContent = txt;
    _tempoBubble.style.left = (x + 14) + 'px'; _tempoBubble.style.top = (y - 30) + 'px';
}
function hideTempoBubble() { if (_tempoBubble) { _tempoBubble.remove(); _tempoBubble = null; } }

// Règle : pastille de signature (clic = la changer), clic droit = menu tempo / signature
function bindTempoRuler() {
    const ruler = document.getElementById('timelineRuler');
    if (!ruler || ruler._tempoBound) return;
    ruler._tempoBound = true;
    ruler.addEventListener('mousedown', (e) => {
        const chip = e.target.closest('.ruler-sig');
        if (!chip) return;
        e.preventDefault(); e.stopImmediatePropagation();
        askSignatureAt(+chip.dataset.bar);
    }, true);
    ruler.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.marker')) return;
        e.preventDefault();
        const rect = ruler.getBoundingClientRect();
        openTempoMenuAt(e.clientX, e.clientY, Math.max(0, (e.clientX - rect.left) / state.pxPerSecond));
    });
}

function initTempoLane() {
    const hdr = document.querySelector('.tracks-header');
    if (hdr && !document.getElementById('btnTempoLane')) {
        const b = document.createElement('button');
        b.className = 'btn-tempo-lane'; b.id = 'btnTempoLane';
        b.setAttribute('data-tooltip', 'Piste de tempo : le tempo et la signature peuvent changer en cours de morceau (⌥T)');
        b.setAttribute('data-tooltip-placement', 'right');
        b.setAttribute('aria-label', 'Piste de tempo');
        b.textContent = '♩';
        hdr.insertBefore(b, document.getElementById('btnAddTrack'));
        b.addEventListener('click', () => toggleTempoLane());
    }
    document.addEventListener('keydown', (e) => {
        if (!(e.altKey && e.code === 'KeyT' && !e.metaKey && !e.ctrlKey)) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
        e.preventDefault(); toggleTempoLane();
    });
    bindTempoRuler();
    renderTempoLane();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTempoLane); else initTempoLane();
