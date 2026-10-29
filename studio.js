// === Pulse — Studio logic (proto UI) ===
// Pas de moteur audio pour l'instant — on monte l'interface d'abord.

const TRACK_ICONS = {
    audio: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line>',
    beat:  '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>',
    inst:  '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>',
    keys:  '<rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M7 5v9M12 5v9M17 5v9"></path>',
    drums: '<ellipse cx="12" cy="8" rx="8" ry="3"></ellipse><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8"></path><path d="M3 3l6 5M21 3l-6 5"></path>'
};

const COLORS = ['#A855F7', '#7C3AED', '#C084FC', '#F472B6', '#60A5FA', '#34D399'];
// Panneau de couleurs (Option + C) : 12 teintes × 5 tons + gris
const COLOR_HUES = [0, 20, 38, 52, 85, 140, 165, 190, 215, 250, 285, 330];
const COLOR_TONES = [[85, 78], [75, 68], [68, 58], [60, 46], [48, 34]];   // saturation %, clarté %
function hslHex(h, sat, l) {
    sat /= 100; l /= 100;
    const a = sat * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
// Une couleur par famille de piste : voix = violet, piano = turquoise, batterie = orange, instru/beat = rose
const TYPE_COLORS = { audio: '#A855F7', keys: '#22D3EE', drums: '#F59E0B', inst: '#F472B6', beat: '#F472B6' };

// Piste d'instru : modèle (preset), ancien type « instru » ou piste créée par le menu + (« inst »)
// Auto-Tune affiché sur une piste de voix seulement s'il a été ajouté (ou fourni par le modèle) : un projet vide n'en a pas
// PulseTune est un effet comme les autres : sur n'importe quelle piste (voix, instrument…), seulement si on l'a ajouté
function showTuneSlot(t) { return !!t && !t.premaster && !!(t.tuneSlot || t.autotune); }
function isVoiceTrack(t) { return !!t && (t.type === 'audio' || !t.type) && !t.isCapture && !isInstruTrack(t); }
function isInstruTrack(t) { return !!t && (t.preset === 'instru' || t.type === 'instru' || t.type === 'inst'); }

// Petit helper d'échappement HTML — pour tous les noms user-provided
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- Charger le projet (depuis le start screen) ---
function loadProject() {
    try {
        const data = localStorage.getItem('pulse_current_project');
        if (!data) {
            return {
                id: Date.now().toString(36),
                name: 'Projet sans titre',
                tracks: [
                    { name: 'Piste 1', type: 'audio', color: '#A855F7', clips: [], output: 'master' }
                ],
                buses: [],
                bpm: 120
            };
        }
        const p = JSON.parse(data);
        // Normaliser (ajouter clips et output par défaut si manquant)
        p.tracks = p.tracks.map(t => ({
            ...t,
            clips: t.clips || [],
            output: t.output || 'master',
            // La piste Rec (modèle) est armée à l'ouverture ; on peut ensuite armer n'importe quelle autre piste à sa place
            armed: t.isCapture ? true : (t.armed || false)
        }));
        if (p.tracks.some(t => t.isCapture)) p.tracks.forEach(t => { if (!t.isCapture) t.armed = false; });
        p.buses = p.buses || [];
        p.markers = p.markers || [];
        if (!p.id) p.id = Date.now().toString(36);
        return p;
    } catch {
        return { id: Date.now().toString(36), name: 'Projet sans titre', tracks: [], buses: [], bpm: 120, markers: [] };
    }
}

const state = {
    project: loadProject(),
    playing: false,
    recording: false,
    looping: false,
    metronome: false,
    mixerOpen: false,
    automationMode: false,
    tapMode: false,       // T = toggle, puis Espace tape
    playhead: 0,          // en secondes
    pxPerSecond: 48,      // zoom horizontal
    selectedTrack: 0,
    selectedTracks: new Set(),   // sélection multiple de pistes (⌘ + clic, Shift + clic) ; vide = seulement selectedTrack
    selectedClip: null,   // { trackIdx, clipIdx }
    selectedClips: new Set(), // Set de "ti:ci" — multi-sélection (Shift+click)
    startTime: 0,
    loop: null,           // { start, end } en secondes, ou null
    tool: 'pointer',      // 'pointer' | 'scissors'
    trackHeight: 72,      // hauteur des pistes en px (zoom vertical)
    snap: 'off',          // 'off' (Libre) | 'magnet' (Intelligent) | 'grid' (Temps)
    gridRes: 'auto',      // finesse de la grille : 'auto' | 'bar' | 'beat' | 'division'
    clipboard: null       // { clip, trackIdx } pour copy/paste
};

// === Undo (snapshots JSON du projet, max 30 niveaux) ===
const _undoStack = [];
const _redoStack = [];
const _MAX_UNDO = 30;
function pushUndo() {
    _undoStack.push(JSON.stringify(state.project));
    if (_undoStack.length > _MAX_UNDO) _undoStack.shift();
    _redoStack.length = 0;
    updateUndoBtn();
}
function undoAction() {
    // Éditeur de notes ouvert : ⌘Z défait la dernière note, pas toute la séance
    if (window.PulsePianoRoll && PulsePianoRoll.isOpen() && PulsePianoRoll.undoNote()) { flash('↩ Note annulée'); return; }
    if (!_undoStack.length) { flash('Rien à annuler'); return; }
    if (window.PulsePianoRoll && PulsePianoRoll.isOpen()) PulsePianoRoll.close(true);
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());   // elles pointaient l'ancien état
    _redoStack.push(JSON.stringify(state.project));
    const lyrics = state.project.lyrics, lmap = state.project.lyricsMap; // le texte n'est pas concerné par Annuler : on ne perd jamais ce qu'on a écrit
    state.project = JSON.parse(_undoStack.pop());
    if (lyrics !== undefined) state.project.lyrics = lyrics;
    if (lmap !== undefined) state.project.lyricsMap = lmap;
    renderAll(); saveProject(); flash('↩ Annulé');
}
function redoAction() {
    if (window.PulsePianoRoll && PulsePianoRoll.isOpen() && PulsePianoRoll.redoNote()) { flash('↪ Note refaite'); return; }
    if (!_redoStack.length) { flash('Rien à refaire'); return; }
    if (window.PulsePianoRoll && PulsePianoRoll.isOpen()) PulsePianoRoll.close(true);
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());   // elles pointaient l'ancien état
    _undoStack.push(JSON.stringify(state.project));
    const lyrics = state.project.lyrics, lmap = state.project.lyricsMap;
    state.project = JSON.parse(_redoStack.pop());
    if (lyrics !== undefined) state.project.lyrics = lyrics;
    if (lmap !== undefined) state.project.lyricsMap = lmap;
    renderAll(); saveProject(); flash('↪ Refait');
}
function updateUndoBtn() {
    const btn = document.getElementById('btnUndo');
    if (!btn) return;
    btn.style.opacity = _undoStack.length ? '1' : '0.3';
    btn.title = _undoStack.length ? `Annuler (⌘Z) — ${_undoStack.length} action${_undoStack.length > 1 ? 's' : ''}` : 'Rien à annuler';
}
function updateDocTitle() {
    document.title = `${state.project.name || 'Projet'} — Pulse`;
}

// === Prises (façon Take Folder de Logic) ===
// Quand on enregistre par-dessus une prise, la nouvelle passe devant et l'ancienne est rangée
// sous la piste (Prise A, B, C…). Un clic sur un morceau rangé le remet devant sur ce passage.
// track.clips = ce qu'on entend ; track.takes = les morceaux mis de côté (jamais lus).
const REC_MODE_KEY = 'pulse_rec_mode'; // 'takes' (défaut) | 'overlap' (ancien comportement : superposer)
const TAKE_XFADE = 0.008;              // mini-fondu aux points de coupe (évite les clics)
function recMode() { return localStorage.getItem(REC_MODE_KEY) === 'overlap' ? 'overlap' : 'takes'; }
function takeLetter(n) {
    let out = '';
    while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out || 'A';
}
// Toute prise déjà présente sur la piste reçoit sa lettre (ordre chronologique)
function ensureTakeNumbers(t, except) {
    t.takeSeq = t.takeSeq || 0;
    (t.clips || []).filter(c => !c.take && !c.recording && c !== except).sort((a, b) => a.start - b.start)
        .forEach(c => { c.take = ++t.takeSeq; });
}
// Découpe un clip autour de [s, e) : ce qui reste devant + le morceau retiré
function carveClip(c, s, e) {
    const cs = c.start, ce = c.start + c.duration;
    if (ce <= s + 1e-3 || cs >= e - 1e-3) return { keep: [c], cut: null };
    const off = c.offset || 0;
    const a = Math.max(cs, s), b = Math.min(ce, e);
    const keep = [];
    if (a > cs + 1e-3) keep.push({ ...c, duration: a - cs, loopEnd: undefined, fadeOut: TAKE_XFADE });
    if (b < ce - 1e-3) keep.push({ ...c, start: b, duration: ce - b, offset: off + (b - cs), loopEnd: undefined, fadeIn: TAKE_XFADE });
    const cut = { ...c, start: a, duration: b - a, offset: off + (a - cs), loopEnd: undefined, fadeIn: 0, fadeOut: 0 };
    return { keep, cut };
}
// Range de côté tout ce qui joue sur [s, e) (sauf `except`). Renvoie le nombre de morceaux rangés.
// whole = la région touchée même en partie part en entier sur le côté (re-rec d'un bout par-dessus une prise)
function setAsideRange(t, s, e, except, whole) {
    t.takes = t.takes || [];
    let n = 0;
    const out = [];
    for (const c of (t.clips || [])) {
        if (c === except || c.recording) { out.push(c); continue; }
        const r = carveClip(c, s, e);
        if (whole && r.cut) { t.takes.push({ ...c, loopEnd: undefined }); n++; continue; }
        out.push(...r.keep);
        if (r.cut) { t.takes.push(r.cut); n++; }
    }
    t.clips = out;
    mergeTakePieces(t);
    state.selectedClip = null;
    state.selectedClips.clear();
    return n;
}
// Recolle les morceaux rangés qui se suivent dans le même fichier (évite l'émiettement)
function mergeTakePieces(t) {
    const list = (t.takes || []).slice().sort((a, b) => (a.take || 0) - (b.take || 0) || a.start - b.start);
    const out = [];
    for (const c of list) {
        const p = out[out.length - 1];
        if (p && p.id === c.id && p.take === c.take
            && Math.abs(p.start + p.duration - c.start) < 2e-3
            && Math.abs((p.offset || 0) + p.duration - (c.offset || 0)) < 2e-3) {
            p.duration = c.start + c.duration - p.start;
        } else out.push({ ...c });
    }
    t.takes = out;
}
function trackTakeNumbers(t) {
    if (!t.takes || !t.takes.length) return [];
    const set = new Set();
    t.takes.forEach(c => set.add(c.take || 0));
    (t.clips || []).forEach(c => { if (c.take) set.add(c.take); });
    return [...set].sort((a, b) => a - b);
}
// Remet devant un morceau rangé : ce qui jouait à cet endroit prend sa place de côté
function promoteTake(trackIdx, pieceIdx) {
    const t = state.project.tracks[trackIdx];
    const p = t && t.takes && t.takes[pieceIdx];
    if (!p) return;
    pushUndo();
    t.takes.splice(pieceIdx, 1);
    setAsideRange(t, p.start, p.start + p.duration, null);
    t.clips.push({ ...p, fadeIn: TAKE_XFADE, fadeOut: TAKE_XFADE });
    rerenderTracks(); saveProject(); refreshPlaybackSoon();
    flash(`Prise ${takeLetter(p.take || 1)} choisie sur ce passage`);
}
// Comping (option des Réglages) : on glisse sur une prise rangée pour garder CE passage-là de cette prise ;
// ce qui jouait à cet endroit part de côté, le reste de la prise reste rangé
const COMPING_KEY = 'pulse_comping';
function compingOn() { try { return localStorage.getItem(COMPING_KEY) === '1'; } catch { return false; } }
function compRange(trackIdx, pieceIdx, s, e) {
    const t = state.project.tracks[trackIdx];
    const p = t && t.takes && t.takes[pieceIdx];
    if (!p) return;
    const a = Math.max(p.start, Math.min(s, e)), b = Math.min(p.start + p.duration, Math.max(s, e));
    if (b - a < 0.05) return;
    pushUndo();
    const r = carveClip(p, a, b);   // r.cut = le passage choisi, r.keep = ce qui reste de la prise
    t.takes.splice(pieceIdx, 1, ...r.keep.map(k => ({ ...k, fadeIn: 0, fadeOut: 0 })));
    setAsideRange(t, a, b, null);
    t.clips.push({ ...r.cut, fadeIn: TAKE_XFADE, fadeOut: TAKE_XFADE });
    rerenderTracks(); saveProject(); refreshPlaybackSoon();
    flash(`Prise ${takeLetter(p.take || 1)} gardée sur ce passage (${(b - a).toFixed(1)} s) — ⌘Z pour annuler`);
}
function deleteTakePiece(trackIdx, pieceIdx) {
    const t = state.project.tracks[trackIdx];
    if (!t || !t.takes || !t.takes[pieceIdx]) return;
    pushUndo();
    const letter = takeLetter(t.takes[pieceIdx].take || 1);
    t.takes.splice(pieceIdx, 1);
    rerenderTracks(); saveProject();
    flash(`Morceau de la prise ${letter} supprimé (⌘Z pour le récupérer)`);
}
function clearTrackTakes(trackIdx) {
    const t = state.project.tracks[trackIdx];
    if (!t || !t.takes || !t.takes.length) return;
    pushUndo();
    t.takes = [];
    t.takesOpen = false;
    rerenderTracks(); saveProject();
    flash('Prises mises de côté supprimées (⌘Z pour les récupérer)');
}
function takeRowsClass(t) { return isTrackFolded(t) ? 'is-group-collapsed' : ''; }
function renderTakesPanel(t, i) {
    const nums = trackTakeNumbers(t);
    if (!nums.length || !t.takesOpen) return '';
    return `<div class="takes-labels ${takeRowsClass(t)} ${trackGroup(t) ? 'in-group' : ''}" style="--track-color: ${t.color}">
        ${nums.map(n => `<div class="take-label"><b>${takeLetter(n)}</b> Prise ${takeLetter(n)}</div>`).join('')}
    </div>`;
}
function renderTakesLanes(t, i, widthPx) {
    const nums = trackTakeNumbers(t);
    if (!nums.length || !t.takesOpen) return '';
    const piece = (c, cls, attrs, tip) => {
        const w = c.duration * state.pxPerSecond;
        return `<div class="take-piece ${cls}" ${attrs} data-tooltip="${esc(tip)}" style="left:${(c.start * state.pxPerSecond).toFixed(1)}px;width:${w.toFixed(1)}px">${renderClipWaveform(c, w)}</div>`;
    };
    return `<div class="takes-lanes ${takeRowsClass(t)}" style="width:${widthPx}px; --track-color: ${t.color}">
        ${nums.map(n => `<div class="take-lane">
            ${(t.clips || []).filter(c => c.take === n && !c.recording).map(c => piece(c, 'is-active', '', `Prise ${takeLetter(n)} — c'est elle qu'on entend ici`)).join('')}
            ${t.takes.map((c, pi) => (c.take || 0) === n ? piece(c, '', `data-ti="${i}" data-pi="${pi}"`, `Prise ${takeLetter(n)} — clique pour la remettre devant${compingOn() ? ' · glisse pour ne garder que ce passage' : ''}`) : '').join('')}
        </div>`).join('')}
    </div>`;
}
function bindTakePieces() {
    document.querySelectorAll('.take-piece[data-pi]').forEach(el => {
        const ti = parseInt(el.dataset.ti), pi = parseInt(el.dataset.pi);
        el.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (e.button !== 0 || !compingOn()) return;
            // Comping : glisser sur la prise = ne garder que ce passage
            const lane = el.parentElement, x0 = e.clientX;
            let dragged = false, sel = null;
            const toSec = (cx) => (cx - lane.getBoundingClientRect().left) / state.pxPerSecond;
            const move = (ev) => {
                if (!dragged && Math.abs(ev.clientX - x0) < 6) return;
                dragged = true;
                if (!sel) { sel = document.createElement('div'); sel.className = 'comp-sel'; lane.appendChild(sel); }
                const lr = lane.getBoundingClientRect();
                sel.style.left = (Math.min(x0, ev.clientX) - lr.left) + 'px'; sel.style.width = Math.abs(ev.clientX - x0) + 'px';
            };
            const up = (ev) => {
                document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
                if (sel) sel.remove();
                if (dragged) { el.dataset.dragged = '1'; compRange(ti, pi, toSec(x0), toSec(ev.clientX)); }
            };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        });
        el.addEventListener('click', (e) => { e.stopPropagation(); if (el.dataset.dragged) { delete el.dataset.dragged; return; } promoteTake(ti, pi); });
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            closeAllMenus();
            const menu = document.createElement('div');
            menu.className = 'track-ctx-menu';
            menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:200;`;
            menu.innerHTML = '<div class="ctx-item">Remettre cette prise devant</div><div class="ctx-item ctx-danger">Supprimer ce morceau de prise</div>';
            menu.children[0].addEventListener('click', () => { closeAllMenus(); promoteTake(ti, pi); });
            menu.children[1].addEventListener('click', () => { closeAllMenus(); deleteTakePiece(ti, pi); });
            document.body.appendChild(menu);
            setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
        });
    });
    document.querySelectorAll('.takes-lanes').forEach(el => el.addEventListener('mousedown', (e) => e.stopPropagation()));
}
function bindTakeToggles() {
    document.querySelectorAll('.takes-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const t = state.project.tracks[parseInt(btn.dataset.takes)];
            if (!t) return;
            t.takesOpen = !t.takesOpen;
            rerenderTracks(); saveProject();
        });
    });
}

// === Groupes de pistes (façon Track Stack de Logic) ===
// Un groupe = un bus qui reçoit plusieurs pistes. Dans la liste, il apparaît comme un en-tête
// repliable au-dessus de ses pistes, avec un volume / mute / solo pour tout le groupe.
function busById(id) { return (state.project.buses || []).find(x => x.id === id) || null; }
function trackGroup(t) {
    const b = busById(t.output);
    return b && isVisibleGroup(b) ? b : null;
}
// Pistes rangées directement dans ce groupe
function groupMemberIdx(bus) {
    const out = [];
    state.project.tracks.forEach((t, i) => { if (t.output === bus.id) out.push(i); });
    return out;
}
// Groupes rangés directement dans ce groupe (un groupe peut en contenir d'autres : Toutes les voix > Voix 1, Backs…)
function groupChildren(bus) { return (state.project.buses || []).filter(b => b.output === bus.id && b !== bus); }
function isVisibleGroup(bus, depth = 0) {
    if (bus.locked || bus.noFolder || depth > 8) return false;
    return !!bus.isGroup || groupMemberIdx(bus).length >= 2 || groupChildren(bus).some(c => isVisibleGroup(c, depth + 1));
}
function groupParent(bus) {
    const p = busById(bus.output);
    return p && p !== bus && isVisibleGroup(p) ? p : null;
}
// Du groupe lui-même jusqu'au plus grand groupe qui le contient
function groupChain(bus) {
    const chain = [];
    for (let g = bus, n = 0; g && n < 8; g = groupParent(g), n++) chain.push(g);
    return chain;
}
function trackGroups(t) { const g = trackGroup(t); return g ? groupChain(g) : []; }
// Toutes les pistes du groupe, y compris celles de ses sous-groupes
function groupTracksDeep(bus) {
    const out = [];
    state.project.tracks.forEach((t, i) => { if (trackGroups(t).includes(bus)) out.push(i); });
    return out;
}
// Une piste est cachée dès qu'un des groupes qui la contiennent est replié
function isTrackFolded(t) { return trackGroups(t).some(g => g.collapsed); }
function isGroupFolded(bus) { return groupChain(bus).slice(1).some(g => g.collapsed); }
// En-têtes à dessiner au-dessus de la piste i : du plus grand groupe au plus petit
function groupsStartingAt(i) {
    return trackGroups(state.project.tracks[i]).filter(g => groupTracksDeep(g)[0] === i).reverse();
}
// Tout afficher (comme dans Logic) : montre aussi les bus cachés et la sortie, pour ceux qui veulent tout régler
function showAll() { try { return localStorage.getItem('pulse_show_all') === '1'; } catch { return false; } }
function isBusShown(b) { return !b.hidden || showAll(); }
// Bus affichés comme une simple ligne sous les pistes (le premaster, et les bus cachés quand on affiche tout)
function rowBuses() { return (state.project.buses || []).filter(b => (b.row || (b.hidden && showAll())) && !isVisibleGroup(b)); }

function groupColor(bus) { return bus.color || '#A855F7'; }

function renderGroupHeader(bus) {
    const members = groupTracksDeep(bus);
    const allSolo = members.length > 0 && members.every(i => state.project.tracks[i].solo);
    const n = members.length;
    const depth = groupChain(bus).length - 1;
    const isRow = !isVisibleGroup(bus);
    return `
    <div class="group-header ${state.selectedBus === bus.id && state._selBusTrack === state.selectedTrack ? 'is-selected' : ''} ${isRow ? 'is-row' : ''} ${bus.collapsed ? 'is-collapsed' : ''} ${bus.muted ? 'is-muted' : ''} ${isGroupFolded(bus) ? 'is-group-collapsed' : ''}" data-bus="${esc(bus.id)}" style="--group-color: ${groupColor(bus)}; --depth: ${depth}${bus.height ? `; --grp-h: ${bus.height}px` : ''}">
        <div class="group-resize" data-bus="${esc(bus.id)}" data-tooltip="Tire pour agrandir ou rétrécir ce groupe (Alt = tous les groupes, double-clic = taille normale)"></div>
        <button class="group-toggle" data-tooltip="${bus.collapsed ? 'Déplier le groupe' : 'Replier le groupe'}" aria-label="Replier ou déplier le groupe">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="group-name" contenteditable="true" spellcheck="false">${esc(bus.name)}</div>
        ${bus.spots ? '<button class="g-mini g-spots" data-tooltip="Effets ponctuels : choisis un passage de ta prise, puis un effet (Del, Pitch, Phone)">✦</button>' : ''}
        <button class="g-mini g-son ${(bus.effects || []).length ? 'active' : ''}" data-tooltip="${bus.premaster ? 'Finition : le réglage final de tout le morceau' : 'Son du groupe : un réglage pour toutes ses pistes'}">♪</button>
        <button class="g-mini g-m ${bus.muted ? 'active' : ''}" data-tooltip="Couper tout le groupe">M</button>
        <button class="g-mini g-s ${allSolo ? 'active' : ''}" data-tooltip="Écouter seulement ce groupe">S</button>
        <input type="range" class="group-vol" min="0" max="100" step="0.5" data-default="${volToPos(100)}" value="${volToPos(bus.volume ?? 100)}" data-tooltip="Volume du groupe">
    </div>`;
}

// === Effets ponctuels (méthode de la template Logic) ===
// Une piste d'effet n'existe que quand on s'en sert : on choisit un passage de la prise, puis l'effet ;
// Pulse crée la piste déjà réglée sous le groupe et y pose le passage. Vidée, elle disparaît toute seule.
// copy = la voix d'origine reste (un écho s'ajoute) ; move = le passage part sur la piste d'effet (sinon on l'entendrait en double)
const SPOT_KINDS = {
    del18:  { name: 'Del 1/8 P-Pong', desc: 'écho 1/8 qui rebondit gauche / droite', mode: 'copy', effects: ['delay'], params: () => ({ delay: { ...FX_PRESETS.delay[0].params, wet: 100, dry: 0, _preset: FX_PRESETS.delay[0].name } }) },
    del14:  { name: 'Del 1/4',        desc: 'écho 1/4 sur le dernier mot', mode: 'copy', effects: ['delay'], params: () => ({ delay: { ...FX_PRESETS.delay[2].params, wet: 100, dry: 0, _preset: FX_PRESETS.delay[2].name } }) },
    pitchm: { name: 'Pitch −',        desc: 'voix plus grave sur ce passage', mode: 'move', effects: ['pitch'], params: () => ({ pitch: { ...FX_PRESETS.pitch[0].params, _preset: FX_PRESETS.pitch[0].name } }) },
    pitchp: { name: 'Pitch +',        desc: 'voix plus aiguë sur ce passage', mode: 'move', effects: ['pitch'], params: () => ({ pitch: { ...FX_PRESETS.pitch[1].params, _preset: FX_PRESETS.pitch[1].name } }) },
    phone:  { name: 'Phone',          desc: 'voix de téléphone', mode: 'move', effects: ['filter'], params: () => ({ filter: { ...FX_PRESETS.filter[0].params, _preset: FX_PRESETS.filter[0].name } }) }
};
function openSpotMenu(bus, anchor) {
    closeAllMenus();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu spot-menu';
    menu.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;z-index:3000;min-width:220px`;
    menu.innerHTML = `<div class="ctx-head">Effet ponctuel sur le passage choisi</div>` + Object.entries(SPOT_KINDS).map(([k, d]) =>
        `<div class="ctx-item" data-spot="${k}"><span class="fam-nm">${esc(d.name)}</span><span class="fam-ds">${esc(d.desc)}</span></div>`).join('');
    menu.querySelectorAll('[data-spot]').forEach(el => el.addEventListener('click', () => { menu.remove(); addSpotEffect(bus, el.dataset.spot); }));
    document.body.appendChild(menu);
    if (typeof dismissMenuOnOutside === 'function') dismissMenuOnOutside(menu);
    else setTimeout(() => document.addEventListener('mousedown', function c(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', c); } }), 50);
}
// Les morceaux de prise à traiter : la plage choisie (sur les pistes du groupe), sinon les clips choisis
function spotSourcePieces(bus) {
    const members = groupTracksDeep(bus).filter(i => !state.project.tracks[i].spot);
    const pieces = [];
    if (state.selection) {
        const a = Math.min(state.selection.start, state.selection.end), b = Math.max(state.selection.start, state.selection.end);
        const range = state.selection.tracks;
        members.filter(i => !range || (i >= range[0] && i <= range[1])).forEach(ti => (state.project.tracks[ti].clips || []).forEach(c => {
            const s = Math.max(a, c.start), e = Math.min(b, c.start + c.duration);
            if (e - s > 0.01) pieces.push({ ti, c, s, e });
        }));
    }
    if (!pieces.length) {
        const keys = new Set(state.selectedClips || []);
        if (state.selectedClip) keys.add(`${state.selectedClip.trackIdx}:${state.selectedClip.clipIdx}`);
        keys.forEach(k => { const [ti, ci] = k.split(':').map(Number); const c = state.project.tracks[ti]?.clips?.[ci];
            if (c && members.includes(ti)) pieces.push({ ti, c, s: c.start, e: c.start + c.duration }); });
    }
    return pieces;
}
function addSpotEffect(bus, kind) {
    const d = SPOT_KINDS[kind]; if (!d) return;
    if (state.recording || state._cap) { flash('Une prise est en cours : arrête-la avant'); return; }
    const pieces = spotSourcePieces(bus);
    if (!pieces.length) { flash(`Choisis d'abord le passage : glisse sur ta prise (ou clique un clip), puis ${d.name}`); return; }
    pushUndo();
    const tracks = state.project.tracks;
    const srcTracks = [...new Set(pieces.map(p => tracks[p.ti]))];
    // Piste d'effet : on réutilise celle du même effet dans ce groupe, sinon on la crée juste sous la dernière piste du groupe
    let spot = tracks.find(t => t.spot === kind && t.output === bus.id);
    if (!spot) {
        const src = srcTracks[0];
        spot = { name: d.name, type: 'audio', output: bus.id, color: '#7C3AED', spot: kind, clips: [],
            effects: [...d.effects], effectParams: d.params(), sends: { ...(src.sends || {}) } };
        if (src.autotune) { spot.tuneSlot = true; spot.autotune = JSON.parse(JSON.stringify(src.autotune)); }
        const last = Math.max(...groupTracksDeep(bus));
        tracks.splice(last + 1, 0, spot);
    }
    pieces.forEach(({ c, s, e }) => spot.clips.push({ ...c, start: s, duration: e - s, offset: (c.offset || 0) + (s - c.start), fadeIn: 0, fadeOut: 0, loopEnd: undefined }));
    if (d.mode === 'move') {
        // on retire le passage de la prise d'origine (découpe comme « Supprimer la plage »)
        srcTracks.forEach(t => {
            const mine = pieces.filter(p => tracks[p.ti] === t || p.c && (t.clips || []).includes(p.c));
            t.clips = (t.clips || []).flatMap(c => {
                const p = mine.find(m => m.c === c); if (!p) return [c];
                const out = [];
                if (p.s - c.start > 0.01) out.push({ ...c, duration: p.s - c.start, loopEnd: undefined, fadeOut: 0 });
                if (c.start + c.duration - p.e > 0.01) out.push({ ...c, start: p.e, duration: c.start + c.duration - p.e, offset: (c.offset || 0) + (p.e - c.start), fadeIn: 0 });
                return out;
            });
        });
    }
    clearRangeSelection(); state.selectedClip = null; state.selectedClips = new Set();
    state.selectedTrack = tracks.indexOf(spot);
    renderAll(); saveProject(); refreshPlaybackSoon();
    flash(`${d.name} : ${pieces.length > 1 ? pieces.length + ' passages posés' : 'passage posé'} sur sa piste${d.mode === 'move' ? ' (retiré de la prise)' : ''} — ⌘Z pour annuler`);
}
// Une piste d'effet ponctuel vidée disparaît (jamais pendant une prise : les numéros de piste ne doivent pas bouger)
function pruneEmptySpots() {
    if (state.recording || state._cap) return;
    const tr = state.project.tracks;
    if (!tr.some(t => t.spot && !(t.clips || []).length && !t.armed)) return;
    const sel = tr[state.selectedTrack];
    state.project.tracks = tr.filter(t => !(t.spot && !(t.clips || []).length && !t.armed));
    const ni = state.project.tracks.indexOf(sel);
    state.selectedTrack = ni >= 0 ? ni : Math.min(state.selectedTrack, state.project.tracks.length - 1);
    state.selectedTracks = new Set();
}

function renderGroupTimelineRow(bus, widthPx) {
    const bars = groupTracksDeep(bus).flatMap(i => {
        const t = state.project.tracks[i];
        return (t.clips || []).map(c => {
            const end = Math.max(c.start + c.duration, c.loopEnd || 0);
            return `<span style="left:${(c.start * state.pxPerSecond).toFixed(1)}px;width:${Math.max(2, (end - c.start) * state.pxPerSecond).toFixed(1)}px;background:${c.color || t.color}"></span>`;
        });
    }).join('');
    const n = groupTracksDeep(bus).length;
    if (!isVisibleGroup(bus)) return `<div class="timeline-group-row is-row" data-bus="${esc(bus.id)}" style="width:${widthPx}px; --group-color: ${groupColor(bus)}${bus.height ? `; --grp-h: ${bus.height}px` : ''}"><em class="group-count">${esc(bus.name)} · ${bus.premaster ? 'tout le morceau passe ici avant la sortie' : 'bus de sécurité'}</em>${state.automationMode ? renderBusCurve(bus, widthPx) : ''}</div>`;
    const label = `${esc(bus.name)} · ${n} piste${n > 1 ? 's' : ''}${bus.collapsed ? ' (replié)' : ''}`;
    return `<div class="timeline-group-row ${bus.collapsed ? 'is-collapsed' : ''} ${isGroupFolded(bus) ? 'is-group-collapsed' : ''}" data-bus="${esc(bus.id)}" style="width:${widthPx}px; --group-color: ${groupColor(bus)}${bus.height ? `; --grp-h: ${bus.height}px` : ''}">${bars}<em class="group-count">${label}</em>${state.automationMode && !bus.collapsed ? renderBusCurve(bus, widthPx) : ''}</div>`;
}

function rerenderTracks() {
    renderTracksPanel(); bindTrackEvents(); renderTimelineTracks(); renderMixer(); bindMixerEvents();
}

function bindGroupEvents() {
    document.querySelectorAll('.group-header').forEach(h => {
        const bus = (state.project.buses || []).find(b => b.id === h.dataset.bus);
        if (!bus) return;
        h.querySelector('.group-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            bus.collapsed = !bus.collapsed;
            rerenderTracks(); saveProject();
        });
        const spotsBtn = h.querySelector('.g-spots');
        if (spotsBtn) spotsBtn.addEventListener('click', (e) => { e.stopPropagation(); openSpotMenu(bus, spotsBtn); });
        h.querySelector('.g-son').addEventListener('click', (e) => {
            e.stopPropagation();
            if (bus.premaster) openMasterPanel(bus, e.currentTarget); else openSoundPanel(bus, e.currentTarget);
        });
        h.querySelector('.g-m').addEventListener('click', (e) => {
            e.stopPropagation();
            bus.muted = !bus.muted;
            PulseAudio.updateBusVolume(bus.id, bus.muted ? 0 : (bus.volume ?? 100));
            h.classList.toggle('is-muted', bus.muted);
            e.currentTarget.classList.toggle('active', bus.muted);
            saveProject();
        });
        // Un clic sur l'en-tête d'un groupe l'affiche dans le bloc de faders de gauche, comme une piste
        h.addEventListener('click', (e) => {
            if (e.target.closest('button, input, .group-name.editing, .group-toggle')) return;
            state.selectedBus = bus.id; state._selBusTrack = state.selectedTrack;
            renderTracksPanel(); bindTrackEvents();
        });
        h.querySelector('.g-s').addEventListener('click', (e) => {
            e.stopPropagation();
            const members = groupTracksDeep(bus).map(i => state.project.tracks[i]);
            const allSolo = members.every(t => t.solo);
            members.forEach(t => { t.solo = !allSolo; });
            PulseAudio.refreshAudibility(state.project);
            renderTracksPanel(); bindTrackEvents(); saveProject();
        });
        const vol = h.querySelector('.group-vol');
        vol.addEventListener('mousedown', (e) => e.stopPropagation());
        let volUndone = false;
        vol.addEventListener('input', () => {
            if (!volUndone) { pushUndo(); volUndone = true; }
            bus.volume = posToVol(parseFloat(vol.value));
            if (!bus.muted) PulseAudio.updateBusVolume(bus.id, bus.volume);
        });
        vol.addEventListener('change', () => { volUndone = false; renderMixer(); bindMixerEvents(); saveProject(); });
        const nameEl = h.querySelector('.group-name');
        // Un clic ne fait que sélectionner ; double-clic pour changer le nom
        const startGroupEdit = () => { nameEl.classList.add('editing'); nameEl.focus(); document.execCommand('selectAll'); };
        nameEl.addEventListener('mousedown', (e) => {
            if (nameEl.classList.contains('editing')) return;
            e.preventDefault();
            if (e.detail >= 2) startGroupEdit();
        });
        nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); if (!nameEl.classList.contains('editing')) startGroupEdit(); });
        nameEl.addEventListener('blur', () => nameEl.classList.remove('editing'));
        nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } e.stopPropagation(); });
        nameEl.addEventListener('blur', () => {
            const v = nameEl.textContent.trim();
            if (v && v !== bus.name) { pushUndo(); bus.name = v; renderMixer(); bindMixerEvents(); saveProject(); }
            else nameEl.textContent = bus.name;
        });
        h.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            closeAllMenus();
            if (!isVisibleGroup(bus)) return; // une simple ligne de bus : rien à ranger ni à dupliquer
            const menu = document.createElement('div');
            menu.className = 'track-ctx-menu';
            menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:200;`;
            const parent = groupParent(bus);
            const inside = new Set(groupChain(bus));
            const others = (state.project.buses || []).filter(b => b !== bus && b !== parent && isVisibleGroup(b) && !groupChain(b).includes(bus) && !inside.has(b));
            const items = [
                ['Dupliquer le groupe (pour un feat, par exemple)', () => duplicateGroup(bus.id)],
                ['Ranger dans un nouveau grand groupe', () => wrapGroup(bus.id)],
                ...others.map(o => [`Ranger dans « ${o.name} »`, () => moveGroupInto(bus.id, o.id)]),
                ...(parent ? [[`Sortir de « ${parent.name} »`, () => moveGroupInto(bus.id, parent.output || 'master')]] : []),
                ['Dissoudre le groupe (les pistes restent)', () => dissolveGroup(bus.id)]
            ];
            items.forEach(([label, action]) => {
                const it = document.createElement('div');
                it.className = 'ctx-item'; it.textContent = label;
                it.addEventListener('click', () => { closeAllMenus(); action(); });
                menu.appendChild(it);
            });
            document.body.appendChild(menu);
            setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
        });
    });
}

function afterGroupChange(msg) {
    renderAll(); saveProject(); refreshPlaybackSoon();
    if (msg) flash(msg);
}

// Nouveau bus, depuis zéro : un groupe vide à qui on envoie des pistes et sur lequel on pose les effets de son choix
function createBus({ withTracks = [], name } = {}) {
    pushUndo();
    state.project.buses = state.project.buses || [];
    const n = state.project.buses.filter(b => b.isGroup).length + 1;
    const id = 'grp_' + Date.now().toString(36);
    const first = state.project.tracks[withTracks[0]];
    state.project.buses.push({ id, name: name || `Bus ${n}`, isGroup: true, output: 'master', color: (first && first.color) || '#7C3AED', volume: 100, effects: [] });
    withTracks.forEach(i => { const t = state.project.tracks[i]; if (t && !t.isCapture) t.output = id; });
    state.selectedBus = id; state._selBusTrack = state.selectedTrack;
    afterGroupChange(withTracks.length ? `Bus créé avec ${withTracks.length > 1 ? withTracks.length + ' pistes' : 'la piste'} — clique « + Effet » pour choisir ses effets` : 'Bus créé — envoie-lui des pistes (en bas de leur tranche : « Direction ») et clique « + Effet »');
}

function createGroupWithTrack(idx) {
    const t = state.project.tracks[idx];
    if (!t) return;
    pushUndo();
    state.project.buses = state.project.buses || [];
    const n = state.project.buses.filter(b => b.isGroup).length + 1;
    const id = 'grp_' + Date.now().toString(36);
    state.project.buses.push({ id, name: `Groupe ${n}`, isGroup: true, output: t.output || 'master', color: t.color, volume: 100 });
    t.output = id;
    afterGroupChange('Groupe créé — clic droit sur une autre piste pour la ranger dedans');
}

function moveTrackToGroup(idx, busId) {
    const tracks = state.project.tracks;
    const t = tracks[idx];
    const bus = (state.project.buses || []).find(b => b.id === busId);
    if (!t || !bus) return;
    pushUndo();
    t.output = busId;
    // On range la piste juste sous les autres pistes du groupe
    const others = groupMemberIdx(bus).filter(i => i !== idx);
    if (others.length && !t.isCapture) {
        const anchor = tracks[others[others.length - 1]];
        tracks.splice(idx, 1);
        tracks.splice(tracks.indexOf(anchor) + 1, 0, t);
        state.selectedTrack = tracks.indexOf(t);
    }
    bus.collapsed = false;
    afterGroupChange(`« ${t.name} » rangée dans ${bus.name}`);
}

// Met un groupe dans un nouveau grand groupe (ex. « Voix 1 » dans « Toutes les voix »)
function wrapGroup(busId) {
    const bus = busById(busId);
    if (!bus) return;
    pushUndo();
    const id = 'grp_' + Date.now().toString(36);
    state.project.buses.push({ id, name: 'Toutes les voix', isGroup: true, output: bus.output || 'master', color: '#7C3AED', volume: 100 });
    bus.output = id;
    afterGroupChange(`« ${bus.name} » est maintenant dans un grand groupe — clic droit sur un autre groupe pour l'y ranger aussi`);
}

// Range un groupe dans un autre (ou le sort vers `destId`)
function moveGroupInto(busId, destId) {
    const bus = busById(busId), dest = busById(destId);
    if (!bus || bus === dest) return;
    pushUndo();
    bus.output = dest ? dest.id : 'master';
    if (dest) {
        dest.collapsed = false;
        // On remonte ses pistes à côté de celles du groupe d'accueil, pour que tout reste ensemble dans la liste
        const tracks = state.project.tracks;
        const mine = groupTracksDeep(bus).map(i => tracks[i]);
        const theirs = groupTracksDeep(dest).map(i => tracks[i]).filter(t => !mine.includes(t));
        if (mine.length && theirs.length) {
            const anchor = theirs[theirs.length - 1];
            state.project.tracks = tracks.filter(t => !mine.includes(t));
            state.project.tracks.splice(state.project.tracks.indexOf(anchor) + 1, 0, ...mine);
        }
    }
    afterGroupChange(dest ? `« ${bus.name} » rangé dans « ${dest.name} »` : `« ${bus.name} » sorti de son groupe`);
}

// Copie un groupe avec ses réglages et ses pistes vides (même chemin, même sortie) : idéal pour un feat
function duplicateGroup(busId) {
    const src = busById(busId);
    if (!src) return;
    pushUndo();
    const stamp = Date.now().toString(36);
    let n = 0;
    const newTracks = [];
    const copyGroup = (g, output, top) => {
        const id = `grp_${stamp}_${n++}`;
        const copy = { ...JSON.parse(JSON.stringify(g)), id, output, collapsed: false, muted: false };
        copy.name = nextCopyName(g.name);   // jamais deux groupes au même nom (Back → Back 2)
        state.project.buses.push(copy);
        state.project.tracks.forEach(t => {
            if (t.output !== g.id || t.isCapture) return;
            const c = JSON.parse(JSON.stringify(t));
            const taken = new Set([...state.project.tracks, ...newTracks].map(x => x.name));
            const m = (c.name || '').match(/^(.*?)(\d+)$/);
            let base = m ? m[1] : (c.name || 'Piste') + ' ', k = m ? parseInt(m[2]) + 1 : 2;
            while (taken.has(base + k)) k++;
            c.name = base + k;
            newTracks.push({ ...c, clips: [], takes: [], output: id, armed: false, solo: false, muted: false, takesOpen: false });
        });
        groupChildren(g).forEach(child => copyGroup(child, id, false));
        return copy;
    };
    const last = Math.max(...groupTracksDeep(src), -1);
    const copy = copyGroup(src, src.output || 'master', true);
    state.project.tracks.splice(last + 1, 0, ...newTracks);
    afterGroupChange(`« ${copy.name} » créé : mêmes réglages, pistes vides, prêt à enregistrer`);
}
function nextCopyName(name) {
    const m = name.match(/^(.*?)(\d+)$/);
    const names = new Set((state.project.buses || []).map(b => b.name));
    let base = m ? m[1] : name + ' ', k = m ? parseInt(m[2]) + 1 : 2;
    while (names.has(base + k)) k++;
    return base + k;
}

function removeTrackFromGroup(idx) {
    const t = state.project.tracks[idx];
    const bus = t && (state.project.buses || []).find(b => b.id === t.output);
    if (!bus) return;
    pushUndo();
    t.output = bus.output || 'master';
    const hasChild = (state.project.buses || []).some(b => b.output === bus.id);
    if (bus.isGroup && groupMemberIdx(bus).length === 0 && !hasChild) {
        state.project.buses = state.project.buses.filter(b => b !== bus);
    }
    afterGroupChange(`« ${t.name} » sortie du groupe`);
}

function dissolveGroup(busId) {
    const bus = (state.project.buses || []).find(b => b.id === busId);
    if (!bus) return;
    pushUndo();
    const out = bus.output || 'master';
    state.project.tracks.forEach(t => { if (t.output === busId) t.output = out; });
    (state.project.buses || []).forEach(b => { if (b.output === busId) b.output = out; });
    state.project.buses = state.project.buses.filter(b => b !== bus);
    afterGroupChange('Groupe dissous — les pistes sont toujours là');
}

// --- Rendu : panneau pistes ---
// Bouton « i » (comme Logic) : la voix de cette piste revient-elle dans le casque ?
// Une piste armée s'écoute d'office ; « i » force l'écoute sur une piste non armée, ou la coupe sur une armée.
function trackMonitored(t) {
    return t.inputMonitor === true || (!!t.armed && t.inputMonitor !== false);
}
// Le micro est unique : il revient dans le casque si au moins une piste est écoutée (et si le monitoring logiciel est actif)
function syncMonitor() {
    if (!state.project || !state.project.tracks) return;
    PulseAudio.setMonitorRoute(state.project.tracks.some(trackMonitored));
}
// Retour direct de l'appli : il passe par la tranche de la piste écoutée (ses effets, son volume, son pan),
// comme dans Logic. On renvoie la tranche au moteur natif dès qu'elle change (vérifié 4 fois par seconde).
let _nativeMonTrack = null;
function nativeMonitorTrackJson() {
    const t = state.project && (state.project.tracks || []).find(x => (x.type || 'audio') === 'audio' && trackMonitored(x));
    if (!t) return '';
    const track = { name: t.name || '', effects: t.effects || [], effectParams: t.effectParams || {}, fxOrder: t.fxOrder || [], volume: t.volume == null ? 100 : t.volume, pan: t.pan || 0 };
    const bpm = typeof tempoVaries === 'function' && tempoVaries() ? bpmAtSec(Math.max(0, state.playhead || 0)) : state.project.bpm;
    return JSON.stringify({ track, bpm });
}
function syncNativeMonitorTrack() {
    const nm = PulseAudio.getNativeMonitor && PulseAudio.getNativeMonitor();
    if (!nm || !nm.active) { _nativeMonTrack = null; return; }
    let j = '';
    try { j = nativeMonitorTrackJson(); } catch { return; }
    if (j === _nativeMonTrack) return;
    _nativeMonTrack = j;
    PulseNative.monitor.track(j).catch(() => {});
}
if (window.PulseNative && PulseNative.available) setInterval(syncNativeMonitorTrack, 250);
function toggleTrackMonitor(t) {
    t.inputMonitor = !trackMonitored(t);
    // Même état que l'automatique : on n'enregistre rien dans le projet
    if (t.inputMonitor === !!t.armed) delete t.inputMonitor;
}

// === Bouton rond gauche / droite (comme Logic) : un arc et une petite boule qui tournent ===
function panLabel(v) { return v === 0 ? 'Centre' : (v < 0 ? 'G ' + Math.abs(v) : 'D ' + v); }
function panTip(v) { return `Gauche ↔ droite : ${v === 0 ? 'centre' : panLabel(v)} (glisse, molette, double-clic = centre)`; }
function panKnobSvg(v) {
    const R = 9, C = 12, a = (Math.max(-100, Math.min(100, v)) / 100) * 135 * Math.PI / 180;
    const px = (ang) => `${(C + R * Math.sin(ang)).toFixed(2)},${(C - R * Math.cos(ang)).toFixed(2)}`;
    const arc = v === 0 ? '' : `<path d="M${px(0)} A${R},${R} 0 0 ${v > 0 ? 1 : 0} ${px(a)}" class="knob-arc"/>`;
    return `<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="${C}" cy="${C}" r="${R}" class="knob-ring"/>${arc}<circle cx="${(C + R * Math.sin(a)).toFixed(2)}" cy="${(C - R * Math.cos(a)).toFixed(2)}" r="2.6" class="knob-dot"/></svg>`;
}

// Hauteur d'une piste : la sienne si tu l'as tirée, sinon celle de toutes les pistes
const TRACK_H_MIN = 44, TRACK_H_MAX = 240;
function trackH(t) { return t && t.height ? t.height : state.trackHeight; }

function renderTracksPanel() {
    const list = document.getElementById('tracksList');
    // Les Capture Lanes remontent toujours en haut (pinned)
    const tracks = state.project.tracks;
    list.innerHTML = tracks.map((t, i) => {
        const classes = [
            'track-item',
            isPendDel(t) ? 'pend-del' : '',
            (i === state.selectedTrack && state.deselectedAt !== i) || state.selectedTracks.has(i) ? 'selected' : '',
            t.isCapture ? 'is-capture' : '',
            isInstruTrack(t) ? 'is-instru' : '',
            t.armed ? 'is-armed' : '',
            t.hidden ? 'is-hidden-track' : '',
            t.locked ? 'is-locked-track' : '',
            t.notes ? 'has-notes' : '',
            t.frozen ? 'is-frozen-track' : '',
            t.muted ? 'is-muted' : '',
            t.solo ? 'is-solo' : '',
            trackGroup(t) ? 'in-group' : '',
            isTrackFolded(t) ? 'is-group-collapsed' : ''
        ].filter(Boolean).join(' ');
        return `${groupsStartingAt(i).map(renderGroupHeader).join('')}
        <div class="${classes}" style="--track-color: ${t.color}; --group-color: ${trackGroup(t) ? groupColor(trackGroup(t)) : 'transparent'}; --depth: ${trackGroups(t).length}${t.height ? `; --track-h: ${t.height}px` : ''}" data-i="${i}">
            <div class="track-resize" data-i="${i}" data-tooltip="Tire pour agrandir ou rétrécir la piste (Alt = toutes les pistes, double-clic = taille normale)"></div>
            ${t.isCapture ? '' : '<div class="track-drag-handle" data-tooltip="Tire la piste pour la déplacer (sous un groupe : elle passe par ce groupe)"><svg viewBox="0 0 10 16" width="10" height="14" fill="currentColor" opacity="0.4"><circle cx="3" cy="2.5" r="1.5"/><circle cx="7" cy="2.5" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/><circle cx="3" cy="13.5" r="1.5"/><circle cx="7" cy="13.5" r="1.5"/></svg></div>'}
            <div class="track-icon">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${isInstruTrack(t) ? TRACK_ICONS.inst : (TRACK_ICONS[t.type] || TRACK_ICONS.audio)}
                </svg>
            </div>
            <div class="track-info">
                <div class="track-name" contenteditable="${!t.isCapture}" data-i="${i}">${esc(t.name)}${t.isCapture ? '<span class="chip" contenteditable="false"> LIVE</span>' : ''}</div>
                <div class="track-buttons">
                    <button class="t-mini m-m ${t.muted?'active':''}" data-flag="mute" data-i="${i}" data-tooltip="Mute (M)">M</button>
                    <button class="t-mini m-s ${t.solo?'active':''}" data-flag="solo" data-i="${i}" data-tooltip="Solo (S) — ⌘+clic = exclusif">S</button>
                    <button class="t-mini m-r ${t.armed?'active':''}" data-flag="rec" data-i="${i}" data-tooltip="${t.armed ? 'Prête à enregistrer : la prochaine prise ira ici (clic pour désarmer)' : 'Prête à enregistrer : clique pour que la prochaine prise aille ici'}">R</button>
                    <button class="t-mini m-i ${trackMonitored(t)?'active':''}" data-flag="mon" data-i="${i}" data-tooltip="${trackMonitored(t) ? 'Retour casque : tu t\'entends (clic pour couper)' : 'Retour casque coupé (clic pour t\'entendre)'}">i</button>
                    ${trackTakeNumbers(t).length ? `<button class="takes-toggle ${t.takesOpen ? 'active' : ''}" data-takes="${i}" data-tooltip="${t.takesOpen ? 'Cacher les prises' : 'Voir les prises mises de côté'}"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>${trackTakeNumbers(t).length}</button>` : ''}
                    <div class="t-knob" data-i="${i}" data-pan="${t.pan || 0}" tabindex="0" role="slider" aria-label="Gauche / droite" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${t.pan || 0}" data-tooltip="${panTip(t.pan || 0)}">${panKnobSvg(t.pan || 0)}</div>
                    <input type="range" class="t-vol" data-i="${i}" min="0" max="100" step="0.5" data-default="${volToPos(100)}" value="${volToPos(t.volume ?? 100)}" data-tooltip="Volume : ${volumeToDb(t.volume ?? 100)} dB (⌘ + clic = 0 dB, double-clic = écrire la valeur)" aria-label="Volume de la piste">
                    <div class="vu-mini"><span></span></div>
                    <div class="t-meter ${PulseAudio.trackChannelCount(t) === 1 ? 'is-mono' : ''}" data-i="${i}" aria-hidden="true"><i class="mL"></i><i class="mR"></i></div>
                    ${t.isCapture ? '' : `<button class="t-mini m-del" data-del="${i}" data-tooltip="Supprimer la piste">×</button>`}
                </div>
                ${state.automationMode ? `<div class="t-auto">${autoChip(t)}</div>` : ''}
            </div>
        </div>${renderTakesPanel(t, i)}`;
    }).join('') + rowBuses().map(renderGroupHeader).join('');
    bindGroupEvents();
    bindTakeToggles();
    renderInspector();
    observeTrackHeights();
}

// Le bouton gauche / droite (grand rond) disparaît quand la piste est trop basse, et revient quand il y a la place (comme Logic)
const PAN_KNOB_MIN_H = 70;
let _trackRO = null;
function observeTrackHeights() {
    if (!window.ResizeObserver) return;
    if (!_trackRO) {
        _trackRO = new ResizeObserver((entries) => {
            for (const en of entries) en.target.classList.toggle('is-short', en.target.getBoundingClientRect().height < PAN_KNOB_MIN_H);
        });
    }
    _trackRO.disconnect();
    document.querySelectorAll('#tracksList .track-item').forEach(el => {
        el.classList.toggle('is-short', el.getBoundingClientRect().height < PAN_KNOB_MIN_H);
        _trackRO.observe(el);
    });
}

// --- Rendu : timeline tracks (zones vides) ---
function renderTimelineTracks() {
    const el = document.getElementById('timelineTracks');
    const timelineWidthSec = Math.max(180, computeProjectEndSec() + 60);
    const timelineWidthPx = state.pxPerSecond * timelineWidthSec;

    // Piste qui recevra la prochaine prise (même règle que toggleRec)
    const recTargetIdx = state.project.tracks.findIndex(t => t.armed);

    el.innerHTML = state.project.tracks.map((t, i) => {
        const clips = t.clips || [];
        const isInstru = isInstruTrack(t);
        const needsDropzone = isInstru && clips.length === 0;
        const showRecHint = i === recTargetIdx && clips.length === 0 && !needsDropzone;

        return `${groupsStartingAt(i).map(g => renderGroupTimelineRow(g, timelineWidthPx)).join('')}
        <div class="timeline-track ${isPendDel(t) ? 'pend-del' : ''} ${t.hidden ? 'is-hidden-track' : ''} ${t.locked ? 'is-locked-track' : ''} ${t.frozen ? 'is-frozen-track' : ''} ${isInstru ? 'is-instru' : ''} ${isTrackFolded(t) ? 'is-group-collapsed' : ''}" data-i="${i}" style="width: ${timelineWidthPx}px${t.height ? `; --track-h: ${t.height}px` : ''}">
            ${clips.map((c, ci) => renderClip(t, c, ci)).join('')}
            ${needsDropzone ? renderInstruDropzone(i) : ''}
            ${showRecHint ? '<div class="track-empty-hint"><span class="rec-dot"></span>Appuie sur <kbd>R</kbd> pour t\'enregistrer ici</div>' : ''}
            ${state.automationMode ? renderVolumeCurve(t, i, timelineWidthPx) : ''}
        </div>${renderTakesLanes(t, i, timelineWidthPx)}`;
    }).join('') + rowBuses().map(b => renderGroupTimelineRow(b, timelineWidthPx)).join('');

    // Projet encore vide : un grand pas à pas clair au lieu d'une zone noire (c'est la première chose que voit un débutant)
    if (!state.recording && state.project.tracks.length && !state.project.tracks.some(t => (t.clips || []).length)
        && !state.project.tracks.some(t => isInstruTrack(t) && !(t.clips || []).length)) {   // un modèle a déjà sa zone « Dépose ton instru » : pas de doublon
        const onlyMidi = state.project.tracks.every(t => t.type === 'keys' || t.type === 'drums');
        if (onlyMidi) el.insertAdjacentHTML('beforeend', `
        <div class="empty-cta">
            <div class="empty-cta-title">Crée ton premier motif</div>
            <div class="empty-cta-steps">
                <div class="empty-cta-step"><b>1</b><span>Double-clique dans une piste : une région s'ouvre, prête à recevoir des notes</span></div>
                <div class="empty-cta-step"><b>2</b><span>Clique dans la grille pour poser des notes, puis appuie sur <kbd>Espace</kbd> pour écouter</span></div>
                <div class="empty-cta-step"><b>3</b><span>Ajoute ta voix avec <kbd>R</kbd> quand tu es prêt</span></div>
            </div>
        </div>`);
        else el.insertAdjacentHTML('beforeend', `
        <div class="empty-cta">
            <div class="empty-cta-title">Pose ton instru, puis enregistre ta voix</div>
            <div class="empty-cta-steps">
                <div class="empty-cta-step"><b>1</b><span>Glisse ton instru ici (MP3, WAV…)</span>
                    <button class="empty-cta-btn" type="button">Choisir un fichier</button>
                    <input type="file" class="empty-cta-input" accept="audio/*,.mp3,.wav,.m4a,.flac,.aif,.aiff,.ogg" hidden></div>
                <div class="empty-cta-step"><b>2</b><span>Appuie sur <kbd>R</kbd> (ou sur le rond rouge) et chante</span></div>
                <div class="empty-cta-step"><b>3</b><span>Clique sur <em>Exporter</em> : ton morceau est prêt</span></div>
            </div>
            <div class="empty-cta-sub">Pas d'instru ? Appuie directement sur <kbd>R</kbd> : Pulse enregistre ta voix seule.</div>
        </div>`);
        const cta = el.querySelector('.empty-cta');
        const inp = cta.querySelector('.empty-cta-input');
        if (inp) {
            cta.querySelector('.empty-cta-btn').addEventListener('click', (e) => { e.stopPropagation(); inp.click(); });
            inp.addEventListener('change', async () => {
                const f = inp.files && inp.files[0];
                if (!f) return;
                const ti = Math.max(0, state.project.tracks.findIndex(t => !t.isCapture && !(t.clips || []).length));
                try { await importAudioFile(f, ti, 0); } catch (err) { console.error(err); flash('Ce fichier n\'a pas pu être lu — essaie un MP3 ou un WAV'); }
            });
        }
        cta.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    if (state.selection) {
        const overlay = document.createElement('div');
        overlay.className = 'range-selection';
        el.appendChild(overlay);
        updateRangeOverlay(overlay);
    }
    renderLoopOverlay();   // le contenu des pistes vient d'être refait : la zone de boucle / plage doit se redessiner sur les pistes, pas seulement sur la règle
    renderTimelineGrid(el);
    syncPlayheadHeight();
    bindDropzones();
    bindTakePieces();
    if (state.automationMode) bindVolumeCurves();
}

// Temps par mesure (4 par défaut : 4/4 ; 3 = valse, etc.)
function bpb() { return Math.max(1, Math.min(12, Math.round(state.project.beatsPerBar) || 4)); }

// === Carte de tempo (tempo.js) : tempo et signature qui changent en cours de morceau ===
// Projet à tempo fixe : exactement les anciens calculs (60 / bpm, bpb()). Sinon tout passe par PulseTempo.
// project.tempos = [{ beat, bpm }] (jamais au temps 0 : le premier tempo reste project.bpm),
// project.signatures = [{ bar, beats }] (jamais à la mesure 0 : la première reste project.beatsPerBar).
function tempoVaries(p = state.project) { return !!(window.PulseTempo && ((p.tempos && p.tempos.length) || (p.signatures && p.signatures.length))); }
function beatAtSec(s) { return tempoVaries() ? PulseTempo.secToBeats(state.project, s) : s * state.project.bpm / 60; }
function secAtBeat(b) { return tempoVaries() ? PulseTempo.beatsToSec(state.project, b) : b * 60 / state.project.bpm; }
function bpmAtSec(s) { return tempoVaries() ? PulseTempo.bpmAt(state.project, s) : state.project.bpm; }
function bpbAtSec(s) { return tempoVaries() ? PulseTempo.beatsPerBarAt(state.project, s) : bpb(); }
// Mesure (0 = première) qui contient l'instant s, et l'instant où elle commence
function barAtSec(s) { return tempoVaries() ? PulseTempo.beatsToBar(state.project, beatAtSec(s)).bar : Math.floor(s / (bpb() * 60 / state.project.bpm) + 1e-9); }
function barStartSec(bar) { return tempoVaries() ? secAtBeat(PulseTempo.barToBeats(state.project, bar)) : bar * bpb() * 60 / state.project.bpm; }
// Finesse de grille ('bar' | 'beat' | 'division' | 'fine') → instant de grille le plus proche
function snapToGrid(t, eff) {
    if (tempoVaries()) return PulseTempo.snapSec(state.project, t, eff === 'bar' ? 'bar' : eff === 'fine' ? 1 / 8 : eff === 'division' ? 1 / 4 : 1);
    const beatSec = 60 / state.project.bpm;
    const unit = eff === 'bar' ? beatSec * bpb() : eff === 'fine' ? beatSec / 8 : eff === 'division' ? beatSec / 4 : beatSec;
    return Math.max(0, Math.round(t / unit) * unit);
}
// Temps (ou mesure) suivant / précédent sur la grille
function stepGridSec(t, dir, unit) {
    if (!tempoVaries()) {
        const beat = 60 / state.project.bpm, u = unit === 'bar' ? beat * bpb() : beat, r = t / u;
        return Math.max(0, (dir > 0 ? Math.floor(r + 1e-4) + 1 : Math.ceil(r - 1e-4) - 1) * u);
    }
    const p = state.project, b = PulseTempo.secToBeats(p, t);
    if (unit === 'bar') {
        const pos = PulseTempo.beatsToBar(p, b + (dir > 0 ? 1e-4 : -1e-4));
        return Math.max(0, secAtBeat(PulseTempo.barToBeats(p, Math.max(0, pos.bar + (dir > 0 ? 1 : 0)))));
    }
    return Math.max(0, secAtBeat(Math.max(0, dir > 0 ? Math.floor(b + 1e-4) + 1 : Math.ceil(b - 1e-4) - 1)));
}
// Morceaux où tempo et signature ne changent pas : [{ a, b, bpm, beats }] (secondes)
function tempoPieces(totalSec) {
    const p = state.project, cuts = new Set([0]);
    PulseTempo.tempoSegments(p).forEach(s => cuts.add(s.sec));
    PulseTempo.sigSegments(p).forEach(s => cuts.add(PulseTempo.beatsToSec(p, s.beat)));
    const xs = [...cuts].filter(x => x < totalSec).sort((a, b) => a - b);
    return xs.map((a, i) => ({ a, b: i + 1 < xs.length ? xs[i + 1] : totalSec, bpm: PulseTempo.bpmAt(p, a), beats: PulseTempo.beatsPerBarAt(p, a) }));
}
// Pas de mesures de la règle quand le tempo varie : calculé sur la mesure la plus serrée, pour ne jamais faire de bouillie
function rulerBarStepVar(pieces) {
    return rulerBarStep(Math.min(...pieces.map(x => x.beats * 60 / x.bpm)) * state.pxPerSecond);
}
// Grille quand le tempo varie : un jeu de lignes répétées par morceau (même rendu que la grille fixe, sans un trait par temps dans le DOM)
function renderTimelineGridVar(el) {
    const p = state.project, pps = state.pxPerSecond, total = Math.max(180, computeProjectEndSec() + 60);
    const pieces = tempoPieces(total), step = rulerBarStepVar(pieces);
    const layers = [], sizes = [], pos = [];
    const line = (alpha, period, from, to) => {
        if (to - from < 0.5 || period < 1) return;
        layers.push(`repeating-linear-gradient(90deg, rgba(255,255,255,${alpha}) 0px, rgba(255,255,255,${alpha}) 1px, transparent 1px, transparent ${period.toFixed(2)}px)`);
        sizes.push(`${(to - from).toFixed(1)}px 100%`); pos.push(`${from.toFixed(1)}px 0`);
    };
    for (const pc of pieces) {
        const beatPx = pps * 60 / pc.bpm, b = pc.b * pps;
        const b0 = PulseTempo.secToBeats(p, pc.a), firstBeat = PulseTempo.beatsToSec(p, Math.ceil(b0 - 1e-6)) * pps;
        const bar = PulseTempo.beatsToBar(p, b0 + 1e-6), barA = bar.beat < 2e-6 ? bar.bar : bar.bar + 1;
        const barN = Math.ceil(barA / step) * step, firstBar = PulseTempo.beatsToSec(p, PulseTempo.barToBeats(p, barN)) * pps;
        if (beatPx >= 240 && step === 1) line(0.03, beatPx / 4, firstBeat, b);
        if (beatPx >= 20 && step === 1) line(0.045, beatPx, firstBeat, b);
        if (firstBar < b) line(step > 1 ? 0.08 : 0.10, beatPx * pc.beats * step, firstBar, b);
    }
    el.style.backgroundImage = layers.join(',');
    el.style.backgroundSize = sizes.join(',');
    el.style.backgroundPosition = pos.join(',');
    el.style.backgroundRepeat = layers.map(() => 'no-repeat').join(',');
}
function renderTimelineGrid(el) {
    if (tempoVaries()) { renderTimelineGridVar(el); return; }
    el.style.backgroundPosition = ''; el.style.backgroundRepeat = '';
    const beatSec = 60 / state.project.bpm;
    const beatPx = state.pxPerSecond * beatSec;
    const step = rulerBarStep(beatPx * bpb());         // dézoomé : une ligne toutes les N mesures, jamais une bouillie
    const barPx = beatPx * bpb() * step;
    // Ligne de mesure : 1px opaque, ligne de beat : 1px transparent sauf si zoom suffisant
    const showBeats = beatPx >= 20 && step === 1;
    const layers = [], sizes = [];
    const line = (alpha, period) => {
        layers.push(`repeating-linear-gradient(90deg, rgba(255,255,255,${alpha}) 0px, rgba(255,255,255,${alpha}) 1px, transparent 1px, transparent ${period.toFixed(2)}px)`);
        sizes.push(`${period.toFixed(2)}px 100%`);
    };
    if (beatPx >= 240 && step === 1) line(0.03, beatPx / 4);     // seizièmes (zoom serré)
    if (showBeats) line(0.045, beatPx);
    line(step > 1 ? 0.08 : 0.10, barPx);
    el.style.backgroundImage = layers.join(',');
    el.style.backgroundSize = sizes.join(',');
}

// Peaks waveform : ~20 points/seconde (max 4000), arrondis pour alléger la sauvegarde
function makePeaks(audioBuffer) {
    const n = Math.max(200, Math.min(4000, Math.round(audioBuffer.duration * 20)));
    return Array.from(PulseAudio.computePeaks(audioBuffer, n), v => Math.round(v * 100) / 100);
}

// Portion du fichier source affichée par un clip (en indices de peaks)
function clipPeakWindow(c) {
    const off = c.offset || 0;
    const srcDur = (c.id && window.PulseAudio && PulseAudio.getBufferDuration(c.id)) || (off + c.duration);
    const n = c.peaks.length;
    return { p0: (off / srcDur) * n, span: Math.max(1, (c.duration / srcDur) * n) };
}

function hasClipOverlap(t, c) {
    if (!t.clips) return false;
    const cEnd = c.start + c.duration;
    return t.clips.some(other => other !== c && !other.recording
        && other.start < cEnd && (other.start + other.duration) > c.start);
}

function renderClip(t, c, ci) {
    const hasBuffer = c.id && (window.PulseAudio ? PulseAudio.hasBuffer(c.id) : false);
    const origWidthPx = c.duration * state.pxPerSecond;
    // Si loopEnd défini, le clip s'étend visuellement jusqu'à loopEnd
    const totalWidthPx = c.loopEnd ? (c.loopEnd - c.start) * state.pxPerSecond : origWidthPx;
    const loopWidthPx  = totalWidthPx - origWidthPx;
    const leftPx = c.start * state.pxPerSecond;
    const posTC = secondsToTC(c.start);
    const durTC = secondsToDuration(c.duration);
    const tooltip = `${c.name || 'Clip'} — ${durTC} @ ${posTC}`;
    const stale = !hasBuffer && !c.recording && c.id;
    const trackIdx = state.project.tracks.indexOf(t);
    const selected = state.selectedClip && state.selectedClip.trackIdx === trackIdx && state.selectedClip.clipIdx === ci;
    const multiSelected = state.selectedClips.has(`${trackIdx}:${ci}`);
    const overlap = !c.recording && hasClipOverlap(t, c);

    const fadeInPx  = c.fadeIn  ? Math.min(c.fadeIn  * state.pxPerSecond, origWidthPx * 0.9) : 0;
    const fadeOutPx = c.fadeOut ? Math.min(c.fadeOut * state.pxPerSecond, origWidthPx * 0.9) : 0;

    // Zones de répétition (waveform fantôme)
    let loopHtml = '';
    if (loopWidthPx > 4) {
        // Répétitions entières + fragment final
        const repeatDur = c.duration;
        const totalLoop = c.loopEnd - c.start - c.duration;
        let offsetPx = origWidthPx;
        let remaining = totalLoop;
        while (remaining > 0.05) {
            const segDur = Math.min(repeatDur, remaining);
            const segPx = segDur * state.pxPerSecond;
            loopHtml += `<div class="clip-loop-repeat" style="left:${offsetPx.toFixed(1)}px;width:${segPx.toFixed(1)}px">
                ${renderClipWaveformLoop(c, segPx, repeatDur)}
            </div>`;
            offsetPx += segPx;
            remaining -= segDur;
        }
    }

    return `
    <div class="clip ${clipHasFx(c) ? 'has-fx' : ''} ${c.recording ? 'is-recording' : ''} ${c.pending ? 'is-pending' : ''} ${stale ? 'is-stale' : ''} ${selected || multiSelected ? 'is-selected' : ''} ${multiSelected ? 'is-multi-selected' : ''} ${c.muted ? 'is-muted-clip' : ''} ${loopWidthPx > 0 ? 'has-loop' : ''} ${overlap ? 'has-overlap' : ''}"
         data-ci="${ci}"
         data-tooltip="${esc(tooltip)}"
         style="--clip-color: ${c.color || t.color}; left: ${leftPx}px; width: ${totalWidthPx}px; --orig-w: ${origWidthPx}px">
        <div class="clip-trim-handle left"></div>
        <div class="clip-trim-handle right"></div>
        <div class="clip-fade-zone in"  data-fade="in"></div>
        <div class="clip-fade-zone out" data-fade="out"></div>
        ${fadeInPx  > 0 ? `<div class="clip-fade-overlay in"  style="width:${fadeInPx}px">${fadeLine('in', fadeK(c, 'in'))}</div><div class="fade-curve-handle in" data-fade="in" data-tooltip="Tire vers le haut ou le bas pour arrondir le fondu (double-clic = droit)" style="${fadeHandleStyle('in', fadeInPx, fadeK(c, 'in'))}"></div>` : ''}
        ${fadeOutPx > 0 ? `<div class="clip-fade-overlay out" style="width:${fadeOutPx}px">${fadeLine('out', fadeK(c, 'out'))}</div><div class="fade-curve-handle out" data-fade="out" data-tooltip="Tire vers le haut ou le bas pour arrondir le fondu (double-clic = droit)" style="${fadeHandleStyle('out', fadeOutPx, fadeK(c, 'out'))}"></div>` : ''}
        ${c.midi ? renderMidiNotes(c, origWidthPx) : renderClipWaveform(c, origWidthPx)}
        ${loopHtml}
        ${!c.recording ? '<div class="clip-loop-handle" data-loop-handle="1"></div>' : ''}
        ${clipFxHtml(c, totalWidthPx)}
        <div class="clip-name" data-ci="${ci}">${esc(c.name || 'Clip')}${stale ? ' <span class="clip-stale-tag">⚠ audio perdu</span>' : ''}${c.midi ? ` <span class="clip-gain-tag">${c.midi.pid ? '🔗 ' : ''}${c.midi.inst === 'drums' ? 'PAS' : 'MIDI'}</span>` : ''}${c.tune ? ' <span class="clip-gain-tag">TUNE</span>' : ''}${c.rev ? ' <span class="clip-gain-tag">REV</span>' : ''}${c.warp ? ` <span class="clip-gain-tag">WARP ${Math.round(c.warp.srcBpm)}→${Math.round(c.warp.bpm)}</span>` : ''}${c.gain && c.gain !== 1 ? ` <span class="clip-gain-tag">${(20*Math.log10(c.gain)).toFixed(1)}dB</span>` : ''}</div>
    </div>`;
}

// Courbure d'un fondu : le niveau suit p^k (k = 1 : droit, k < 1 : monte vite, k > 1 : monte tard)
const FADE_K_MIN = 0.25, FADE_K_MAX = 4;
const fadeK = (c, dir) => { const k = dir === 'in' ? c.fadeInCurve : c.fadeOutCurve; return k > 0 ? Math.max(FADE_K_MIN, Math.min(FADE_K_MAX, k)) : 1; };
// Trait de la courbe de fondu : exactement la courbe du son
function fadeLine(dir, k = 1) {
    let pts = '';
    for (let i = 0; i <= 24; i++) {
        const p = i / 24;                       // 0 → 1 le long du fondu
        const g = Math.pow(dir === 'in' ? p : 1 - p, k);
        pts += `${(p * 100).toFixed(1)},${(100 - g * 100).toFixed(1)} `;
    }
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts.trim()}"/></svg>`;
}
// Poignée au milieu du fondu : tirer vers le haut / le bas pour l'arrondir
function fadeHandleStyle(dir, px, k) {
    return `${dir === 'in' ? 'left' : 'right'}:${(px / 2).toFixed(1)}px; top:${((1 - Math.pow(0.5, k)) * 100).toFixed(1)}%`;
}

function renderClipWaveformLoop(c, segWidthPx, fullDur) {
    if (!c.peaks || !c.peaks.length || segWidthPx < 8) return '';
    const ratio = segWidthPx / (fullDur * state.pxPerSecond);
    const { p0, span } = clipPeakWindow(c);
    // Pas plus de barres que de pics dans la fenêtre : au-delà, le dessin ne gagne rien et pèse très lourd
    const targetBars = Math.max(2, Math.min(Math.floor(segWidthPx / 2), Math.ceil(span * ratio)));
    const step = (span * ratio) / targetBars;
    const h = Math.max(20, state.trackHeight - 28);
    const barWidth = segWidthPx / targetBars;
    const cy = h / 2;
    let path = '';
    for (let i = 0; i < targetBars; i++) {
        const idx = Math.floor(p0 + ((i * step) % span));
        const v = c.peaks[idx] || 0;
        const halfH = Math.max(0.5, (v * h) * 0.48);
        const x = i * barWidth;
        const bw = Math.max(0.5, barWidth - 0.5);
        path += `M${x.toFixed(1)} ${(cy - halfH).toFixed(1)}h${bw.toFixed(1)}v${(halfH * 2).toFixed(1)}h-${bw.toFixed(1)}z`;
    }
    return `<svg class="clip-wave-svg loop-wave" viewBox="0 0 ${segWidthPx} ${h}" preserveAspectRatio="none"><path d="${path}"/></svg>`;
}

// Au-delà de ce zoom les pics enregistrés ne suffisent plus : on relit le son lui-même, pour la partie visible seulement
const FINE_WAVE_PPS = 100;
function renderClipWaveformFine(c, widthPx) {
    const buf = c.id && window.PulseAudio && PulseAudio.getBuffer(c.id);
    if (!buf) return null;
    const pps = state.pxPerSecond, left = c.start * pps;
    const tl = document.querySelector('.timeline');
    const vw = tl ? tl.clientWidth : 1400, sl = tl ? tl.scrollLeft : 0;
    const lo = Math.max(0, Math.floor(sl - vw - left)), hi = Math.min(Math.ceil(widthPx), Math.ceil(sl + 2 * vw - left));
    const h = Math.max(20, state.trackHeight - 28), cy = h / 2;
    if (hi - lo < 2) return `<svg class="clip-wave-svg fine-wave" viewBox="0 0 10 ${h}"></svg>`;
    const bw = 2, n = Math.max(1, Math.floor((hi - lo) / bw)), span = hi - lo;
    const sr = buf.sampleRate, off = c.offset || 0;
    const d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const gainScale = c.gain !== undefined ? Math.min(2, c.gain) : 1;
    const envAt = (tt) => Math.min(1, c.fadeIn > 0 && tt < c.fadeIn ? Math.pow(tt / c.fadeIn, fadeK(c, 'in')) : 1,
        c.fadeOut > 0 && tt > c.duration - c.fadeOut ? Math.pow(Math.max(0, (c.duration - tt) / c.fadeOut), fadeK(c, 'out')) : 1);
    // Zoom très serré (moins de 3 échantillons par pixel) : la vraie forme d'onde en ligne, comme Logic / Pro Tools
    if (pps >= sr / 3) {
        const k0 = Math.max(0, Math.floor((off + lo / pps) * sr) - 1), k1 = Math.min(d0.length - 1, Math.ceil((off + hi / pps) * sr) + 1);
        let pts = '';
        for (let k = k0; k <= k1; k++) {
            const tt = k / sr - off, x = tt * pps - lo;
            const v = d1 ? (d0[k] + d1[k]) / 2 : d0[k];
            const y = cy - Math.max(-cy * 0.98, Math.min(cy * 0.98, v * gainScale * envAt(tt) * h * 0.48));
            pts += `${x.toFixed(1)},${y.toFixed(1)} `;
        }
        const dots = pps >= sr * 1.5;   // assez de place : un point par échantillon, comme Logic
        return `<svg class="clip-wave-svg fine-wave line-wave" style="left:${lo + 2}px;width:${span}px;right:auto" viewBox="0 0 ${span} ${h}" preserveAspectRatio="none">`
            + `<line x1="0" y1="${cy}" x2="${span}" y2="${cy}" class="wave-axis"/><polyline points="${pts}" class="wave-line${dots ? ' with-dots' : ''}"/></svg>`;
    }
    let path = '';
    for (let i = 0; i < n; i++) {
        const t0 = off + (lo + i * bw) / pps;
        const s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(d0.length, Math.max(s0 + 1, Math.floor((t0 + bw / pps) * sr)));
        const stride = Math.max(1, Math.ceil((s1 - s0) / 256));
        let v = 0;
        for (let k = s0; k < s1; k += stride) {
            const a = Math.abs(d0[k]); if (a > v) v = a;
            if (d1) { const b = Math.abs(d1[k]); if (b > v) v = b; }
        }
        const tt = (lo + (i + 0.5) * bw) / pps;
        const env = Math.min(1, c.fadeIn > 0 && tt < c.fadeIn ? Math.pow(tt / c.fadeIn, fadeK(c, 'in')) : 1,
            c.fadeOut > 0 && tt > c.duration - c.fadeOut ? Math.pow(Math.max(0, (c.duration - tt) / c.fadeOut), fadeK(c, 'out')) : 1);
        const halfH = Math.max(0.5, Math.min(v * gainScale * env * h * 0.48, cy * 0.97));
        path += `M${(i * bw).toFixed(1)} ${(cy - halfH).toFixed(1)}h${bw - 0.3}v${(halfH * 2).toFixed(1)}h-${bw - 0.3}z`;
    }
    return `<svg class="clip-wave-svg fine-wave" style="left:${lo + 2}px;width:${span}px;right:auto" viewBox="0 0 ${span} ${h}" preserveAspectRatio="none"><path d="${path}"/></svg>`;
}
// Quand on défile en zoom serré, la partie visible change : on redessine seulement les formes d'onde
let _fineRaf = 0;
function refreshFineWaves() {
    if (state.pxPerSecond <= FINE_WAVE_PPS || _fineRaf) return;
    _fineRaf = requestAnimationFrame(() => {
        _fineRaf = 0;
        document.querySelectorAll('.timeline-track .clip').forEach(el => {
            const tEl = el.closest('.timeline-track');
            const c = tEl && state.project.tracks[parseInt(tEl.dataset.i)]?.clips[parseInt(el.dataset.ci)];
            if (!c || c.recording) return;
            const w = parseFloat(el.style.getPropertyValue('--orig-w'));
            const wave = el.querySelector('.clip-wave-svg:not(.loop-wave)');
            if (wave && w > 0) wave.outerHTML = renderClipWaveform(c, w);
        });
    });
}

function renderClipWaveform(c, widthPx) {
    if (state.pxPerSecond > FINE_WAVE_PPS && widthPx >= 10) {
        const fine = renderClipWaveformFine(c, widthPx);
        if (fine) return fine;
    }
    const peaks = c.peaks;
    if (!peaks || !peaks.length || widthPx < 10) {
        return '<div class="clip-wave"></div>';
    }
    const { p0, span } = clipPeakWindow(c);
    // Pas plus de barres que de pics dans la fenêtre : au-delà, le dessin ne gagne rien et pèse très lourd
    const targetBars = Math.max(2, Math.min(Math.floor(widthPx / 2), Math.ceil(span)));
    const step = span / targetBars;
    const h = Math.max(20, state.trackHeight - 28);
    const barWidth = widthPx / targetBars;
    const cy = h / 2;
    const gainScale = c.gain !== undefined ? Math.min(2, c.gain) : 1;

    let path = '';
    for (let i = 0; i < targetBars; i++) {
        // Max sur la fenêtre de peaks couverte par la barre (pas de transitoire raté)
        const a = Math.floor(p0 + i * step);
        const b = Math.max(a + 1, Math.floor(p0 + (i + 1) * step));
        let v = 0;
        for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > v) v = peaks[k];
        // Le spectre suit les fondus : il s'amincit là où le son monte ou descend
        const tt = (i + 0.5) / targetBars * c.duration;
        const env = Math.min(1, c.fadeIn > 0 && tt < c.fadeIn ? Math.pow(tt / c.fadeIn, fadeK(c, 'in')) : 1, c.fadeOut > 0 && tt > c.duration - c.fadeOut ? Math.pow(Math.max(0, (c.duration - tt) / c.fadeOut), fadeK(c, 'out')) : 1);
        const halfH = Math.max(0.5, Math.min((v * gainScale * env * h) * 0.48, cy * 0.97));
        const x = i * barWidth;
        const bw = Math.max(0.5, barWidth - 0.5);
        path += `M${x.toFixed(1)} ${(cy - halfH).toFixed(1)}h${bw.toFixed(1)}v${(halfH * 2).toFixed(1)}h-${bw.toFixed(1)}z`;
    }
    return `<svg class="clip-wave-svg" viewBox="0 0 ${widthPx} ${h}" preserveAspectRatio="none"><path d="${path}"/></svg>`;
}

function computeProjectEndSec() {
    let max = 0;
    state.project.tracks.forEach(t => (t.clips || []).forEach(c => {
        const end = Math.max(c.start + c.duration, c.loopEnd || 0);
        if (end > max) max = end;
    }));
    return max;
}

function secondsToTC(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    return `${m}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function secondsToDuration(s) {
    if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
    if (s < 60) return `${s.toFixed(2)}s`;
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return `${m}m${sec}s`;
}

function renderInstruDropzone(trackIdx) {
    return `
    <div class="instru-dropzone" data-i="${trackIdx}">
        <div class="dz-inner">
            <div class="dz-row">
                <button class="dz-tab active" data-tab="file">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Fichier local
                </button>
                ${urlImportAvailable() ? `                <button class="dz-tab" data-tab="url">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Lien YouTube / SoundCloud
                </button>` : ''}
            </div>
            <div class="dz-panel dz-panel-file active" data-panel="file">
                <div class="dz-big">
                    <div class="dz-icon">🎵</div>
                    <div class="dz-title">Dépose ton instru ici</div>
                    <div class="dz-sub">MP3, WAV, FLAC, M4A — ou clique pour choisir</div>
                    <input type="file" class="dz-input" accept="audio/*,.mp3,.wav,.m4a,.flac,.aif,.aiff,.ogg">
                </div>
            </div>
            <div class="dz-panel dz-panel-url" data-panel="url">
                <div class="dz-url-wrap">
                    <input type="url" class="dz-url-input" placeholder="https://youtube.com/watch?v=…">
                    <button class="dz-url-btn">Importer</button>
                </div>
                <div class="dz-url-wrap dz-url-convert">
                    <span class="dz-url-or">ou garder le fichier :</span>
                    <button class="dz-url-btn dz-url-dl" data-fmt="mp3">Convertir en MP3</button>
                    <button class="dz-url-btn dz-url-dl" data-fmt="wav">Convertir en WAV</button>
                </div>
                <div class="dz-url-note">
                    <span>Usage personnel : vérifie que tu as le droit d'utiliser cette instru (licence du beatmaker, crédit « prod by »).</span>
                    <span>La 1re fois, Pulse télécharge son outil d'import (quelques secondes).</span>
                </div>
            </div>
        </div>
    </div>`;
}

function bindDropzones() {
    document.querySelectorAll('.instru-dropzone').forEach(dz => {
        const trackIdx = parseInt(dz.dataset.i);

        // Toggle tabs
        dz.querySelectorAll('.dz-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = tab.dataset.tab;
                dz.querySelectorAll('.dz-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
                dz.querySelectorAll('.dz-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));
            });
        });

        // File input
        const input = dz.querySelector('.dz-input');
        const bigZone = dz.querySelector('.dz-big');
        bigZone.addEventListener('click', (e) => {
            if (e.target === input) return;
            input.click();
        });
        input.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (f) importAudioFile(f, trackIdx);
        });

        // Drag & drop
        ['dragenter', 'dragover'].forEach(ev => bigZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            bigZone.classList.add('dragging');
        }));
        ['dragleave', 'drop'].forEach(ev => bigZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            bigZone.classList.remove('dragging');
        }));
        bigZone.addEventListener('drop', (e) => {
            const f = e.dataTransfer.files[0];
            if (f && ((f.type || '').startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i.test(f.name))) importAudioFile(f, trackIdx);
            else flash('Seuls les fichiers audio sont acceptés');
        });

        // URL field
        const urlBtn = dz.querySelector('.dz-url-btn');
        const urlInput = dz.querySelector('.dz-url-input');
        urlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = urlInput.value.trim();
            if (!url) { flash('Colle d\'abord le lien de ton instru dans la case'); return; }
            if (!urlImportAvailable()) { flash('Les liens marchent dans le logiciel Pulse installé — ici, télécharge ton instru puis dépose le fichier'); return; }
            if (!/^https:\/\/(www\.|m\.|music\.|on\.)?(youtube\.com|youtu\.be|soundcloud\.com)\//i.test(url)) { flash('Colle un lien YouTube ou SoundCloud (qui commence par https://)'); return; }
            importFromUrl(url, trackIdx, urlBtn);
        });
        dz.querySelectorAll('.dz-url-dl').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = urlInput.value.trim();
            if (!url) { flash('Colle d\'abord un lien YouTube ou SoundCloud dans la case'); return; }
            if (!/^https:\/\/(www\.|m\.|music\.|on\.)?(youtube\.com|youtu\.be|soundcloud\.com)\//i.test(url)) { flash('Colle un lien YouTube ou SoundCloud (qui commence par https://)'); return; }
            convertFromUrl(url, b.dataset.fmt, b);
        }));
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); urlBtn.click(); }
            e.stopPropagation();
        });

        // Stopper les clics sur la dropzone pour qu'ils ne placent pas le playhead
        dz.addEventListener('mousedown', (e) => e.stopPropagation());
    });
}

// === Import d'une instru par lien (logiciel installé seulement : yt-dlp côté Rust) ===
function urlImportAvailable() { return !!(window.__TAURI__ && window.__TAURI__.core); }
async function importFromUrl(url, trackIdx, btn) {
    const inv = window.__TAURI__.core.invoke;
    if (btn) { btn.disabled = true; btn.textContent = 'Téléchargement…'; }
    flash('Téléchargement de ton instru… (la 1re fois, Pulse installe aussi son outil d\'import)');
    try {
        const path = await inv('import_url', { url });
        const bytes = await inv('read_import_file', { path });
        const name = String(path).split(/[\\/]/).pop() || 'instru.m4a';
        const ext = (name.split('.').pop() || '').toLowerCase();
        const file = new File([bytes], name.replace(/_/g, ' '), { type: ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : ext === 'webm' ? 'audio/webm' : ext === 'wav' ? 'audio/wav' : 'audio/mpeg' });
        await importAudioFile(file, trackIdx);
    } catch (err) {
        flash('Import impossible : ' + (err && err.message ? err.message : err));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Importer'; }
    }
}

// Lien → fichier MP3 ou WAV rangé dans Téléchargements (sans toucher au projet)
async function convertFromUrl(url, fmt, btn) {
    const inv = window.__TAURI__.core.invoke;
    const label = btn ? btn.textContent : '';
    document.querySelectorAll('.dz-url-btn').forEach(b => { b.disabled = true; });
    if (btn) btn.textContent = 'Conversion…';
    flash(`Téléchargement et conversion en ${fmt.toUpperCase()}… (la 1re fois, Pulse installe aussi son outil d'import)`);
    try {
        if (fmt === 'mp3' && !window.lamejs) throw new Error('le MP3 n\'est pas prêt — recharge la page, ou choisis WAV');
        const path = await inv('import_url', { url });
        const bytes = await inv('read_import_file', { path });
        await PulseAudio.init();
        const buf = await PulseAudio.getContext().decodeAudioData(bytes.slice(0));
        const wavBlob = PulseAudio.audioBufferToWav(buf);
        const outBlob = fmt === 'mp3' ? await encodeToMp3(wavBlob, 320) : wavBlob;
        const base = (String(path).split(/[\\/]/).pop() || 'son').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        const data = new Uint8Array(await outBlob.arrayBuffer());
        await inv('save_download', data, { headers: { name: encodeURIComponent(`${base}.${fmt}`) } });
        flash(`✓ ${base}.${fmt} rangé dans ton dossier Téléchargements`);
    } catch (err) {
        flash('Conversion impossible : ' + (err && err.message ? err.message : err));
    } finally {
        document.querySelectorAll('.dz-url-btn').forEach(b => { b.disabled = false; });
        if (btn) btn.textContent = label;
    }
}

// === Import d'un fichier audio local ===
async function importAudioFile(file, trackIdx, atTime = null, opts = {}) {
    const t = state.project.tracks[trackIdx];
    if (!t) return false;
    flash(`Import de ${file.name}…`);
    try {
        await PulseAudio.init();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await PulseAudio.getContext().decodeAudioData(arrayBuffer.slice(0)); // slice: copy pour éviter détachement
        const duration = audioBuffer.duration;

        const clipId = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        PulseAudio.registerBuffer(clipId, audioBuffer);
        const peaks = makePeaks(audioBuffer);

        // Persistance : encode en WAV et stocke en IndexedDB (lossless, portable)
        try {
            const wavBlob = PulseAudio.audioBufferToWav(audioBuffer);
            await PulsePersist.saveBlob(clipId, wavBlob, { originalName: file.name });
        } catch (persErr) { console.warn('Persist failed', persErr); }

        const hadSound = projectHasSound();
        if (!opts.noUndo) pushUndo();
        t.clips = t.clips || [];
        // Un fichier posé sur une piste vide, pas armée : c'est l'instru → la piste devient « Instru » (icône à part, la voix ira ailleurs)
        // (seulement s'il n'y a pas déjà une instru et si la piste n'est pas rangée dans un groupe : une voix déposée sur « Lead » reste une voix)
        const inGroup = t.output && t.output !== 'master' && (state.project.buses || []).some(b => b.id === t.output && b.isGroup);
        if (!opts.noInstru && !t.clips.length && !t.armed && !t.isCapture && (!t.type || t.type === 'audio') && !inGroup
            && !state.project.tracks.some((o, oi) => oi !== trackIdx && isInstruTrack(o))) {
            t.type = 'inst';
            if (/^Piste \d+$/.test(t.name || '')) t.name = 'Instru';
        }
        t.clips.push({
            id: clipId,
            name: file.name.replace(/\.[^.]+$/, ''),
            start: atTime !== null ? atTime : 0,
            duration,
            peaks,
            fileName: file.name,
            fileSize: file.size
        });

        // Le tempo ne suit le fichier que pour le tout premier son du projet (sinon les prises déjà posées se décaleraient)
        const estimatedBpm = hadSound ? null : detectBpmStub(audioBuffer);
        if (estimatedBpm) {
            state.project.bpm = estimatedBpm;
            document.getElementById('bpmInput').value = estimatedBpm;
            renderRuler();
            flash(`✓ ${file.name} ajouté — tempo trouvé : ${estimatedBpm} BPM${t.type === 'inst' ? ' · appuie sur R pour enregistrer ta voix' : ''}`);
        } else {
            flash(`${file.name} importé${t.type === 'inst' ? ' · appuie sur R pour enregistrer ta voix' : ''}`);
        }

        renderAll();
        saveProject();
        return true;
    } catch (err) {
        console.error(err);
        flash(err && err.name === 'EncodingError'
            ? 'Ce fichier n\'est pas lisible ici : exporte-le en MP3 ou WAV puis redépose-le'
            : 'Impossible de lire ce fichier audio');
        return false;
    }
}

// Détection du tempo : enveloppe des attaques (flux d'énergie) + autocorrélation.
// Analyse jusqu'à 60 s au cœur du morceau, renvoie un BPM dans [70, 180] ou null si pas de pulsation nette.
function detectBpmStub(audioBuffer) {
    try {
        const sr = audioBuffer.sampleRate;
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
        const hop = Math.round(sr / 400);              // 2,5 ms
        const fps = sr / hop;
        const total = Math.floor(ch0.length / hop);
        const want = Math.min(total, Math.round(60 * fps));
        if (want < fps * 6) return null;               // moins de 6 s : pas fiable
        const first = Math.floor((total - want) / 2);

        // Énergie par trame → attaques = hausses d'énergie (log)
        const onset = new Float32Array(want);
        let prev = 0, mean = 0;
        for (let f = 0; f < want; f++) {
            const a = (first + f) * hop;
            let e = 0;
            for (let k = 0; k < hop; k++) {
                const v = ch1 ? (ch0[a + k] + ch1[a + k]) * 0.5 : ch0[a + k];
                e += v * v;
            }
            const le = Math.log(1 + 1000 * e / hop);
            const d = le - prev;
            onset[f] = d > 0 ? d : 0;
            prev = le;
            mean += onset[f];
        }
        mean /= want;
        if (mean < 1e-5) return null;
        // Lissage ~12 ms : rend la mesure insensible à l'alignement des attaques sur les trames
        const raw = onset.slice();
        for (let f = 2; f < want - 2; f++) {
            onset[f] = (raw[f - 2] + 2 * raw[f - 1] + 3 * raw[f] + 2 * raw[f + 1] + raw[f + 2]) / 9;
        }
        for (let f = 0; f < want; f++) onset[f] -= mean;

        const ac = (lag) => {
            const l0 = Math.floor(lag), fr = lag - l0;
            let sum = 0;
            for (let f = 0; f + l0 + 1 < want; f++) sum += onset[f] * (onset[f + l0] * (1 - fr) + onset[f + l0 + 1] * fr);
            return sum / (want - l0);
        };
        const ac0 = ac(0);
        if (ac0 <= 0) return null;

        // Balayage grossier 70–180 BPM, renforcé par les multiples (2 et 4 temps)
        let best = 0, bestScore = -Infinity;
        for (let bpm = 70; bpm <= 180; bpm += 0.5) {
            const lag = fps * 60 / bpm;
            // Légère préférence pour les tempos courants (départage 81 / 162, etc.)
            const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
            const score = (ac(lag) + 0.6 * ac(lag * 2) + 0.4 * ac(lag * 4)) * prior;
            if (score > bestScore) { bestScore = score; best = bpm; }
        }
        if (bestScore / ac0 < 0.08) return null;       // pas de pulsation régulière

        // Affinage sur 8 temps (résolution 8× meilleure)
        let fine = best, fineScore = -Infinity;
        for (let bpm = best - 0.6; bpm <= best + 0.6; bpm += 0.02) {
            const sc = ac(fps * 60 / bpm * 8) + ac(fps * 60 / bpm * 4);
            if (sc > fineScore) { fineScore = sc; fine = bpm; }
        }
        // Les instrus sont presque toujours à un tempo entier
        const rounded = Math.round(fine);
        return Math.abs(fine - rounded) < 0.25 ? rounded : Math.round(fine * 10) / 10;
    } catch {
        return null;
    }
}

// --- Rendu : règle temporelle ---
// Pas de mesures affichées : 1, 2, 4, 8… pour que deux repères ne soient jamais à moins de 36 px
function rulerBarStep(barPx) {
    let step = 1;
    while (barPx * step < 36 && step < 4096) step *= 2;
    return step;
}

function renderRuler() {
    if (window.PulseAudio && PulseAudio.setBeatsPerBar) PulseAudio.setBeatsPerBar(bpb());
    const ruler = document.getElementById('timelineRuler');
    const beatSec = 60 / state.project.bpm;
    const beatPx = state.pxPerSecond * beatSec;
    const totalSec = Math.max(180, computeProjectEndSec() + 60);
    const bars = Math.ceil(totalSec / (beatSec * bpb()));
    const showBeats = beatPx >= 24; // affiche les numéros de beat si assez de place
    const step = rulerBarStep(beatPx * bpb());
    // Subdivisions : seulement quand il y a la place (zoom serré, pour caler à la milliseconde près)
    const subs = beatPx >= 480 ? 8 : beatPx >= 100 ? 4 : 1;

    let html = tempoVaries() ? rulerHtmlVar(totalSec) : '';
    if (!tempoVaries()) for (let bar = 0; bar <= bars; bar += step) {
        const x = bar * beatPx * bpb();
        html += `<div class="ruler-tick major" style="left:${x.toFixed(1)}px"></div>`;
        html += `<div class="ruler-label major${bar === 0 ? ' first' : ''}" style="left:${x.toFixed(1)}px">${bar + 1}</div>`;
        if (step > 1) continue;     // dézoomé : seulement les mesures
        for (let beat = 0; beat < bpb(); beat++) {
            const bx = x + beat * beatPx;
            if (beat > 0) {
                html += `<div class="ruler-tick minor" style="left:${bx.toFixed(1)}px"></div>`;
                if (showBeats) html += `<div class="ruler-label minor" style="left:${bx.toFixed(1)}px">${beat + 1}</div>`;
            }
            for (let k = 1; k < subs; k++) {
                const sx = bx + k * beatPx / subs;
                html += `<div class="ruler-tick ${k % 2 === 0 || subs === 4 ? 'sub' : 'subsub'}" style="left:${sx.toFixed(1)}px"></div>`;
            }
        }
    }
    ruler.innerHTML = html;
    // La règle fait la largeur de tout le morceau (sinon, dès qu'on défile à droite, elle s'arrête au bord de l'écran)
    ruler.style.width = Math.ceil(totalSec * state.pxPerSecond) + 'px';
    ruler.style.minWidth = '100%';

    // Marqueurs (re-injectés après innerHTML)
    renderMarkers();
    if (typeof renderTempoLane === 'function') renderTempoLane();
    // Overlay loop (re-injectée après innerHTML)
    renderLoopOverlay();
}

// Règle quand le tempo ou la signature changent : mêmes repères, calculés morceau par morceau,
// plus une pastille à chaque changement (rose = tempo, bleu = signature)
function rulerHtmlVar(totalSec) {
    const p = state.project, pps = state.pxPerSecond, pieces = tempoPieces(totalSec), step = rulerBarStepVar(pieces);
    let html = '';
    const lines = PulseTempo.gridLines(p, 0, totalSec, step > 1 ? { barsOnly: true, every: step } : {});
    lines.forEach((l, i) => {
        const x = l.sec * pps;
        if (l.isBar) {
            html += `<div class="ruler-tick major" style="left:${x.toFixed(1)}px"></div>`;
            html += `<div class="ruler-label major${l.bar === 0 ? ' first' : ''}" style="left:${x.toFixed(1)}px">${l.bar + 1}</div>`;
        }
        if (step > 1) return;
        const next = i + 1 < lines.length ? lines[i + 1].sec : PulseTempo.beatsToSec(p, PulseTempo.secToBeats(p, l.sec) + 1);
        const beatPx = (next - l.sec) * pps, subs = beatPx >= 480 ? 8 : beatPx >= 100 ? 4 : 1;
        if (!l.isBar) {
            html += `<div class="ruler-tick minor" style="left:${x.toFixed(1)}px"></div>`;
            if (beatPx >= 24) html += `<div class="ruler-label minor" style="left:${x.toFixed(1)}px">${l.beat + 1}</div>`;
        }
        for (let k = 1; k < subs; k++) html += `<div class="ruler-tick ${k % 2 === 0 || subs === 4 ? 'sub' : 'subsub'}" style="left:${(x + k * beatPx / subs).toFixed(1)}px"></div>`;
    });
    (p.signatures || []).forEach(sg => {
        const x = PulseTempo.beatsToSec(p, PulseTempo.barToBeats(p, sg.bar)) * pps;
        html += `<div class="ruler-sig" data-bar="${sg.bar}" style="left:${x.toFixed(1)}px" title="Signature : clic pour la changer">${PulseTempo.beatsToBar(p, PulseTempo.barToBeats(p, sg.bar)).beats}/4</div>`;
    });
    return html;
}

function renderMarkers() {
    const ruler = document.getElementById('timelineRuler');
    // Supprimer anciens marqueurs
    ruler.querySelectorAll('.marker').forEach(m => m.remove());
    const markers = state.project.markers || [];
    markers.forEach((mk, idx) => {
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.left = (mk.time * state.pxPerSecond) + 'px';
        el.innerHTML = `<div class="marker-line"></div><div class="marker-label">${esc(mk.name || (idx + 1))}</div>`;
        el.dataset.idx = idx;
        // Clic gauche → placer le curseur sur le marqueur
        el.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (e.button === 2) return;
            state.playhead = mk.time;
            updatePlayhead(); updateChrono();
        });
        // Clic droit → menu
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            openMarkerContextMenu(e.clientX, e.clientY, idx);
        });
        ruler.appendChild(el);
    });
}

function navigateMarker(dir) {
    const markers = (state.project.markers || []).slice().sort((a, b) => a.time - b.time);
    if (!markers.length) { flash('Aucun marqueur'); return; }
    const ph = state.playhead;
    let target;
    if (dir > 0) {
        target = markers.find(m => m.time > ph + 0.05);
    } else {
        target = [...markers].reverse().find(m => m.time < ph - 0.05);
    }
    if (!target) target = dir > 0 ? markers[0] : markers[markers.length - 1];
    state.playhead = target.time;
    updatePlayhead(); updateChrono();
    flash(`→ ${target.name}`);
}

function addMarker(time) {
    pushUndo();
    if (!state.project.markers) state.project.markers = [];
    // Suggérer un nom automatique basé sur la position en mesures
    const barIdx = barAtSec(time) + 1;
    state.project.markers.push({ time, name: `M${barIdx}` });
    state.project.markers.sort((a, b) => a.time - b.time);
    saveProject();
    renderMarkers();
    flash(`Marqueur posé`);
}

// Fenêtre « Ajouter les fichiers » (comme Logic) quand on dépose plusieurs sons d'un coup.
// Renvoie 'new' (une piste par fichier), 'one' (tous à la suite sur une piste), 'existing' (sur les pistes déjà là) ou null.
const MULTI_IMPORT_KEY = 'pulse_multi_import';
function askMultiImport(n) {
    return new Promise((resolve) => {
        let last = 'new'; try { last = localStorage.getItem(MULTI_IMPORT_KEY) || 'new'; } catch {}
        const opts = [
            ['new', 'Créer de nouvelles pistes', 'Une piste par fichier, tous calés au même endroit (idéal pour des pistes séparées / stems)'],
            ['one', 'Placer tous les fichiers sur une seule piste', 'Les fichiers se suivent, l\'un après l\'autre'],
            ['existing', 'Utiliser les pistes existantes', 'Le 1er fichier va sur la piste visée, les suivants sur les pistes en dessous (créées si besoin)']
        ];
        const bd = document.createElement('div');
        bd.className = 'modal-backdrop visible';
        bd.innerHTML = `<div class="modal ask-modal multi-import-modal">
            <h2 class="modal-title">Ajouter ${n} fichiers</h2>
            <div class="mi-opts">${opts.map(([v, l, h]) => `<label class="mi-opt"><input type="radio" name="miOpt" value="${v}"${v === last ? ' checked' : ''}><span><b>${l}</b><small>${h}</small></span></label>`).join('')}</div>
            <div class="ask-actions"><button class="ask-cancel">Annuler</button><button class="ask-ok">OK</button></div>
        </div>`;
        document.body.appendChild(bd);
        const done = (v) => { bd.remove(); document.removeEventListener('keydown', key, true); if (v) { try { localStorage.setItem(MULTI_IMPORT_KEY, v); } catch {} } resolve(v); };
        const pick = () => bd.querySelector('input[name=miOpt]:checked')?.value || 'new';
        const key = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(pick()); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
        document.addEventListener('keydown', key, true);
        bd.querySelector('.ask-ok').onclick = () => done(pick());
        bd.querySelector('.ask-cancel').onclick = () => done(null);
        bd.querySelector('.mi-opts').addEventListener('dblclick', (e) => { if (e.target.closest('.mi-opt')) done(pick()); });
        bd.addEventListener('mousedown', (e) => { if (e.target === bd) done(null); e.stopPropagation(); });
        setTimeout(() => bd.querySelector('.ask-ok').focus(), 30);
    });
}

async function importDroppedFiles(files, mode, at, targetIdx) {
    const T = state.project.tracks;
    const newTrack = (name) => {
        const i = T.length;
        T.push({ name: name.replace(/\.[^.]+$/, '').slice(0, 24), type: 'audio', color: COLORS[i % COLORS.length], clips: [], output: 'master', volume: 100 });
        return i;
    };
    pushUndo();
    const undoDepth = _undoStack.length;
    const multi = files.length > 1;
    let made = 0, pos = at, oneIdx = -1;
    for (let k = 0; k < files.length; k++) {
        const f = files[k];
        let idx, created = false;
        if (mode === 'one') { if (oneIdx < 0) { oneIdx = newTrack(f.name); created = true; } idx = oneIdx; }
        else if (mode === 'existing') { idx = targetIdx + k; if (idx >= T.length) { idx = newTrack(f.name); created = true; } }
        else { idx = newTrack(f.name); created = true; }
        renderAll();
        const ok = await importAudioFile(f, idx, pos, { noUndo: true, noInstru: multi });
        if (ok) {
            made++;
            if (mode === 'one') { const c = T[idx].clips[T[idx].clips.length - 1]; pos = c.start + c.duration; }
        } else if (created && !(T[idx].clips || []).length) {
            // Fichier illisible : on ne laisse pas une piste vide à son nom
            T.splice(idx, 1); if (idx === oneIdx) oneIdx = -1; renderAll();
        }
    }
    if (!made && _undoStack.length === undoDepth) { _undoStack.pop(); updateUndoBtn(); }
    if (multi && made) flash(`✓ ${made} fichier${made > 1 ? 's' : ''} ajouté${made > 1 ? 's' : ''}`);
}

// Petite fenêtre Pulse pour demander un texte (remplace la fenêtre du système). Renvoie le texte, ou null si on annule.
function pulseAsk(title, value = '') {
    return new Promise((resolve) => {
        const bd = document.createElement('div');
        bd.className = 'modal-backdrop visible';
        bd.innerHTML = `<div class="modal ask-modal">
            <h2 class="modal-title">${esc(title)}</h2>
            <input type="text" class="ask-input" value="${esc(value)}" spellcheck="false">
            <div class="ask-actions"><button class="ask-cancel">Annuler</button><button class="ask-ok">OK</button></div>
        </div>`;
        document.body.appendChild(bd);
        const inp = bd.querySelector('.ask-input');
        const done = (v) => { bd.remove(); resolve(v); };
        bd.querySelector('.ask-ok').onclick = () => done(inp.value);
        bd.querySelector('.ask-cancel').onclick = () => done(null);
        bd.addEventListener('mousedown', (e) => { if (e.target === bd) done(null); e.stopPropagation(); });
        inp.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') done(inp.value);
            if (e.key === 'Escape') done(null);
        });
        setTimeout(() => { inp.focus(); inp.select(); }, 30);
    });
}

function openMarkerContextMenu(x, y, idx) {
    closeAllMenus();
    const mk = state.project.markers[idx];
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200`;
    const items = [
        { label: `Renommer "${mk.name}"`, action: () => {
            pulseAsk('Nom du marqueur', mk.name).then((newName) => {
                if (newName === null) return;
                pushUndo();
                mk.name = newName.trim() || mk.name;
                saveProject(); renderMarkers();
            });
        }},
        { sep: true },
        { label: 'Supprimer le marqueur', danger: true, action: () => {
            pushUndo();
            state.project.markers.splice(idx, 1);
            saveProject(); renderMarkers();
        }}
    ];
    menu.innerHTML = items.map(it => it.sep
        ? `<div class="ctx-sep"></div>`
        : `<div class="ctx-item${it.danger?' ctx-danger':''}">${it.label}</div>`
    ).join('');
    menu.querySelectorAll('.ctx-item').forEach((el, i) => {
        const item = items.filter(it => !it.sep)[i];
        el.addEventListener('click', () => { closeAllMenus(); item.action(); });
    });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
}

// --- Rendu : mixer strips (tracks + buses) ---
// Anciens projets : la reverb et l'écho étaient posés sur la piste ; ils passent maintenant par les envois
function applyShowAll() { document.body.classList.toggle('show-all', showAll()); }
function migrateProject() {
    let changed = false;
    PulseAudio.setCeiling(state.project.ceilingDb ?? -0.3);
    // Le fader Master fait partie du projet : même export, même niveau, à chaque ouverture
    const mv = state.project.masterVolume ?? 100;
    PulseAudio.setMasterVolume(mv);
    const mf = document.querySelector('.mixer-master .fader');
    if (mf) { mf.value = volToPos(mv); const d = document.querySelector('.mixer-master .strip-db'); if (d) d.textContent = `${volumeToDb(mv)} dB`; }
    applyShowAll();
    // Comme Logic : il n'y a que des bus. Les anciens retours Reverb / Écho deviennent des bus d'envoi, au même son.
    if (Array.isArray(state.project.sends) && state.project.sends.length) {
        [...state.project.sends].forEach(sd => sendToBusRaw(sd.id));
        changed = true;
        try { renderAll(); } catch {}
    }
    // Un modèle décrit le son voulu (« Voix lead » sur le groupe…) : on le traduit en vrais effets à la première ouverture
    [...state.project.tracks, ...(state.project.buses || [])].forEach(x => {
        if (x.sound && x.effects === undefined) { applySound(x); changed = true; }
    });
    state.project.tracks.forEach(t => {
        if (t.sound && (t.effects || []).some(e => e === 'reverb' || e === 'delay')) { applySound(t); changed = true; }
    });
    if (changed) saveProject();
}

// === Tranche à gauche (inspecteur) : la piste sélectionnée et, à sa droite, là où elle sort ===
// Évite d'ouvrir le mixer pour voir les effets d'une piste ou régler son volume.
const FX_NAMES = { msat: 'Saturation multibande', mband: 'Multibande', pitch: 'Pitch', crush: 'Bitcrusher', util: 'Utilitaire', width: 'Largeur', tremolo: 'Trémolo', phaser: 'Phaser', flanger: 'Flanger', chorus: 'Chorus', doubler: 'Doubleur', slapback: 'Slapback', filter: 'Filtre', gate: 'Gate', eq: 'EQ', sat: 'Saturation', deess: 'De-esser', comp: 'Compresseur', master: 'Finition', limit: 'Limiteur', delay: 'Écho', reverb: 'Reverb' };
const FX_ORDER = ['pitch', 'filter', 'gate', 'eq', 'sat', 'msat', 'crush', 'deess', 'comp', 'mband', 'util', 'width', 'tremolo', 'phaser', 'flanger', 'chorus', 'doubler', 'slapback', 'master', 'limit', 'delay', 'reverb'];
function inspectorOpen() { try { return localStorage.getItem('pulse_inspector') !== '0'; } catch { return true; } }
function setInspectorOpen(open) {
    try { localStorage.setItem('pulse_inspector', open ? '1' : '0'); } catch {}
    document.body.classList.toggle('inspector-open', open);
    document.getElementById('inspector').hidden = !open;
    const btn = document.getElementById('btnInspector');
    if (btn) btn.classList.toggle('active', open);
    renderInspector();
}
function initInspector() {
    const btn = document.getElementById('btnInspector');
    if (btn) btn.addEventListener('click', () => setInspectorOpen(!inspectorOpen()));
    setInspectorOpen(inspectorOpen());
}
// Effets actifs d'une piste ou d'un bus, dans l'ordre où le son les traverse
function chainOf(x) {
    const on = x.effects || [];
    const order = Array.isArray(x.fxOrder) ? [...x.fxOrder, ...FX_ORDER.filter(n => !x.fxOrder.includes(n))] : FX_ORDER;
    return order.filter(n => on.includes(n));
}
// Format de la piste, façon Logic : stéréo ou mono (les deux côtés mélangés)
function trackIsMono(t) { return !!t.mono || (PulseAudio.trackChannelCount(t) === 1); }
function monoButtonHtml(t) {
    const mono = trackIsMono(t);
    // Entrée de l'interface audio (Apollo…) : seulement pour une piste de voix, comme le sélecteur « Input » de Logic
    const input = isVoiceTrack(t) ? `<button class="insp-input" data-tooltip="Entrée de ta carte son pour cette piste (ex. l'entrée où est branché ton micro sur l'Apollo)">Entrée ${t.inputChannel || 1}</button>` : '';
    return `<div class="insp-fmt">${input}<button class="insp-mono ${t.mono ? 'on' : ''}" data-tooltip="${mono ? 'Mono : un seul côté (clique pour revenir à la stéréo si le son est stéréo)' : 'Stéréo : clique pour mélanger les deux côtés en mono'}">${mono ? 'Mono' : 'Stéréo'}</button></div>`;
}
// Menu « Entrée » : quelle entrée de la carte son enregistrer sur cette piste
function openInputMenu(anchor, t) {
    closeAllMenus();
    const r = anchor.getBoundingClientRect();
    const known = PulseAudio.getMicChannels();
    const n = Math.max(2, Math.min(16, known || 8));
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.max(8, r.left)}px;top:${Math.min(window.innerHeight - 40 - n * 28, Math.max(8, r.bottom + 4))}px;z-index:300;min-width:170px`;
    const cur = t.inputChannel || 1;
    for (let i = 1; i <= n; i++) {
        const el = document.createElement('div'); el.className = 'ctx-item';
        el.textContent = (i === cur ? '✓  ' : '    ') + `Entrée ${i}`;
        el.addEventListener('click', () => {
            menu.remove();
            if (i === cur) return;
            pushUndo(); if (i === 1) delete t.inputChannel; else t.inputChannel = i;
            if (t.armed) PulseAudio.setMicChannel(i);
            saveProject(); renderInspector();
            flash(`« ${t.name} » enregistrera l'entrée ${i} de ta carte son`);
        });
        menu.appendChild(el);
    }
    if (!known) { const note = document.createElement('div'); note.className = 'ctx-item-label'; note.textContent = 'Pulse verra les vraies entrées après un premier R'; menu.appendChild(note); }
    document.body.appendChild(menu);
    dismissMenuOnOutside(menu);
}
function inspectorStrip(kind, x, idx) {
    // kind : 'track' | 'bus' | 'master'
    const isMaster = kind === 'master';
    const name = isMaster ? 'Sortie stéréo' : x.name;
    const color = isMaster ? 'var(--violet-3)' : (x.color || 'var(--violet-2)');
    const vol = isMaster ? Math.round(PulseAudio.getMasterVolume ? PulseAudio.getMasterVolume() : 80) : (x.volume ?? 100);
    const soundLabel = isMaster ? '' : x.premaster ? 'Finition' : (x.sound && presetsFor(x)[x.sound.preset] ? presetsFor(x)[x.sound.preset].label : 'Réglage');
    return `
    <div class="strip insp-strip" data-kind="${kind}" data-id="${isMaster ? 'master' : kind === 'track' ? idx : esc(x.id)}" style="--track-color: ${color}">
        <div class="strip-name">${esc(name)}</div>
        ${kind === 'track' && !x.isCapture ? monoButtonHtml(x) : ''}
        ${kind === 'track' && x.frozen ? '<div class="insp-note">❄ Piste gelée : effets figés (clic droit > Son > Dégeler)</div>' : ''}
        ${isMaster ? '<div class="insp-note">Tout le morceau sort ici</div>' : `<button class="strip-sound insp-sound" data-tooltip="${x.premaster ? 'Le réglage final de tout le morceau' : 'Réglage : charge un réglage prêt à l\'emploi (comme « Réglage » dans Logic)'}">${esc(soundLabel)} ▾</button>`}
        ${isMaster ? '' : slotListsHtml(kind, x)}
        ${(kind === 'track' || (kind === 'bus' && !x.premaster && !x.locked)) ? `<div class="insp-pan as-knob"><div class="insp-knob t-knob-look" role="slider" aria-label="Gauche / droite" data-tooltip="${panTip(x.pan || 0)}">${panKnobSvg(x.pan || 0)}</div><input type="range" class="insp-pan-input" min="-100" max="100" step="1" data-default="0" value="${x.pan || 0}" tabindex="-1" aria-hidden="true"></div>` : ''}
        <div class="strip-fader-wrap">
            <input type="range" class="fader insp-fader" min="0" max="100" step="0.5" data-vmap="1" data-default="${volToPos(100)}" value="${volToPos(vol)}" ${x && x.locked && !showAll() ? 'disabled' : ''}>
            <div class="strip-db">${volumeToDb(vol)} dB</div>
        </div>
        ${isMaster ? '<div class="strip-output"></div>' : (x.locked ? `<div class="strip-output">→ ${esc(busLabel(x.output))}</div>` : `<button class="strip-output insp-output" data-tooltip="Où va le son de ${kind === 'bus' ? 'ce groupe' : 'cette piste'} : clique pour changer la direction">→ ${esc(busLabel(x.output))} ▾</button>`)}
    </div>`;
}
// Listes d'effets (inserts) et d'envois façon Logic, les mêmes dans la tranche de gauche et dans la table de mixage
function slotListsHtml(kind, x) {
    const chain = chainOf(x);
    const sends = (kind === 'track' || (kind === 'bus' && !x.premaster && !x.locked)) ? projectSends() : [];
    const canAdd = !x.premaster && !x.locked;
    return `<div class="insp-fx">
            <div class="strip-sends-title">Effets${canAdd ? '<button class="slot-plus" data-plus="fx" data-tooltip="Ajouter un effet (insert)">+</button>' : ''}</div>
            <div class="insp-slots insp-fx-box" data-add="fx">
            ${kind === 'track' && showTuneSlot(x) ? `<div class="insp-fx-row insp-tune-row ${x.autotune && x.autotune.on ? 'on' : 'is-off'}" data-fx="tune" data-tooltip="${x.autotune && x.autotune.on ? 'Auto-Tune : clic pour régler' : 'Auto-Tune éteint : clic pour le régler et l\'allumer'}">
                <span>PulseTune</span><i class="insp-del" data-tooltip="Retirer PulseTune (Auto-Tune) de cette piste">×</i>
            </div>` : ''}
            ${chain.map((n, k) => `
            <div class="insp-fx-row ${x.premaster || n === 'limit' || n === 'master' ? '' : 'can-drag'}" data-fx="${n}" data-tooltip="Clic pour régler · clic maintenu et glisser pour changer l'ordre · clic droit pour copier ou supprimer">
                <span>${FX_NAMES[n] || n}</span>
                ${x.premaster || x.locked || n === 'limit' || n === 'master' ? '' : '<i class="insp-del" data-tooltip="Supprimer cet effet">×</i>'}
            </div>`).join('')}
            ${x.premaster || x.locked ? '' : Array.from({ length: Math.max(4, 8 - chain.length - (kind === 'track' && showTuneSlot(x) ? 1 : 0)) }, (_, i) => `<div class="insp-slot-empty${i === 0 ? ' insp-add-fx' : ''}" data-tooltip="Emplacement libre : clique pour mettre un effet"></div>`).join('')}
            </div>
        </div>
        ${(kind === 'track' || (kind === 'bus' && !x.premaster && !x.locked)) ? `<div class="strip-sends">
            <div class="strip-sends-title">Envois<button class="slot-plus" data-plus="send" data-tooltip="Ajouter un envoi : vers un nouveau bus ou un bus existant">+</button></div>
            <div class="insp-slots insp-sends-box" data-add="send">
            ${sends.map(sd => `
            <label class="strip-send-row send-bar-row ${(x.sends || {})[sd.id] > 0 ? 'on' : ''}" data-send="${esc(sd.id)}" style="--lvl:${(x.sends || {})[sd.id] || 0}%" data-tooltip="Glisser pour envoyer plus · double-clic = écrire le chiffre · ⌘ + clic = remettre à 0 · Maj = réglage fin · clic droit = avant / après le fader">
                <span class="sb-name">${esc(sd.name)}</span>${(x.preSends || {})['send:' + sd.id] ? '<b class="sb-pre" data-tooltip="Envoi pris avant le fader (Pre)">PRE</b>' : ''}<em class="sb-val">${Math.round((x.sends || {})[sd.id] || 0)}</em>
                <input type="range" class="insp-send" min="0" max="100" data-default="0" value="${(x.sends || {})[sd.id] || 0}" hidden>
            </label>`).join('')}
            ${Object.keys(x.busSends || {}).filter(id => busById(id)).map(id => `
            <label class="strip-send-row send-bar-row on" data-bsend="${esc(id)}" style="--lvl:${x.busSends[id]}%" data-tooltip="Envoi vers le groupe « ${esc(busById(id).name)} » · glisser pour régler · double-clic = écrire le chiffre · ⌘ + clic = remettre à 0 · clic droit = avant / après le fader, retirer">
                <span class="sb-name">→ ${esc(busById(id).name)}</span>${(x.preSends || {})['busSend:' + id] ? '<b class="sb-pre" data-tooltip="Envoi pris avant le fader (Pre)">PRE</b>' : ''}<em class="sb-val">${Math.round(x.busSends[id])}</em>
                <input type="range" class="insp-send" min="0" max="100" data-default="0" value="${x.busSends[id]}" hidden>
            </label>`).join('')}
            ${Array.from({ length: Math.max(2, 4 - sends.length - Object.keys(x.busSends || {}).length) }, (_, i) => `<div class="insp-slot-empty${i === 0 ? ' insp-add-send' : ''}" data-tooltip="Emplacement libre : clique pour envoyer vers une reverb, un écho ou un groupe"></div>`).join('')}
            </div>
        </div>` : ''}`;
}
// Après un changement dans une liste : la tranche de gauche et la table de mixage se redessinent ensemble
function refreshStrips() {
    renderInspector();
    if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
}
// Le volume ou le pan changé à un endroit (piste, fader de gauche, mixeur) se voit aussitôt partout
// Plusieurs pistes choisies : quand on bouge le volume de l'une, les autres suivent en gardant leurs écarts
function followSelectedVolume(idx, prev, v) {
    const sel = selectedTrackIdxs();
    if (sel.length < 2 || !sel.includes(idx)) return;
    sel.filter(i => i !== idx).forEach(i => {
        const o = state.project.tracks[i]; if (!o || o.locked) return;
        const ov = o.volume ?? 100;
        o.volume = Math.max(0, Math.min(VOL_MAX, Math.round(prev > 0 ? ov * v / prev : v)));
        PulseAudio.updateTrackVolume(i, o.volume); syncInspectorVolume(i);
    });
}
function syncInspectorVolume(idx) {
    const t = state.project.tracks[idx]; if (!t) return;
    const f = document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-fader');
    if (f && state.selectedTrack === idx) {
        f.value = volToPos(t.volume ?? 100);
        const d = f.closest('.insp-strip').querySelector('.strip-db'); if (d) d.textContent = `${volumeToDb(t.volume ?? 100)} dB`;
    }
    const v = document.querySelector(`.t-vol[data-i="${idx}"]`);
    if (v && document.activeElement !== v) v.value = volToPos(t.volume ?? 100);
    if (v) v.style.setProperty('--fill', v.value + '%');
}
function syncTrackPan(idx) {
    const t = state.project.tracks[idx]; if (!t) return;
    const k = document.querySelector(`.t-knob[data-i="${idx}"]`);
    if (k) { k.dataset.pan = t.pan || 0; k.setAttribute('aria-valuenow', t.pan || 0); k.innerHTML = panKnobSvg(t.pan || 0); k.dataset.tooltip = panTip(t.pan || 0); }
    const p = document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-pan-input');
    if (p && state.selectedTrack === idx && document.activeElement !== p) { p.value = t.pan || 0; paintInspKnob(p); }
}
// Pan de l'inspecteur : un bouton rond comme dans Logic (le curseur caché garde toute la mécanique : annuler, groupes, mixeur)
function paintInspKnob(input) {
    const k = input && input.parentElement && input.parentElement.querySelector('.insp-knob');
    if (!k) return;
    const v = parseInt(input.value) || 0;
    k.innerHTML = panKnobSvg(v); k.dataset.tooltip = panTip(v); k.setAttribute('aria-valuenow', v);
}
function bindInspKnob(input) {
    const k = input && input.parentElement && input.parentElement.querySelector('.insp-knob');
    if (!k) return;
    const set = (v) => {
        v = Math.max(-100, Math.min(100, Math.round(v)));
        if (String(v) === input.value) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        paintInspKnob(input);
    };
    input.addEventListener('input', () => paintInspKnob(input));
    let badge = null;
    const showBadge = () => {
        if (!badge) { badge = document.createElement('div'); badge.className = 'knob-badge'; document.body.appendChild(badge); }
        const r = k.getBoundingClientRect();
        badge.textContent = panLabel(parseInt(input.value) || 0);
        badge.style.left = (r.left + r.width / 2) + 'px'; badge.style.top = (r.top - 6) + 'px';
    };
    k.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        // ⌘ + clic (ou Option + clic) = centre, comme dans Logic
        if (e.metaKey || e.altKey) { set(0); input.dispatchEvent(new Event('change', { bubbles: true })); return; }
        const sx = e.clientX, sy = e.clientY, v0 = parseInt(input.value) || 0;
        let moved = false;
        document.body.classList.add('resizing-col');
        const move = (ev) => {
            const d = (ev.clientX - sx) - (ev.clientY - sy);   // haut ou droite = vers la droite ; Shift = fin
            if (!moved && Math.abs(d) < 2) return;
            moved = true;
            set(v0 + d * (ev.shiftKey ? 0.25 : 1));
            showBadge();
        };
        const up = () => {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
            document.body.classList.remove('resizing-col');
            if (badge) { badge.remove(); badge = null; }
            if (moved) input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    k.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof openValueEntry === 'function') openValueEntry(input); });
    k.addEventListener('wheel', (e) => {
        e.preventDefault();
        set((parseInt(input.value) || 0) + (e.deltaY < 0 ? 2 : -2));
        clearTimeout(k._wt); k._wt = setTimeout(() => input.dispatchEvent(new Event('change', { bubbles: true })), 300);
    }, { passive: false });
}
function renderInspector() {
    const el = document.getElementById('inspector');
    if (!el || el.hidden) return;
    const idx = state.selectedTrack;
    const t = state.project.tracks[idx];
    if (!t) { el.innerHTML = '<div class="insp-hint">Clique sur une piste pour voir ses réglages ici</div>'; return; }
    const dest = busById(t.output);
    // Un groupe cliqué dans la liste s'affiche comme une piste (avec sa sortie en dessous) ; sinon : la piste choisie + son groupe de sortie
    const selBus = state.selectedBus && state._selBusTrack === state.selectedTrack ? busById(state.selectedBus) : null;
    if (selBus) {
        const up = busById(selBus.output);
        el.innerHTML = inspectorStrip('bus', selBus) + (up ? inspectorStrip('bus', up) : inspectorStrip('master'));
    } else {
        el.innerHTML = inspectorStrip('track', t, idx) + (dest ? inspectorStrip('bus', dest) : inspectorStrip('master'));
    }
    el.querySelectorAll('.insp-strip').forEach(strip => {
        const kind = strip.dataset.kind;
        const x = kind === 'track' ? t : kind === 'bus' ? busById(strip.dataset.id) : null;
        if (kind === 'bus' && !x) return;
        const fader = strip.querySelector('.insp-fader');
        let faderUndo = false;
        fader.addEventListener('change', () => { faderUndo = false; });
        fader.addEventListener('input', () => {
            if (!faderUndo && kind !== 'master') { pushUndo(); faderUndo = true; }   // un mouvement de fader = une étape d'annulation
            const v = posToVol(parseFloat(fader.value));   // la sortie stéréo aussi : 0 dB aux 3/4, +6 dB de marge au-dessus
            if (kind === 'track') {
                const prev = t.volume ?? 100;
                t.volume = v; PulseAudio.updateTrackVolume(idx, v); syncInspectorVolume(idx);
                // Plusieurs pistes choisies : elles bougent ensemble, en gardant leurs écarts
                selectedTrackIdxs().filter(i => i !== idx).forEach(i => {
                    const o = state.project.tracks[i]; if (!o || o.locked) return;
                    const ov = o.volume ?? 100;
                    o.volume = Math.max(0, Math.min(VOL_MAX, Math.round(prev > 0 ? ov * v / prev : v)));
                    PulseAudio.updateTrackVolume(i, o.volume); syncInspectorVolume(i);
                });
            }
            else if (kind === 'bus') { x.volume = v; PulseAudio.updateBusVolume(x.id, x.muted ? 0 : v); }
            else { PulseAudio.setMasterVolume(v); state.project.masterVolume = v; }
            strip.querySelector('.strip-db').textContent = `${volumeToDb(v)} dB`;
        });
        fader.addEventListener('change', () => { saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
        const inBtn = strip.querySelector('.insp-input');
        if (inBtn && kind === 'track') inBtn.addEventListener('click', (e) => { e.stopPropagation(); openInputMenu(inBtn, t); });
        const monoBtn = strip.querySelector('.insp-mono');
        if (monoBtn && kind === 'track') monoBtn.addEventListener('click', () => {
            if (!t.mono && PulseAudio.trackChannelCount(t) === 1) { flash('Cette piste est déjà mono : elle a été enregistrée avec un seul micro'); return; }
            // plusieurs pistes choisies : toutes passent dans le même format
            const set = selectedTrackIdxs().includes(idx) ? selectedTrackIdxs() : [idx];
            const next = !t.mono;
            pushUndo();
            set.forEach(i => { const o = state.project.tracks[i]; if (o && !o.isCapture) { if (next) o.mono = true; else delete o.mono; } });
            saveProject(); refreshPlaybackSoon(); renderInspector();
            if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
            flash(next ? 'Piste en mono : les deux côtés sont mélangés' : 'Piste de nouveau en stéréo');
        });
        const snd = strip.querySelector('.insp-sound');
        if (snd) snd.addEventListener('click', () => {
            if (kind === 'bus' && x.premaster) openMasterPanel(x, snd); else openSoundPanel(kind === 'track' ? idx : x, snd);
        });
        bindSlotLists(strip, kind, x, idx);
        const pan = strip.querySelector('.insp-pan-input');
        if (pan) {
            bindInspKnob(pan);
            let panUndo = false;
            pan.addEventListener('change', () => { panUndo = false; });
            pan.addEventListener('input', () => {
                if (!panUndo) { pushUndo(); panUndo = true; }
                if (kind === 'bus') { x.pan = parseInt(pan.value); refreshPlaybackSoon(); return; }
                const prev = t.pan || 0, nv = parseInt(pan.value);
                t.pan = nv; PulseAudio.updateTrackPan(idx, t.pan); syncTrackPan(idx);
                selectedTrackIdxs().filter(i => i !== idx).forEach(i => {
                    const o = state.project.tracks[i]; if (!o) return;
                    o.pan = Math.max(-100, Math.min(100, (o.pan || 0) + (nv - prev)));
                    PulseAudio.updateTrackPan(i, o.pan); syncTrackPan(i);
                });
            });
            pan.addEventListener('change', () => { saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
        }
        // Direction : où part le son de cette piste / de ce groupe
        const outBtn = strip.querySelector('.insp-output');
        if (outBtn && x) outBtn.addEventListener('click', (e) => { e.stopPropagation(); openOutputMenu(outBtn, kind, x, idx); });
    });
}

// Clic, glisser, croix, envois et « + » des listes d'une tranche (gauche ou table de mixage)
function bindSlotLists(strip, kind, x, idx) {
    if (!x) return;
    // plusieurs pistes choisies : un envoi réglé sur l'une se règle sur toutes (si celle-ci en fait partie)
    const group = () => {
        if (kind !== 'track') return [x];
        const s = selectedTrackIdxs().map(i => state.project.tracks[i]).filter(Boolean);
        return s.includes(x) ? s : [x];
    };
    strip.querySelectorAll('.insp-fx-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (row._dragged) { row._dragged = false; return; }   // c'était un glisser, pas un clic
            const n = row.dataset.fx;
            if (e.target.closest('.insp-del')) { e.stopPropagation(); removeFx(n, x); return; }
            if (n === 'tune') { const r = row.getBoundingClientRect(); openTunePanel(idx, -1, r.left - 290, r.top - 20, true); return; }
            if (kind === 'bus' && x.premaster) openMasterPanel(x, row);
            else {
                // Chaque effet ouvre son plug ; le panneau « Son » seulement pour ce qui n'a pas de fenêtre
                openEffectPanel(kind === 'track' ? idx : x, n, row);
                if (!findPlugWin(x, n)) openSoundPanel(kind === 'track' ? idx : x, row);
            }
        });
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openFxCopyMenu(e.clientX, e.clientY, row.dataset.fx, x); });
    });
    bindFxDrag(strip, x);
    strip.querySelectorAll('.insp-send').forEach(sl => {
        const srow = sl.closest('.strip-send-row');
        const isBusSend = !!srow.dataset.bsend, id = srow.dataset.send || srow.dataset.bsend;
        let undoPushed = false;
        sl.addEventListener('input', () => {
            if (!undoPushed) { pushUndo(); undoPushed = true; }
            const v = parseInt(sl.value);
            // la piste, ou le groupe de cette tranche — et, si plusieurs pistes sont choisies, toutes les pistes choisies
            const targets = group();
            targets.forEach(o => {
                if (isBusSend) { o.busSends = o.busSends || {}; o.busSends[id] = v; return; }
                o.sends = o.sends || {};
                if (v > 0) o.sends[id] = v; else delete o.sends[id];
                const sends = projectSends(), key = id === sends.find(s => s.type === 'reverb')?.id ? 'space' : id === sends.find(s => s.type === 'delay')?.id ? 'echo' : null;
                if (key && o.sound) o.sound[key] = v;
            });
            srow.classList.toggle('on', v > 0 || isBusSend);
            refreshPlaybackSoon();
        });
        sl.addEventListener('change', () => { undoPushed = false; saveProject(); refreshStrips(); });
        // Clic droit : avant / après le fader (Pre / Post, comme Logic) ; un envoi vers un groupe se retire ici
        srow.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation(); closeAllMenus();
            const key = (isBusSend ? 'busSend:' : 'send:') + id;
            const set = group();
            const isPre = !!(x.preSends || {})[key];
            const menu = document.createElement('div');
            menu.className = 'track-ctx-menu';
            menu.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth - 240)}px;top:${Math.min(e.clientY, window.innerHeight - 140)}px;z-index:300;min-width:220px`;
            const item = (label, run) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.textContent = label; it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); run(); }); menu.appendChild(it); };
            const setPre = (on) => { pushUndo(); set.forEach(o => { o.preSends = o.preSends || {}; if (on) o.preSends[key] = true; else delete o.preSends[key]; }); saveProject(); refreshPlaybackSoon(); refreshStrips(); flash(on ? 'Envoi avant le fader (Pre) : il ne suit plus le fader ni le gauche/droite' : 'Envoi après le fader (Post) : il suit le fader'); };
            item((isPre ? '   ' : '✓ ') + 'Après le fader (Post)', () => setPre(false));
            item((isPre ? '✓ ' : '   ') + 'Avant le fader (Pre)', () => setPre(true));
            if (isBusSend) item(`Ouvrir le bus « ${busById(id) ? busById(id).name : ''} » (ses effets)`, () => openSendBus(id, false));
            else item(`Transformer « ${(projectSends().find(sd => sd.id === id) || {}).name || 'ce retour'} » en bus (pour y mettre des plugins)`, () => convertSendToBus(id));
            if (isBusSend) item('Retirer cet envoi', () => {
                pushUndo(); set.forEach(o => { if (o.busSends) delete o.busSends[id]; if (o.preSends) delete o.preSends[key]; });
                saveProject(); refreshPlaybackSoon(); refreshStrips();
                flash('Envoi vers « ' + (busById(id) ? busById(id).name : 'groupe') + ' » retiré');
            });
            document.body.appendChild(menu);
            setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
        });
    });
    // Emplacements vides façon Logic : un clic dans le vide d'une liste ajoute un effet / un envoi
    const fxBox = strip.querySelector('.insp-fx-box');
    if (fxBox && x && !x.premaster && !x.locked) fxBox.addEventListener('click', (e) => {
        if (e.target.closest('.insp-fx-row')) return;
        e.stopPropagation(); openAddEffectMenu(e.target.closest('.insp-slot-empty') || fxBox, kind === 'track' ? idx : x, x);
    });
    const sdBox = strip.querySelector('.insp-sends-box');
    if (sdBox && x) sdBox.addEventListener('click', (e) => {
        if (e.target.closest('.send-bar-row')) return;
        e.stopPropagation(); openSendTargetMenu(e.target.closest('.insp-slot-empty') || sdBox, kind, x);
    });
    strip.querySelectorAll('.slot-plus').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.plus === 'fx') openAddEffectMenu(btn, kind === 'track' ? idx : x, x);
        else openSendTargetMenu(btn, kind, x);
    }));
}

// Où envoyer le son (comme Logic : n'importe quel groupe, ou une nouvelle reverb / un nouvel écho)
function busFeeds(from, toId, depth = 0) {   // le groupe `from` finit-il par passer dans `toId` ? (évite les boucles)
    if (!from || depth > 10) return false;
    if (from.id === toId) return true;
    if (from.output && from.output !== 'master') { const nx = busById(from.output); if (nx) return busFeeds(nx, toId, depth + 1); }
    return false;
}
function openSendTargetMenu(anchor, kind, x) {
    closeAllMenus();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.max(8, Math.min(r.left, window.innerWidth - 230))}px;top:${Math.max(8, Math.min(r.bottom + 2, window.innerHeight - 320))}px;z-index:300;min-width:210px;max-height:60vh;overflow:auto`;
    // Comme Logic : un envoi part vers un bus, et ce bus a ses propres effets (on y met ce qu'on veut)
    const items = [
        { label: 'Nouveau bus', run: () => createSendBus(kind, x, 'empty') },
        { head: 'Vers un bus existant' }
    ];
    const buses = (state.project.buses || []).filter(b => !b.premaster && b.id !== 'master' && !(kind === 'bus' && busFeeds(busById(b.id), x.id)) && !(x.busSends || {})[b.id]);
    // un groupe où ce son passe déjà (sa sortie) n'a pas besoin d'envoi
    buses.forEach(b => items.push({ label: b.name, run: () => {
        pushUndo(); const set = kind === 'track' ? selectedTrackIdxs().map(i => state.project.tracks[i]).filter(Boolean) : [x];
        (set.includes(x) ? set : [x]).forEach(o => { o.busSends = o.busSends || {}; o.busSends[b.id] = 50; });
        saveProject(); refreshPlaybackSoon(); refreshStrips();
        flash(`Envoi vers « ${b.name} » ajouté à 50 : double-clic sur sa barre pour écrire le chiffre`);
    } }));
    if (!buses.length) items.pop();
    items.forEach(it => {
        const el = document.createElement('div');
        if (it.head) { el.className = 'ctx-head'; el.textContent = it.head; }
        else { el.className = 'ctx-item'; el.textContent = it.label; el.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); it.run(); }); }
        menu.appendChild(el);
    });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
}

// Bus d'envoi (aux façon Logic) : un groupe qui ne reçoit que des envois, avec ses inserts à lui.
// Reverb à 100 % d'effet et -9,5 dB en sortie : même niveau que les anciens retours.
const SEND_BUS_OUT = -9.54;
function sendBusName(base) {
    const used = new Set((state.project.buses || []).map(b => b.name));
    let n = 1; while (used.has(n === 1 ? base : `${base} ${n}`)) n++;
    return n === 1 ? base : `${base} ${n}`;
}
function createSendBus(kind, x, type) {
    pushUndo();
    state.project.buses = state.project.buses || [];
    const id = 'aux_' + Date.now().toString(36);
    const b = { id, name: sendBusName(type === 'reverb' ? 'Reverb' : type === 'delay' ? 'Écho' : 'Bus'), isGroup: true, isAux: true, output: 'master', color: '#7C3AED', volume: 100, effects: [] };
    if (type === 'reverb') { b.effects = ['reverb']; b.effectParams = { reverb: { size: 2, pre: 0, wet: 100, out: SEND_BUS_OUT } }; }
    if (type === 'delay') { b.effects = ['delay']; b.effectParams = { delay: { beats: 0.5, feedback: 35, wet: 100, dry: 0 } }; }
    state.project.buses.push(b);
    const set = kind === 'track' ? selectedTrackIdxs().map(i => state.project.tracks[i]).filter(Boolean) : [x];
    (set.includes(x) ? set : [x]).forEach(o => { o.busSends = o.busSends || {}; o.busSends[id] = 50; });
    afterGroupChange(type === 'empty'
        ? `Bus d'envoi « ${b.name} » créé : choisis ses effets`
        : `Bus d'envoi « ${b.name} » créé, envoi à 50 — clic droit sur l'envoi pour ouvrir le bus et y ajouter d'autres effets`);
    openSendBus(id, type === 'empty');
    return b;
}
// Ouvre un bus d'envoi dans la tranche de gauche (comme sélectionner l'aux dans Logic) ; withMenu = menu d'ajout d'effet tout de suite
function openSendBus(id, withMenu) {
    const b = busById(id); if (!b) return;
    state.selectedBus = id; state._selBusTrack = state.selectedTrack;
    refreshStrips();
    if (!withMenu) return;
    const strip = document.querySelector(`#inspector .insp-strip[data-kind="bus"][data-id="${CSS.escape(id)}"]`) || document.querySelector(`.mixer-strips .strip[data-kind="bus"][data-i="${state.project.buses.indexOf(b)}"]`);
    const plus = strip && strip.querySelector('.slot-plus[data-plus="fx"]');
    if (plus) openAddEffectMenu(plus, b, b);
}
// Ancien retour (Reverb / Écho fermés) → vrai bus d'envoi avec le même effet, les mêmes doses et le même son
function convertSendToBus(sid) {
    if (!projectSends().find(s => s.id === sid)) return;
    pushUndo();
    const b = sendToBusRaw(sid);
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
    afterGroupChange(`« ${b.name} » est maintenant un bus d'envoi : ajoute-lui les effets que tu veux — ⌘Z pour annuler`);
    openSendBus(b.id, false);
}
// Fait le travail sans annulation ni message (utilisé aussi à l'ouverture d'un ancien projet)
function sendToBusRaw(sid) {
    const sd = projectSends().find(s => s.id === sid); if (!sd) return null;
    state.project.buses = state.project.buses || [];
    // le bus garde l'identifiant de l'ancien retour (s'il est libre) : doses et courbes s'y retrouvent
    const taken = (v) => v === 'master' || state.project.buses.some(b => b.id === v);
    let id = taken(sd.id) ? 'aux_' + Date.now().toString(36) : sd.id, k = 1;
    while (taken(id)) id = 'aux_' + Date.now().toString(36) + '_' + (k++);
    const isDelay = sd.type === 'delay';
    const b = { id, name: sendBusName(sd.name || (isDelay ? 'Écho' : 'Reverb')), isGroup: true, isAux: true, output: 'master', color: '#7C3AED', volume: sd.volume ?? 100, muted: !!sd.muted,
        effects: [isDelay ? 'delay' : 'reverb'],
        effectParams: isDelay
            ? { delay: { ...(sd.ms ? { ms: sd.ms } : { beats: sd.beats ?? 0.5 }), feedback: sd.feedback ?? 35, pp: !!sd.pp, wet: 100, dry: 0 } }
            : { reverb: { size: sd.size ?? 3.2, pre: sd.pre || 0, wet: 100, out: SEND_BUS_OUT } } };
    if (!b.muted) delete b.muted;
    state.project.buses.push(b);
    [...state.project.tracks, ...state.project.buses].forEach(o => {
        if (o.sends && o.sends[sid] !== undefined) { if (o.sends[sid] > 0) { o.busSends = o.busSends || {}; o.busSends[id] = o.sends[sid]; } delete o.sends[sid]; }
        if (o.preSends && o.preSends['send:' + sid]) { o.preSends['busSend:' + id] = true; delete o.preSends['send:' + sid]; }
        if (o.automation && o.automation['send:' + sid]) { o.automation['busSend:' + id] = o.automation['send:' + sid]; delete o.automation['send:' + sid]; }
    });
    state.project.sends = projectSends().filter(s => s.id !== sid);
    return b;
}

// Copier / coller le réglage d'un effet d'une piste (ou d'un bus) à l'autre, comme dans Logic
let _fxClip = null;
function openFxCopyMenu(cx, cy, fx, x) {
    if (!x || !fx) return;
    closeAllMenus();
    const name = fx === 'tune' ? 'Auto-Tune' : (FX_NAMES[fx] || fx);
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.min(cx, window.innerWidth - 220)}px;top:${Math.min(cy, window.innerHeight - 120)}px;z-index:300;min-width:200px`;
    const items = [];
    items.push({ label: `Copier le réglage (${name})`, run: () => {
        const params = fx === 'tune' ? (x.autotune ? JSON.parse(JSON.stringify(x.autotune)) : null) : JSON.parse(JSON.stringify((x.effectParams || {})[fx] || {}));
        _fxClip = { fx, params, eqBands: fx === 'eq' && Array.isArray(x.eqBands) ? JSON.parse(JSON.stringify(x.eqBands)) : undefined, from: x.name };
        flash(`Réglage ${name} copié — clic droit sur le même effet d'une autre piste pour le coller`);
    } });
    if (_fxClip && _fxClip.fx === fx) items.push({ label: `Coller le réglage (${name} de « ${_fxClip.from} »)`, run: () => pasteFxSetting(fx, x) });
    // Supprimer l'effet de la chaîne (Auto-Tune : retire aussi la correction des prises)
    const removable = fx === 'tune' ? !!x.tuneSlot || !!x.autotune : (x.effects || []).includes(fx) && !x.premaster && fx !== 'limit' && fx !== 'master';
    if (removable) items.push({ label: `Supprimer l'effet (${name})`, run: () => removeFx(fx, x) });
    items.forEach(it => {
        const el = document.createElement('div'); el.className = 'ctx-item'; el.textContent = it.label;
        el.addEventListener('click', () => { menu.remove(); it.run(); });
        menu.appendChild(el);
    });
    document.body.appendChild(menu);
    dismissMenuOnOutside(menu);
}
// Supprime un effet de la chaîne d'une piste ou d'un groupe (Auto-Tune : retire aussi la correction des prises)
async function removeFx(fx, x) {
    const name = fx === 'tune' ? 'Auto-Tune' : (FX_NAMES[fx] || fx);
    if (fx === 'tune') {
        const ti = state.project.tracks.indexOf(x);
        if (x.autotune && ti >= 0) await untuneWholeTrack(ti); else pushUndo();
        delete x.tuneSlot; saveProject();
    } else {
        pushUndo();
        x.effects = (x.effects || []).filter(n => n !== fx);
        saveProject(); refreshPlaybackSoon();
    }
    closeTransientPanels(); const fw = findPlugWin(x, fx); if (fw) fw.remove();   // seule la fenêtre de l'effet retiré se ferme
    renderInspector();
    if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
    flash(`${name} supprimé de « ${x.name} » — ⌘Z pour annuler`);
}
function pasteFxSetting(fx, x) {
    if (!_fxClip || _fxClip.fx !== fx) return;
    pushUndo();
    if (fx === 'tune') {
        if (!_fxClip.params) { flash('Rien à coller : l\'Auto-Tune copié n\'avait pas de réglage'); return; }
        x.autotune = JSON.parse(JSON.stringify(_fxClip.params)); x.autotune.on = true;
        const ti = state.project.tracks.indexOf(x); if (ti >= 0) tuneWholeTrack(ti, null, true);
    } else {
        x.effects = x.effects || []; if (!x.effects.includes(fx)) x.effects.push(fx);
        x.effectParams = x.effectParams || {}; x.effectParams[fx] = JSON.parse(JSON.stringify(_fxClip.params));
        if (fx === 'eq' && _fxClip.eqBands) x.eqBands = JSON.parse(JSON.stringify(_fxClip.eqBands));
    }
    saveProject(); refreshPlaybackSoon(); renderInspector();
    if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
    flash(`Réglage collé sur « ${x.name} » — ⌘Z pour annuler`);
}

// Destinations possibles pour la direction d'une piste ou d'un groupe (jamais lui-même ni un de ses sous-groupes)
function outputChoices(kind, x) {
    const buses = state.project.buses || [];
    const below = new Set();
    if (kind === 'bus') {
        const walk = (id) => { below.add(id); buses.filter(b => b.output === id).forEach(b => walk(b.id)); };
        walk(x.id);
    }
    return buses.filter(b => !below.has(b.id) && !b.locked);   // Mix Bus 1 (Finition) compris : c'est une vraie direction
}
function openOutputMenu(anchor, kind, x, idx) {
    closeAllMenus();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.max(8, r.left)}px;top:${Math.max(8, r.top - 12)}px;z-index:300;min-width:170px`;
    const cur = x.output || 'master';
    const items = [{ id: 'master', label: 'Sortie stéréo (Master)' }, ...outputChoices(kind, x).map(b => ({ id: b.id, label: b.name })), ...(kind === 'track' ? [{ id: '__new', label: '+  Nouveau bus…' }] : [])];
    items.forEach(it => {
        const el = document.createElement('div');
        el.className = 'ctx-item';
        el.textContent = (it.id === cur ? '✓  ' : '    ') + it.label;
        el.addEventListener('click', () => {
            menu.remove();
            if (it.id === '__new') { createBus({ withTracks: kind === 'track' ? (selectedTrackIdxs().includes(idx) ? selectedTrackIdxs() : [idx]) : [] }); return; }
            if (it.id === cur) return;
            if (kind === 'track') {
                // Plusieurs pistes choisies : elles partent toutes vers cette destination
                const sel = selectedTrackIdxs();
                const group = sel.length > 1 && sel.includes(idx) ? sel.map(i => state.project.tracks[i]) : [x];
                if (it.id === 'master') {
                    pushUndo(); group.forEach(g => { g.output = 'master'; });
                    afterGroupChange(group.length > 1 ? `${group.length} pistes sortent maintenant directement sur la sortie stéréo` : `« ${x.name} » sort maintenant directement sur la sortie stéréo`);
                } else if (group.length > 1) {
                    const bus = busById(it.id); if (!bus) return;
                    pushUndo(); group.forEach(g => { g.output = it.id; }); bus.collapsed = false;
                    afterGroupChange(`${group.length} pistes rangées dans ${bus.name}`);
                } else moveTrackToGroup(idx, it.id);
            } else {
                moveGroupInto(x.id, it.id === 'master' ? null : it.id);
            }
        });
        menu.appendChild(el);
    });
    document.body.appendChild(menu);
    dismissMenuOnOutside(menu);
}
// Effets qu'on peut poser sur une piste ou un bus (chacun a son panneau)
const ADD_FX_CHOICES = [['crush', 'Bitcrusher (son lo-fi)'], ['util', 'Utilitaire (gain, mono, phase)'], ['width', 'Largeur stéréo'],
    ['tremolo', 'Trémolo (volume qui pulse)'], ['phaser', 'Phaser'], ['flanger', 'Flanger'], ['chorus', 'Chorus'],
    ['doubler', 'Doubleur de voix'], ['slapback', 'Slapback (écho court)'], ['gate', 'Gate (coupe le bruit entre les phrases)'], ['filter', 'Filtre (coupe-bas / coupe-haut)'], ['eq', 'EQ'], ['comp', 'Compresseur'], ['mband', 'Multibande'], ['deess', 'De-esser'], ['sat', 'Saturation'], ['msat', 'Saturation multibande'], ['delay', 'Écho'], ['reverb', 'Reverb']];
// Rangés par catégorie comme dans Logic (voir PLUGINS-CATALOGUE.md) : un nouvel effet = une ligne dans sa catégorie
const ADD_FX_CATEGORIES = [
    ['Dynamique', ['comp', 'mband', 'deess', 'gate']],
    ['Égaliseur et filtre', ['eq', 'filter']],
    ['Distorsion', ['sat', 'msat', 'crush']],
    ['Mouvement', ['chorus', 'flanger', 'phaser', 'tremolo']],
    ['Voix et hauteur', ['pitch', 'doubler']],
    ['Écho et espace', ['delay', 'slapback', 'reverb']],
    ['Stéréo', ['width']],
    ['Utilitaires', ['util']]
];
// Une phrase par effet dans le menu « + Effet », et les mots qu'on tape pour le trouver
const FX_DESC = { msat: 'chaleur et grain par zone : des graves ronds, des médiums qui grognent, des aigus qui brillent', mband: 'travaille seulement une zone du son (graves, boue, sifflantes…), quand elle déborde', pitch: 'monte ou descend la voix (demi-tons), pour un effet sur un passage', comp: 'resserre l\'écart entre les passages forts et faibles', deess: 'adoucit les « s » qui sifflent', eq: 'corrige les graves, médiums et aigus',
    sat: 'chaleur et grain, comme une bande ou une lampe', delay: 'répétitions calées sur le tempo (1/8, 1/4…)', reverb: 'ajoute de l\'espace, une pièce',
    width: 'élargit ou resserre l\'image stéréo', chorus: 'épaissit le son en le dédoublant légèrement', flanger: 'balayage métallique qui tourne',
    phaser: 'balayage doux et rond', tremolo: 'le volume pulse en rythme', doubler: 'donne l\'impression de deux prises', slapback: 'écho court, très utilisé en rap',
    crush: 'son lo-fi, numérique abîmé', util: 'volume, phase, passage en mono', filter: 'coupe les graves ou les aigus' };
const FX_WORDS = { msat: 'saturation multiband multibande saturn distortion drive chaleur tape tube', mband: 'multiband multibande compressor dynamic dynamique', pitch: 'pitch shift hauteur transpose alterboy grave aigu', comp: 'compressor compression dynamique', deess: 'deesser sibilance', gate: 'noise gate bruit', eq: 'equalizer egaliseur', filter: 'hpf lpf high pass low pass coupe-bas coupe-haut',
    sat: 'saturation distortion saturator drive', crush: 'bitcrusher lofi', delay: 'delay echo', reverb: 'reverb reverberation', slapback: 'slap delay echo',
    chorus: 'modulation', flanger: 'modulation', phaser: 'modulation', tremolo: 'modulation', doubler: 'doubler double', width: 'stereo imager', util: 'utility gain mono phase', tune: 'autotune pitch justesse' };
const FX_START = {
    limit: { tp: 1 },    // pic réel allumé sur un limiteur neuf (les anciens projets gardent leur son)
    eq: { bands: [] },   // un EQ neuf s'ouvre sans aucun point : on les pose soi-même
    crush: { bits: 8, down: 4, mix: 100 }, util: { gain: 0, invert: 0, mono: 0 }, width: { width: 100 },
    tremolo: { rate: 5, depth: 50 }, phaser: { rate: 0.4, depth: 70, feedback: 40, mix: 50 }, flanger: { rate: 0.25, depth: 2, feedback: 50, mix: 50 },
    chorus: { rate: 0.8, depth: 5, mix: 50 }, doubler: { width: 50, mix: 50 }, slapback: { time: 110, feedback: 12, mix: 25 },
    gate: { threshold: -45, release: 150, reduction: 40 }, filter: { hpf: 80, lpf: 20000, slope: 12 }, sat: { drive: 25 }, msat: { bands: [{ base: true, sty: 'bande', va: 1, heat: 30 }] }, mband: { bands: [] }, deess: { thr: -26, range: 10, lo: 5000, hi: 11000 }, delay: { beats: 0.5, feedback: 35, wet: 25 } };
function openAddEffectMenu(anchor, target, x) {
    closeAllMenus();
    const r = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.max(8, r.left)}px;top:${Math.max(8, r.bottom + 4)}px;z-index:300;min-width:170px`;
    // Menu en deux colonnes (planche du 21/10, variante B) : recherche + récents + catégories à gauche,
    // effets de la catégorie à droite avec une phrase d'explication
    menu.classList.add('fx-add-menu');
    menu.innerHTML = '';
    const fxLabel = Object.fromEntries(ADD_FX_CHOICES);
    const nameOf = (n) => (fxLabel[n] || n).replace(/\s*\(.*\)$/, '');
    const descOf = (n) => FX_DESC[n] || ((fxLabel[n] || '').match(/\((.*)\)$/) || [])[1] || '';
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem('pulse_fx_recent') || '[]').filter(n => fxLabel[n]); } catch {}
    const cats = ADD_FX_CATEGORIES.map(([c, names]) => [c, names.filter(n => fxLabel[n])]);
    const voice = state.project.tracks.includes(x);   // PulseTune : sur toute piste, pas sur un groupe
    if (voice) { const vh = cats.find(([c]) => c === 'Voix et hauteur'); if (vh) vh[1] = ['tune', ...vh[1]]; }   // Auto-Tune en tête : 1er maillon d'une voix
    const left = document.createElement('div'); left.className = 'fam-left';
    const right = document.createElement('div'); right.className = 'fam-right';
    menu.append(left, right);
    left.innerHTML = `<input class="fam-search" type="text" placeholder="Chercher un effet…" spellcheck="false">`;
    const search = left.querySelector('.fam-search');
    const addHead = (box, txt) => { const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = txt; box.appendChild(h); };
    const pick = (n) => {
        menu.remove();
        try { localStorage.setItem('pulse_fx_recent', JSON.stringify([n, ...recent.filter(r => r !== n)].slice(0, 3))); } catch {}
        if (n === 'tune') {
            const ti = state.project.tracks.indexOf(x);
            if (!x.tuneSlot) { pushUndo(); x.tuneSlot = true; saveProject(); }
            renderInspector();
            if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
            const row = document.querySelector('#inspector .insp-strip .insp-fx-row[data-fx="tune"]');
            const rr = (row || anchor).getBoundingClientRect();
            openTunePanel(ti, -1, rr.left - 290, rr.top - 20, true);
            return;
        }
        if (!(x.effects || []).includes(n)) {
            pushUndo(); x.effects = x.effects || []; x.effects.push(n);
            // l'effet démarre avec les valeurs affichées dans son panneau (sinon le curseur dit une chose et le son en fait une autre)
            if (FX_START[n]) { x.effectParams = x.effectParams || {}; if (!x.effectParams[n]) x.effectParams[n] = JSON.parse(JSON.stringify(FX_START[n])); }
            saveProject(); refreshPlaybackSoon();
        }
        renderInspector();
        if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
        if (!state.project.tracks.includes(x) && !(state.project.buses || []).includes(x)) renderTimelineTracks();   // effet d'une région : sa pastille apparaît
        const row = document.querySelector(`#inspector .insp-strip .insp-fx-row[data-fx="${n}"]`);
        openEffectPanel(target, n, row && row.isConnected ? row : document.body);
    };
    const has = (n) => n === 'tune' ? showTuneSlot(x) : (x.effects || []).includes(n);
    // Colonne de droite : tous les effets existent (rangés par catégorie), on montre ceux de la catégorie choisie ou de la recherche
    cats.forEach(([c, names]) => names.forEach(n => {
        const el = document.createElement('div');
        el.className = 'ctx-item fam-fx'; el.dataset.cat = c; el.dataset.fx = n;
        el.innerHTML = `<span class="fam-nm">${esc(n === 'tune' ? 'PulseTune' : nameOf(n))}${has(n) ? '<i class="fam-tag">déjà là · ouvrir</i>' : ''}</span><span class="fam-ds">${esc(n === 'tune' ? 'Auto-Tune : corrige la justesse de la voix' : descOf(n))}</span>`;
        el.addEventListener('click', () => pick(n));
        right.appendChild(el);
    }));
    const head = document.createElement('div'); head.className = 'ctx-head fam-title'; right.prepend(head);
    const empty = document.createElement('div'); empty.className = 'fam-empty'; empty.textContent = 'Aucun effet ne correspond. Essaie « écho », « reverb », « compresseur »…'; right.appendChild(empty);
    const showCat = (c) => {
        head.textContent = c; empty.hidden = true;
        right.querySelectorAll('.fam-fx').forEach(el => { el.hidden = el.dataset.cat !== c; });
        left.querySelectorAll('.fam-cat').forEach(el => el.classList.toggle('on', el.dataset.cat === c));
    };
    if (recent.length) {
        addHead(left, 'Récents');
        recent.forEach(n => {
            const el = document.createElement('div'); el.className = 'ctx-item fam-recent'; el.textContent = nameOf(n);
            el.addEventListener('click', () => pick(n)); left.appendChild(el);
        });
        const sep = document.createElement('div'); sep.className = 'ctx-sep'; left.appendChild(sep);
    }
    cats.forEach(([c]) => {
        const el = document.createElement('div'); el.className = 'ctx-item fam-cat'; el.dataset.cat = c; el.innerHTML = `<span class="fam-dot"></span>${esc(c)}`;
        el.addEventListener('mouseenter', () => { if (!search.value) showCat(c); });
        el.addEventListener('click', () => { search.value = ''; showCat(c); });
        left.appendChild(el);
    });
    // Recherche : nom, explication et mots courants (anglais compris : delay, reverb…)
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    search.addEventListener('input', () => {
        const q = norm(search.value.trim());
        if (!q) { showCat(left.querySelector('.fam-cat.on')?.dataset.cat || cats[0][0]); return; }
        let n = 0;
        right.querySelectorAll('.fam-fx').forEach(el => {
            const ok = norm(el.textContent + ' ' + el.dataset.cat + ' ' + (FX_WORDS[el.dataset.fx] || '')).includes(q);
            el.hidden = !ok; if (ok) n++;
        });
        head.textContent = 'Résultats'; empty.hidden = n > 0;
    });
    search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { const first = [...right.querySelectorAll('.fam-fx')].find(el => !el.hidden); if (first) first.click(); }
        if (e.key === 'Escape') menu.remove();
    });
    showCat((recent[0] && cats.find(([, ns]) => ns.includes(recent[0]))?.[0]) || cats[0][0]);
    setTimeout(() => search.focus(), 0);
    document.body.appendChild(menu);
    // Le menu tient dans la fenêtre : il remonte si besoin et défile au-delà
    {
        const h = Math.min(menu.scrollHeight, window.innerHeight - 16);
        const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8));
        menu.style.top = top + 'px';
        menu.style.maxHeight = (window.innerHeight - top - 8) + 'px';
        menu.style.overflowY = 'auto';
    }
    dismissMenuOnOutside(menu);
}
// Change la place d'un effet dans la chaîne (dir : -1 = plus tôt, +1 = plus tard)
// Place un effet à une position donnée dans la chaîne (glisser-déposer dans l'inspecteur)
function moveEffectTo(x, name, to) {
    const chain = chainOf(x);
    const i = chain.indexOf(name);
    if (i < 0 || to === i) return;
    pushUndo();
    chain.splice(i, 1); chain.splice(Math.max(0, Math.min(chain.length, to)), 0, name);
    x.fxOrder = [...chain, ...FX_ORDER.filter(n => !chain.includes(n))];
    refreshStrips(); refreshPlaybackSoon(); saveProject();
    flash(`${FX_NAMES[name]} déplacé : le son passe maintenant par ${chain.map(n => FX_NAMES[n]).join(' → ')}`);
}
// Clic maintenu sur un effet puis glisser vers le haut ou le bas : la ligne suit la souris, un trait montre où elle va tomber
function bindFxDrag(strip, x) {
    const rows = () => [...strip.querySelectorAll('.insp-fx-row.can-drag')];
    rows().forEach(row => row.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('.insp-del')) return;
        const y0 = e.clientY; let on = false, target = -1, mark = null;
        const list = rows(), from = list.indexOf(row);
        const move = (ev) => {
            if (!on && Math.abs(ev.clientY - y0) < 4) return;   // petit seuil : un simple clic ouvre toujours l'effet
            if (!on) { on = true; row.classList.add('fx-dragging'); document.body.classList.add('fx-drag-on');
                mark = document.createElement('div'); mark.className = 'fx-drop-mark'; row.parentNode.appendChild(mark); }
            row.style.transform = `translateY(${ev.clientY - y0}px)`;
            // position visée : avant la première ligne dont le milieu est sous la souris
            const others = list.filter(r => r !== row);
            let k = others.findIndex(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
            if (k < 0) k = others.length;
            target = k;
            const ref = others[k] || others[others.length - 1];
            if (ref) { const b = ref.getBoundingClientRect(), pb = row.parentNode.getBoundingClientRect();
                mark.style.top = ((others[k] ? b.top : b.bottom) - pb.top - 1) + 'px'; }
        };
        const up = () => {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
            if (!on) return;
            row._dragged = true; setTimeout(() => { row._dragged = false; }, 0);
            row.classList.remove('fx-dragging'); row.style.transform = ''; document.body.classList.remove('fx-drag-on');
            if (mark) mark.remove();
            if (target >= 0 && target !== from) moveEffectTo(x, row.dataset.fx, target);
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }));
}
function moveEffect(x, name, dir) {
    const chain = chainOf(x);
    const i = chain.indexOf(name), j = i + dir;
    if (i < 0 || j < 0 || j >= chain.length) return;
    pushUndo();
    [chain[i], chain[j]] = [chain[j], chain[i]];
    // On garde l'ordre complet : les effets éteints reprennent leur place habituelle autour
    x.fxOrder = [...chain, ...FX_ORDER.filter(n => !chain.includes(n))];
    refreshStrips(); refreshPlaybackSoon(); saveProject();
    flash(`${FX_NAMES[name]} déplacé : le son passe maintenant par ${chain.map(n => FX_NAMES[n]).join(' → ')}`);
}

// === Finition (premaster) : un seul panneau pour finir le morceau vite ===
const MASTER_PRESETS = {
    off:    { label: 'Naturel',   body: 0,  air: 0,  glue: 0,  warm: 0,  width: 0,  push: 0 },
    clean:  { label: 'Propre',    body: 10, air: 25, glue: 30, warm: 0,  width: 10, push: 30 },
    loud:   { label: 'Fort',      body: 20, air: 35, glue: 50, warm: 15, width: 15, push: 60 },
    warm:   { label: 'Chaud',     body: 30, air: 10, glue: 40, warm: 40, width: 0,  push: 40 }
};
// Traduit les curseurs simples en vrais réglages
function applyMaster(bus) {
    const m = bus.master || MASTER_PRESETS.off;
    const params = {
        body: +(m.body * 0.04).toFixed(2),          // -4 … +4 dB de graves
        air: +(m.air * 0.05).toFixed(2),            // jusqu'à +5 dB tout en haut
        glue: m.glue, warm: m.warm,
        width: +(1 + m.width * 0.004).toFixed(3),   // 0,6 … 1,4
        push: +(m.push * 0.1).toFixed(1)            // jusqu'à +10 dB, retenus par un limiteur
    };
    const active = m.body || m.air || m.glue || m.warm || m.width || m.push;
    bus.effects = active ? ['master'] : [];
    bus.effectParams = active ? { master: params } : {};
}
function openMasterPanel(bus, anchorEl) {
    closeTransientPanels();
    if (!bus) return;
    const cur = bus.master || { preset: 'off', ...MASTER_PRESETS.off };
    const panel = document.createElement('div');
    panel.className = 'fx-panel sound-panel master-panel';
    const slider = (key, left, right, min) => `
        <div class="sound-row">
            <div class="sound-ends"><span>${left}</span><span>${right}</span></div>
            <input type="range" class="fx-slider" data-key="${key}" data-default="0" min="${min}" max="100" step="1" value="${cur[key] || 0}">
        </div>`;
    panel.innerHTML = `
        <div class="fx-panel-header"><span>Finition du morceau</span><button class="fx-panel-close">×</button></div>
        <div class="sound-presets">
            ${Object.entries(MASTER_PRESETS).map(([k, p]) => `<button class="sound-chip ${cur.preset === k ? 'active' : ''}" data-preset="${k}">${p.label}</button>`).join('')}
        </div>
        <div class="sound-hint">Le dernier réglage avant la sortie : il s'applique à tout le morceau.</div>
        <div class="fx-panel-body">
            ${slider('body', 'Moins de basses', 'Plus de basses', -100)}
            ${slider('air', 'Normal', 'Plus brillant', 0)}
            ${slider('glue', 'Libre', 'Soudé', 0)}
            ${slider('warm', 'Propre', 'Chaud', 0)}
            ${slider('width', 'Plus serré', 'Plus large', -100)}
            ${slider('push', 'Volume normal', 'Plus fort', 0)}
        </div>`;
    document.body.appendChild(panel);
    const rect = anchorEl.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(window.innerWidth - 290, rect.right + 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, rect.top - 40)) + 'px';
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    let undoPushed = false;
    const commit = () => {
        if (!undoPushed) { pushUndo(); undoPushed = true; }
        applyMaster(bus);
        document.querySelectorAll(`.group-header[data-bus="${bus.id}"] .g-son`).forEach(b => b.classList.toggle('active', bus.effects.length > 0));
        refreshPlaybackSoon(); saveProject();
    };
    panel.querySelectorAll('.sound-chip').forEach(chip => chip.addEventListener('click', () => {
        bus.master = { preset: chip.dataset.preset, ...MASTER_PRESETS[chip.dataset.preset] };
        delete bus.master.label;
        commit();
        flash(`Finition « ${MASTER_PRESETS[chip.dataset.preset].label} » appliquée à tout le morceau`);
        openMasterPanel(bus, anchorEl);
    }));
    panel.querySelectorAll('.fx-slider').forEach(sl => sl.addEventListener('input', () => {
        bus.master = bus.master || { preset: 'off', ...MASTER_PRESETS.off };
        delete bus.master.label;
        bus.master[sl.dataset.key] = parseFloat(sl.value);
        commit();
    }));
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    setTimeout(() => {
        document.addEventListener('mousedown', function closeM(ev) {
            if (!document.body.contains(panel)) { document.removeEventListener('mousedown', closeM); return; }
            if (!panel.contains(ev.target) && !ev.target.closest('.g-son, .master-edit')) { panel.remove(); document.removeEventListener('mousedown', closeM); }
        });
    }, 100);
}

// === Envois : des effets communs (reverb, écho) à part des effets de la piste ===
// Chaque piste y envoie la dose qu'elle veut. L'effet est toujours à 100 % : c'est la dose qui compte.
// Envois en petits boutons ronds (DA Pulse : capuchon sombre, arc violet). Le bouton pilote un curseur caché,
// donc toute la logique des envois (annulation, plusieurs pistes choisies…) reste la même.
function sendKnobSvg(v) {
    const a0 = -135, a = a0 + (Math.max(0, Math.min(100, v)) / 100) * 270, r = 10, c = 13;
    const pt = (deg, rr = r) => { const t = (deg - 90) * Math.PI / 180; return [(c + rr * Math.cos(t)).toFixed(2), (c + rr * Math.sin(t)).toFixed(2)]; };
    const arc = (from, to) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
    const [px, py] = pt(a, 6.2);
    return `<svg viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
        <path d="${arc(a0, 135)}" class="sk-track"/>${v > 0 ? `<path d="${arc(a0, a)}" class="sk-val"/>` : ''}
        <circle cx="13" cy="13" r="7.4" class="sk-cap"/><line x1="13" y1="13" x2="${px}" y2="${py}" class="sk-ptr"/></svg>`;
}
function sendKnobHtml(v) { return `<span class="send-knob" data-tooltip="Glisser vers le haut ou le bas · double-clic = 0">${sendKnobSvg(v)}<em>${Math.round(v)}</em></span>`; }
(function bindSendKnobs() {
    document.addEventListener('mousedown', (e) => {
        const k = e.target.closest && e.target.closest('.send-knob'); if (!k || e.button !== 0) return;
        const inp = k.closest('.strip-send-row').querySelector('input[type="range"]'); if (!inp) return;
        e.preventDefault(); e.stopPropagation();
        let y0 = e.clientY, v = parseFloat(inp.value) || 0;
        k.classList.add('turning');
        const move = (ev) => {
            const nv = Math.max(0, Math.min(100, v + (y0 - ev.clientY) * (ev.shiftKey ? 0.1 : 0.6)));
            if (Math.round(nv) === Math.round(parseFloat(inp.value))) return;
            inp.value = Math.round(nv); inp.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const up = () => {
            k.classList.remove('turning');
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
            inp.dispatchEvent(new Event('change', { bubbles: true }));
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }, true);
    // Envois de la tranche de gauche : barre horizontale façon Logic (glisser à droite = envoyer plus)
    document.addEventListener('mousedown', (e) => {
        const row = e.target.closest && e.target.closest('.send-bar-row'); if (!row || e.button !== 0) return;
        const inp = row.querySelector('input[type="range"]'); if (!inp) return;
        if (e.target.closest && e.target.closest('.sb-edit')) return;
        e.preventDefault(); e.stopPropagation();
        if (e.metaKey || e.ctrlKey) { inp.value = 0; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); return; }   // ⌘ + clic = à 0
        const x0 = e.clientX, v0 = parseFloat(inp.value) || 0, w = Math.max(40, row.getBoundingClientRect().width);
        row.classList.add('turning');
        const move = (ev) => {
            const nv = Math.round(Math.max(0, Math.min(100, v0 + (ev.clientX - x0) / w * 100 * (ev.shiftKey ? 0.15 : 1))));
            if (nv === Math.round(parseFloat(inp.value))) return;
            inp.value = nv; inp.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const up = () => { row.classList.remove('turning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); inp.dispatchEvent(new Event('change', { bubbles: true })); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }, true);
    document.addEventListener('dblclick', (e) => {
        const k = e.target.closest && (e.target.closest('.send-knob') || e.target.closest('.send-bar-row')); if (!k) return;
        const row = k.closest('.strip-send-row'), inp = row.querySelector('input[type="range"]'); if (!inp) return;
        e.preventDefault(); e.stopPropagation();
        const val = row.querySelector('.sb-val');
        if (!val) { inp.value = 0; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); return; }
        // Façon Logic : le chiffre devient un champ où l'on tape la valeur exacte (0 à 100)
        const ed = document.createElement('input');
        ed.className = 'sb-edit'; ed.type = 'text'; ed.inputMode = 'numeric'; ed.value = Math.round(parseFloat(inp.value) || 0);
        val.hidden = true; val.after(ed); ed.focus(); ed.select();
        let done = false;
        const finish = (ok) => {
            if (done) return; done = true;
            const n = parseFloat(String(ed.value).replace(',', '.'));
            ed.remove(); val.hidden = false;
            if (!ok || !isFinite(n)) return;
            inp.value = Math.max(0, Math.min(100, Math.round(n)));
            inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        };
        ed.addEventListener('mousedown', (ev) => ev.stopPropagation());
        ed.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); });
        ed.addEventListener('blur', () => finish(true));
    }, true);
    // Molette au survol (comme Logic) : envois, faders, gauche/droite se dosent en faisant défiler ; Maj = réglage fin
    document.addEventListener('wheel', (e) => {
        if (e.altKey || e.metaKey || e.ctrlKey || !e.target.closest) return;
        const el = e.target.closest('.send-bar-row, .send-knob, .strip-send-row, input.fader, input.t-vol, input.insp-pan-input, .strip-pan input[type="range"]');
        if (!el) return;
        const inp = el.matches('input[type="range"]') ? el : el.querySelector('input[type="range"]');
        if (!inp || inp.disabled) return;
        e.preventDefault(); e.stopPropagation();
        const min = parseFloat(inp.min), max = parseFloat(inp.max), span = max - min;
        const step = (e.shiftKey ? 0.25 : 1) * span / 100 * Math.max(0.5, Math.min(4, Math.abs(e.deltaMode === 0 ? e.deltaY / 12 : e.deltaY * 3)));
        inp._wacc = (inp._wacc || 0) + (e.deltaY < 0 ? step : -step);
        const whole = el.matches('.strip-send-row, .send-bar-row, .send-knob') || inp.classList.contains('insp-pan-input');
        const apply = whole ? Math.trunc(inp._wacc) : inp._wacc;
        if (!apply) return;
        inp._wacc -= apply;
        const nv = Math.max(min, Math.min(max, parseFloat(inp.value) + apply));
        if (nv === parseFloat(inp.value)) return;
        inp.value = nv; inp.dispatchEvent(new Event('input', { bubbles: true }));
        clearTimeout(inp._wt); inp._wt = setTimeout(() => inp.dispatchEvent(new Event('change', { bubbles: true })), 250);
    }, { passive: false, capture: true });
    // Le bouton suit son curseur, quelle que soit la façon dont la valeur a changé
    document.addEventListener('input', (e) => {
        const inp = e.target; if (!inp.closest) return;
        const row = inp.closest('.strip-send-row'); if (!row) return;
        if (row.classList.contains('send-bar-row')) {
            const v = parseFloat(inp.value) || 0;
            row.style.setProperty('--lvl', v + '%'); const sv = row.querySelector('.sb-val'); if (sv) sv.textContent = Math.round(v);
            row.classList.toggle('on', v > 0); return;
        }
        const k = row.querySelector('.send-knob'); if (!k) return;
        const v = parseFloat(inp.value) || 0;
        k.innerHTML = sendKnobSvg(v) + `<em>${Math.round(v)}</em>`;
        row.classList.toggle('on', v > 0);
    }, true);
})();
// Un projet neuf n'a aucun retour d'effet : on les crée soi-même (+ dans la zone Envois)
const DEFAULT_SENDS = () => [];
function projectSends() {
    if (!Array.isArray(state.project.sends)) state.project.sends = DEFAULT_SENDS();
    return state.project.sends;
}

function renderMixer() {
    const strips = document.getElementById('mixerStrips');
    const sends = projectSends();

    // Pistes d'abord
    const trackStrips = state.project.tracks.map((t, i) => {
        const panDeg = ((t.pan || 0) / 100) * 135;
        const panLabel = t.pan === undefined || t.pan === 0 ? 'C' : (t.pan > 0 ? `R${Math.abs(t.pan)}` : `L${Math.abs(t.pan)}`);
        return `
        <div class="strip ${t.isCapture?'strip-capture':''} ${isPendDel(t) ? 'pend-del' : ''}" style="--track-color: ${t.color}" data-kind="track" data-i="${i}">
            <div class="strip-name">${esc(t.name)}</div>
            <button class="strip-sound" data-tooltip="Réglage de la piste : charge un réglage prêt à l'emploi (comme « Réglage » dans Logic)">${t.sound && SOUND_PRESETS[t.sound.preset] ? esc(SOUND_PRESETS[t.sound.preset].label) : 'Réglage'} ▾</button>
            ${slotListsHtml('track', t)}
            <div class="strip-pan">
                <div class="strip-pan-knob" style="transform: rotate(${panDeg}deg)" data-tooltip="Gauche / droite : glisse pour placer le son (${t.pan ? (t.pan > 0 ? 'à droite' : 'à gauche') : 'au centre'})"></div>
            </div>
            <div class="strip-fader-wrap">
                <div class="fader-row">
                    <div class="vu-rail"><div class="vu-bar"></div></div>
                    <input type="range" class="fader" min="0" max="100" step="0.5" data-vmap="1" data-default="${volToPos(100)}" value="${volToPos(t.volume ?? 100)}">
                </div>
                <div class="strip-db">${volumeToDb(t.volume ?? 100)} dB</div>
            </div>
            <div class="strip-output">→ ${busLabel(t.output)}</div>
        </div>`;
    }).join('');

    // Buses ensuite (séparés visuellement)
    const buses = state.project.buses || [];
    const busStrips = buses.length ? `
        <div class="strip-sep"></div>
        ${buses.map((b, bi) => `
            <div class="strip strip-bus ${b.locked?'strip-locked':''}" style="--track-color: ${b.color || 'var(--violet-2)'}" data-kind="bus" data-i="${bi}">
                <div class="strip-name">${esc(b.name)}${b.locked ? ' <span class="chip chip-red">Verrouillé</span>' : ''}</div>
                ${b.premaster || b.locked ? `<div class="strip-fx">
                    ${b.premaster ? `<button class="return-edit master-edit" data-bus="${esc(b.id)}" data-tooltip="Le réglage final de tout le morceau">Finition ▾</button>` : `<div class="strip-fx-slot active" data-fx="preset">${esc(({ 'bus-allvocal': 'Toutes les voix', 'bus-safety': 'Sécurité', 'bus-mix1': 'Finition' })[b.preset] || 'Groupe')}</div>`}
                </div>` : `
                <button class="strip-sound" data-tooltip="Réglage du groupe : charge un réglage prêt à l'emploi">${b.sound && presetsFor(b)[b.sound.preset] ? esc(presetsFor(b)[b.sound.preset].label) : 'Réglage'} ▾</button>
                ${slotListsHtml('bus', b)}
                <label class="insp-pan strip-bus-pan"><span>G</span><input type="range" class="bus-pan" min="-100" max="100" step="1" data-default="0" value="${b.pan || 0}" data-tooltip="Gauche / droite du groupe (⌘ + clic = centre, double-clic = écrire la valeur)"><span>D</span></label>`}
                <div class="strip-fader-wrap">
                    <input type="range" class="fader" min="0" max="100" step="0.5" data-vmap="1" data-default="${volToPos(100)}" value="${volToPos(b.volume ?? 100)}" ${b.locked?'disabled':''}>
                    <div class="strip-db">${volumeToDb(b.volume ?? 100)} dB</div>
                </div>
                <div class="strip-output">→ ${busLabel(b.output)}</div>
            </div>
        `).join('')}
    ` : '';

    // Retours d'envoi : un par effet commun, avec son volume général
    const sendStrips = `
        <div class="strip-sep"></div>
        ${sends.map(sd => `
            <div class="strip strip-return ${sd.muted ? 'is-muted' : ''}" data-kind="send" data-send="${esc(sd.id)}" style="--track-color: ${sd.type === 'delay' ? 'var(--violet-3)' : 'var(--violet-2)'}">
                <div class="strip-name">${esc(sd.name)}</div>
                <button class="return-edit" data-tooltip="Régler cet envoi">${sd.type === 'delay' ? 'Écho' : 'Reverb'} ▾</button>
                <div class="return-note">100 % effet</div>
                <button class="return-tobus" data-tooltip="Transformer ce retour en bus d'envoi : même son, et tu peux y mettre les plugins que tu veux (comme un bus aux dans Logic)">+ Plugins</button>
                <div class="strip-fader-wrap">
                    <input type="range" class="fader return-fader" min="0" max="100" data-default="100" value="${sd.volume ?? 100}">
                    <div class="strip-db">${volumeToDb(sd.volume ?? 100)} dB</div>
                </div>
                <div class="strip-output">→ MASTER</div>
            </div>`).join('')}
        <button class="strip-add-send" data-tooltip="Ajouter un bus vide : tu y mets les effets que tu veux">+<span>Bus</span></button>`;

    strips.innerHTML = trackStrips + busStrips + sendStrips;
    renderInspector();
}

function addSend(type) {
    pushUndo();
    const sends = projectSends();
    const sd = type === 'delay'
        ? { id: 'send_' + Date.now().toString(36), name: 'Écho', type: 'delay', beats: 0.5, feedback: 35, volume: 100 }
        : { id: 'send_' + Date.now().toString(36), name: 'Reverb', type: 'reverb', size: 2, pre: 0, volume: 100 };
    sends.push(sd);
    renderMixer(); bindMixerEvents(); renderInspector(); saveProject();
    flash(`Envoi « ${sd.name} » ajouté — monte son curseur sur une piste pour l'entendre`);
    const el = document.querySelector(`.strip-return[data-send="${sd.id}"] .return-edit`);
    if (el) openSendPanel(sd.id, el);
}

function removeSend(id) {
    pushUndo();
    const gone = projectSends().find(sd => sd.id === id);
    const wasFirst = gone && projectSends().find(sd => sd.type === gone.type) === gone;
    state.project.sends = projectSends().filter(sd => sd.id !== id);
    state.project.tracks.forEach(t => {
        if (t.sends) delete t.sends[id];
        // Le panneau Son dosait cet envoi : on remet son curseur à zéro, sinon l'effet reviendrait tout seul
        if (wasFirst && t.sound) t.sound[gone.type === 'delay' ? 'echo' : 'space'] = 0;
    });
    (state.project.buses || []).forEach(b => { if (b.sends) delete b.sends[id]; });
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
    renderMixer(); bindMixerEvents(); saveProject(); refreshPlaybackSoon();
    flash('Envoi retiré — ⌘Z pour le remettre');
}

function openSendPanel(id, anchorEl) {
    closeTransientPanels();
    const sd = projectSends().find(x => x.id === id);
    if (!sd) return;
    const isDelay = sd.type === 'delay';
    const panel = document.createElement('div');
    panel.className = 'fx-panel sound-panel send-panel';
    panel.innerHTML = `
        <div class="fx-panel-header"><span>Envoi</span><button class="fx-panel-close">×</button></div>
        <div class="fx-panel-body">
            <div class="sound-row">
                <div class="sound-ends"><span>Nom</span></div>
                <input type="text" class="send-name" maxlength="18" value="${esc(sd.name)}">
            </div>
            ${isDelay ? `
            <div class="echo-time">
                <span>L'écho revient</span>
                <div class="echo-chips">
                    ${[[0.25, '¼ temps'], [0.5, '½ temps'], [1, '1 temps'], [2, '2 temps']].map(([b, l]) => `<button data-beats="${b}">${l}</button>`).join('')}
                </div>
                <label class="echo-ms">ou tous les <input type="number" class="send-ms" min="20" max="2000" step="10" placeholder="—"> ms</label>
            </div>
            <div class="sound-row">
                <div class="sound-ends"><span>Une répétition</span><span>Beaucoup</span></div>
                <input type="range" class="fx-slider send-feedback" min="0" max="85" step="1" data-default="35" value="${sd.feedback ?? 35}">
            </div>` : `
            <div class="sound-row">
                <div class="sound-ends"><span>Petite pièce</span><span>Grande salle</span></div>
                <input type="range" class="fx-slider send-size" min="1.2" max="3.2" step="0.05" data-default="2" value="${sd.size ?? 2}">
            </div>
            <label class="echo-ms send-pre-row">La reverb démarre après <input type="number" class="send-pre" min="0" max="500" step="5" value="${sd.pre || 0}"> ms</label>`}
        </div>
        <div class="fx-panel-footer tune-actions"><button class="tune-remove send-remove">Retirer cet envoi</button></div>`;
    document.body.appendChild(panel);
    const rect = anchorEl.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(window.innerWidth - 290, rect.left - 100)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, rect.top - panel.offsetHeight - 8)) + 'px';
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    let undoPushed = false;
    const commit = (rerender) => {
        if (!undoPushed) { pushUndo(); undoPushed = true; }
        if (rerender) { renderMixer(); bindMixerEvents(); }
        refreshPlaybackSoon(); saveProject();
    };
    const name = panel.querySelector('.send-name');
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v) { if (!undoPushed) { pushUndo(); undoPushed = true; } sd.name = v; renderMixer(); bindMixerEvents(); saveProject(); } else name.value = sd.name; });
    if (isDelay) {
        const ms = panel.querySelector('.send-ms');
        const paint = () => {
            panel.querySelectorAll('[data-beats]').forEach(b => b.classList.toggle('active', !(sd.ms > 0) && (sd.beats || 0.5) === parseFloat(b.dataset.beats)));
            panel.querySelector('.echo-ms').classList.toggle('active', sd.ms > 0);
            ms.value = sd.ms > 0 ? sd.ms : '';
        };
        paint();
        panel.querySelectorAll('[data-beats]').forEach(b => b.addEventListener('click', () => { sd.beats = parseFloat(b.dataset.beats); delete sd.ms; paint(); commit(); }));
        ms.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ms.blur(); });
        ms.addEventListener('change', () => { const v = parseFloat(ms.value); if (v > 0) sd.ms = Math.max(20, Math.min(2000, Math.round(v))); else delete sd.ms; paint(); commit(); });
        panel.querySelector('.send-feedback').addEventListener('input', (e) => { sd.feedback = parseFloat(e.target.value); commit(); });
    } else {
        panel.querySelector('.send-size').addEventListener('input', (e) => { sd.size = parseFloat(e.target.value); commit(); });
        const pre = panel.querySelector('.send-pre');
        pre.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') pre.blur(); });
        pre.addEventListener('change', () => { sd.pre = Math.max(0, Math.min(500, Math.round(parseFloat(pre.value) || 0))); pre.value = sd.pre; commit(); });
    }
    panel.querySelector('.send-remove').addEventListener('click', () => removeSend(id));
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    setTimeout(() => {
        document.addEventListener('mousedown', function closeSend(ev) {
            if (!document.body.contains(panel)) { document.removeEventListener('mousedown', closeSend); return; }
            if (!panel.contains(ev.target) && !ev.target.closest('.return-edit')) { panel.remove(); document.removeEventListener('mousedown', closeSend); }
        });
    }, 100);
}

function busLabel(id) {
    if (!id || id === 'master') return 'Master';
    const b = (state.project.buses || []).find(x => x.id === id);
    return b ? b.name : id;
}

// Faders de piste et de groupe : 0 dB aux 3/4 de la course, puis +6 dB de marge tout en haut (comme Logic).
// Le volume enregistré reste le même (100 = 0 dB) : seule la position du fader change, rien ne bouge dans les anciens projets.
const FADER_UNITY = 75, VOL_MAX = 200;
function volToPos(v) {
    v = Math.max(0, Math.min(VOL_MAX, v));
    return v <= 100 ? v * FADER_UNITY / 100 : FADER_UNITY + (v - 100) * (100 - FADER_UNITY) / 100;
}
function posToVol(p) {
    p = Math.max(0, Math.min(100, p));
    // Tout près du 0 dB, la position se colle dessus (impossible de le rater d'un cheveu)
    if (Math.abs(p - FADER_UNITY) < 0.8) return 100;
    return Math.round(p <= FADER_UNITY ? p * 100 / FADER_UNITY : 100 + (p - FADER_UNITY) * 100 / (100 - FADER_UNITY));
}
function volumeToDb(v) {
    if (v === 0) return '-∞';
    const db = 20 * Math.log10(v / 100);
    return (db > 0.05 ? '+' : '') + db.toFixed(1);
}

// Clic sur la valeur en dB d'un fader : on écrit le niveau à la main (ex. -6, -3,5, -inf)
document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.strip-db') : null;
    if (!el || el.querySelector('input')) return;
    const strip = el.closest('.strip, .insp-strip');
    const fader = strip && strip.querySelector('input.fader');
    if (!fader || fader.disabled) return;
    e.stopPropagation();
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'db-edit'; inp.inputMode = 'decimal'; inp.setAttribute('aria-label', 'Niveau en dB');
    inp.value = el.textContent.replace('dB', '').replace('−', '-').trim();
    el.textContent = ''; el.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (apply) => {
        if (done) return; done = true;
        const raw = inp.value.trim().toLowerCase().replace(',', '.').replace('−', '-');
        const mapped = fader.dataset.vmap === '1';
        const cur = mapped ? posToVol(parseFloat(fader.value)) : parseInt(fader.value);
        const maxDb = mapped ? 6 : 0;
        let v = cur;
        if (apply && raw) {
            if (/^-?\s*(inf|∞|infini)/.test(raw) || raw === '-') v = 0;
            else {
                let db = parseFloat(raw);
                if (!Number.isFinite(db)) { flash('Écris un niveau en dB, par exemple -6'); }
                else {
                    if (db > maxDb) { db = maxDb; flash(mapped ? 'Le fader monte jusqu\'à +6 dB' : 'Le fader monte jusqu\'à 0 dB : au-delà, le son saturerait'); }
                    v = Math.max(0, Math.min(mapped ? VOL_MAX : 100, Math.round(100 * Math.pow(10, db / 20))));
                }
            }
        }
        if (v !== cur) {
            fader.value = mapped ? volToPos(v) : v;
            fader.dispatchEvent(new Event('input', { bubbles: true }));
            fader.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (el.isConnected && el.querySelector('input')) el.textContent = `${volumeToDb(v)} dB`;
    };
    inp.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', (ev) => ev.stopPropagation());
}, true);

// --- Projet name édition ---
function initProjectName() {
    const el = document.getElementById('projectName');
    el.textContent = state.project.name;
    el.addEventListener('blur', () => {
        state.project.name = el.textContent.trim() || 'Projet sans titre';
        el.textContent = state.project.name;
        updateDocTitle();
        saveProject();
    });
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
}

let _lastSaveTs = 0;
let _saveTickTimer = null;
let _lastSavedSnapshot = '';
let _autoSaveTimer = null;
function saveProject() {
    const json = JSON.stringify(state.project);
    try {
        localStorage.setItem('pulse_current_project', json);
    } catch (err) {
        // Stockage navigateur plein : on libère la copie de secours et on réessaie une fois
        try {
            localStorage.removeItem('pulse_autosave');
            localStorage.setItem('pulse_current_project', json);
        } catch (err2) {
            console.error('Save failed', err2);
            flash('⚠ Sauvegarde impossible : stockage plein — exporte ton morceau (⌘E) pour ne rien perdre');
            return;
        }
    }
    _lastSavedSnapshot = json;
    _lastSaveTs = Date.now();
    scheduleProjectDocSave();
    updateSaveIndicator();
    if (!_saveTickTimer) {
        _saveTickTimer = setInterval(updateSaveIndicator, 5000);
    }
    // Autosave backup (slot séparé, toutes les 2min)
    if (!_autoSaveTimer) {
        _autoSaveTimer = setInterval(() => {
            const hasContent = state.project.tracks.some(t => (t.clips || []).length > 0);
            if (hasContent) {
                try { localStorage.setItem('pulse_autosave', JSON.stringify(state.project)); } catch {}
            }
        }, 120000);
    }
}

// Chaque projet est aussi rangé dans IndexedDB (clé = id) : créer un nouveau projet n'écrase plus l'ancien
let _docSaveTimer = null;
function scheduleProjectDocSave() {
    clearTimeout(_docSaveTimer);
    _docSaveTimer = setTimeout(flushProjectDocSave, 700);
}
function flushProjectDocSave() {
    clearTimeout(_docSaveTimer);
    _docSaveTimer = null;
    const p = state.project;
    if (!p || !p.id || !window.PulsePersist) return;
    const lastOpen = Date.now();
    PulsePersist.saveProjectDoc({ ...JSON.parse(JSON.stringify(p)), lastOpen }).catch(err => console.warn('Save doc failed', err));
    try {
        const key = 'pulse_recent_projects';
        const recents = (JSON.parse(localStorage.getItem(key) || '[]') || []).filter(r => r.id !== p.id);
        recents.unshift({ id: p.id, name: p.name, lastOpen });
        localStorage.setItem(key, JSON.stringify(recents.slice(0, 20)));
    } catch {}
}
window.addEventListener('pagehide', () => { if (_docSaveTimer) flushProjectDocSave(); });

// Projet créé depuis l'accueil en déposant une instru : on la met en place à l'ouverture
async function importPendingInstru() {
    const pend = state.project.pendingInstru;
    if (!pend) return;
    delete state.project.pendingInstru;
    try {
        const blob = await PulsePersist.loadBlob(pend.key);
        if (!blob) { flash('L\'instru n\'a pas pu être retrouvée — dépose-la sur la piste Instru'); saveProject(); return; }
        let idx = state.project.tracks.findIndex(isInstruTrack);
        if (idx < 0) idx = state.project.tracks.length - 1;
        await importAudioFile(new File([blob], pend.name, { type: pend.type || blob.type }), idx, 0);
        PulsePersist.deleteBlob(pend.key).catch(() => {});
        state.selectedTrack = Math.max(0, state.project.tracks.findIndex(t => t.armed));
        renderAll(); saveProject();
    } catch (err) {
        console.error(err);
        flash('Impossible de lire cette instru — essaie un autre fichier (MP3 ou WAV)');
        saveProject();
    }
}

// Nettoyage des fichiers audio que plus aucun projet n'utilise (au démarrage : l'historique d'annulation est vide)
async function cleanupOrphanAudio() {
    try {
        await PulsePersist.saveProjectDoc(JSON.parse(JSON.stringify(state.project)));
        const keep = [];
        const collect = (p) => keep.push(...PulsePersist.mediaIds(p));
        collect(state.project);
        try { collect(JSON.parse(localStorage.getItem('pulse_autosave') || 'null')); } catch {}
        await PulsePersist.gcAll(keep);
    } catch (err) { console.warn('GC audio', err); }
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// === Dossier de projet façon Logic (appli de bureau) ===
// « Mon morceau/ » contient : Mon morceau.pulse (le fichier qui ouvre Pulse), Audio/ (les sons), Bounces/ (les exports), Pistes.txt (la liste des pistes).
// Dans le navigateur, rien ne change : « Sauvegarder » garde le projet dans Pulse et l'export télécharge.
const nativeFs = () => !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
const fsSafe = (n, fb = 'piste') => String(n || fb).replace(/[^\p{L}\p{N}_\- ]+/gu, '_').trim().slice(0, 60) || fb;
async function nativeWrite(dir, rel, data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await (data instanceof Blob ? data : new Blob([data])).arrayBuffer());
    return window.__TAURI__.core.invoke('save_file', bytes, { headers: { dir: encodeURIComponent(dir), path: encodeURIComponent(rel) } });
}
// Dossier du projet : celui déjà créé, sinon on demande où le ranger (une seule fois). null = annulé.
async function ensureProjectFolder(askAgain = false, forExport = false) {
    const inv = window.__TAURI__.core.invoke;
    let dir = state.project.savedDir;
    if (!askAgain && dir && await inv('project_folder_ok', { dir })) return dir;
    flash('Choisis où ranger ton projet…');
    const parent = await inv('pick_folder', { prompt: 'Où veux-tu ranger ton projet ?' });
    if (!parent) { flash(forExport ? 'Export annulé : il faut choisir un dossier pour y ranger ton fichier — recommence quand tu veux' : 'Pas de souci : ton projet reste gardé dans Pulse. Appuie sur ⌘S quand tu veux choisir où le ranger'); return null; }
    dir = await inv('create_project_folder', { parent, name: state.project.name || 'Mon projet' });
    state.project.savedDir = dir;
    state._savedAudio = new Set();
    saveProject();
    return dir;
}
async function saveProjectFolder(askAgain = false) {
    if (!nativeFs()) { saveProject(); flash('Projet sauvegardé'); return; }
    if (state._savingFolder) return;   // un 2e ⌘S pendant l'enregistrement (ou pendant la boîte de dialogue) est ignoré
    state._savingFolder = true;
    try {
        saveProject();
        const dir = await ensureProjectFolder(askAgain);
        if (!dir) return;
        flash('Enregistrement du projet…');
        const base = dir.split(/[\\/]/).filter(Boolean).pop() || 'Projet';
        // Gros projet : sons répartis en plusieurs fichiers dans Sons/ (un bloc de plusieurs centaines de Mo ne passe pas d'un coup)
        const split = await PulseFile.packSplit(state.project, fsSafe(base, 'Projet'));
        let missing = split.missing;
        if (split.parts.length > 1) {
            for (let i = 0; i < split.parts.length; i++) {
                flash(`Enregistrement du projet… (sons ${i + 1}/${split.parts.length})`);
                await nativeWrite(dir, split.parts[i].name, split.parts[i].blob);
            }
            await nativeWrite(dir, `${fsSafe(base, 'Projet')}.pulse`, split.main);
        } else {
            const packed = await PulseFile.pack(state.project);
            missing = packed.missing;
            await nativeWrite(dir, `${fsSafe(base, 'Projet')}.pulse`, packed.blob);
        }
        // Audio/ : un fichier par son (écrit une seule fois)
        state._savedAudio = state._savedAudio || new Set();
        const lines = [`Projet « ${state.project.name || base} » — ${state.project.bpm} BPM`, ''];
        for (const t of state.project.tracks) {
            lines.push(`${t.name}${t.output && t.output !== 'master' ? '  →  ' + busLabel(t.output) : ''}`);
            for (const c of (t.clips || [])) {
                if (c.recording) continue;
                lines.push(`    ${c.name || 'Région'}  à ${secondsToDuration(c.start)}  (${secondsToDuration(c.duration)})`);
                if (c.id && folderAudioCopies() && !state._savedAudio.has(c.id)) {
                    const buf = PulseAudio.getBuffer(c.id) || await loadBufferById(c.id);
                    if (buf) { await nativeWrite(dir, `Audio/${fsSafe(t.name)} - ${fsSafe(c.id, 'son')}.wav`, new Blob([PulseAudio.audioBufferToWav(buf)])); state._savedAudio.add(c.id); }
                }
            }
        }
        await nativeWrite(dir, 'Pistes.txt', new TextEncoder().encode(lines.join('\n') + '\n'));
        flash(missing ? `⚠ Projet enregistré, mais ${missing} son${missing > 1 ? 's' : ''} manquai${missing > 1 ? 'ent' : 't'} déjà — dossier : ${dir}` : `✓ Projet enregistré dans « ${dir} » (⌘S pour remettre à jour)`);
        if (!state._folderShown) { state._folderShown = true; window.__TAURI__.core.invoke('reveal_project_folder', { dir }).catch(() => {}); }
    } catch (err) {
        console.error(err);
        flash('Impossible d\'écrire dans ce dossier — choisis-en un autre avec ⌘⌥S (le projet reste gardé dans Pulse)');
    } finally { state._savingFolder = false; }
}
// Un fichier prêt à livrer (export) : rangé dans Bounces/ du projet dans l'appli, téléchargé dans le navigateur
async function deliverFile(blob, filename) {
    if (!nativeFs()) { triggerDownload(blob, filename); return { native: false }; }
    const dir = await ensureProjectFolder(false, true);
    if (!dir) return { cancelled: true };
    await nativeWrite(dir, `Bounces/${filename}`, blob);
    return { native: true, dir };
}

// Sauvegarde complète du projet dans un fichier .pulse (projet + tout l'audio)
async function exportPulseFile() {
    if (nativeFs()) { await saveProjectFolder(false); return; }
    flash('Préparation du fichier projet…');
    try {
        saveProject();
        const { blob, clips, missing } = await PulseFile.pack(state.project);
        const name = (state.project.name || 'projet').replace(/[^\p{L}\p{N}_\-]+/gu, '_');
        triggerDownload(blob, name + '.pulse');
        flash(missing
            ? `⚠ Projet enregistré, mais ${missing} son${missing > 1 ? 's' : ''} manquai${missing > 1 ? 'ent' : 't'} déjà (clips « audio perdu »)`
            : `✓ ${name}.pulse téléchargé (${clips} son${clips > 1 ? 's' : ''} inclus) — garde-le précieusement, c'est ta sauvegarde`);
    } catch (err) {
        console.error(err);
        flash('Impossible de créer le fichier projet — libère de la place sur ton disque et réessaie');
    }
}

// Double-clic sur un .pulse dans le Finder / l'Explorateur (appli de bureau) : le fichier s'ouvre dans Pulse
async function openPulseFromPath(path) {
    try {
        const inv = window.__TAURI__.core.invoke;
        const buf = await inv('read_pulse_file', { path });
        const name = String(path).split(/[\\/]/).pop();
        const dir = String(path).slice(0, String(path).length - name.length - 1);
        const file = new File([buf], name);
        // Gros projet : ses sons sont dans Sons/, à côté
        const parts = [];
        for (const rel of await PulseFile.partNames(file)) {
            try { parts.push(new File([await inv('read_pulse_file', { path: dir + '/' + rel })], rel)); } catch {}
        }
        await openPulseFileInStudio(file, { dir, parts });
    } catch (err) {
        console.error(err);
        flash('Impossible d\'ouvrir ce fichier .pulse — vérifie qu\'il n\'est pas abîmé');
    }
}
(function nativeOpenFiles() {
    if (!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)) return;
    const inv = window.__TAURI__.core.invoke;
    // fichiers reçus pendant que la page se chargeait ; la liste est vidée à la lecture (sinon la page se rouvrirait en boucle)
    setTimeout(async () => { try { const list = await inv('take_pending_open'); if (list && list.length) openPulseFromPath(list[0]); } catch {} }, 900);
    if (window.__TAURI__.event && window.__TAURI__.event.listen) {
        window.__TAURI__.event.listen('pulse-open-file', async (e) => { try { await inv('take_pending_open'); } catch {} openPulseFromPath(e.payload); });
    }
})();

// Ouvre un .pulse déposé dans le studio (le projet en cours reste disponible dans les récents)
async function openPulseFileInStudio(file, opts = {}) {
    flash(`Ouverture de ${file.name}…`);
    try {
        flushProjectDocSave();
        // Morceaux de sons : ceux lus à côté du fichier (appli) ou déposés en même temps
        const wanted = await PulseFile.partNames(file);
        const parts = opts.parts || [];
        const project = await PulseFile.unpack(file, parts);
        const got = new Set(parts.map(p => p.name.split(/[\\/]/).pop()));
        const lost = wanted.filter(w => !got.has(w.split('/').pop())).length;
        if (lost) {
            const ids = PulsePersist.mediaIds(project, false);
            let absent = 0; for (const id of ids) if (!(await PulsePersist.loadBlob(id))) absent++;
            if (absent) { try { sessionStorage.setItem('pulse_open_warn', `⚠ ${absent} son${absent > 1 ? 's' : ''} introuvable${absent > 1 ? 's' : ''} : ouvre le projet par double-clic sur le .pulse, ou glisse aussi les fichiers du dossier « Sons » en même temps`); } catch {} }
        }
        // Un .pulse ouvert depuis son dossier de projet : on continue d'y enregistrer
        if (opts.dir && nativeFs()) { try { if (await window.__TAURI__.core.invoke('project_folder_ok', { dir: opts.dir })) project.savedDir = opts.dir; } catch {} }
        await PulsePersist.saveProjectDoc(project);
        localStorage.setItem('pulse_current_project', JSON.stringify(project));
        _skipUnloadGuard = true;
        location.reload();
    } catch (err) {
        console.error(err);
        flash('Ce fichier n\'est pas un projet Pulse valide — choisis un fichier qui finit par .pulse');
    }
}
let _skipUnloadGuard = false;

function updateSaveIndicator() {
    const el = document.getElementById('saveIndicator');
    if (!el) return;
    if (!_lastSaveTs) { el.textContent = '—'; el.classList.remove('saved'); return; }
    const diff = Math.floor((Date.now() - _lastSaveTs) / 1000);
    el.classList.add('saved');
    if (diff < 3) el.textContent = 'Sauvegardé';
    else if (diff < 60) el.textContent = `Sauvegardé il y a ${diff}s`;
    else if (diff < 3600) el.textContent = `Sauvegardé il y a ${Math.floor(diff/60)}min`;
    else el.textContent = 'Sauvegardé';
}

// --- Transport ---
// fromRec = lecture lancée par l'enregistrement lui-même : on part pile du curseur, sans le déplacer
async function togglePlay(fromRec = false) {
    // Logic : Space pendant rec = stop rec + stop play, puis curseur revient au début de la prise
    if (state.recording && !fromRec) {
        const recStartSec = state._punch ? state._punch.preStart : (state._livingClip?.clip?.start ?? state.playhead);
        closeOpenRegion();
        state.playing = false;
        await finalizeCapture();
        const btn = document.getElementById('btnPlay');
        btn.querySelector('.icon-play').style.display = 'block';
        btn.querySelector('.icon-pause').style.display = 'none';
        PulseAudio.stopAll();
        PulseAudio.stopMetronome();
        state.playhead = recStartSec;
        updatePlayhead();
        updateChrono();
        return;
    }

    state.playing = !state.playing;
    const btn = document.getElementById('btnPlay');
    btn.querySelector('.icon-play').style.display = state.playing ? 'none' : 'block';
    btn.querySelector('.icon-pause').style.display = state.playing ? 'block' : 'none';

    if (state.playing) {
        if (!fromRec && !projectHasSound() && !state.recording) flash('Rien à écouter pour l\'instant : pose ton instru, ou appuie sur R pour t\'enregistrer');
        // Si une boucle est active et le curseur est hors de la zone → on revient au début de la boucle
        if (fromRec) {
            // rien : la prise démarre exactement là où est le curseur
        } else if (state.looping && state.loop) {
            const ls = Math.min(state.loop.start, state.loop.end);
            const le = Math.max(state.loop.start, state.loop.end);
            // Chaque Espace repart du début de la boucle, sauf si tu as posé toi-même un curseur de départ dans la boucle
            const ub = state.userBaseSec;
            const start = (ub != null && !state.baseCleared && ub >= ls && ub < le) ? ub : ls;
            if (Math.abs(state.playhead - start) > 1e-6) {
                state.playhead = start;
                updatePlayhead(); updateChrono();
            }
        } else {
            // Comme Logic : la lecture part toujours de là où tu as posé le curseur, même après la dernière région
            // (avant, un curseur posé juste derrière une prise renvoyait au début du morceau)
        }
        // Après une pause : le 1er Espace a arrêté le son là où il en était, le 2e relance depuis le point de départ
        if (!fromRec && returnOnStop() && state.paused && state.playOrigin != null
            && Math.abs(state.playhead - state.paused.pos) < 0.02 && !(state.looping && state.loop)) {
            state.playhead = state.playOrigin;
            updatePlayhead(); updateChrono();
        }
        if (!fromRec) state.paused = null;
        state.followOff = false;
        state.startTime = performance.now() - state.playhead * 1000;
        // Moteur natif (appli de bureau, si activé dans les Réglages) : seulement pour écouter, pas pendant une prise
        const useNative = !fromRec && window.PulseNative && PulseNative.isEnabled() && !state.recording;
        if (useNative) PulseNative.onError = (err) => flash('Le moteur natif n\'a pas pu jouer (' + (err && err.message || err) + ') : lecture par le moteur habituel');
        PulseAudio.setNativeBackend(useNative ? PulseNative : null);
        const from0 = state.playhead;
        if (!fromRec) state.playOrigin = state.baseCleared ? null : state.playhead;   // le curseur revient ici à l'arrêt (comme Logic) ; sans base il reste où il s'arrête
        try { await PulseAudio.play(state.project, state.playhead); } catch (err) { console.error(err); }
        // Le mixage natif prend un instant : on recale le curseur sur le vrai départ du son
        if (PulseAudio.isNative()) state.startTime = performance.now() - from0 * 1000;
        if (state.metronome) PulseAudio.startMetronome(state.project.bpm, state.playhead, state.project);
        requestAnimationFrame(tick);
        if (!fromRec && !PulseAudio.isNative()) maybeStartBgCapture();
    } else {
        PulseAudio.stopAll();
        PulseAudio.stopMetronome();
        await finalizeCapture();
        // 1er Espace : pause là où le son s'est arrêté. Le suivant relance depuis le point de départ (marque pointillée).
        if (returnOnStop() && state.playOrigin != null && !state.recording) {
            state.paused = { pos: state.playhead };
        }
        updatePlayOrigin();
    }
}
// Copier aussi les sons en WAV dans Audio/ (le .pulse les contient déjà : ça double le poids du dossier) — décoché par défaut
function folderAudioCopies() { try { return localStorage.getItem('pulse_folder_audio') === '1'; } catch { return false; } }
function returnOnStop() { try { return localStorage.getItem('pulse_return_on_stop') !== '0'; } catch { return true; } }

// === Réglages (⚙) : tout ce qui change la façon d'enregistrer, au même endroit ===
function openSettings() {
    if (document.getElementById('settingsModal')) return;
    const modal = document.createElement('div');
    modal.id = 'settingsModal';
    modal.className = 'modal-backdrop';
    const mode = recMode();
    const bg = localStorage.getItem('pulse_bg_capture') !== '0';
    const countIn = PulseAudio.isCountInEnabled();
    const manual = parseFloat(localStorage.getItem('pulse_latency_ms') || '0') || 0;
    const opt = (name, value, checked, title, desc) => `
        <label class="set-opt">
            <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}>
            <span><b>${title}</b><em>${desc}</em></span>
        </label>`;
    const toggle = (id, checked, title, desc) => `
        <label class="set-opt">
            <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
            <span><b>${title}</b><em>${desc}</em></span>
        </label>`;
    modal.innerHTML = `
        <div class="modal settings-modal">
            <button class="modal-close" id="settingsClose" aria-label="Fermer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h2 class="modal-title">Réglages</h2>
            <p class="modal-sub">Pulse est réglé comme en studio. Change seulement si tu préfères travailler autrement.</p>

            <h4 class="set-title no-tx">Langue · Language</h4>
            <div class="set-lang no-tx">
                <button class="set-lang-btn ${(!window.PulseI18n || PulseI18n.current() !== 'en') ? 'on' : ''}" data-lang="fr">Français</button>
                <button class="set-lang-btn ${window.PulseI18n && PulseI18n.current() === 'en' ? 'on' : ''}" data-lang="en">English (beta)</button>
            </div>

            <h4 class="set-title">Quand j'enregistre par-dessus une prise</h4>
            ${opt('recmode', 'takes', mode === 'takes', 'Ranger l\'ancienne prise', 'La nouvelle passe devant, l\'ancienne reste sous la piste (A, B, C…).')}
            ${opt('recmode', 'overlap', mode === 'overlap', 'Superposer les deux', 'Les deux prises s\'entendent en même temps.')}

            <h4 class="set-title">Mon morceau</h4>
            <div class="set-row">
                <span>Temps par mesure <em>(4 pour presque tout le rap et la trap ; 3 pour une valse)</em></span>
                <select id="setBeats" class="set-select">${[2, 3, 4, 5, 6, 7].map(n => `<option value="${n}" ${bpb() === n ? 'selected' : ''}>${n} temps</option>`).join('')}</select>
            </div>
            <h4 class="set-title">Enregistrement</h4>
            ${toggle('setCountIn', countIn, 'Décompte 1-2-3-4 avant d\'enregistrer', 'Un clic par temps de la mesure pour se caler quand on part de l\'arrêt.')}
            ${toggle('setBg', bg, 'Garder ce que je dis avant d\'appuyer sur R', 'Le micro capte dès la lecture : tu étires le bord de la prise pour récupérer le début.')}

            <h4 class="set-title">Souris sur une région</h4>
            <div class="set-row">
                <span>⌘ + clic</span>
                <select id="setToolCmd" class="set-select">${MOUSE_TOOL_LISTS.cmd.map(k => `<option value="${k}" ${mouseTool('cmd') === k ? 'selected' : ''}>${MOUSE_TOOL_LABELS[k]}</option>`).join('')}</select>
            </div>
            <div class="set-row">
                <span>Clic droit <em>(un clic sans bouger ouvre le menu)</em></span>
                <select id="setToolRight" class="set-select">${MOUSE_TOOL_LISTS.right.map(k => `<option value="${k}" ${mouseTool('right') === k ? 'selected' : ''}>${MOUSE_TOOL_LABELS[k]}</option>`).join('')}</select>
            </div>

            <h4 class="set-title">Retour casque</h4>
            ${toggle('setMonitor', PulseAudio.isMonitorOn(), 'M\'entendre dans le casque par Pulse', 'Coché : ta voix revient dans ton casque en passant par Pulse. Décoché : tu t\'entends par le retour direct de ta carte son, s\'il y en a un (pas de double retour). Mets un casque : sur des enceintes, ça siffle. Le bouton « i » de chaque piste choisit quelle voix tu entends.')}
            ${window.PulseNative && PulseNative.available ? toggle('setNativeMon', PulseAudio.getNativeMonitor().usable, 'Retour direct par l\'appli (le plus rapide)', 'Coché : ta voix passe directement du micro au casque par le moteur de l\'appli, avec la plus petite mémoire tampon possible (quelques millisecondes, comme dans les logiciels des studios pros). Décoché : elle passe par le moteur habituel, un peu plus lent.') : ''}
            ${toggle('setLowLat', PulseAudio.isLowLatency(), 'Faible latence', 'Pulse demande à ton ordi le plus petit délai possible pour ton micro. À garder coché, sauf si ça craque.')}
            <div class="set-row" data-tooltip="Petite : le moins de retard dans ton casque, pour enregistrer. Grande : plus de marge pour ton ordi, pour mixer un gros projet sans aucun craquement.">
                <span>Mémoire tampon <em>(petite pour enregistrer, grande pour mixer)</em></span>
                <select id="setBuffer" class="set-select">${[['petit', 'Petite — enregistrer'], ['moyen', 'Moyenne'], ['grand', 'Grande — mixer']].map(([k, l]) => `<option value="${k}" ${PulseAudio.getBufferMode() === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div>
            <div class="set-row">
                <span>Retard entre ta voix et ce que tu entends <em id="setLatNote"></em></span>
                <span id="setLatValue" class="set-mic">…</span>
            </div>

            <h4 class="set-title">Sortie</h4>
            <div class="set-row">
                <span>Volume maximum de sortie <em>(rien ne dépasse ce niveau, même à l'export)</em></span>
                <span><input type="number" id="setCeiling" class="set-num" step="0.1" min="-6" max="0" value="${(state.project.ceilingDb ?? -0.3).toFixed(1)}"> dB</span>
            </div>
            ${toggle('setComping', compingOn(), 'Comping : choisir les meilleurs passages de chaque prise', 'Quand tu as enregistré plusieurs prises, glisse sur une prise rangée sous la piste pour garder seulement ce passage-là : ce qui jouait à cet endroit part de côté, le reste de la prise reste rangé. Tu assembles ainsi la meilleure prise phrase par phrase. Décoché : un clic remet la prise entière devant.')}
            ${toggle('setAutoFollow', autoFollowRegions(), 'L\'automation suit les régions déplacées', 'Comme le réglage de Logic : quand tu déplaces une région, les points d\'automation de sa piste sous cette région partent avec elle (aussi vers une autre piste). Éteint : les courbes restent où elles sont.')}
            ${toggle('setReturn', returnOnStop(), 'Espace : pause, puis relance depuis le départ', 'Un premier Espace met en pause là où tu en es, le deuxième relance depuis l\'endroit où tu avais posé le curseur (la petite marque pointillée). Décoché : Espace reprend toujours là où le son s\'est arrêté.')}
            ${toggle('setShowAll', showAll(), 'Afficher les réglages avancés de la sortie', 'Montre aussi les bus de sortie, pour les régler ou dessiner leur volume. Pas besoin pour enregistrer.')}

            ${window.PulseCompteur && PulseCompteur.configured ? toggle('setCompteur', PulseCompteur.enabled(), 'Compter mon installation (anonyme)', 'Envoie un numéro tiré au hasard, la version et ton système, jamais tes projets ni tes sons. Ça nous dit seulement combien de personnes utilisent Pulse.') : ''}
            <h4 class="set-title">En cas de problème</h4>
            <div class="set-row">
                <span>Si Pulse redémarre tout seul ou affiche une erreur, ça s'écrit ici <em>${diagLog().length ? esc(diagLog().slice(-4).map(d => `${d.t.slice(5, 16).replace('T', ' ')} — ${d.kind} : ${d.detail}`).join(' | ')) : '(rien pour l\'instant : tout va bien)'}</em></span>
                <span><button class="set-btn" id="setDiagCopy">Copier</button></span>
            </div>

            ${window.PulseNative && PulseNative.available ? `<h4 class="set-title">Dossier du projet</h4>
            ${toggle('setFolderAudio', folderAudioCopies(), 'Copier aussi les sons en WAV dans le dossier Audio', 'Le fichier .pulse contient déjà tous tes sons. Cocher ajoute des WAV à part (pratique pour les ouvrir dans un autre logiciel) mais double le poids du dossier.')}` : ''}

            ${window.PulseNative && PulseNative.available ? `<h4 class="set-title">Moteur natif (bêta)</h4>
            <div class="set-row">
                <span>Lire le morceau avec le moteur Pulse de l'appli <em>(le même son, mixé par le moteur natif. Pour écouter et mixer : dès que tu enregistres, Pulse repasse tout seul sur le moteur habituel)</em></span>
                <span><input type="checkbox" id="setNativeOn" ${PulseNative.isEnabled() ? 'checked' : ''}></span>
            </div>` : ''}

            <h4 class="set-title">Micro</h4>
            <div class="set-row">
                <span class="set-mic" id="setMicLabel">${esc(PulseAudio.getMicLabel() || 'Pas encore choisi')}</span>
                <button class="set-btn" id="setMicPick">Changer de micro</button>
            </div>
            <div class="set-row">
                <span>Caler ma voix sur l'instru <em>(clics + micro : Pulse mesure le décalage tout seul)</em></span>
                <button class="set-btn" id="setCalib">Régler automatiquement</button>
            </div>
            <div class="set-row">
                <span>Décalage manuel de la voix <em>(+ = la voix est avancée davantage)</em></span>
                <span><input type="number" id="setLatency" class="set-num" step="1" min="-200" max="300" value="${Math.round(manual)}"> ms</span>
            </div>
        </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('visible'));
    const close = () => { modal.classList.remove('visible'); setTimeout(() => modal.remove(), 240); };
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('#settingsClose')) close(); });
    modal.querySelectorAll('input[name="recmode"]').forEach(r => r.addEventListener('change', () => {
        localStorage.setItem(REC_MODE_KEY, r.value);
        flash(r.value === 'takes' ? 'Les anciennes prises seront rangées sous la piste' : 'Les prises se superposeront');
    }));
    modal.querySelector('#setBeats').addEventListener('change', (e) => {
        pushUndo();
        state.project.beatsPerBar = parseInt(e.target.value);
        PulseAudio.setBeatsPerBar && PulseAudio.setBeatsPerBar(bpb());
        // carte de tempo : une signature devenue identique à celle de départ ne sert plus, la piste de tempo se redessine
        if ((state.project.tempos || state.project.signatures) && typeof tempoMapChanged === 'function') tempoMapChanged();
        else { renderRuler(); renderTimelineTracks(); updateChrono(); saveProject(); }
        flash(`Mesure à ${bpb()} temps : la grille, le métronome et l'aimant suivent`);
    });
    modal.querySelector('#setCountIn').addEventListener('change', (e) => {
        if (PulseAudio.isCountInEnabled() !== e.target.checked) document.getElementById('btnCountIn').click();
    });
    modal.querySelector('#setBg').addEventListener('change', (e) => {
        localStorage.setItem('pulse_bg_capture', e.target.checked ? '1' : '0');
        flash(e.target.checked ? 'Le micro captera dès la lecture' : 'Le micro ne captera qu\'à partir de R');
    });
    modal.querySelectorAll('.set-lang-btn').forEach(b => b.addEventListener('click', () => {
        if (!window.PulseI18n || PulseI18n.current() === b.dataset.lang) return;
        try { localStorage.setItem('pulse_lang', b.dataset.lang); } catch {}
        flushProjectDocSave(); saveProject(); _skipUnloadGuard = true;
        location.reload();
    }));
    modal.querySelector('#setAutoFollow').addEventListener('change', (e) => {
        try { localStorage.setItem('pulse_auto_follow_regions', e.target.checked ? '1' : '0'); } catch {}
        flash(e.target.checked ? 'L\'automation suit maintenant les régions que tu déplaces' : 'L\'automation reste en place quand tu déplaces une région');
    });
    modal.querySelector('#setComping').addEventListener('change', (e) => {
        try { localStorage.setItem(COMPING_KEY, e.target.checked ? '1' : '0'); } catch {}
        rerenderTracks();
        flash(e.target.checked ? 'Comping activé : glisse sur une prise rangée pour garder un passage' : 'Comping coupé : un clic remet la prise entière devant');
    });
    modal.querySelector('#setReturn').addEventListener('change', (e) => {
        try { localStorage.setItem('pulse_return_on_stop', e.target.checked ? '1' : '0'); } catch {}
        flash(e.target.checked ? 'Espace : pause là où tu en es, puis relance depuis le départ' : 'Espace reprend toujours là où le son s\'est arrêté');
    });
    const cpt = modal.querySelector('#setCompteur');
    if (cpt) cpt.addEventListener('change', (e) => { PulseCompteur.setEnabled(e.target.checked); flash(e.target.checked ? 'Comptage anonyme activé' : 'Comptage anonyme désactivé'); });
    const dc = modal.querySelector('#setDiagCopy');
    if (dc) dc.addEventListener('click', async () => {
        const txt = diagLog().map(d => `${d.t} ${d.kind} : ${d.detail}`).join('\n') || 'Rien dans le journal';
        try { await navigator.clipboard.writeText(txt); flash('Journal copié — colle-le dans ton message pour que je regarde'); } catch { flash('Copie impossible ici : recopie le texte affiché'); }
    });
    const fa = modal.querySelector('#setFolderAudio');
    if (fa) fa.addEventListener('change', (e) => {
        try { localStorage.setItem('pulse_folder_audio', e.target.checked ? '1' : '0'); } catch {}
        flash(e.target.checked ? 'Les sons seront aussi copiés en WAV dans le dossier Audio à la prochaine sauvegarde' : 'Les sons restent seulement dans le fichier .pulse (dossier plus léger)');
    });
    const nOn = modal.querySelector('#setNativeOn');
    if (nOn) nOn.addEventListener('change', (e) => {
        PulseNative.setEnabled(e.target.checked);
        flash(e.target.checked ? 'Moteur natif activé : la prochaine lecture passe par le moteur Pulse de l\'appli' : 'Moteur natif coupé : lecture par le moteur habituel');
    });
    modal.querySelector('#setMonitor').addEventListener('change', async (e) => {
        const on = e.target.checked;
        if (on) {
            // Il faut le micro tout de suite pour s'entendre sans attendre la première prise
            try { await PulseAudio.init(); await PulseAudio.requestMic(); }
            catch (err) { e.target.checked = false; flash(micErrorMessage(err)); return; }
        }
        PulseAudio.setMonitor(on);
        flash(on ? '🎧 Tu t\'entends dans le casque par Pulse — si ta voix arrive en retard, coupe-le et utilise le retour direct de ta carte son' : 'Coupé : tu t\'entends par le retour de ta carte son');
    });
    // Latence réelle mesurée + conseil clair
    const showLatency = () => {
        const v = document.getElementById('setLatValue'), n = document.getElementById('setLatNote');
        if (!v || !n) return;
        const info = PulseAudio.getLatencyInfo();
        if (!info) { v.textContent = 'Pas encore mesurée'; n.textContent = '(lance une lecture ou active le micro)'; return; }
        const ms = Math.round(info.totalMs);
        v.textContent = info.native ? `≈ ${ms} ms` : `${ms} ms`;
        n.textContent = info.native ? '(retour direct par l\'appli : tu ne sens rien)' : ms <= 12 ? '(excellent : tu ne sens rien)'
            : ms <= 25 ? '(correct pour chanter)'
            : '(trop long : branche une carte son, ferme les autres applis, ou utilise le retour direct de ta carte son avec « M\'entendre dans le casque par Pulse » coupé)';
    };
    showLatency();
    const nativeMonBox = modal.querySelector('#setNativeMon');
    if (nativeMonBox) nativeMonBox.addEventListener('change', (e) => {
        PulseAudio.setNativeMonitor(e.target.checked);
        flash(e.target.checked ? '⚡ Retour direct par l\'appli : le moins de retard possible dans ton casque' : 'Retour par le moteur habituel');
        // le retour direct s'ouvre en quelques dizaines de millisecondes ; s'il échoue, on le dit
        setTimeout(() => {
            const nm = PulseAudio.getNativeMonitor();
            if (e.target.checked && nm.error) flash('Retour direct impossible (' + nm.error + ') : tu t\'entends par le moteur habituel');
            showLatency();
        }, 600);
    });
    modal.querySelector('#setBuffer').addEventListener('change', async (e) => {
        const m = e.target.value;
        if (state.recording || state._recStarting) { e.target.value = PulseAudio.getBufferMode(); flash('Arrête d\'abord l\'enregistrement en cours (Espace)'); return; }
        if (state.playing) togglePlay();
        const ok = await PulseAudio.setBufferMode(m);
        if (!ok) { e.target.value = PulseAudio.getBufferMode(); flash('Mémoire tampon : impossible de changer pendant une prise'); return; }
        flash(m === 'grand' ? 'Mémoire tampon grande : idéal pour mixer (un peu plus de retard au casque)' : m === 'moyen' ? 'Mémoire tampon moyenne' : 'Mémoire tampon petite : le moins de retard pour enregistrer');
        setTimeout(showLatency, 400);
    });
    modal.querySelector('#setLowLat').addEventListener('change', (e) => {
        const reopened = PulseAudio.setLowLatency(e.target.checked);
        flash(e.target.checked ? '⚡ Faible latence activée' + (reopened ? '' : ' : prise en compte à la prochaine prise') : 'Faible latence coupée');
        setTimeout(showLatency, 400);
    });
    const saveTool = (which, value) => setMouseTool(which, value);
    modal.querySelector('#setToolCmd').addEventListener('change', (e) => saveTool('cmd', e.target.value));
    modal.querySelector('#setToolRight').addEventListener('change', (e) => saveTool('right', e.target.value));
    modal.querySelector('#setCeiling').addEventListener('change', (e) => {
        const v = Math.max(-6, Math.min(0, parseFloat(e.target.value)));
        const db = Number.isFinite(v) ? Math.round(v * 10) / 10 : -0.3;
        e.target.value = db.toFixed(1);
        pushUndo();
        state.project.ceilingDb = db;
        PulseAudio.setCeiling(db); saveProject(); refreshPlaybackSoon();
        flash(`Plafond de sécurité : ${db.toFixed(1)} dB`);
    });
    modal.querySelector('#setShowAll').addEventListener('change', (e) => {
        localStorage.setItem('pulse_show_all', e.target.checked ? '1' : '0');
        applyShowAll(); renderAll();
        flash(e.target.checked ? 'Tout est affiché : bus de sécurité et sortie compris' : 'Le bus de sécurité et la sortie sont de nouveau cachés (ils marchent toujours)');
    });
    modal.querySelector('#setLatency').addEventListener('change', (e) => {
        const v = Math.max(-200, Math.min(300, parseFloat(e.target.value) || 0));
        localStorage.setItem('pulse_latency_ms', String(v));
        flash(`Calage : ${v >= 0 ? '+' : ''}${v} ms`);
    });
    modal.querySelector('#setCalib').addEventListener('click', async () => {
        await runLatencyCalibration();
        const el = document.getElementById('setLatency');
        if (el) el.value = Math.round(parseFloat(localStorage.getItem('pulse_latency_ms') || '0') || 0);
    });
    modal.querySelector('#setMicPick').addEventListener('click', (e) => { close(); openMicMenu(document.getElementById('btnMic')); });
}

// === Choix du micro ===
function updateMicButton() {
    const btn = document.getElementById('btnMic');
    if (!btn) return;
    const label = PulseAudio.getMicLabel();
    btn.dataset.tooltip = label ? `Micro : ${label}` : 'Choisir le micro';
    btn.classList.toggle('active', !!label);
}

async function openMicMenu(anchor) {
    if (state.recording) { flash('Arrête la prise (R) avant de changer de micro'); return; }
    closeAllMenus();
    let inputs = [];
    try {
        // Les noms des micros ne sont visibles qu'une fois l'accès autorisé
        await PulseAudio.resumeIfNeeded();
        await PulseAudio.requestMic();
        inputs = await PulseAudio.listInputs();
    } catch (err) {
        flash(micErrorMessage(err));
        return;
    }
    updateMicButton();
    if (!inputs.length) { flash('🎙 Aucun micro détecté — branche ton micro ou ta carte son'); return; }
    const current = PulseAudio.getMicDeviceId();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu mic-menu';
    const rect = anchor.getBoundingClientRect();
    menu.style.cssText = `position:fixed;top:${rect.bottom + 8}px;right:${Math.max(8, window.innerWidth - rect.right)}px;z-index:200`;
    menu.innerHTML = `<div class="ctx-title">Avec quoi tu enregistres ?</div>` + inputs.map((d, i) =>
        `<div class="ctx-item${d.deviceId === current ? ' is-current' : ''}" data-id="${esc(d.deviceId)}">${d.deviceId === current ? '✓ ' : ''}${esc(d.label || `Micro ${i + 1}`)}</div>`
    ).join('');
    menu.insertAdjacentHTML('beforeend', `<div class="ctx-sep"></div><div class="ctx-mode" data-calib="1">⏱ Caler ma voix sur l'instru (réglage auto, 3 s)</div>`);
    menu.querySelector('[data-calib]').addEventListener('mousedown', (e) => e.stopPropagation());
    menu.querySelector('[data-calib]').addEventListener('click', () => { closeAllMenus(); runLatencyCalibration(); });
    menu.querySelectorAll('.ctx-item').forEach(el => {
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('click', async () => {
            closeAllMenus();
            if (!PulseAudio.setInputDevice(el.dataset.id)) return;
            try {
                await PulseAudio.requestMic();
                flash(`🎙 Micro : ${PulseAudio.getMicLabel() || 'sélectionné'}`);
            } catch (err) { flash(micErrorMessage(err)); }
            updateMicButton();
        });
    });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
}

// Message d'aide selon la raison pour laquelle le micro ne répond pas
function micErrorMessage(err) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError')
        return window.__TAURI__
            ? '🎙 Micro bloqué — ouvre Réglages Système › Confidentialité et sécurité › Microphone, autorise Pulse, puis relance Pulse'
            : '🎙 Micro bloqué — clique sur le cadenas à gauche de l\'adresse, autorise le micro, puis réappuie sur R';
    if (n === 'NotFoundError' || n === 'OverconstrainedError')
        return '🎙 Aucun micro détecté — branche ton micro ou ta carte son, puis réappuie sur R';
    if (n === 'NotReadableError')
        return '🎙 Micro déjà utilisé par une autre app — ferme-la (Zoom, Discord…) puis réappuie sur R';
    if (n === 'InsecureContextError')
        return '🎙 Le micro ne marche qu\'en https ou sur localhost — ouvre Pulse depuis son adresse normale';
    return '🎙 Micro indisponible — vérifie qu\'il est branché et autorisé, puis réappuie sur R';
}

function removeLivingClip() {
    const lc = state._livingClip;
    if (!lc) return;
    const t = state.project.tracks[lc.trackIdx];
    if (t && t.clips) t.clips = t.clips.filter(c => c !== lc.clip);
    state._livingClip = null;
    renderTimelineTracks();
}

async function toggleRec() {
    // Si on est déjà en train d'enregistrer → stop
    if (state.recording) {
        punchOut();
        return;
    }
    // R pendant le décompte → on annule proprement
    if (state._recStarting) {
        if (PulseAudio.isCountingIn()) { PulseAudio.stopCountIn(); flash('Décompte annulé'); }
        return;
    }

    // Piste cible : d'abord Capture Lane, sinon première armée
    let targetIdx = recTargetIdx();

    // Rien d'armé : on arme toute seule une piste vide (celle choisie, sinon la 1re) pour la voix,
    // sans jamais enregistrer par-dessus un instru ; s'il n'y en a pas, on en crée une
    if (targetIdx < 0) {
        const tracks = state.project.tracks;
        const ok = (i) => { const t = tracks[i]; return t && (!t.type || t.type === 'audio') && t.preset !== 'instru' && !(t.clips || []).some(c => !c.recording); };
        const capIdx = tracks.findIndex(t => t.isCapture);
        let pick = capIdx >= 0 ? capIdx : (ok(state.selectedTrack) ? state.selectedTrack : tracks.findIndex((t, i) => ok(i)));
        if (pick < 0) {
            pushUndo();
            tracks.push({ name: 'Voix', type: 'audio', color: TYPE_COLORS.audio, clips: [], volume: 100, output: 'master' });
            pick = tracks.length - 1;
        }
        armTrackExclusive(pick);
        targetIdx = pick;
        state.selectedTrack = pick;
        renderAll();
        saveProject();
    }

    state._recStarting = true;
    try {
        await startActualRecording(targetIdx);
    } catch (err) {
        console.error(err);
        flash(micErrorMessage(err));
        abortCapture();
    } finally {
        state._recStarting = false;
    }
}

// === Enregistrement façon Logic : le micro capte TOUT le passage (de Espace à Pause) ===
// R pose l'entrée, R pose la sortie, la lecture continue. À la pause, chaque prise devient un clip
// découpé dans cette capture : on peut donc étirer ses bords pour récupérer ce qu'il y avait
// avant l'entrée et après la sortie.
// state._cap = { id, trackIdx, regions: [{ clip, in, out }] }
// Une seule piste prête à enregistrer à la fois : armer celle-ci désarme les autres (y compris la piste Rec du modèle)
function armTrackExclusive(idx) {
    if (state.project.tracks[idx] && state.project.tracks[idx].locked) { flash('🔒 Piste verrouillée : déverrouille-la pour enregistrer dessus'); return; }
    state.project.tracks.forEach((t, k) => { t.armed = (k === idx); });
}
function recTargetIdx() {
    const captureIdx = state.project.tracks.findIndex(t => t.isCapture);
    // La piste armée (une seule à la fois) ; à défaut, la piste Rec du modèle
    const armedIdx = state.project.tracks.findIndex(t => t.armed);
    return armedIdx >= 0 ? armedIdx : -1;
}

async function beginCapture(targetIdx, startSec) {
    state._cap = { id: `rec_${Date.now().toString(36)}`, trackIdx: targetIdx, regions: [] };
    // l'entrée de la carte son choisie pour cette piste (sinon la première)
    const tgt = state.project.tracks[targetIdx];
    PulseAudio.setMicChannel((tgt && tgt.inputChannel) || 1);
    await PulseAudio.startRecording(targetIdx, startSec, {});
}

// Lecture lancée avec une piste prête à enregistrer et un micro déjà autorisé : on capte en arrière-plan,
// pour pouvoir récupérer ce qui a été dit avant d'appuyer sur R.
async function maybeStartBgCapture() {
    if (localStorage.getItem('pulse_bg_capture') === '0') return;
    if (state._cap || state.recording || state._recStarting) return;
    const targetIdx = recTargetIdx();
    if (targetIdx < 0) return;
    if (!PulseAudio.hasMic()) {
        try {
            const st = await navigator.permissions.query({ name: 'microphone' });
            if (st.state !== 'granted') return;
        } catch { return; }
    }
    if (!state.playing || state._cap || state.recording || state._recStarting) return;
    try {
        await beginCapture(targetIdx, PulseAudio.getPlaybackPosition());
        updateMicButton();
    } catch (err) { console.warn('Capture arrière-plan impossible', err); state._cap = null; return; }
    if (!state.playing) finalizeCapture();
}

// Enregistrement en boucle (Réglages, allumé par défaut) : avec une boucle allumée, la prise continue à chaque tour
function loopRecOn() { try { return localStorage.getItem('pulse_loop_rec') !== '0'; } catch { return true; } }
function punchIn(inSec, zoneEnd = null) {
    const cap = state._cap;
    const t = state.project.tracks[cap.trackIdx];
    const livingClip = { id: cap.id, name: '●REC', start: inSec, duration: 0.05, recording: true };
    t.clips = t.clips || [];
    t.clips.push(livingClip);
    const lin = PulseAudio.getRecLinearPosition ? PulseAudio.getRecLinearPosition() - (state.playing ? PulseAudio.getPlaybackPosition() : inSec) + inSec : inSec;
    cap.regions.push({ clip: livingClip, in: inSec, inLin: lin, out: null });
    state._livingClip = { trackIdx: cap.trackIdx, clip: livingClip };
    state.recording = true;
    document.getElementById('btnRec').classList.add('active');
    renderTimelineTracks();
    // Comme dans Logic : l'ancienne prise se tait là où on la refait
    if (recMode() === 'takes') PulseAudio.muteTrackBetween(cap.trackIdx, inSec, zoneEnd);
}

// Ferme la prise en cours à la position actuelle (sans arrêter ni la lecture ni la capture)
function closeOpenRegion() {
    const cap = state._cap;
    const lc = state._livingClip && state._livingClip.clip;
    state.recording = false;
    state._livingClip = null;
    document.getElementById('btnRec').classList.remove('active');
    hideRecLevelHint();
    if (!cap || !lc) return null;
    const region = cap.regions.find(r => r.clip === lc);
    if (!region) return null;
    let out = state.playing ? PulseAudio.getPlaybackPosition() : state.playhead;
    if (state._punch) out = Math.min(out, state._punch.end);
    region.out = out;
    if (PulseAudio.getRecWraps && state.loop) {
        const outLin = PulseAudio.getRecLinearPosition();
        const wraps = PulseAudio.getRecWraps().filter(w => w > region.inLin + 1e-3 && w < outLin - 1e-3);
        if (wraps.length) { region.outLin = outLin; region.wraps = wraps; region.loop = { a: Math.min(state.loop.start, state.loop.end), b: Math.max(state.loop.start, state.loop.end) }; }
    }
    lc.duration = Math.max(0.01, out - (region.wraps ? lc.start : region.in));
    lc.pending = true;
    const owner = state.project.tracks.find(tr => (tr.clips || []).includes(lc));
    lc.name = (owner && owner.name) || 'Voix';
    return region;
}

// « Refaire cette prise » : le curseur revient au début de la prise ratée et l'enregistrement repart ;
// l'ancienne prise est rangée juste dessous (rien n'est perdu)
function redoTake(trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx], c = t && t.clips[clipIdx];
    if (!c) return;
    if (state.recording || state._recStarting) { flash('Arrête d\'abord l\'enregistrement en cours (Espace)'); return; }
    if (state.playing) togglePlay();
    if (!t.armed) { armTrackExclusive(trackIdx); }
    seekPlayhead(c.start);
    flash('🎙 On la refait : l\'ancienne prise est rangée juste dessous');
    setTimeout(() => toggleRec(), 150);
}

// R pendant le rec : on sort de la prise, la lecture continue
function punchOut() {
    const region = closeOpenRegion();
    PulseAudio.refreshAudibility(state.project);
    renderTimelineTracks();
    if (region) flash('✓ Prise posée — appuie sur Espace pour l\'écouter');
}

function abortCapture() {
    const cap = state._cap;
    state._cap = null; state._punch = null;
    state.recording = false; state._livingClip = null;
    document.getElementById('btnRec').classList.remove('active', 'is-counting');
    if (!cap) return;
    if (PulseAudio.isCapturing()) PulseAudio.stopRecording().catch(() => {});
    const t = state.project.tracks[cap.trackIdx];
    if (t) t.clips = (t.clips || []).filter(c => !cap.regions.some(r => r.clip === c));
    renderTimelineTracks();
}

async function startActualRecording(targetIdx) {
    const t = state.project.tracks[targetIdx];

    // Une capture tourne déjà sur cette piste (lecture en cours) → R = entrée immédiate, rien d'autre à faire
    if (state.playing && state._cap && state._cap.trackIdx === targetIdx) {
        punchIn(PulseAudio.getPlaybackPosition());
        flash(`🔴 Rec sur « ${t.name} » — R pour sortir, la lecture continue`);
        return;
    }
    if (state._cap) await finalizeCapture();

    let startSec = state.playhead;
    const wasPlaying = state.playing;

    // Punch-in : une plage est sélectionnée (Shift+glisser) → on n'enregistre QUE dedans,
    // avec 2 mesures d'élan avant pour se caler (ça remplace le décompte).
    let punch = null;
    if (!state.playing && state.selection && Math.abs(state.selection.end - state.selection.start) > 0.2) {
        const a = Math.min(state.selection.start, state.selection.end);
        const b = Math.max(state.selection.start, state.selection.end);
        const pre = Math.min(a, a - secAtBeat(Math.max(0, beatAtSec(a) - 8)));
        punch = { start: a, end: b, preStart: a - pre, pre };
        state.playhead = punch.preStart;
        startSec = punch.preStart;
        updatePlayhead(); updateChrono();
    }
    state._punch = punch;

    // Micro demandé AVANT le décompte : sinon la fenêtre d'autorisation casse le timing.
    // Si l'autorisation tarde, on dit à l'utilisateur où regarder.
    const micHint = setTimeout(() => flash('🎙 Autorise le micro dans la petite fenêtre du navigateur (en haut à gauche) pour enregistrer'), 1200);
    try {
        await PulseAudio.resumeIfNeeded();
        await PulseAudio.requestMic();
    } finally {
        clearTimeout(micHint);
    }
    const recGroup = trackGroup(t);
    if (recGroup && recGroup.collapsed) { recGroup.collapsed = false; renderTracksPanel(); bindTrackEvents(); }
    if (PulseAudio.consumeMicFallback()) flash('🎙 Ton micro habituel est débranché — j\'utilise le micro par défaut');
    updateMicButton();

    // Count-in : UNIQUEMENT si on n'est pas déjà en lecture (R depuis stop)
    if (PulseAudio.isCountInEnabled() && !state.playing && !punch) {
        flash('Décompte : 1 · 2 · 3 · 4… (R pour annuler)');
        const recBtn = document.getElementById('btnRec');
        recBtn.classList.add('is-counting');
        const stopOverlay = showCountOverlay(bpmAtSec(startSec), bpbAtSec(startSec));
        const ok = await PulseAudio.playCountIn(bpmAtSec(startSec), bpbAtSec(startSec));
        stopOverlay();
        recBtn.classList.remove('is-counting');
        if (!ok) { state._punch = null; return; }
        startSec = state.playhead; // le décompte ne déplace pas le curseur
    }

    await beginCapture(targetIdx, startSec);
    if (!state.playing) await togglePlay(true);
    punchIn(punch ? punch.start : (wasPlaying ? PulseAudio.getPlaybackPosition() : startSec), punch ? punch.end : null);
    flash(punch ? `🔴 Ça enregistre sur « ${t.name} », seulement dans la zone sélectionnée`
                : `🔴 Rec sur « ${t.name} » — R pour sortir (la lecture continue), Espace pour tout arrêter`);
}

// Grand 1 · 2 · 3 · 4 au centre de l'écran pendant le décompte : on sait exactement quand chanter
function showCountOverlay(bpm, beats) {
    const el = document.createElement('div');
    el.id = 'countOverlay';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    const beatMs = 60000 / bpm, timers = [];
    for (let i = 0; i < beats; i++) {
        timers.push(setTimeout(() => {
            el.textContent = String(i + 1);
            el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        }, 60 + i * beatMs));
    }
    return () => { timers.forEach(clearTimeout); el.remove(); };
}

// Fin du passage (pause, fin du projet…) : la capture devient de vrais clips
async function finalizeCapture() {
    state._finalizing = true;
    try { return await _finalizeCapture(); } finally { state._finalizing = false; }
}
async function _finalizeCapture() {
    const cap = state._cap;
    if (!cap) return;
    if (state.recording) closeOpenRegion();
    state._cap = null;
    const punch = state._punch;
    state._punch = null;
    PulseAudio.refreshAudibility(state.project);

    const result = await PulseAudio.stopRecording();
    const t = state.project.tracks[cap.trackIdx];
    if (!t) return;
    const regions = cap.regions.filter(r => r.out !== null && t.clips.includes(r.clip));
    if (!regions.length) return; // simple écoute, aucune prise posée : on ne garde rien

    const dropAll = (msg) => {
        t.clips = t.clips.filter(c => !regions.some(r => r.clip === c));
        rerenderTracks();
        flash(msg);
    };
    if (!result || !result.audioBuffer) {
        dropAll('Prise trop courte ou vide — réappuie sur R et laisse tourner au moins une seconde');
        return;
    }

    const { audioBuffer } = result;
    const capStart = result.startSec, capEnd = result.startSec + result.duration;
    // ⌘Z après une prise ratée = elle disparaît (et l'ancienne revient devant)
    const pendingClips = t.clips.filter(c => c.recording);
    t.clips = t.clips.filter(c => !c.recording);
    pushUndo();
    t.clips.push(...pendingClips);
    PulseAudio.registerBuffer(cap.id, audioBuffer);
    const peaks = makePeaks(audioBuffer);
    const done = [];
    let aside = 0;
    for (const r of regions) {
        const clip = r.clip;
        if (r.wraps && r.wraps.length) {
            // Prise en boucle : un morceau par tour, sur le temps continu de la capture. Le dernier tour passe devant, les autres sont rangés derrière (A, B, C…)
            const segs = []; let x0 = r.inLin;
            r.wraps.forEach(w => { segs.push([x0, w]); x0 = w; });
            segs.push([x0, r.outLin]);
            const passes = segs.map(([u, v], j) => {
                const s0 = Math.max(u, capStart), s1 = Math.min(v, capEnd);
                return { start: j ? r.loop.a + (s0 - u) : r.in + (s0 - r.inLin), dur: s1 - s0, off: s0 - capStart };
            }).filter(p => p.dur >= 0.05);
            if (!passes.length) { t.clips = t.clips.filter(c => c !== clip); continue; }
            ensureTakeNumbers(t, clip);
            const nums = passes.map(() => ++t.takeSeq);
            // devant : le dernier tour COMPLET (si on a arrêté au milieu d'un tour, ce bout reste rangé derrière avec sa lettre)
            const L = r.loop.b - r.loop.a, isFull = (p) => p.dur >= 0.9 * L;
            let fi = passes.length - 1;
            if (!isFull(passes[fi])) { for (let k = fi - 1; k >= 0; k--) if (isFull(passes[k])) { fi = k; break; } }
            const last = passes[fi];
            Object.assign(clip, { start: last.start, offset: last.off, duration: last.dur, peaks, take: nums[fi], name: t.name || 'Voix' });
            delete clip.recording; delete clip.pending;
            if (recMode() === 'takes') {
                const n = setAsideRange(t, r.loop.a, r.loop.b, clip, true);
                if (n > 0) { clip.fadeIn = TAKE_XFADE; clip.fadeOut = TAKE_XFADE; aside += n; }
            }
            t.takes = t.takes || [];
            passes.forEach((p, k) => { if (k === fi) return; t.takes.push({ id: cap.id, name: t.name || 'Voix', start: p.start, duration: p.dur, offset: p.off, peaks, take: nums[k] }); aside++; });
            done.push(clip);
            continue;
        }
        const a = Math.max(r.in, capStart), b = Math.min(r.out, capEnd);
        if (b - a < 0.05) { t.clips = t.clips.filter(c => c !== clip); continue; }
        clip.start = a;
        clip.offset = a - capStart;   // tout ce qui précède reste récupérable en étirant le bord gauche
        clip.duration = b - a;
        clip.peaks = peaks;
        delete clip.recording; delete clip.pending;
        ensureTakeNumbers(t, clip);
        clip.take = ++t.takeSeq;
        clip.name = t.name || 'Voix';   // comme Logic : la région porte le nom de la piste (la lettre de prise reste dans la zone des prises)
        if (recMode() === 'takes') {
            const n = setAsideRange(t, a, b, clip, true);
            if (n > 0) { clip.fadeIn = TAKE_XFADE; clip.fadeOut = TAKE_XFADE; aside += n; }
        }
        done.push(clip);
    }
    if (!done.length) {
        rerenderTracks();
        flash(punch ? 'Arrêté avant la zone sélectionnée — rien n\'a été enregistré'
                    : 'Prise trop courte — laisse tourner au moins une seconde entre les deux R');
        return;
    }
    if (aside > 0 && !t._takesSeen) { t.takesOpen = true; t._takesSeen = true; }
    try {
        await PulsePersist.saveBlob(cap.id, PulseAudio.audioBufferToWav(audioBuffer), { kind: 'rec' });
    } catch (e) {
        console.warn('Persist rec failed', e);
        flash('⚠ Prise gardée en mémoire mais pas sauvegardée (stockage plein) — exporte ton projet en .pulse');
    }
    rerenderTracks();
    saveProject();

    const last = done[done.length - 1];
    const name = done.length > 1 ? `${done.length} prises enregistrées` : `Prise ${takeLetter(last.take)} enregistrée`;
    if (t.autotune && t.autotune.on) {   // Auto-Tune de piste : la nouvelle prise est corrigée toute seule
        const ti = state.project.tracks.indexOf(t);
        setTimeout(() => tuneWholeTrack(ti, done.filter(c => !c.midi), true), 300);
    }
    if (aside > 0) {
        flash(`✓ ${name} — l'ancienne est rangée juste dessous, clique dessus pour la reprendre`);
        if (!compingOn()) tipOnce('pulse_tip_comping', 'Astuce : pour garder le meilleur passage de chaque prise, active « Comping » dans les Réglages', 4500);
    }
    else if (!localStorage.getItem('pulse_tip_stretch')) {
        localStorage.setItem('pulse_tip_stretch', '1');
        flash(`✓ ${name} — astuce : tire les bords du clip pour récupérer ce que tu as dit juste avant ou après`);
    } else flash(`✓ ${name}`);
    if (!localStorage.getItem('pulse_tip_headphones')) {
        localStorage.setItem('pulse_tip_headphones', '1');
        setTimeout(() => flash('🎧 Astuce : enregistre avec un casque, sinon l\'instru des enceintes repasse dans ton micro'), 3200);
    }
}

function tick() {
    if (!state.playing) return;
    const audioPos = window.PulseAudio ? PulseAudio.getPlaybackPosition() : null;
    state.playhead = (audioPos !== null && audioPos > 0 && !state._seekPending)
        ? audioPos
        : (performance.now() - state.startTime) / 1000;

    // Punch-in : arrêt automatique à la fin de la zone, retour au début de l'élan
    if (state.recording && state._punch && state.playhead >= state._punch.end + 0.12) {
        if (!state._punchStopping) {
            state._punchStopping = true;
            const back = state._punch.preStart;
            togglePlay().then(() => {
                state.playhead = back;
                updatePlayhead(); updateChrono();
                state._punchStopping = false;
            });
        }
        return;
    }

    // Loop region : si on dépasse end, on revient à start
    // Guard !state.recording : on ne coupe pas un enregistrement en cours
    // le moteur prépare lui-même le tour suivant (boucle sans trou) ; s'il n'a pas pu (boucle trop courte, changée au dernier moment), on saute avec un fondu
    // pendant une prise : enregistrement en boucle (chaque tour devient une prise A, B, C… à l'arrêt) ; écoute seule avec capture de fond : comme avant
    const loopRec = state.recording && loopRecOn();
    if (PulseAudio.setLoop) PulseAudio.setLoop(state.looping && state.loop && (state.recording ? loopRec : !state._cap) ? state.loop : null);
    if (state.looping && state.loop && (!state.recording || loopRec)) {
        const loopEnd = Math.max(state.loop.start, state.loop.end);
        const loopStart = Math.min(state.loop.start, state.loop.end);
        if (state.playhead >= loopEnd) {
            const engineLoops = PulseAudio.loopScheduled && PulseAudio.loopScheduled();
            if (state.recording && !engineLoops) { /* boucle trop courte pour tourner pendant la prise : on continue tout droit */ }
            else {
            state.playhead = loopStart;
            state.startTime = performance.now() - loopStart * 1000;
            if (state.recording && state._livingClip) { state._livingClip.clip.start = loopStart; renderTimelineTracks(); }   // le clip rouge repart du début de boucle
            if (state._cap && !state.recording) finalizeCapture();
            if (!engineLoops) PulseAudio.play(state.project, loopStart, { smooth: true, jump: true });   // le tour de boucle se fond (plus de coupure nette) ; hors lecture, play() coupe comme avant
            if (state.metronome) PulseAudio.startMetronome(state.project.bpm, loopStart, state.project);
            updatePlayhead();
            updateChrono();
            requestAnimationFrame(tick);
            return;
            }
        }
    } else if (!state.recording && !(state._cap && state._cap.regions.length)) {
        // Comme Logic : la lecture ne s'arrête plus toute seule à la fin des régions (on garde un blanc pour poser une idée) ; c'est Espace qui arrête.
        // Seule sécurité : 10 minutes après la dernière région, on arrête pour ne pas laisser tourner un morceau oublié.
        const end = computeProjectEndSec();
        if (end > 0 && state.playhead > end + 600) {
            togglePlay();
            flash('Lecture arrêtée : plus rien à écouter depuis 10 minutes');
            return;
        }
    }

    updatePlayhead();
    updateChrono();
    // Le clip rouge suit le curseur pendant la prise
    if (state.recording && state._livingClip) {
        const lc = state._livingClip.clip;
        const limit = state._punch ? state._punch.end : Infinity;
        const elapsed = Math.max(0.05, Math.min(limit, state.playhead) - lc.start);
        lc.duration = elapsed;
        const clipEl = document.querySelector('.clip.is-recording:not(.is-pending)');
        if (clipEl) {
            clipEl.style.width = (elapsed * state.pxPerSecond) + 'px';
            const nameEl = clipEl.querySelector('.clip-name');
            if (nameEl) nameEl.textContent = '⏺ ' + secondsToDuration(elapsed);
            if (state.playhead >= lc.start) drawLiveRecWave(clipEl, elapsed);
        }
    }
    requestAnimationFrame(tick);
}

// Le curseur couvre toute la hauteur du contenu (et pas seulement la partie visible au chargement)
function syncPlayheadHeight() {
    const tl = document.querySelector('.timeline'), ph = document.getElementById('playhead');
    if (!tl || !ph) return;
    ph.style.bottom = 'auto';
    ph.style.height = Math.max(tl.clientHeight, tl.scrollHeight) + 'px';
}

// Petite marque au point de départ : c'est là que le curseur reviendra à l'arrêt
function updatePlayOrigin() {
    const ph = document.getElementById('playhead');
    if (!ph || !ph.parentElement) return;
    let m = document.getElementById('playOrigin');
    const show = (state.playing || (state.paused && Math.abs(state.paused.pos - state.playhead) < 0.02)) && !state.recording && state.playOrigin != null && returnOnStop()
        && Math.abs(state.playOrigin - state.playhead) > 0.05;
    if (!show) { if (m) m.style.display = 'none'; return; }
    if (!m) {
        m = document.createElement('div');
        m.id = 'playOrigin'; m.className = 'play-origin';
        m.setAttribute('data-tooltip', 'Point de départ : le curseur y revient quand tu arrêtes');
        ph.parentElement.appendChild(m);
    }
    m.style.display = 'block';
    m.style.left = `${state.playOrigin * state.pxPerSecond}px`;
}
function updatePlayhead() {
    const ph = document.getElementById('playhead');
    const x = state.playhead * state.pxPerSecond;
    ph.style.left = `${x}px`;
    ph.style.transform = '';
    updatePlayOrigin();
    if (window.lyricsFollowOn && window.lyricsFollowOn() && window.updateLyricsFollow) window.updateLyricsFollow();
    // Auto-scroll : le curseur reste visible pendant lecture et rec (sauf si tu as zoomé / défilé toi-même)
    if ((state.playing || state.recording) && !state.followOff) {
        const timeline = document.querySelector('.timeline');
        if (timeline) {
            const margin = 100;
            const right = timeline.scrollLeft + timeline.clientWidth;
            if (x > right - margin) {
                timeline.scrollLeft = x - margin;
            } else if (x < timeline.scrollLeft + 20) {
                timeline.scrollLeft = Math.max(0, x - 40);
            }
        }
    }
}

let _chronoEl = null;
let _chronoLast = '';
let _chronoMode = 'tc'; // 'tc' (mm:ss.cs) ou 'bars' (mesure:temps:tick)
function updateChrono() {
    if (!_chronoEl) _chronoEl = document.getElementById('chrono');
    if (!_chronoEl) return;
    if (state.project && (state.project.tempos || state.project.signatures)) syncBpmField();
    const t = Math.max(0, state.playhead);
    let txt;
    if (_chronoMode === 'bars') {
        let bar, beat, tick;
        if (tempoVaries()) {
            const pos = PulseTempo.beatsToBar(state.project, beatAtSec(t));
            bar = pos.bar + 1; beat = Math.floor(pos.beat + 1e-9) + 1; tick = Math.floor((pos.beat - (beat - 1)) * 96 + 1e-6);
        } else {
            const beatSec = 60 / state.project.bpm;
            const totalBeats = t / beatSec;
            bar  = Math.floor(totalBeats / bpb()) + 1;
            beat = Math.floor(totalBeats % bpb()) + 1;
            tick = Math.floor((totalBeats % 1) * 96); // 96 ticks/beat
        }
        txt = `${bar.toString().padStart(3,' ')} | ${beat} . ${tick.toString().padStart(2,'0')}`;
    } else {
        const min = Math.floor(t / 60);
        const sec = Math.floor(t % 60);
        const cs  = Math.floor((t % 1) * 100);
        txt = `${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}.${cs.toString().padStart(2,'0')}`;
    }
    if (txt !== _chronoLast) {
        _chronoEl.textContent = txt;
        _chronoLast = txt;
    }
}

// === Déplacer le curseur au clavier ===
// Point de départ (base du curseur) : posé par un clic dans la moitié BASSE d'une piste, dans la règle ou le vide ; retiré par un clic dans la moitié HAUTE.
// Sans base, la lecture reprend là où elle s'est arrêtée (Espace ne revient plus en arrière).
function clearPlayBase() {
    state.userBaseSec = null;
    if (state.baseCleared) return;
    const had = state.playOrigin != null;
    state.baseCleared = true; state.playOrigin = null;
    updatePlayOrigin();
    if (had) flash('Point de départ retiré : la lecture reprend là où elle s\'arrête. Clique dans la moitié basse d\'une piste pour en poser un.');
}
let _seekTimer = null;
function seekPlayhead(sec) {
    if (state.recording) { flash('Arrête l\'enregistrement avant de déplacer le curseur'); return; }
    state.playhead = Math.max(0, sec);
    state.baseCleared = false;
    state.userBaseSec = state.playhead;
    if (state.playing) state.playOrigin = state.playhead;
    updatePlayhead(); updateChrono();
    // Le curseur doit rester visible même à l'arrêt
    const tl = document.querySelector('.timeline');
    if (tl) {
        const x = state.playhead * state.pxPerSecond;
        if (x < tl.scrollLeft + 20) tl.scrollLeft = Math.max(0, x - 60);
        else if (x > tl.scrollLeft + tl.clientWidth - 60) tl.scrollLeft = x - tl.clientWidth + 120;
    }
    // En lecture : le son repart d'ici (une seule fois si on appuie plusieurs fois de suite)
    if (state.playing) {
        state.startTime = performance.now() - state.playhead * 1000;
        state._seekPending = true;   // le curseur suit l'horloge le temps que le son reparte d'ici
        clearTimeout(_seekTimer);
        _seekTimer = setTimeout(async () => {
            if (state.playing && !state.recording) {
                state.startTime = performance.now() - state.playhead * 1000;
                await PulseAudio.play(state.project, state.playhead, { smooth: true, jump: true });   // fondu de 20 ms : pas de « clac » au saut
                state.startTime = performance.now() - state.playhead * 1000;
            }
            state._seekPending = false;
        }, 90);
    }
}
// Un temps (ou une mesure) plus loin, calé sur la grille
function stepPlayhead(dir, unit) {
    seekPlayhead(stepGridSec(state.playhead, dir, unit));
}
// Pendant la lecture, ← / → déplacent le curseur de base (celui où l'on revient à l'arrêt) ; la lecture continue sans sauter
function stepPlayOrigin(dir, unit) {
    state.playOrigin = stepGridSec(state.playOrigin, dir, unit);
    updatePlayhead();
    flash(`Le curseur de base passe à ${secondsToDuration(state.playOrigin)} — la lecture continue`);
}
// Couper = copier puis effacer la région choisie (⌘X)
function cutSelectedClip() {
    if (!state.selectedClip && state.selectedClips.size === 0) { flash('Clique d\'abord sur une région pour la couper'); return; }
    if (state.recording) { flash('Une prise est en cours : arrête-la (Espace) avant de couper'); return; }
    if (state.selectedClip) copySelectedClip();
    deleteSelectedClip();
}
// Quitter : dans le logiciel on ferme la fenêtre ; dans un navigateur, c'est le navigateur qui décide
function quitApp() {
    const w = window.__TAURI__ && window.__TAURI__.window && window.__TAURI__.window.getCurrentWindow && window.__TAURI__.window.getCurrentWindow();
    if (w && w.close) { flushProjectDocSave(); saveProject(); _skipUnloadGuard = true; w.close(); return; }
    flash('Pour quitter, ferme l\'onglet (⌘W) — ⌘Q marche dans le logiciel installé');
}
// Début ou fin de clip précédent / suivant, toutes pistes confondues
function jumpToClipEdge(dir) {
    const edges = new Set([0]);
    state.project.tracks.forEach(t => (t.clips || []).forEach(c => {
        if (c.recording) return;
        edges.add(c.start); edges.add(c.start + c.duration);
    }));
    const list = [...edges].sort((a, b) => a - b);
    const ph = state.playhead;
    const target = dir > 0 ? list.find(x => x > ph + 0.005) : [...list].reverse().find(x => x < ph - 0.005);
    if (target === undefined) { flash(dir > 0 ? 'Plus rien après le curseur' : 'Tu es au début'); return; }
    seekPlayhead(target);
}

function rewind() {
    state.playhead = 0;
    state.startTime = performance.now();
    updatePlayhead();
    updateChrono();
}

// --- Mixer toggle ---
function toggleMixer() {
    state.mixerOpen = !state.mixerOpen;
    document.getElementById('mixer').classList.toggle('open', state.mixerOpen);
    document.getElementById('btnMixer').classList.toggle('active', state.mixerOpen);
}

// === Édition rapide (Q / S) ===
// Coupe tous les clips de la piste sélectionnée à hauteur du playhead.
// Q = garde la partie droite (supprime la gauche)
// S = garde la partie gauche (supprime la droite)
function trimLeft()  { trimAtPlayhead('left');  }
function trimRight() { trimAtPlayhead('right'); }

// Point de coupe : le curseur de base (point de départ posé) pendant la lecture, sinon la tête de lecture
function cutPointSec() {
    return (state.playing && !state.baseCleared && state.playOrigin != null) ? state.playOrigin : state.playhead;
}
function trimAtPlayhead(side) {
    const t = state.project.tracks[state.selectedTrack];
    if (!t) return;
    const ph = cutPointSec();
    const clips = t.clips || [];
    // un verrou (piste ou région touchée par la coupe) arrête tout : rien ne se coupe par accident
    const hit = clips.find(c => !c.recording && c.locked && (side === 'left' ? c.start < ph : clipEndOf(c) > ph));
    if (t.locked || hit) { clipIsLocked(hit || clips[0] || {}); if (t.locked) flash('🔒 Piste verrouillée : rien n\'a été coupé'); return; }
    let touched = 0;

    const snap = JSON.stringify(state.project);   // « Annuler » n'est enregistré que si quelque chose a vraiment été coupé
    t.clips = clips.flatMap(c => {
        const start = c.start;
        const end   = c.start + c.duration;
        // Playhead en dehors du clip → inchangé
        if (ph <= start || ph >= end) return [c];
        touched++;
        if (side === 'left') {
            // On garde la partie droite : nouveau start = playhead
            return [{ ...c, start: ph, duration: end - ph, offset: (c.offset || 0) + (ph - start), fadeIn: 0 }];
        } else {
            // On garde la partie gauche : nouvelle duration = playhead - start
            return [{ ...c, duration: ph - start, loopEnd: undefined, fadeOut: 0 }];
        }
    });

    if (touched > 0) {
        _undoStack.push(snap); if (_undoStack.length > _MAX_UNDO) _undoStack.shift(); _redoStack.length = 0; updateUndoBtn();
        renderTimelineTracks();
        saveProject();
        flash(side === 'left' ? '✂︎ Coupé à gauche' : 'Coupé à droite ✂︎');
    } else {
        flash('Rien à couper ici');
    }
}

// === Mute / Solo clavier ===
function toggleMute(trackIdx) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    t.muted = !t.muted;
    const btn = document.querySelector(`.track-item[data-i="${trackIdx}"] .m-m`);
    if (btn) btn.classList.toggle('active', t.muted);
    PulseAudio.refreshAudibility(state.project);
    saveProject();
}

// exclusiveMode = Ctrl+clic → solo exclusif (tous les autres coupés)
function toggleSolo(trackIdx, exclusiveMode = false) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    if (exclusiveMode) {
        // Solo exclusif : solo seulement cette piste, toutes les autres à false
        const wasSoloAlone = t.solo && state.project.tracks.every((tr, i) => i === trackIdx || !tr.solo);
        state.project.tracks.forEach((tr, i) => { tr.solo = !wasSoloAlone && i === trackIdx; });
        renderTracksPanel(); bindTrackEvents();
    } else {
        t.solo = !t.solo;
        const btn = document.querySelector(`.track-item[data-i="${trackIdx}"] .m-s`);
        if (btn) btn.classList.toggle('active', t.solo);
    }
    PulseAudio.refreshAudibility(state.project);
    saveProject();
}

function clearAllSolos() {
    state.project.tracks.forEach(t => t.solo = false);
    document.querySelectorAll('.track-item .m-s').forEach(btn => btn.classList.remove('active'));
    PulseAudio.refreshAudibility(state.project);
    saveProject();
    flash('Toutes les pistes s\'entendent à nouveau');
}

// === Sélection de piste ===
// Pistes choisies : la sélection multiple, ou seulement la piste active
// Un clic dans la timeline (vide ou règle) désélectionne la piste : plus de surbrillance, plus de sélection multiple
function deselectTracksByTimelineClick() {
    const had = state.selectedTracks.size > 0 || state.deselectedAt !== state.selectedTrack;
    state.selectedTracks = new Set(); state.deselectedAt = state.selectedTrack;
    if (had) { renderTracksPanel(); bindTrackEvents(); }
}
function selectedTrackIdxs() {
    const n = state.project.tracks.length;
    const set = new Set([...state.selectedTracks].filter(i => i >= 0 && i < n));
    set.add(state.selectedTrack);
    return [...set].sort((a, b) => a - b);
}

// Choisir une autre piste : un clip choisi sur une piste différente n'est plus « choisi » (sinon Suppr l'efface sans qu'on le voie)
function dropStaleClipSelection() {
    state.selectedBus = null;   // on a choisi une piste : l'inspecteur montre la piste, plus un groupe
    const sc = state.selectedClip;
    if (sc && sc.trackIdx !== state.selectedTrack) state.selectedClip = null;
    [...state.selectedClips].forEach(k => {
        if (parseInt(k) !== state.selectedTrack) state.selectedClips.delete(k);
    });
}

function selectTrack(idx) {
    state.deselectedAt = null;
    const max = state.project.tracks.length - 1;
    state.selectedTrack = Math.max(0, Math.min(max, idx));
    state.selectedTracks = new Set();
    dropStaleClipSelection();
    renderTracksPanel();
    bindTrackEvents();
}

// === Cheat sheet raccourcis (? ou bouton help) ===
const SHORTCUT_GROUPS = [
    {
        title: 'Transport',
        items: [
            ['Espace', 'Écouter · 1re fois = pause là où tu es · 2e fois = repart du point de départ (s\'il y en a un) · la lecture ne s\'arrête pas toute seule à la fin des régions'],
            ['R', 'Enregistrer — R à nouveau : sortir de la prise, la lecture continue'],
            ['Espace pendant l\'enregistrement', 'Tout arrêter'],
            ['Shift + glisser puis R', 'Enregistrer seulement dans la zone choisie'],
            ['Entrée (aussi celle du pavé numérique)', 'Retour au début'],
            ['L ou C', 'Répéter un passage en boucle (oui / non)'],
            ['U', 'Caler la boucle sur la région choisie (ou les régions choisies)'],
            ['Règle (haut) · glisser', 'Dessiner la boucle ; clic dessus = l\'allumer / l\'éteindre ; tirer un bord = l\'étirer ; tirer le milieu = la déplacer'],
            ['Règle (en dessous) · clic ou glisser', 'Placer le curseur'],
            ['⌘↵', 'Jouer depuis le début de la boucle'],
            ['K', 'Métronome'],
            ['T', 'Trouver le tempo en tapant le rythme (puis Espace)'],
            ['⌥M', 'Poser un marqueur au curseur'],
            ['⌥← / ⌥→', 'Marqueur précédent / suivant'],
            ['← / →', 'Curseur : un temps en arrière / en avant (pendant la lecture : déplace le curseur de base, la lecture continue)'],
            ['Shift + ← / →', 'Curseur : une mesure'],
            ['Tab / Maj + Tab', 'Curseur : bord de clip suivant / précédent'],
            ['Début / Fin', 'Curseur au début / à la fin du morceau']
        ]
    },
    {
        title: 'Édition rapide',
        items: [
            ['D', 'Effacer ce qui est à gauche du curseur de base (sur la piste choisie)'],
            ['F', 'Effacer ce qui est à droite du curseur de base'],
            ['⌘X', 'Couper la région : la copier et l\'effacer d\'un coup (⌘V la recolle)'],
            ['B', 'Ciseaux : scinder une région là où tu cliques'],
            ['Y', 'Menu des outils (Pointeur, Crayon, Gomme…) sous la souris'],
            ['Double-clic sur une région', 'La scinder : garde le 2e clic enfoncé, glisse pour choisir l\'endroit, relâche pour couper (Échap annule) — sur son nom : la renommer'],
            ['⌘C', 'Copier la région choisie'],
            ['⌘V', 'Coller à la position du curseur'],
            ['⌘R', 'Répéter la région choisie une fois de plus, juste après (autant de fois que tu appuies)'],
            ['⌘Z / ⌘⇧Z', 'Annuler / Rétablir (30 niveaux) — marche aussi sur une prise ratée'],
            ['Tirer le bord d\'une prise', 'Récupérer ce qui a été dit avant ou après (curseur « barre et flèches » = étirer la région ; curseur « courbe » = fondu, dans le coin du haut)'],
            ['⌘ + clic sur une région', 'La muter / la démuter (réglable)'],
            ['Clic droit + glisser sur une région', 'Volume de la région : vers le haut = plus fort (⌥ + clic droit : remet 0 dB ; un clic sans bouger = menu)'],
            ['⌘← / ⌘→', 'Décaler la région choisie d\'un cran'],
            ['⌘⇧← / ⌘⇧→', 'Décaler la région très finement'],
            ['Shift (en tenant un clip)', 'Verrou d\'axe : surtout vers le bas = tu changes de piste sans bouger dans le temps ; surtout de côté = tu restes sur la piste · Shift de nouveau = libère'],
            ['Clic dans la moitié BASSE d\'une piste', 'Place le curseur et le point de départ (curseur en croix)'],
            ['Clic dans la moitié HAUTE d\'une piste', 'Choisit la région et retire le point de départ : Espace reprend là où la lecture s\'est arrêtée (flèche)'],
            ['⌘A · ⌥⌘A', 'Choisir toutes les régions de toutes les pistes · seulement celles de la piste choisie'],
            ['Plage glissée sur plusieurs pistes', 'Les régions touchées sont choisies : elles se déplacent ensemble (même vers une autre piste), ⌘X les coupe, clic droit pour leur volume'],
            ['⌥C', 'Panneau de couleurs (régions choisies, sinon pistes choisies)'],
            ['⌥T', 'Piste de tempo : le tempo et la signature changent en cours de morceau'],
            ['⌘G', 'Aimant : Libre ↔ Intelligent (les régions et le curseur se calent sur le rythme et sur le bord des régions)'],
            ['⌘ + glisser une région', 'La placer librement, sans aimant'],
            ['Shift + glisser', 'Choisir un passage (Shift + clic : en ajouter / en retirer)'],
            ['Suppr / ⌫', 'Effacer le clip ou la plage sélectionnée'],
            ['Alt + glisser une région', 'La dupliquer'],
            ['Échap', 'Annuler sélection / effacer la boucle']
        ]
    },
    {
        title: 'Pistes',
        items: [
            ['M', 'Couper le son de la piste choisie'],
            ['S (ou ⌥S)', 'N\'écouter que la piste choisie'],
            ['⌘⇧S', 'Tout réécouter (annule les « seulement celle-ci »)'],
            ['⌘⇧T', 'Nouvelle piste audio'],
            ['⌘S · ⌘⌥S · ⌘Q', 'Sauvegarder (dans l\'appli : choisir le dossier la 1re fois) · Enregistrer sous… · Quitter'],
            ['⌘ ou ⌥ + clic sur un réglage', 'Le remettre à sa valeur d\'origine · double-clic = écrire la valeur (dB, g15 / -15, 0-100)'],
            ['⌥ + molette', 'Hauteur des pistes : sur la liste de gauche, celle qu\'on survole (les pistes choisies si elles sont plusieurs) · sur la timeline, toutes les pistes · ⌘ + molette = zoom, le curseur au milieu de l\'écran'],
            ['Croix × sur un effet · clic droit', 'Supprimer l\'effet de la piste (+ Effet pour en ajouter, Auto-Tune compris)'],
            ['⌘D', 'Dupliquer la piste (sans clips)'],
            ['⌘⌫', 'Supprimer la piste sélectionnée'],
            ['↑ / ↓', 'Changer de piste'],
                        ['A', 'Courbes de volume (poser des points sur la piste)']
        ]
    },
    {
        title: 'Vue',
        items: [
            ['⌘ + scroll', 'Zoomer autour du pointeur'],
            ['⌥ + scroll', 'Sur la liste de gauche : seule la piste survolée grandit / rétrécit · sur la timeline : toutes les pistes'],
            ['Maj + molette', 'Défiler la timeline de gauche à droite (Magic Mouse / trackpad : glisser latéralement)'],
                        ['E / Z', 'Zoomer / dézoomer : le curseur (de base si tu as cliqué) se met au milieu de l\'écran'],
            ['F', 'Zoom sur le clip sélectionné (ou tout le projet)'],
            ['⌘⇧F', 'Voir tout le morceau'],
            ['⌘A', 'Sélectionner tous les clips de la piste'],
            ['X', 'Ouvrir / fermer le mixeur']
        ]
    },
    {
        title: 'Fichier',
        items: [
            ['⌘S', 'Sauvegarder (dans l\'appli : choisir le dossier la 1re fois)'],
            ['⌘⌥S', 'Enregistrer sous… (autre dossier)'],
            ['⌘E', 'Exporter'],
            ['⌘N', 'Nouveau projet']
        ]
    },
    {
        title: 'Notes (piano, batterie)',
        items: [
            ['Double-clic dans le vide', 'Créer une région sur une piste instrument ou batterie'],
            ['Double-clic sur la région', 'Ouvrir l\'éditeur de notes'],
            ['Clic · glisser', 'Poser une note · la déplacer (bord droit = l\'étirer)'],
            ['Double-clic · clic droit', 'Effacer la note'],
            ['1 · 2 · 3 · 4', 'Outils : Crayon (poser) · Pointeur (choisir, double-clic = poser) · Gomme (effacer en glissant) · Ciseaux (couper une note en deux)'],
            ['Q', 'Caler les notes choisies sur la grille (toutes si rien n\'est choisi)'],
            ['Règle de l\'éditeur', 'Clic = placer le curseur · double-clic = écouter d\'ici · bande du haut = la boucle du projet'],
            ['Touches du clavier foncées', 'Notes hors de la gamme choisie ; la note de départ est en violet'],
            ['⌘ / Maj + glisser', 'Sélectionner plusieurs notes'],
            ['← → ↑ ↓', 'Déplacer la sélection (Maj = mesure / octave)'],
            ['⌘D · ⌘A · ⌘Z', 'Dupliquer · tout choisir · annuler'],
            ['Rangée du milieu / du dessus', 'Jouer les notes comme un piano — milieu = blanches, dessus = noires (rangée du bas : octave − / +)'],
            ['● Jouer en direct', 'Enregistre ce que tu joues pendant la lecture (clavier MIDI USB aussi)'],
            ['Échap', 'Fermer l\'éditeur']
        ]
    }
];

function openCheatSheet() {
    const existing = document.getElementById('cheatModal');
    if (existing) { closeCheatSheet(); return; }

    const modal = document.createElement('div');
    modal.id = 'cheatModal';
    modal.className = 'modal-backdrop cheat';
    modal.innerHTML = `
        <div class="modal cheat-modal">
            <button class="modal-close" id="cheatClose" aria-label="Fermer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h2 class="modal-title">Raccourcis</h2>
            <p class="modal-sub">Les gestes utiles, regroupés. Tu n'as pas besoin de tous les connaître.</p>
            <div class="cheat-groups">
                ${SHORTCUT_GROUPS.map(g => `
                    <div class="cheat-group">
                        <h4>${g.title}</h4>
                        <ul>
                            ${g.items.map(([k, v]) => `<li><kbd>${k}</kbd><span>${v}</span></li>`).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('visible'));

    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('#cheatClose')) closeCheatSheet();
    });
}

function closeCheatSheet() {
    const modal = document.getElementById('cheatModal');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 240);
}

// === Restauration des buffers IndexedDB au boot ===
async function restoreBuffersFromDisk() {
    if (!window.PulsePersist) return;
    let restored = 0, missing = 0;
    for (const t of state.project.tracks) {
        for (const c of [...(t.clips || []), ...(t.takes || [])]) {
            if (!c.id || c.recording) continue;
            if (PulseAudio.hasBuffer(c.id)) continue;
            try {
                const blob = await PulsePersist.loadBlob(c.id);
                if (!blob && c.midi && window.PulseSynth) {   // une région MIDI se refait toute seule à partir de ses notes
                    const b = renderMidiBuffer(c.midi, c.midi.bpm || state.project.bpm);
                    PulseAudio.registerBuffer(c.id, b);
                    if (!c.peaks || !c.peaks.length) c.peaks = makePeaks(b);
                    restored++; continue;
                }
                if (!blob) { missing++; continue; }
                const arrBuf = await blob.arrayBuffer();
                const audioBuf = await PulseAudio.getContext().decodeAudioData(arrBuf);
                PulseAudio.registerBuffer(c.id, audioBuf);
                if (!c.peaks || !c.peaks.length) {
                    c.peaks = makePeaks(audioBuf);
                }
                restored++;
            } catch (err) {
                console.warn('Restore failed for', c.id, err);
                missing++;
            }
        }
    }
    // Rendu des pistes gelées (sans lui, la piste se tairait : on la dégèle pour retrouver ses régions et ses effets)
    for (const t of state.project.tracks) {
        if (!t.frozen || PulseAudio.hasBuffer(t.frozen.id)) continue;
        try {
            const blob = await PulsePersist.loadBlob(t.frozen.id);
            if (!blob) throw new Error('missing');
            PulseAudio.registerBuffer(t.frozen.id, await PulseAudio.getContext().decodeAudioData(await blob.arrayBuffer()));
        } catch (err) {
            console.warn('Rendu gelé introuvable', t.name, err);
            unfreezeTrackData(t);
            setTimeout(() => flash(`« ${t.name} » a été dégelée : son rendu était introuvable (ses régions et ses effets jouent comme avant)`), 2400);
        }
    }
    if (restored > 0) flash(`✓ Projet rouvert (${restored} son${restored>1?'s':''})`);
    if (missing > 0) setTimeout(() => flash(`⚠ ${missing} son${missing>1?'s':''} introuvable${missing>1?'s':''} — le navigateur les a effacés. Si tu as un fichier .pulse de ce projet, rouvre-le depuis l'accueil`), 1200);
}

// === Drag-drop fichier n'importe où dans la fenêtre ===
function bindGlobalDragDrop() {
    let overlay = null;
    const createOverlay = () => {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'global-drop-overlay';
        overlay.innerHTML = `
            <div class="global-drop-inner">
                <div class="global-drop-icon">🎵</div>
                <div class="global-drop-title">Dépose ton audio</div>
                <div class="global-drop-sub">Nouvelle piste créée automatiquement</div>
            </div>`;
        document.body.appendChild(overlay);
        return overlay;
    };

    window.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        if (e.target.closest('.instru-dropzone')) return; // priorité à la dropzone instru
        e.preventDefault();
        createOverlay().classList.add('visible');
    });
    window.addEventListener('dragover', (e) => {
        if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', (e) => {
        if (e.clientX === 0 && e.clientY === 0 && overlay) overlay.classList.remove('visible');
    });
    window.addEventListener('drop', async (e) => {
        if (!hasFiles(e)) return;
        if (e.target.closest('.instru-dropzone')) return;
        e.preventDefault();
        if (overlay) overlay.classList.remove('visible');

        const pulseFile = Array.from(e.dataTransfer.files).find(f => /\.pulse$/i.test(f.name));
        if (pulseFile) {
            // Un gros projet déposé avec ses morceaux (dossier Sons) : le principal est celui qui n'est pas un « - sons N »
            const all = Array.from(e.dataTransfer.files).filter(f => /\.pulse$/i.test(f.name));
            const main = all.find(f => !/ - sons \d+\.pulse$/i.test(f.name)) || pulseFile;
            openPulseFileInStudio(main, { parts: all.filter(f => f !== main) });
            return;
        }
        const midis = Array.from(e.dataTransfer.files).filter(f => /\.midi?$/i.test(f.name));
        if (midis.length) {
            for (const f of midis) await importMidiFile(f, state.selectedTrack, state.playhead);
            return;
        }
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i.test(f.name));
        if (!files.length) { flash('Ce fichier n\'est pas un son — dépose un MP3, WAV, M4A ou FLAC'); return; }

        // Comme Logic : lâché sur la timeline → posé à cet endroit (calé sur la grille), sinon au curseur
        const tl = document.querySelector('.timeline');
        const tlr = tl && tl.getBoundingClientRect();
        const overTl = tlr && e.clientX >= tlr.left && e.clientX <= tlr.right && e.clientY >= tlr.top && e.clientY <= tlr.bottom;
        const at = overTl ? snapTime(Math.max(0, (e.clientX - tlr.left + tl.scrollLeft) / state.pxPerSecond), e.shiftKey) : state.playhead;
        const rowEl = e.target.closest && e.target.closest('.timeline-track, .track-item');
        const rowIdx = rowEl ? [...rowEl.parentElement.children].filter(c => c.matches('.timeline-track, .track-item')).indexOf(rowEl) : -1;
        // Plusieurs fichiers : on demande quoi en faire, comme la fenêtre « Ajouter les fichiers » de Logic
        const mode = files.length > 1 ? await askMultiImport(files.length) : 'new';
        if (!mode) return;
        await importDroppedFiles(files, mode, at, rowIdx >= 0 ? rowIdx : (state.selectedTrack ?? 0));
    });

    function hasFiles(e) {
        return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    }
}

// === VU-mètres par piste + master (boucle d'affichage) ===
let vuRafId = null;
let vuTempArray = new Uint8Array(128);
// Peak hold : { peak, time } par index ('master' ou trackIdx)
const _vuPeaks = {};
const PEAK_HOLD_MS = 1800;
const PEAK_FALL_MS = 600;
function startVuMeterLoop() {
    if (vuRafId) return;
    const loop = () => {
        updateAllVuMeters();
        vuRafId = requestAnimationFrame(loop);
    };
    vuRafId = requestAnimationFrame(loop);
}

function updateAllVuMeters() {
    const now = performance.now();
    // Pistes
    state.project.tracks.forEach((_, i) => {
        // Vu-mètre de la ligne de piste : deux barres collées (gauche / droite), une seule si le son est mono
        const mt = PulseAudio.getTrackMeters(i);
        const mrow = document.querySelector(`.tracks-panel .track-item[data-i="${i}"] .t-meter`);
        if (mrow) {
            if (mt) {
                const l = meterPct(mt.l), r = meterPct(mt.r);
                mrow.style.setProperty('--l', l.toFixed(1) + '%');
                mrow.style.setProperty('--r', (mrow.classList.contains('is-mono') ? l : r).toFixed(1) + '%');
            } else if (!(state.recording && state._livingClip && state._livingClip.trackIdx === i)) {
                mrow.style.setProperty('--l', '0%'); mrow.style.setProperty('--r', '0%');
            }
        }
        const an = PulseAudio.getTrackAnalyser(i);
        if (!an) return;
        if (vuTempArray.length !== an.frequencyBinCount) vuTempArray = new Uint8Array(an.frequencyBinCount);
        an.getByteTimeDomainData(vuTempArray);
        const level = computeRms(vuTempArray);
        applyVuPeak(i, level, now);
        const pct = (level * 100).toFixed(1) + '%';
        const peakPct = ((_vuPeaks[i]?.peak || 0) * 100).toFixed(1) + '%';
        // Mixer strip — on set sur .vu-rail pour que ::before (peak) y accède
        const rail = document.querySelector(`.mixer-strips .strip[data-kind="track"][data-i="${i}"] .vu-rail`);
        if (rail) { rail.style.setProperty('--lvl', pct); rail.style.setProperty('--peak', peakPct); }
        // Track panel
        const panel = document.querySelector(`.tracks-panel .track-item[data-i="${i}"] .vu-mini`);
        if (panel) { panel.style.setProperty('--lvl', pct); panel.style.setProperty('--peak', peakPct); }
    });
    // Master
    const ma = PulseAudio.getMasterAnalyser();
    if (ma) {
        if (vuTempArray.length !== ma.frequencyBinCount) vuTempArray = new Uint8Array(ma.frequencyBinCount);
        ma.getByteTimeDomainData(vuTempArray);
        const level = computeRms(vuTempArray);
        applyVuPeak('master', level, now);
        const el = document.getElementById('masterMeter');
        if (el) el.style.setProperty('--lvl', (level * 100).toFixed(1) + '%');
        const rail = el?.parentElement;
        if (rail) rail.style.setProperty('--peak', ((_vuPeaks['master']?.peak || 0) * 100).toFixed(1) + '%');
    }
    // Indicateur de niveau pendant l'enregistrement
    if (state.recording && state._livingClip) {
        updateRecLevelHint();
    } else {
        hideRecLevelHint();
    }
}

// Suivi de clipping pour éviter de spammer le flash
let _clipFlashSent = false;
let _clipFrameCount = 0;
let _recLevelSmooth = 0;

// Crête instantanée du micro (0-1)
function readMicPeak() {
    const an = window.PulseAudio ? PulseAudio.getMicAnalyser() : null;
    if (!an) return 0;
    if (vuTempArray.length !== an.frequencyBinCount) vuTempArray = new Uint8Array(an.frequencyBinCount);
    an.getByteTimeDomainData(vuTempArray);
    let peak = 0;
    for (let i = 0; i < vuTempArray.length; i++) {
        const v = Math.abs(vuTempArray[i] - 128) / 128;
        if (v > peak) peak = v;
    }
    return peak;
}

// Waveform dessinée en direct dans le clip pendant la prise (viewBox en secondes : rien à recalculer)
const SVG_NS = 'http://www.w3.org/2000/svg';
function drawLiveRecWave(clipEl, elapsed) {
    let svg = clipEl.querySelector('.rec-live-wave');
    if (!svg) {
        svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'clip-wave-svg rec-live-wave');
        svg.setAttribute('preserveAspectRatio', 'none');
        clipEl.appendChild(svg);
        state._recWave = { lastT: elapsed, max: 0 };
    }
    const w = state._recWave;
    w.max = Math.max(w.max, readMicPeak());
    if (elapsed - w.lastT >= 0.04) {
        const h = Math.max(0.02, Math.min(0.96, w.max));
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', w.lastT.toFixed(3));
        r.setAttribute('width', ((elapsed - w.lastT) * 0.75).toFixed(3));
        r.setAttribute('y', (0.5 - h / 2).toFixed(3));
        r.setAttribute('height', h.toFixed(3));
        svg.appendChild(r);
        w.lastT = elapsed; w.max = 0;
    }
    svg.setAttribute('viewBox', `0 0 ${Math.max(0.1, elapsed).toFixed(3)} 1`);
}

function updateRecLevelHint() {
    const hint = document.getElementById('recLevelHint');
    if (!hint) return;

    // Lire le niveau de la piste en cours d'enregistrement
    const an = window.PulseAudio ? PulseAudio.getMicAnalyser() : null;
    let level = 0;
    if (an) {
        if (vuTempArray.length !== an.frequencyBinCount) vuTempArray = new Uint8Array(an.frequencyBinCount);
        // Niveau crête (0-1) : c'est la crête qui sature, pas la moyenne
        const peak = readMicPeak();
        // Lissage : montée immédiate, descente douce (évite le texte qui clignote)
        _recLevelSmooth = Math.max(peak, (_recLevelSmooth || 0) * 0.94);
        level = _recLevelSmooth;
        // VU de la piste en cours d'enregistrement
        const mini = document.querySelector(`.tracks-panel .track-item[data-i="${state._livingClip.trackIdx}"] .vu-mini`);
        if (mini) mini.style.setProperty('--lvl', (Math.min(1, level) * 100).toFixed(1) + '%');
        const tm = document.querySelector(`.tracks-panel .track-item[data-i="${state._livingClip.trackIdx}"] .t-meter`);
        if (tm) {
            const db = level > 0.00001 ? 20 * Math.log10(Math.min(1, level)) : -90;
            const pc = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
            tm.style.setProperty('--l', pc.toFixed(1) + '%'); tm.style.setProperty('--r', pc.toFixed(1) + '%');
        }
    }

    hint.classList.add('visible');
    hint.classList.remove('lvl-silent', 'lvl-low', 'lvl-ok', 'lvl-hot', 'lvl-clip');

    if (level < 0.02) {
        hint.className = 'rec-level-hint visible lvl-silent';
        hint.textContent = '🎙 Silence… parle dans le micro';
        _clipFrameCount = 0;
    } else if (level < 0.12) {
        hint.className = 'rec-level-hint visible lvl-low';
        hint.textContent = '↑ Trop faible — rapproche-toi ou monte le gain';
        _clipFrameCount = 0;
    } else if (level < 0.85) {
        // Zone cible : vert → début orange du VU (autour de -9 dB)
        hint.className = 'rec-level-hint visible lvl-ok';
        hint.textContent = '✓ Bon niveau';
        _clipFrameCount = 0;
        _clipFlashSent = false;
    } else if (level < 0.96) {
        hint.className = 'rec-level-hint visible lvl-hot';
        hint.textContent = '⚡ Chaud — attention à la saturation';
        _clipFrameCount = 0;
    } else {
        hint.className = 'rec-level-hint visible lvl-clip';
        hint.textContent = '🔴 CLIP ! Baisse le gain';
        _clipFrameCount++;
        if (_clipFrameCount > 3 && !_clipFlashSent) {
            flash('🔴 Trop fort, ça sature ! Recule un peu du micro ou baisse le volume d\'entrée de ta carte son');
            _clipFlashSent = true;
        }
    }
}

function hideRecLevelHint() {
    const hint = document.getElementById('recLevelHint');
    if (hint) { hint.classList.remove('visible'); hint.className = 'rec-level-hint'; }
    _clipFlashSent = false;
    _clipFrameCount = 0;
}

function applyVuPeak(key, level, now) {
    let p = _vuPeaks[key];
    if (!p) { _vuPeaks[key] = { peak: level, time: now }; return; }
    if (level >= p.peak) {
        p.peak = level; p.time = now;
    } else {
        const age = now - p.time;
        if (age > PEAK_HOLD_MS) {
            const fall = Math.max(0, 1 - (age - PEAK_HOLD_MS) / PEAK_FALL_MS);
            p.peak = level + (p.peak - level) * fall;
        }
    }
}

// Niveau crête d'un analyseur en % d'une échelle de -60 à 0 dB (comme un vu-mètre de console), avec chute douce
const _meterBuf = new Float32Array(512);
const _meterHold = new WeakMap();
function meterPct(an) {
    an.getFloatTimeDomainData(_meterBuf);
    let pk = 0;
    for (let i = 0; i < _meterBuf.length; i++) { const v = Math.abs(_meterBuf[i]); if (v > pk) pk = v; }
    const db = pk > 0.00001 ? 20 * Math.log10(pk) : -90;
    let pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    const prev = _meterHold.get(an) || 0;
    pct = pct >= prev ? pct : prev - (prev - pct) * 0.18;   // monte tout de suite, retombe doucement
    _meterHold.set(an, pct);
    return pct;
}

function computeRms(byteArr) {
    let sum = 0;
    for (let i = 0; i < byteArr.length; i++) {
        const v = (byteArr[i] - 128) / 128;
        sum += v * v;
    }
    const rms = Math.sqrt(sum / byteArr.length);
    // Boost visuel + clip à 1
    return Math.min(1, rms * 2.2);
}

// Astuce affichée une seule fois (mémorisée dans le navigateur) — pour faire découvrir un geste au moment où il sert
function tipOnce(key, msg, delay = 0) {
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
    setTimeout(() => flash(msg), delay);
}

// === Onboarding première visite ===
const ONBOARD_KEY = 'pulse_onboarded_v1';

const ONBOARDING_STEPS = [
    {
        target: '#btnRec',
        placement: 'bottom',
        title: 'Enregistre-toi',
        text: 'Appuie sur <kbd>R</kbd> (ou ce bouton rouge). Tu entends <strong>1-2-3-4</strong>, puis ça enregistre. <kbd>R</kbd> à nouveau pour arrêter.',
    },
    {
        target: '#btnPlay',
        placement: 'bottom',
        title: 'Écoute',
        text: '<kbd>Espace</kbd> pour lire, <kbd>Espace</kbd> pour mettre en pause, et encore pour repartir de là où tu avais cliqué. Pour choisir d\'où ça part : clique dans la <strong>moitié basse</strong> d\'une piste (curseur en croix) ou dans la règle.',
    },
    {
        target: '#timelineRuler',
        placement: 'bottom',
        title: 'Répète un passage',
        text: 'Pour bosser un refrain en boucle : glisse dans la <strong>bande du haut</strong> de la règle. Clique sur la boucle pour l\'allumer ou l\'éteindre (touche <kbd>C</kbd>), tire ses bords pour l\'ajuster.',
    },
    {
        target: '#btnExport',
        placement: 'bottom',
        title: 'Récupère ton morceau',
        text: 'Quand tu es content du résultat, <strong>Exporter</strong> te donne un fichier MP3 ou WAV prêt à envoyer. Bloqué ? Le bouton <kbd>?</kbd> liste tous les raccourcis.',
    }
];

function startOnboarding() {
    if (localStorage.getItem(ONBOARD_KEY)) return;
    runOnboardingStep(0);
}

function runOnboardingStep(idx) {
    const existing = document.getElementById('onboardOverlay');
    if (existing) existing.remove();

    if (idx >= ONBOARDING_STEPS.length) {
        localStorage.setItem(ONBOARD_KEY, '1');
        flash('👋 À toi de jouer !');
        return;
    }

    const step = ONBOARDING_STEPS[idx];
    const target = (step.target.includes('.empty-cta') && document.querySelector('.empty-cta')) || document.querySelector(step.target.split(',').pop().trim() === step.target ? step.target : step.target.split(',').pop().trim());
    const rect = target ? target.getBoundingClientRect() : { top: window.innerHeight / 2, left: window.innerWidth / 2, right: window.innerWidth / 2, bottom: window.innerHeight / 2, width: 0, height: 0 };

    const overlay = document.createElement('div');
    overlay.id = 'onboardOverlay';
    overlay.className = 'onboard-overlay';
    overlay.innerHTML = `
        <div class="onboard-mask" style="--x:${rect.left}px; --y:${rect.top}px; --w:${rect.width}px; --h:${rect.height}px"></div>
        <div class="onboard-bubble" data-placement="${step.placement}">
            <div class="onboard-step">${idx + 1} / ${ONBOARDING_STEPS.length}</div>
            <h3>${step.title}</h3>
            <p>${step.text}</p>
            <div class="onboard-actions">
                <button class="onboard-skip" id="onboardSkip">Passer</button>
                <button class="onboard-next" id="onboardNext">${idx < ONBOARDING_STEPS.length - 1 ? 'Suivant' : 'Terminer'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Positionner la bulle par rapport à la cible
    const bubble = overlay.querySelector('.onboard-bubble');
    requestAnimationFrame(() => {
        const bw = bubble.offsetWidth;
        const bh = bubble.offsetHeight;
        let x = rect.left + rect.width / 2 - bw / 2;
        let y;
        if (step.placement === 'top')    { y = rect.top - bh - 16; }
        else if (step.placement === 'bottom') { y = rect.bottom + 16; }
        else if (step.placement === 'right')  { x = rect.right + 16; y = rect.top + rect.height / 2 - bh / 2; }
        else                                   { x = rect.left - bw - 16; y = rect.top + rect.height / 2 - bh / 2; }
        x = Math.max(16, Math.min(window.innerWidth - bw - 16, x));
        y = Math.max(16, Math.min(window.innerHeight - bh - 16, y));
        bubble.style.left = x + 'px';
        bubble.style.top = y + 'px';
    });

    document.getElementById('onboardNext').addEventListener('click', () => runOnboardingStep(idx + 1));
    document.getElementById('onboardSkip').addEventListener('click', () => runOnboardingStep(ONBOARDING_STEPS.length));
}

// === Export WAV / MP3 du projet (modal) ===
function openExportModal() {
    if (document.getElementById('exportModal')) return;
    const hasLoop = !!(state.loop);
    const loopLabel = hasLoop
        ? (() => {
            const a = Math.min(state.loop.start, state.loop.end);
            const b = Math.max(state.loop.start, state.loop.end);
            return `${secondsToDuration(a)} → ${secondsToDuration(b)}`;
        })() : '';
    const modal = document.createElement('div');
    modal.id = 'exportModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal">
            <button class="modal-close" id="exportClose" aria-label="Fermer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h2 class="modal-title">Exporter</h2>
            <p class="modal-sub">${hasLoop ? `Boucle active — exporter la sélection (${loopLabel}) ou tout le projet.` : 'Ton morceau est exporté tel que tu l\'entends.'}</p>
            <label class="export-loud">
                <input type="checkbox" id="exportLoud" ${localStorage.getItem('pulse_export_loud') === '0' ? '' : 'checked'}>
                <span><b>Volume au maximum</b><em>Remonte le morceau pour qu'il sonne aussi fort que possible sans saturer. Conseillé pour poster ou envoyer.</em></span>
            </label>
            <div class="export-options">
                <button class="export-opt" data-fmt="mp3" data-bitrate="320">
                    <div class="export-opt-tag">MP3</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">Pour poster et partager <span class="export-reco">conseillé</span></div>
                        <div class="export-opt-desc">Le plus simple : TikTok, YouTube, WhatsApp, mail… très bonne qualité.</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="wav">
                    <div class="export-opt-tag">WAV</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">Qualité maximale</div>
                        <div class="export-opt-desc">Aucune perte, fichier lourd. Pour faire masteriser ou garder une copie parfaite.</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="mp3" data-bitrate="192">
                    <div class="export-opt-tag">MP3 léger</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">Petit fichier</div>
                        <div class="export-opt-desc">Pour envoyer vite une démo par message.</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="stems">
                    <div class="export-opt-tag" style="background:var(--violet-2);color:#fff">PISTES</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">Chaque piste séparée</div>
                        <div class="export-opt-desc">Un fichier par piste (voix, instru…), pour un ingé son ou pour mixer ailleurs.</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="pulse">
                    <div class="export-opt-tag" style="background:#10B981;color:#04130D">PROJET</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">Sauvegarder le projet</div>
                        <div class="export-opt-desc">Tout dans un seul fichier, pour le rouvrir plus tard ou sur un autre ordi.</div>
                    </div>
                </button>
                ${hasLoop ? `
                <div class="export-sep-label">── Exporter la sélection (${loopLabel}) ──</div>
                <button class="export-opt" data-fmt="wav-loop">
                    <div class="export-opt-tag" style="background:#f59e0b;color:#000">WAV ✂</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">WAV — zone de boucle</div>
                        <div class="export-opt-desc">Exporte uniquement la plage sélectionnée (${loopLabel}) en WAV.</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="mp3-loop" data-bitrate="320">
                    <div class="export-opt-tag" style="background:#f59e0b;color:#000">MP3 ✂</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">MP3 320 — zone de boucle</div>
                        <div class="export-opt-desc">Exporte uniquement la plage sélectionnée en MP3 320 kbps.</div>
                    </div>
                </button>` : ''}
            </div>
        </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('visible'));

    modal.addEventListener('click', async (e) => {
        if (e.target === modal || e.target.closest('#exportClose')) return closeExportModal();
        const opt = e.target.closest('.export-opt');
        if (!opt) return;
        const fmt = opt.dataset.fmt;
        const bitrate = parseInt(opt.dataset.bitrate || '320');
        const loudEl = document.getElementById('exportLoud');
        if (loudEl) localStorage.setItem('pulse_export_loud', loudEl.checked ? '1' : '0');
        closeExportModal();
        if (fmt === 'pulse') await exportPulseFile();
        else if (fmt === 'stems') await doExportStems();
        else if (fmt === 'wav-loop') await doExport('wav', 320, true);
        else if (fmt === 'mp3-loop') await doExport('mp3', bitrate, true);
        else await doExport(fmt, bitrate);
    });
}

function closeExportModal() {
    const m = document.getElementById('exportModal');
    if (!m) return;
    m.classList.remove('visible');
    setTimeout(() => m.remove(), 240);
}

async function doExport(fmt, bitrate = 320, loopOnly = false) {
    const rangeLabel = loopOnly && state.loop ? ' (sélection)' : '';
    flash(`Export ${fmt.toUpperCase()}${rangeLabel} en cours…`);
    try {
        const exportOpts = (loopOnly && state.loop) ? {
            startSec: Math.min(state.loop.start, state.loop.end),
            endSec:   Math.max(state.loop.start, state.loop.end)
        } : {};
        exportOpts.normalize = localStorage.getItem('pulse_export_loud') !== '0';
        const wavBlob = await PulseAudio.exportWav(state.project, exportOpts);
        if (!wavBlob) { flash('Ton projet est vide — enregistre ta voix ou dépose un son avant d\'exporter'); return; }

        let outBlob = wavBlob;
        let ext = 'wav';
        if (fmt === 'mp3') {
            if (!window.lamejs) { flash('Le MP3 n\'est pas prêt — recharge la page, ou exporte en WAV en attendant'); return; }
            outBlob = await encodeToMp3(wavBlob, bitrate);
            ext = 'mp3';
        }

        const suffix = loopOnly ? '_selection' : '';
        const fname = (state.project.name || 'pulse-export').replace(/[^\p{L}\p{N}_\-]+/gu, '_') + suffix + '.' + ext;
        const res = await deliverFile(outBlob, fname);
        if (res.cancelled) return;
        if (res.native) { flash(`✓ Export ${fmt.toUpperCase()}${rangeLabel} rangé dans le dossier Bounces de ton projet`); window.__TAURI__.core.invoke('reveal_project_folder', { dir: res.dir }).catch(() => {}); }
        else flash(`✓ Export ${fmt.toUpperCase()}${rangeLabel} téléchargé`);
    } catch (err) {
        console.error(err);
        flash('L\'export n\'a pas marché — réessaie, et si ça bloque encore choisis WAV');
    }
}

async function encodeToMp3(wavBlob, bitrate) {
    // Décoder le WAV pour récupérer les samples
    const arrBuf = await wavBlob.arrayBuffer();
    const audioCtx = PulseAudio.getContext();
    const audioBuf = await audioCtx.decodeAudioData(arrBuf);
    const channels = audioBuf.numberOfChannels;
    const sampleRate = audioBuf.sampleRate;

    // Convertir en Int16
    // Un MP3 dépasse un peu à l'encodage : -0,6 dB de marge pour ne jamais écrêter une fois décodé
    const MP3_HEADROOM = 0.933;
    const left = toInt16(audioBuf.getChannelData(0), MP3_HEADROOM);
    const right = channels > 1 ? toInt16(audioBuf.getChannelData(1), MP3_HEADROOM) : left;

    const mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, bitrate);
    const chunkSize = 1152;
    const chunks = [];
    for (let i = 0; i < left.length; i += chunkSize) {
        const l = left.subarray(i, i + chunkSize);
        const r = right.subarray(i, i + chunkSize);
        const mp3buf = mp3encoder.encodeBuffer(l, r);
        if (mp3buf.length > 0) chunks.push(mp3buf);
    }
    const end = mp3encoder.flush();
    if (end.length > 0) chunks.push(end);

    return new Blob(chunks, { type: 'audio/mp3' });
}

function toInt16(float32, gain = 1) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i] * gain));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
}

async function doExportStems() {
    const tracks = state.project.tracks.filter(t => (t.clips || []).length > 0);
    if (!tracks.length) { flash('Ton projet est vide — enregistre ta voix ou dépose un son avant d\'exporter'); return; }

    flash(`Export des ${tracks.length} pistes séparées en cours…`);
    const baseName = (state.project.name || 'pulse-export').replace(/[^\p{L}\p{N}_\-]+/gu, '_');
    let done = 0, stemDir = null;
    for (let i = 0; i < state.project.tracks.length; i++) {
        const t = state.project.tracks[i];
        if (!(t.clips || []).length) continue;
        try {
            const wavBlob = await PulseAudio.exportTrackWav(state.project, i);
            if (!wavBlob) continue;
            const trackName = (t.name || `piste-${i + 1}`).replace(/[^\p{L}\p{N}_\-]+/gu, '_');
            const res = await deliverFile(wavBlob, `${baseName}_stem_${String(i + 1).padStart(2, '0')}_${trackName}.wav`);
            if (res.cancelled) return;
            if (res.native) stemDir = res.dir;
            done++;
            flash(`Export ${done}/${tracks.length} — ${t.name}…`);
            // Petite pause entre chaque téléchargement pour éviter le blocage du navigateur
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            console.error(`Stem export failed for track ${i}`, err);
        }
    }
    flash(stemDir ? `✓ ${done} piste${done > 1 ? 's' : ''} exportée${done > 1 ? 's' : ''} séparément — dans le dossier Bounces de ton projet` : `✓ ${done} piste${done > 1 ? 's' : ''} exportée${done > 1 ? 's' : ''} séparément — regarde dans tes Téléchargements`);
    if (stemDir) window.__TAURI__.core.invoke('reveal_project_folder', { dir: stemDir }).catch(() => {});
}

// Legacy alias
function projectHasSound() {
    return state.project.tracks.some(t => (t.clips || []).some(c => !c.recording && !(c.midi && !(c.midi.notes || []).length)));
}
async function exportProject() {
    if (!projectHasSound()) { flash('Ton projet est vide : pose un instru ou enregistre-toi avant d\'exporter'); return; }
    openExportModal();
}

// === Mode automation ===
// Toggle. En mode A, cliquer sur un effet (slot EQ/Comp/Rev du mixer, ou sur une piste)
// ouvre la courbe d'automation de ce paramètre sur la timeline, comme Logic.
function toggleAutomationMode() {
    state.automationMode = !state.automationMode;
    document.body.classList.toggle('automation-mode', state.automationMode);
    flash(state.automationMode
        ? '🎚 Automation — touche un réglage (fader, pan, envoi, plugin) : sa courbe s\'affiche sur la piste. Clique pour poser un point, double-clic pour l\'enlever (A pour quitter)'
        : 'Automation masquée');
    renderTracksPanel();   // la pastille du réglage dessiné est dans l'en-tête de chaque piste (comme Logic)
    renderTimelineTracks();
}

// === Auto-Tune sur un clip (après la prise) ===
// Le clip pointe vers une copie corrigée ; l'original est gardé (clip.tune.src) pour pouvoir revenir en arrière.
async function loadBufferById(id) {
    let buf = PulseAudio.getBuffer(id);
    if (buf) return buf;
    try {
        const blob = await PulsePersist.loadBlob(id);
        if (!blob) return null;
        buf = await PulseAudio.getContext().decodeAudioData(await blob.arrayBuffer());
        PulseAudio.registerBuffer(id, buf);
        return buf;
    } catch { return null; }
}

// Le clip le plus long de la piste d'instru (ou, à défaut, le plus long son d'une autre piste)
function findInstruClip(exceptTrackIdx) {
    let best = null, bestScore = 0;
    state.project.tracks.forEach((t, i) => {
        if (i === exceptTrackIdx) return;
        const named = t.preset === 'instru' || /instru|prod|beat/i.test(t.name || '');
        (t.clips || []).forEach(c => {
            if (c.recording || c.tune) return;
            const score = c.duration * (named ? 100 : 1);
            if ((named || c.duration >= 20) && score > bestScore) { bestScore = score; best = c; }
        });
    });
    return best;
}

// Lit la gamme sur l'instru et la garde dans le projet (elle vaut pour tout le morceau)
async function detectProjectKey(exceptTrackIdx) {
    const clip = findInstruClip(exceptTrackIdx);
    if (!clip) return { reason: 'no-instru' };
    const buf = await loadBufferById(clip.id);
    if (!buf) return { reason: 'no-instru' };
    const n = buf.length, mono = new Float32Array(n);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
    const k = await PulseTune.detectKeyFromMusic(mono, buf.sampleRate);
    if (!k || k.confidence < 0.35) return { reason: 'unsure' };
    // Une gamme majeure et sa relative mineure ont les mêmes notes : on l'annonce en mineur (le cas courant en rap)
    const tonic = k.minor ? k.tonic : (k.tonic + 9) % 12;
    state.project.key = { notes: k.notes, tonic, minor: true, label: scaleLabel(tonic, true), source: 'instru' };
    saveProject();
    return state.project.key;
}

// « A mineur (Am) » : notes en lettres (notation anglaise), comme sur les autres Auto-Tune
function scaleLabel(tonic, minor) {
    return `${PulseTune.NOTE_NAMES[tonic]} ${minor ? 'mineur' : 'majeur'} (${PulseTune.NOTE_NAMES[tonic]}${minor ? 'm' : ''})`;
}
// Les 7 notes d'une gamme majeure ou mineure
const scaleMask = (tonic, minor) => PulseTune.toMask(minor ? (tonic + 3) % 12 : tonic);

// Reconnaît la gamme formée par les notes choisies au clavier (majeur / mineur, ou la plus proche)
function detectScale(mask) {
    const on = mask.map((v, i) => v ? i : -1).filter(i => i >= 0);
    if (on.length < 5) return 'Choisis au moins 5 notes pour trouver la gamme';
    if (on.length === 12) return '';
    const exact = [], close = [];
    for (let m = 0; m < 2; m++) for (let t = 0; t < 12; t++) {
        const sm = scaleMask(t, !!m), out = on.filter(i => !sm[i]).length, miss = sm.filter((v, i) => v && !mask[i]).length;
        if (out === 0 && miss === 0) exact.push(scaleLabel(t, !!m));
        else if (out === 0 && miss === 1 && on.length >= 6) close.push(scaleLabel(t, !!m));
        else if (out === 1 && miss === 0 && on.length >= 7) close.push(scaleLabel(t, !!m));
    }
    if (exact.length) return 'Gamme : ' + exact.join('  =  ');
    if (close.length) return 'Presque : ' + close[0] + ' (1 note de différence)';
    return 'Pas une gamme majeure ou mineure';
}
// Petite note de piano, pour comparer à l'oreille avec la prod
// Son de piano maison : harmoniques qui s'éteignent chacune à leur rythme (les aigus plus vite), deux cordes très légèrement
// désaccordées, petit coup de marteau, timbre qui s'adoucit. La note meurt toute seule ; le relâchement = l'étouffoir.
let _pianoNoise = null;
function pianoVoice(pc, oct = 0) {
    const ctx = PulseAudio.getContext();
    if (!ctx) return null;
    const t = ctx.currentTime, f0 = 261.63 * Math.pow(2, pc / 12 + oct);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(1, t + 0.004);
    env.gain.setTargetAtTime(0.0001, t + 0.004, 2.2 / (1 + Math.max(0, Math.log2(f0 / 261.63)) * 0.35));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.3;
    lp.frequency.setValueAtTime(Math.min(10000, f0 * 16), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(1200, f0 * 3), t + 1.4);
    const out = ctx.createGain(); out.gain.value = 0.2;
    env.connect(lp); lp.connect(out); out.connect(ctx.destination);
    const oscs = [];
    const AMP = [1, 0.62, 0.42, 0.3, 0.2, 0.13, 0.09, 0.06];
    AMP.forEach((a, i) => {
        const n = i + 1, f = f0 * n * Math.sqrt(1 + 0.0004 * n * n);
        if (f > 12000) return;
        const pg = ctx.createGain(); pg.gain.setValueAtTime(a / 1.6, t);
        pg.gain.setTargetAtTime(0.0001, t + 0.004, 2.4 / Math.pow(n, 0.7));
        pg.connect(env);
        [-1.3, 1.3].forEach(c => {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = c;
            o.connect(pg); o.start(t); o.stop(t + 9); oscs.push(o);
        });
    });
    // Coup de marteau
    if (!_pianoNoise || _pianoNoise.ctx !== ctx) {
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
        _pianoNoise = { ctx, buf };
    }
    const ns = ctx.createBufferSource(); ns.buffer = _pianoNoise.buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, f0 * 5); bp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t);
    let done = false;
    return () => {   // étouffoir
        if (done) return; done = true;
        const r = ctx.currentTime;
        env.gain.cancelScheduledValues(r);
        env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), r);
        env.gain.exponentialRampToValueAtTime(0.0001, r + 0.22);
        oscs.forEach(o => { try { o.stop(r + 0.26); } catch {} });
    };
}
// Touche tenue : la note sonne et s'éteint seule comme sur un piano ; le relâchement l'étouffe
function holdKeyNote(pc, oct = 0) {
    const rel = pianoVoice(pc, oct);
    if (!rel) return () => {};
    const safety = setTimeout(rel, 12000);   // sécurité : jamais une note coincée
    return () => { clearTimeout(safety); rel(); };
}
function playKeyNote(pc) { pianoVoice(pc); }

function openTunePanel(trackIdx, clipIdx, x, y, trackMode = false) {
    closeTransientPanels();
    const trk = state.project.tracks[trackIdx];
    // Mode « piste » : l'Auto-Tune est un effet de la piste, il corrige toutes ses prises (et les nouvelles)
    const clip = trackMode ? (trk ? { name: trk.name, tune: trk.autotune && trk.autotune.on ? { src: 'piste', ...trk.autotune } : null } : null) : trk?.clips[clipIdx];
    if (!clip || clip.recording) return;
    const cur = clip.tune || { strength: 0.85 };
    // Notes autorisées : celles du clip, sinon celles du morceau, sinon on va les lire sur l'instru
    const oldMask = clip.tune && !clip.tune.notes && clip.tune.root !== undefined ? PulseTune.toMask(clip.tune.root) : null;
    let mask = (clip.tune && clip.tune.notes) || oldMask || (state.project.key && state.project.key.notes) || null;
    mask = mask ? mask.slice() : null;
    let source = clip.tune && clip.tune.notes ? (clip.tune.source || 'clavier') : (mask && state.project.key ? state.project.key.source : (oldMask ? 'clavier' : null));
    // Gamme choisie (note + mineur / majeur). 95 % des prods rap sont en mineur : c'est le choix par défaut.
    const k0 = (clip.tune && clip.tune.tonic !== undefined ? clip.tune : state.project.key) || {};
    let tonic = k0.tonic ?? 9, minor = k0.minor ?? true;
    const BLACK = [1, 3, 6, 8, 10], WHITE = [0, 2, 4, 5, 7, 9, 11];
    const blackLeft = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }; // après quelle touche blanche
    // Déjà ouvert (mode piste) : on le ramène devant
    if (trackMode) { const open = findPlugWin(trk, 'tune'); if (open) { plugFront(open); return; } }
    const isOn = () => trackMode ? !!(trk.autotune && trk.autotune.on) : !!clip.tune;
    const saved = (trackMode ? trk.autotune : clip.tune) || {};
    // PulseTune (planche « Pro » du 22/10) : 4 boutons, valeurs 0 à 100
    const K = {
        strength: Math.round(((saved.strength ?? cur.strength) ?? 0.85) * 100),
        human: Math.round((saved.human || 0) * 100),
        flex: Math.round((saved.flex || 0) * 100),
        vibrato: Math.round((saved.vibrato || 0) * 100)
    };
    let voice = saved.voice || 'mid';
    const KNOBS = [
        { key: 'strength', label: 'Vitesse', def: 85, desc: 'Naturel → Robot', fmt: (v) => (v < 35 ? 'Naturel' : v < 70 ? 'Moyen' : v < 90 ? 'Rapide' : 'Robot') + ' · ' + v + ' %' },
        { key: 'human', label: 'Humain', def: 0, desc: 'laisse vivre les notes tenues', fmt: (v) => v + ' %' },
        { key: 'flex', label: 'Souplesse', def: 0, desc: 'ne corrige que près de la note', fmt: (v) => v + ' %' },
        { key: 'vibrato', label: 'Vibrato naturel', def: 0, desc: 'garde ton vibrato', fmt: (v) => v + ' %' }
    ];
    const panel = document.createElement('div');
    panel.className = 'fx-panel tune-panel tune-b tune-pro' + (isOn() ? ' is-on' : '');
    panel.style.setProperty('--fx-accent', 'var(--violet-2)');
    panel.innerHTML = `
        <div class="fx-panel-header">
            <button class="tb-power" data-tooltip="Allumer ou éteindre PulseTune">⏻</button>
            <span class="tp-brand"><i>Voix et hauteur</i><b>Pulse<span>Tune</span></b>${trackMode ? '' : `<em>${esc(clip.name || 'Clip')}</em>`}</span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="tp-bar">
            <div class="tp-f"><label>Tonalité</label><select class="tune-tonic">${PulseTune.NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></div>
            <div class="tp-f"><label>Gamme</label><div class="tune-mode tp-seg"><button data-minor="1">Mineur</button><button data-minor="0">Majeur</button><button data-chroma="1">Chromatique</button></div></div>
            <div class="tp-f"><label>Type de voix</label><div class="tp-voice tp-seg"><button data-v="high">Aiguë</button><button data-v="mid">Médium</button><button data-v="low">Grave</button></div></div>
            <div class="tp-f tp-right"><button class="tp-btn" data-q="instru">Lire l'instru</button></div>
        </div>
        <div class="tune-scale"><span class="tune-status"></span></div>
        <div class="tp-meter" data-tooltip="Pendant la lecture ou la prise : la note que tu chantes et son écart avec la note juste">
            <svg class="tp-scale" viewBox="0 0 600 64" preserveAspectRatio="none"></svg>
            <div class="tp-side tp-left">VOIX<b class="tp-in">—</b></div>
            <div class="tp-side tp-rt">ÉCART<b class="tp-gap">—</b></div>
            <div class="tp-target"><b>—</b><span>note juste</span></div>
        </div>
        <div class="tp-knobs">${KNOBS.map(k => `<div class="tp-k" data-k="${k.key}"><span class="tp-lbl">${k.label}</span><div class="tp-knob fx-knob" tabindex="0" data-tooltip="Glisser vers le haut ou le bas · double-clic = ${k.def} %"></div><b class="tp-val"></b><em>${k.desc}</em></div>`).join('')}
            <input type="range" class="tune-strength" min="0" max="100" value="${K.strength}" hidden></div>
        <div class="tb-keys-wrap">
            <div class="tune-keys">
                ${WHITE.map(pc => `<button class="tune-key-btn white" data-pc="${pc}"><em>${PulseTune.NOTE_NAMES[pc]}</em></button>`).join('')}
                ${BLACK.map(pc => `<button class="tune-key-btn black" data-pc="${pc}" style="left: calc(${blackLeft[pc]} * 100% / 7)"></button>`).join('')}
            </div>
            <div class="tune-hint">Joue au clavier de l'ordi (<kbd>A</kbd> <kbd>W</kbd> <kbd>S</kbd> <kbd>E</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>T</kbd> <kbd>G</kbd> <kbd>Y</kbd> <kbd>H</kbd> <kbd>U</kbd> <kbd>J</kbd>, <kbd>Z</kbd> / <kbd>X</kbd> = octave) ou à la souris · <kbd>⌘</kbd> + clic : retirer / remettre la note, pour toutes les octaves</div>
        </div>
        <div class="fx-panel-footer tb-foot">
            ${trackMode ? '<label class="tune-all" data-tooltip="Copie ce réglage sur toutes les pistes qui ont PulseTune allumé"><input type="checkbox" class="tune-all-box"> Même réglage partout</label>' : '<span></span>'}
            <div class="tune-quick"><button data-q="all">Toutes les notes</button></div>
        </div>`;
    document.body.appendChild(panel);
    panel.style.left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, x)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, y)) + 'px';
    if (trackMode) makePlugWindow(panel, trk, 'tune', trackIdx);
    const status = panel.querySelector('.tune-status');
    const chroma = () => !!mask && mask.every(Boolean);
    const paint = () => {
        panel.querySelectorAll('.tune-key-btn').forEach(k => {
            k.classList.toggle('on', !mask || !!mask[+k.dataset.pc]);
            k.classList.toggle('tonic', +k.dataset.pc === tonic && !!(mask && mask[tonic]) && !chroma());
        });
        const named = source === 'instru' || source === 'gamme';
        status.textContent = !mask ? 'Gamme devinée sur ta voix' : source === 'instru' ? `Lue sur l'instru : ${scaleLabel(tonic, minor)}` : source === 'gamme' || chroma() ? '' : detectScale(mask);
        panel.querySelector('.tune-tonic').value = String(tonic);
        panel.querySelector('.tune-scale').classList.toggle('is-manual', !!mask && !named);
        panel.querySelectorAll('.tune-mode button').forEach(b => b.classList.toggle('on', b.dataset.chroma ? chroma() : !chroma() && (b.dataset.minor === '1') === minor));
        panel.querySelectorAll('.tp-voice button').forEach(b => b.classList.toggle('on', b.dataset.v === voice));
        panel.classList.toggle('is-on', isOn());
    };
    // --- Appliquer (allumé) : en différé, pour ne pas recalculer à chaque petit mouvement
    let applyTimer = null;
    const more = () => ({ strength: K.strength / 100, human: K.human / 100, flex: K.flex / 100, vibrato: K.vibrato / 100, voice });
    const settings = () => mask ? { notes: mask.slice(), source, tonic, minor, ...more() } : { root: 'auto', ...more() };
    const apply = (withUndo = true) => {
        if (mask && !mask.some(Boolean)) { flash('Toutes les notes sont retirées — remets au moins une note (⌘ + clic)'); return; }
        if (mask) { const named = source === 'instru' || source === 'gamme'; state.project.key = { notes: mask.slice(), tonic, minor, label: named ? scaleLabel(tonic, minor) : '', source }; }
        if (trackMode) {
            if (withUndo) pushUndo();
            trk.autotune = { on: true, ...settings() }; trk.tuneSlot = true; saveProject();
            tuneWholeTrack(trackIdx, null, true);
            if ((panel.querySelector('.tune-all-box') || {}).checked) setTimeout(() => {
                let n = 0;
                state.project.tracks.forEach((o, i) => { if (o !== trk && o.autotune && o.autotune.on) { o.autotune = JSON.parse(JSON.stringify(trk.autotune)); tuneWholeTrack(i, null, true); n++; } });
                if (n) { saveProject(); flash(`Même réglage PulseTune posé sur ${n} autre${n > 1 ? 's' : ''} piste${n > 1 ? 's' : ''}`); }
            }, 50);
        } else applyTune(clip, tuneOpts(settings()));
        paint(); renderInspector();
    };
    const changed = () => { if (!isOn()) return; clearTimeout(applyTimer); applyTimer = setTimeout(() => apply(false), 600); };
    const turnOff = async () => {
        if (trackMode) {
            const keep = { ...(trk.autotune || {}), ...settings(), on: false };
            await untuneWholeTrack(trackIdx);
            trk.autotune = keep; trk.tuneSlot = true; saveProject();   // éteint, mais il garde ses réglages
        } else await removeTune(clip);
        paint(); renderInspector();
    };
    panel.querySelector('.tb-power').addEventListener('click', () => { if (isOn()) turnOff(); else { pushUndo(); apply(false); } });
    // --- Gamme, type de voix
    const pickScale = () => { mask = scaleMask(tonic, minor); source = 'gamme'; paint(); changed(); };
    panel.querySelector('.tune-tonic').addEventListener('change', (e) => { tonic = parseInt(e.target.value); e.target.blur(); playKeyNote(tonic); pickScale(); });
    panel.querySelectorAll('.tune-mode button').forEach(b => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
            if (b.dataset.chroma) { mask = new Array(12).fill(true); source = 'clavier'; paint(); changed(); return; }
            minor = b.dataset.minor === '1'; pickScale();
        });
    });
    panel.querySelectorAll('.tp-voice button').forEach(b => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { voice = b.dataset.v; paint(); changed(); });
    });
    const readInstru = async (quiet) => {
        status.textContent = 'Je lis la gamme sur l\'instru…';
        const k = await detectProjectKey(trackIdx);
        if (!document.body.contains(panel)) return;
        if (k.notes) { mask = k.notes.slice(); tonic = k.tonic; minor = k.minor; source = 'instru'; paint(); changed(); if (!quiet) flash(`Gamme lue sur l'instru : ${k.label} — si ce n'est pas la bonne, change-la ou retire des notes (⌘ + clic sur une touche)`); return; }
        paint();
        if (!quiet) flash(k.reason === 'no-instru'
            ? 'Je ne trouve pas d\'instru dans le projet — dépose ta prod sur une piste, ou choisis les notes au clavier'
            : 'Je n\'arrive pas à lire la gamme sur cette instru (pas assez de notes) — choisis les notes au clavier');
    };
    // --- Les 4 boutons métal
    panel.querySelectorAll('.tp-k').forEach(box => {
        const kd = KNOBS.find(k => k.key === box.dataset.k), knob = box.querySelector('.tp-knob'), val = box.querySelector('.tp-val');
        const def = { key: kd.key, label: kd.label, unit: '%', min: 0, max: 100, def: kd.def, step: 1 };
        const draw = () => { knob.innerHTML = fxKnobSvg(def, K[kd.key], true, 'P'); val.textContent = kd.fmt(K[kd.key]); if (kd.key === 'strength') panel.querySelector('.tune-strength').value = K.strength; };
        knob.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; e.preventDefault();
            const y0 = e.clientY, v0 = K[kd.key];
            const mv = (ev) => { const nv = Math.round(Math.max(0, Math.min(100, v0 + (y0 - ev.clientY) * (ev.shiftKey ? 0.1 : 0.5)))); if (nv !== K[kd.key]) { K[kd.key] = nv; draw(); } };
            const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); changed(); };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
        knob.addEventListener('dblclick', () => { K[kd.key] = kd.def; draw(); changed(); });
        draw();
    });
    // --- Indicateur : la note chantée en direct (lecture ou prise) et son écart avec la note juste de la gamme
    const sc = panel.querySelector('.tp-scale');
    let g = '';
    for (let c = -50; c <= 50; c += 5) { const xx = 300 + c * 5.6, big = c % 25 === 0; g += `<line x1="${xx}" y1="${big ? 14 : 20}" x2="${xx}" y2="30" class="${c === 0 ? 'z' : big ? 'b' : ''}"/>`; if (big) g += `<text x="${xx}" y="10">${c > 0 ? '+' : ''}${c}</text>`; }
    sc.innerHTML = g + '<rect class="tp-bar-gap" x="300" y="36" width="0" height="9" rx="3"/><line class="tp-needle" x1="300" y1="12" x2="300" y2="50"/>';
    const inEl = panel.querySelector('.tp-in'), gapEl = panel.querySelector('.tp-gap'), tgEl = panel.querySelector('.tp-target b'), bar = sc.querySelector('.tp-bar-gap'), needle = sc.querySelector('.tp-needle');
    let tbuf = null, lastT = 0, shownC = 0;
    const pitchOf = (b, sr) => {
        let rms = 0; for (let i = 0; i < b.length; i++) rms += b[i] * b[i];
        if (Math.sqrt(rms / b.length) < 0.01) return 0;
        const minL = Math.floor(sr / 1000), maxL = Math.min(b.length >> 1, Math.floor(sr / 60));
        let best = 0, bestL = 0; const n = b.length - maxL;
        for (let L = minL; L <= maxL; L++) {
            let c = 0, e1 = 0, e2 = 0;
            for (let i = 0; i < n; i++) { c += b[i] * b[i + L]; e1 += b[i] * b[i]; e2 += b[i + L] * b[i + L]; }
            const r = c / Math.sqrt(e1 * e2 + 1e-12); if (r > best) { best = r; bestL = L; }
        }
        return best > 0.85 && bestL ? sr / bestL : 0;
    };
    const NN = PulseTune.NOTE_NAMES;
    const live = (ts) => {
        if (!panel.isConnected) return;
        if (ts - lastT > 60) {
            lastT = ts;
            const an = (state.playing || state.recording) && PulseAudio.getTrackAnalyser ? PulseAudio.getTrackAnalyser(trackIdx) : null;
            let f = 0;
            if (an) {
                if (an.fftSize < 2048) an.fftSize = 2048;   // assez long pour une voix grave
                if (!tbuf || tbuf.length !== an.fftSize) tbuf = new Float32Array(an.fftSize);
                an.getFloatTimeDomainData(tbuf);
                f = pitchOf(tbuf, an.context.sampleRate);
            }
            if (f) {
                const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m);
                // note juste la plus proche dans la gamme choisie
                let t = r; if (mask && mask.some(Boolean)) { for (let d = 0; d <= 6; d++) { if (mask[((r + d) % 12 + 12) % 12]) { t = r + d; break; } if (mask[((r - d) % 12 + 12) % 12]) { t = r - d; break; } } }
                const cents = Math.max(-50, Math.min(50, Math.round((m - t) * 100)));
                shownC += (cents - shownC) * 0.5;
                inEl.textContent = `${NN[((r % 12) + 12) % 12]} ${Math.round((m - r) * 100) >= 0 ? '+' : ''}${Math.round((m - r) * 100)}`;
                tgEl.textContent = NN[((t % 12) + 12) % 12];
                gapEl.textContent = `${cents >= 0 ? '+' : ''}${cents} cents`;
            } else { shownC *= 0.7; inEl.textContent = '—'; gapEl.textContent = '—'; if (!state.playing && !state.recording) tgEl.textContent = '—'; }
            const xx = 300 + shownC * 5.6;
            needle.setAttribute('x1', xx); needle.setAttribute('x2', xx);
            bar.setAttribute('x', Math.min(300, xx)); bar.setAttribute('width', Math.abs(xx - 300));
        }
        requestAnimationFrame(live);
    };
    requestAnimationFrame(live);
    paint();
    if (!mask) readInstru(true);
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.querySelectorAll('.tune-key-btn').forEach(k => {
        // Clic = jouer la note (tenue tant qu'on reste appuyé) ; ⌘ + clic = retirer / remettre la note (toutes les octaves)
        k.addEventListener('mousedown', (e) => {
            e.preventDefault();   // pas de focus : Espace reste la lecture
            if (e.button !== 0) return;
            const pc = +k.dataset.pc;
            if (e.metaKey || e.ctrlKey) {
                if (!mask) mask = new Array(12).fill(true);
                mask[pc] = !mask[pc];
                source = 'clavier';
                playKeyNote(pc);
                paint(); changed();
                return;
            }
            const release = holdKeyNote(pc);
            k.classList.add('pressed');
            const up = () => { release(); k.classList.remove('pressed'); document.removeEventListener('mouseup', up); k.removeEventListener('mouseleave', up); };
            document.addEventListener('mouseup', up); k.addEventListener('mouseleave', up);
        });
    });
    // Clavier d'ordinateur = clavier de piano (comme dans le piano roll), tant que PulseTune est ouvert
    {
        const KM = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
        const phys = (e) => (e.code && /^Key[A-Z]$/.test(e.code)) ? e.code.slice(3).toLowerCase() : String(e.key || '').toLowerCase();
        const held = new Map(); let oct = 0;
        const lamp = (n, on) => { const b = panel.querySelector(`.tune-key-btn[data-pc="${n % 12}"]`); if (b) b.classList.toggle('pressed', on); };
        const stopAll = () => { held.forEach((h, k) => { h.rel(); lamp(h.n, false); }); held.clear(); };
        const cleanup = () => { stopAll(); document.removeEventListener('keydown', onDown, true); document.removeEventListener('keyup', onUp, true); };
        const onDown = (e) => {
            if (!panel.isConnected) { cleanup(); return; }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
            const k = phys(e);
            if (k === 'z' || k === 'x') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) oct = Math.max(-2, Math.min(2, oct + (k === 'x' ? 1 : -1))); return; }
            const n = KM[k]; if (n === undefined) return;
            e.preventDefault(); e.stopImmediatePropagation();
            if (e.repeat || held.has(k)) return;
            held.set(k, { n, rel: holdKeyNote(n % 12, oct + Math.floor(n / 12)) });
            lamp(n, true);
        };
        const onUp = (e) => {
            if (!panel.isConnected) { cleanup(); return; }
            const k = phys(e), h = held.get(k); if (!h) return;
            e.preventDefault(); e.stopImmediatePropagation();
            h.rel(); lamp(h.n, false); held.delete(k);
        };
        document.addEventListener('keydown', onDown, true); document.addEventListener('keyup', onUp, true);
        window.addEventListener('blur', stopAll);
    }
    panel.querySelectorAll('[data-q]').forEach(b => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
            if (b.dataset.q === 'all') { mask = new Array(12).fill(true); source = 'clavier'; paint(); changed(); }
            else readInstru(false);
        });
    });
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    // Réglage d'un seul clip : la fenêtre se ferme quand on clique ailleurs (mode piste : elle reste, comme les plugs)
    if (!trackMode) setTimeout(() => {
        document.addEventListener('mousedown', function closeTune(ev) {
            if (!panel.contains(ev.target)) panel.remove();
            if (!document.body.contains(panel)) document.removeEventListener('mousedown', closeTune);
        });
    }, 100);
}

// === Régions MIDI : piano roll + séquenceur de pas ===
// Une région garde ses notes (clip.midi) ET le son qui en sort (buffer rendu par PulseSynth) : le reste de Pulse la
// traite comme une prise normale (effets, fondus, export). clip.midi.bpm = tempo auquel le son a été calculé.
const MIDI_INSTS = () => PulseSynth.INSTRUMENTS;
function renderMidiBuffer(midi, bpm) {
    const ctx = PulseAudio.getContext();
    const r = PulseSynth.render(midi, bpm, ctx.sampleRate);
    const buf = ctx.createBuffer(2, r.length, ctx.sampleRate);
    buf.getChannelData(0).set(r.channels[0]); buf.getChannelData(1).set(r.channels[1]);
    return buf;
}
async function bakeMidiClip(clip, midi, bpm) {
    const buf = renderMidiBuffer(midi, bpm);
    const newId = `mid_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    PulseAudio.registerBuffer(newId, buf);
    try { await PulsePersist.saveBlob(newId, PulseAudio.audioBufferToWav(buf), { kind: 'midi' }); }
    catch (e) { console.warn('Persist midi failed', e); }
    clip.id = newId;
    clip.peaks = makePeaks(buf);
    const pid = (clip.midi && clip.midi.pid) || midi.pid;
    clip.midi = { inst: midi.inst, beats: midi.beats, notes: midi.notes, bpm, ...(midi.swing ? { swing: midi.swing } : {}), ...(pid ? { pid } : {}) };
    return buf;
}

async function createMidiClip(trackIdx, atSec, noUndo = false) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    const start = Math.max(0, barStartSec(barAtSec(atSec + 1e-6))), bpm = bpmAtSec(start), beats = bpbAtSec(start), bar = beats * 60 / bpm;
    if (t.clips.some(c => !c.recording && c.start < start + bar - 1e-3 && c.start + c.duration > start + 1e-3)) {
        flash('Il y a déjà une région ici — double-clique dans un espace vide, ou ouvre celle-ci avec un double-clic');
        return;
    }
    if (!noUndo) pushUndo();
    const inst = t.midiInst || (t.type === 'drums' ? 'drums' : 'piano');
    const n = t.clips.filter(c => c.midi).length + 1;
    const clip = { start, duration: bar, offset: 0, name: `${MIDI_INSTS()[inst].label} ${n}`, color: t.color };
    await bakeMidiClip(clip, { inst, beats, notes: [] }, bpm);
    t.clips.push(clip);
    t.clips.sort((a, b) => a.start - b.start);
    state.selectedTrack = trackIdx;
    state.selectedClip = { trackIdx, clipIdx: t.clips.indexOf(clip) };
    renderTimelineTracks(); saveProject();
    openMidiEditor(trackIdx, t.clips.indexOf(clip), true);
}

const _prevCache = new Map();
function playMidiPreview(inst, p, v) {
    try {
        const ctx = PulseAudio.getContext();
        if (ctx.state === 'suspended') ctx.resume();
        const key = `${inst}|${p}|${v}|${ctx.sampleRate}`;
        let buf = _prevCache.get(key);
        if (!buf) {
            const r = PulseSynth.preview(inst, p, v, ctx.sampleRate);
            buf = ctx.createBuffer(2, r.length, ctx.sampleRate);
            buf.getChannelData(0).set(r.channels[0]); buf.getChannelData(1).set(r.channels[1]);
            if (_prevCache.size > 300) _prevCache.clear();
            _prevCache.set(key, buf);
        }
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = 0.8;
        src.connect(g); g.connect(ctx.destination); src.start();
    } catch (e) { console.warn('preview', e); }
}

let _midiSession = null;
function openMidiEditor(trackIdx, clipIdx, fresh) {
    const t = state.project.tracks[trackIdx], clip = t && t.clips[clipIdx];
    if (!clip || !clip.midi) return;
    if (!window.PulsePianoRoll) { flash('L\'éditeur de notes n\'est pas chargé — recharge la page (Cmd+Shift+R)'); return; }
    state.selectedClip = { trackIdx, clipIdx };
    _midiSession = { clip, trackIdx, undoPushed: false };
    PulsePianoRoll.open({
        midi: clip.midi, title: `${t.name} — ${clip.name || 'Région'}`, color: clip.color || t.color,
        key: state.project.key, flash, bpb: bpbAtSec(clip.start),
        ghost: t.clips.filter(c => c !== clip && c.midi && !(clip.midi.pid && c.midi.pid === clip.midi.pid)).map(c => c.midi.notes),
        view: clip.midi.inst === 'drums' ? 'steps' : 'roll',
        onPreview: playMidiPreview,
        // Curseur du projet vu depuis l'éditeur (même à l'arrêt) et clic dans sa règle : on y déplace le curseur, double-clic = lecture d'ici
        getCursorBeat: () => {
            const spb = 60 / (clip.midi.bpm || state.project.bpm);
            const b = (state.playhead - clip.start + (clip.offset || 0)) / spb;
            if (b < 0) return null;
            if (b > clip.midi.beats) { if (!state.playing || !clip.loopEnd || b > (clip.loopEnd - clip.start) / spb) return null; return b % clip.midi.beats; }
            return b;
        },
        getLoop: () => {
            if (!state.loop) return null;
            const spb = 60 / (clip.midi.bpm || state.project.bpm), o = clip.start - (clip.offset || 0);
            return { a: (Math.min(state.loop.start, state.loop.end) - o) / spb, b: (Math.max(state.loop.start, state.loop.end) - o) / spb, on: !!state.looping };
        },
        setLoop: (a, b) => {   // a, b en temps depuis le début de la région ; null = ne change que l'état
            const spb = 60 / (clip.midi.bpm || state.project.bpm), o = clip.start - (clip.offset || 0);
            if (a == null) { state.looping = !state.looping; }
            else { state.loop = { start: Math.max(0, o + a * spb), end: Math.max(0, o + b * spb) }; state.looping = true; }
            renderLoopOverlay(); updateLoopButton(); saveProject();
        },
        onSeek: (beat, play) => {
            const spb = 60 / (clip.midi.bpm || state.project.bpm);
            seekPlayhead(Math.max(0, clip.start - (clip.offset || 0) + beat * spb));
            if (play && !state.playing && !state.recording) togglePlay();
        },
        getBeat: () => {
            if (!state.playing && !state.recording) return null;
            const spb = 60 / (clip.midi.bpm || state.project.bpm);
            let b = (state.playhead - clip.start + (clip.offset || 0)) / spb;
            if (b < 0) return null;
            if (b > clip.midi.beats) { if (!clip.loopEnd || b > (clip.loopEnd - clip.start) / spb) return null; b %= clip.midi.beats; }
            return b;
        },
        onCommit: (midi, first, fromHistory) => commitMidi(clip, midi, fromHistory),
        onClose: () => { _midiSession = null; renderTimelineTracks(); }
    });
    if (fresh) flash('Clique dans la grille pour poser des notes — Espace pour écouter, Échap pour fermer');
    tipOnce('pulse_tip_roll_tools', 'Astuce : touches 1 Crayon · 2 Pointeur · 3 Gomme · 4 Ciseaux — Q cale tes notes sur la grille', fresh ? 4000 : 600);
    // L'éditeur prend le bas de l'écran : la piste en cours d'édition doit rester visible au-dessus
    setTimeout(() => {
        const row = document.querySelector(`#timelineTracks .timeline-track[data-i="${trackIdx}"]`);
        if (row) row.scrollIntoView({ block: 'nearest' });
    }, 60);
}

async function commitMidi(clip, midi, fromHistory = false) {
    const ti = state.project.tracks.findIndex(t => t.clips.includes(clip));
    if (ti < 0) { flash('Cette région n\'existe plus — l\'éditeur se ferme'); PulsePianoRoll.close(true); return; }
    if (!fromHistory) pushUndo();   // une étape par série de modifications : ⌘Z défait la dernière série, pas toute la séance
    const bpm = bpmAtSec(clip.start), spb = 60 / bpm;
    const lenChanged = midi.beats !== clip.midi.beats;
    const pid = clip.midi.pid;
    const buf = await bakeMidiClip(clip, midi, bpm);
    if (lenChanged) { clip.offset = 0; clip.duration = midi.beats * spb; delete clip.loopEnd; }
    else clip.duration = Math.min(clip.duration, Math.max(0.05, buf.duration - (clip.offset || 0)));
    if (lenChanged && state.project.tracks[ti].clips.some(o => o !== clip && !o.recording && o.start < clip.start + clip.duration - 1e-3 && o.start + o.duration > clip.start + 1e-3)) {
        flash('Cette région est maintenant plus longue et chevauche la suivante : déplace-la ou raccourcis le motif');
    }
    // Régions liées (alias) : elles reçoivent exactement le même motif et le même son
    if (pid) state.project.tracks.forEach(t => t.clips.forEach(o => {
        if (o === clip || !o.midi || o.midi.pid !== pid) return;
        o.id = clip.id; o.peaks = clip.peaks;
        o.midi = { ...clip.midi };
        if (lenChanged) { o.offset = 0; o.duration = midi.beats * spb; delete o.loopEnd; }
        else o.duration = Math.min(o.duration, Math.max(0.05, buf.duration - (o.offset || 0)));
    }));
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
}

// Copie liée (comme un alias de Logic ou un motif de FL) : modifier l'une modifie toutes les autres
function linkDuplicateMidi(trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx], clip = t && t.clips[clipIdx];
    if (!clip || !clip.midi) return;
    pushUndo();
    if (!clip.midi.pid) clip.midi.pid = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    let start = clip.start + (clip.loopEnd ? clip.loopEnd - clip.start : clip.duration);
    while (t.clips.some(o => o !== clip && !o.recording && o.start < start + clip.duration - 1e-3 && o.start + o.duration > start + 1e-3)) start += clip.duration;
    const copy = JSON.parse(JSON.stringify(clip));
    copy.start = start; delete copy.loopEnd;
    t.clips.push(copy);
    t.clips.sort((a, b) => a.start - b.start);
    state.selectedClip = { trackIdx, clipIdx: t.clips.indexOf(copy) };
    renderTimelineTracks(); saveProject();
    flash('🔗 Copie liée créée — modifie l\'une, l\'autre suit (clic droit > Rendre indépendante pour les séparer)');
}

// --- Fichiers .mid : importer / exporter ---
const safeName = (s) => String(s || 'pulse').replace(/[^\p{L}\p{N}_\-]+/gu, '_').replace(/^_+|_+$/g, '') || 'pulse';
function exportMidiClip(trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx], c = t && t.clips[clipIdx];
    if (!c || !c.midi) return;
    const bytes = PulseMidiFile.encode([{ name: c.name || t.name, drums: c.midi.inst === 'drums', notes: c.midi.notes }], c.midi.bpm || bpmAtSec(c.start));
    triggerDownload(new Blob([bytes], { type: 'audio/midi' }), `${safeName(c.name || t.name)}.mid`);
    flash('✓ Fichier .mid enregistré — tu peux l\'ouvrir dans FL Studio, Logic, Ableton…');
}
// Changements de tempo et de signature à écrire dans un .mid (positions en temps depuis le début)
function midiTempoMap() {
    const p = state.project;
    if (!tempoVaries()) return { beats: bpb(), tempos: [], signatures: [] };
    return { beats: bpb(), tempos: PulseTempo.tempoSegments(p).slice(1).map(x => ({ beat: x.beat, bpm: x.bpm })),
        signatures: PulseTempo.sigSegments(p).slice(1).map(x => ({ beat: x.beat, beats: x.beats })) };
}
function exportMidiTrack(trackIdx) {
    const t = state.project.tracks[trackIdx];
    const regs = (t && t.clips || []).filter(c => c.midi && !c.muted);
    if (!regs.length) { flash('Il n\'y a pas encore de région MIDI sur cette piste'); return; }
    const notes = [];
    regs.forEach(c => {
        const spb = 60 / (c.midi.bpm || bpmAtSec(c.start));    // la région est rendue au tempo de son début
        const cs = beatAtSec(c.start), beats = c.midi.beats, total = ((c.loopEnd ? c.loopEnd - c.start : c.duration) / spb);
        PulseSynth.loopNotes(c.midi.notes, beats, Math.max(beats, total)).forEach(n => {
            if (n.s < total - 1e-6) notes.push({ s: n.s + cs, d: Math.min(n.d, total - n.s), p: n.p, v: n.v });
        });
    });
    const bytes = PulseMidiFile.encode([{ name: t.name, drums: t.type === 'drums', notes }], state.project.bpm, midiTempoMap());
    triggerDownload(new Blob([bytes], { type: 'audio/midi' }), `${safeName(t.name)}.mid`);
    flash(`✓ Piste « ${t.name} » enregistrée en .mid`);
}
async function importMidiFile(file, trackIdx, atSec) {
    let r;
    try { r = PulseMidiFile.decode(await file.arrayBuffer()); }
    catch (e) { flash(`Impossible de lire « ${file.name} » : ${e.message}`); return; }
    let t = state.project.tracks[trackIdx];
    if (!t || (t.type !== 'keys' && t.type !== 'drums')) {          // pas de piste instrument choisie : on en crée une
        pushUndo();
        const type = r.drums ? 'drums' : 'keys', i = state.project.tracks.length;
        state.project.tracks.push({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 24), type, midiInst: type === 'drums' ? 'drums' : 'piano', color: COLORS[i % COLORS.length], clips: [], volume: 100 });
        trackIdx = i; t = state.project.tracks[i];
    } else pushUndo();
    const inst = t.midiInst || (t.type === 'drums' ? 'drums' : 'piano');
    let start = Math.max(0, snapToGrid(atSec || 0, 'bar'));
    // Projet encore vide (aucune région nulle part) : il prend le tempo et la signature du fichier, changements compris (comme Logic)
    const empty = state.project.tracks.every(tr => !(tr.clips || []).some(c => !c.recording));
    const fileChanges = (r.tempos || []).length + (r.signatures || []).length;
    let adopted = false;
    if (empty && (r.bpm || fileChanges || (r.beatsPerBar && r.beatsPerBar !== bpb()))) {
        const startBar = barAtSec(start);
        const p = state.project;
        p.bpm = roundBpm(r.bpm || p.bpm);
        p.beatsPerBar = r.beatsPerBar || 4;
        delete p.tempos; delete p.signatures;
        // signatures du fichier (en temps) → numéros de mesure, en suivant les signatures précédentes
        const sigs = []; let barBase = 0, beatBase = 0, cur = p.beatsPerBar;
        (r.signatures || []).forEach(e => {
            const bar = barBase + Math.round((e.beat - beatBase) / cur);
            sigs.push({ bar: startBar + bar, beats: e.beats });
            barBase = bar; beatBase = e.beat; cur = e.beats;
        });
        if (startBar > 0) sigs.unshift({ bar: startBar, beats: p.beatsPerBar });
        if (sigs.length) p.signatures = sigs;
        const startBeat = PulseTempo.barToBeats(p, startBar);
        const tps = (r.tempos || []).map(e => ({ beat: startBeat + e.beat, bpm: e.bpm }));
        if (tps.length) p.tempos = tps;
        normalizeTempoMap(p);
        start = secAtBeat(startBeat);
        _tempoWatch = tempoSnapshot();          // projet vide : rien à recaler
        const bpmEl = document.getElementById('bpmInput'); if (bpmEl) bpmEl.value = p.bpm;
        if (window.PulseAudio) PulseAudio.setMetronomeBpm(p.bpm);
        adopted = true;
    }
    const kept = r.notes.slice(0, PulseSynth.MAX_NOTES);
    let drumsSkipped = 0;
    if (inst === 'drums') { const lanes = PulseSynth.DRUM_LANES.map(l => l.p); drumsSkipped = kept.filter(n => !lanes.includes(n.p)).length; }
    // Une région par palier de tempo (chaque région joue au tempo de son début) : coupée à chaque changement
    const startBeat0 = beatAtSec(start);
    const cuts = [0];
    if (adopted) (state.project.tempos || []).forEach(e => { const b = e.beat - startBeat0; if (b > 1e-6 && b < r.beats - 1e-6) cuts.push(b); });
    cuts.push(r.beats);
    const totalDur = adopted ? secAtBeat(startBeat0 + r.beats) - start : r.beats * 60 / bpmAtSec(start);
    while (t.clips.some(c => !c.recording && c.start < start + totalDur - 1e-3 && c.start + c.duration > start + 1e-3)) {
        const o = t.clips.find(c => !c.recording && c.start < start + totalDur - 1e-3 && c.start + c.duration > start + 1e-3);
        start = o.start + o.duration;
    }
    const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'MIDI';
    const made = [];
    for (let k = 0; k < cuts.length - 1; k++) {
        const b0 = cuts[k], b1 = cuts[k + 1];
        const s0 = k === 0 ? start : secAtBeat(beatAtSec(start) + b0);
        const bpm = bpmAtSec(s0), beats = b1 - b0;
        const notes = kept.filter(n => n.s >= b0 - 1e-9 && (n.s < b1 - 1e-9 || k === cuts.length - 2)).map(n => ({ ...n, s: n.s - b0 }));
        const clip = { start: s0, duration: beats * 60 / bpm, offset: 0, name: cuts.length > 2 ? `${baseName} ${k + 1}` : baseName, color: t.color };
        await bakeMidiClip(clip, { inst, beats, notes }, bpm);
        t.clips.push(clip); made.push(clip);
    }
    t.clips.sort((a, b) => a.start - b.start);
    const clip = made[0], bpm = clip.midi.bpm;
    state.selectedTrack = trackIdx;
    state.selectedClip = { trackIdx, clipIdx: t.clips.indexOf(clip) };
    if (adopted && tempoVaries() && typeof renderTempoLane === 'function') renderTempoLane();
    renderAll(); updateChrono(); saveProject(); refreshPlaybackSoon();
    // mesures couvertes, d'après la signature de l'endroit (3/4 compte 3 temps par mesure)
    const sb = beatAtSec(clip.start), b0 = PulseTempo.beatsToBar(state.project, sb), b1 = PulseTempo.beatsToBar(state.project, sb + r.beats);
    const nBars = Math.max(1, b1.bar - b0.bar + (b1.beat > 1e-6 ? 1 : 0));
    const bits = [`✓ « ${file.name} » importé (${kept.length} note${kept.length > 1 ? 's' : ''}, ${nBars} mesure${nBars > 1 ? 's' : ''})`];
    if (adopted) {
        const tc = (state.project.tempos || []).length, sc = (state.project.signatures || []).filter(e => e.bar > barAtSec(start)).length;
        let m = `le projet prend le tempo du fichier (${state.project.bpm} BPM`;
        if (tc) m += `, ${tc} changement${tc > 1 ? 's' : ''} de tempo`;
        if (sc) m += `, ${sc} changement${sc > 1 ? 's' : ''} de signature`;
        bits.push(m + ') — ⌘Z pour revenir');
    } else if (r.bpm && Math.abs(r.bpm - bpm) > 0.5) bits.push(`le fichier est à ${r.bpm} BPM, le projet à ${bpm} : les notes suivent le tempo du projet`);
    if (!adopted && fileChanges) bits.push('ses changements de tempo ne sont pas repris (le projet contient déjà des sons)');
    if (r.notes.length > kept.length) bits.push(`seules les ${kept.length} premières notes sont gardées`);
    if (drumsSkipped) bits.push(`${drumsSkipped} coups d'autres instruments de batterie ne sonnent pas (kit à 9 pièces)`);
    flash(bits.join(' — '));
}
function pickMidiFile(trackIdx, atSec) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.mid,.midi,audio/midi';
    inp.onchange = () => { const f = inp.files[0]; if (f) importMidiFile(f, trackIdx, atSec); };
    inp.click();
}

// Notes dessinées dans la région (au lieu de la forme d'onde)
function renderMidiNotes(c, widthPx) {
    const m = c.midi, h = Math.max(20, state.trackHeight - 28), spb = 60 / (m.bpm || state.project.bpm), pps = state.pxPerSecond;
    if (!m.notes.length || widthPx < 6) return '<div class="clip-wave"></div>';
    const drums = m.inst === 'drums', lanes = PulseSynth.DRUM_LANES.map(l => l.p);
    let lo = 127, hi = 0;
    m.notes.forEach(n => { const v = drums ? lanes.indexOf(n.p) : n.p; if (v < 0) return; lo = Math.min(lo, v); hi = Math.max(hi, v); });
    if (hi < lo) return '<div class="clip-wave"></div>';
    if (!drums) { const mid = (lo + hi) / 2; lo = Math.min(lo, mid - 6); hi = Math.max(hi, mid + 6); }
    const span = hi - lo + 1, rh = (h - 8) / span, off = c.offset || 0;
    let path = '';
    for (const n of m.notes) {
        const v = drums ? lanes.indexOf(n.p) : n.p; if (v < 0) continue;
        const x = (n.s * spb - off) * pps, w = Math.max(1.5, n.d * spb * pps - 0.5);
        if (x + w < 0 || x > widthPx) continue;
        const y = 4 + (hi - v) * rh;
        path += `M${x.toFixed(1)} ${y.toFixed(1)}h${w.toFixed(1)}v${Math.max(1.5, rh - 0.5).toFixed(1)}h-${w.toFixed(1)}z`;
    }
    return `<svg class="clip-wave-svg midi-notes" viewBox="0 0 ${widthPx} ${h}" preserveAspectRatio="none"><path d="${path}"/></svg>`;
}

// Le tempo change : les régions MIDI sont recalculées et gardent leur place sur les temps.
// Chaque région est rendue au tempo de son début (comme une région warpée) : avec une carte de tempo, une région
// placée après un changement joue au nouveau tempo.
// oldMap : la carte d'avant ({ bpm, beatsPerBar, tempos, signatures }) → les régions se déplacent pour rester sur leur temps ;
// null → seulement remettre au bon tempo les régions qui ne le sont plus (déplacée de l'autre côté d'un changement…), sans les déplacer.
function rerenderMidiForTempo(oldMap) {
    const todo = [];
    state.project.tracks.forEach(t => (t.clips || []).forEach(c => {
        if (!c.midi || !c.midi.bpm || c.recording) return;
        const start = oldMap ? Math.max(0, secAtBeat(PulseTempo.secToBeats(oldMap, c.start))) : c.start;
        const bpm = bpmAtSec(start);
        if (Math.abs(c.midi.bpm - bpm) < 1e-6 && Math.abs(start - c.start) < 1e-9) return;
        todo.push({ c, start, bpm, f: c.midi.bpm / bpm });
    }));
    // Première passe sur les objets « midi » d'origine (deux moitiés d'une région coupée peuvent partager le même) : un rendu par motif et par tempo
    const bufs = new Map();
    todo.forEach(({ c, start, bpm, f }) => {
        if (Math.abs(f - 1) > 1e-9) {
            let byBpm = bufs.get(c.midi); if (!byBpm) bufs.set(c.midi, byBpm = new Map());
            if (!byBpm.has(bpm)) {
                const buf = renderMidiBuffer(c.midi, bpm);
                const id = `mid_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                PulseAudio.registerBuffer(id, buf);
                PulsePersist.saveBlob(id, PulseAudio.audioBufferToWav(buf), { kind: 'midi' }).catch(() => {});
                byBpm.set(bpm, { id, peaks: makePeaks(buf) });
            }
            const r = byBpm.get(bpm);
            c.id = r.id; c.peaks = r.peaks;
        }
        const oldStart = c.start;
        c.start = start;                              // la région reste sur la même mesure
        c.offset = (c.offset || 0) * f; c.duration *= f;
        if (c.fadeIn) c.fadeIn *= f; if (c.fadeOut) c.fadeOut *= f;
        if (c.loopEnd) c.loopEnd = start + (c.loopEnd - oldStart) * f;
    });
    // Deuxième passe : chaque région note son tempo (copie du motif si deux régions qui le partageaient n'ont plus le même)
    todo.forEach(({ c, bpm }) => { if (c.midi.bpm !== bpm) c.midi = { ...c.midi, bpm }; });
    return todo.length;
}

// === Warp : caler un son sur le tempo du projet (sans changer sa hauteur) ===
// Même principe que l'Auto-Tune : le clip pointe vers une copie étirée, l'original est gardé (clip.warp.src).
let _warpBusy = false;
async function applyWarp(clip, srcBpm, targetBpm) {
    if (_warpBusy) { flash('Un warp est déjà en cours — attends qu\'il finisse'); return false; }
    if (clip.tune) { flash('Retire d\'abord l\'Auto-Tune de ce clip, puis cale-le sur le tempo'); return false; }
    const chk = PulseWarp.checkRatio(srcBpm, targetBpm);
    if (!chk.ok) { flash(chk.why === 'écart trop grand' ? 'L\'écart de tempo est trop grand pour caler proprement (essaie ÷2 ou ×2 sur le tempo de l\'audio)' : 'Tempo hors limites (30 à 300 BPM)'); return false; }
    _warpBusy = true;
    try {
        const srcId = clip.warp ? clip.warp.src : clip.id;
        const src = await loadBufferById(srcId);
        if (!src) { flash('Le son de ce clip est introuvable — impossible de le caler'); return false; }
        flash('⏱ Warp en cours…');
        const chans = [];
        for (let c = 0; c < src.numberOfChannels; c++) chans.push(src.getChannelData(c));
        let last = 0;
        const out = await PulseWarp.stretch(chans, src.sampleRate, chk.ratio, (p) => {
            const st = Math.floor(p * 4);
            if (st > last) { last = st; flash(`⏱ Warp en cours… ${Math.min(99, Math.round(p * 100))} %`); }
        });
        const buf = PulseAudio.getContext().createBuffer(out.length, out[0].length, src.sampleRate);
        out.forEach((ch, i) => buf.getChannelData(i).set(ch));
        const newId = `${srcId}_w${Date.now().toString(36)}`;
        PulseAudio.registerBuffer(newId, buf);
        try { await PulsePersist.saveBlob(newId, PulseAudio.audioBufferToWav(buf), { kind: 'warp' }); }
        catch (e) { console.warn('Persist warp failed', e); }
        // Le clip garde ses coupes : tout est mis à l'échelle du changement de vitesse
        const cur = clip.warp ? clip.warp.srcBpm / clip.warp.bpm : 1;
        const f = chk.ratio / cur;
        pushUndo();
        clip.offset = (clip.offset || 0) * f;
        clip.duration *= f;
        if (clip.fadeIn) clip.fadeIn *= f;
        if (clip.fadeOut) clip.fadeOut *= f;
        if (clip.loopEnd) clip.loopEnd = clip.start + (clip.loopEnd - clip.start) * f;
        clip.id = newId;
        clip.warp = { src: srcId, srcBpm, bpm: targetBpm };
        clip.peaks = makePeaks(buf);
        renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
        flash(`✓ Calé : ${Math.round(srcBpm * 10) / 10} → ${targetBpm} BPM, même hauteur`);
        return true;
    } catch (err) {
        console.error(err);
        flash('Le warp n\'a pas pu traiter ce clip — réessaie sur un clip plus court');
        return false;
    } finally {
        _warpBusy = false;
    }
}

async function removeWarp(clip) {
    if (!clip.warp) return;
    const src = await loadBufferById(clip.warp.src);
    if (!src) { flash('Le son d\'origine est introuvable — le warp ne peut pas être retiré'); return; }
    pushUndo();
    const f = clip.warp.bpm / clip.warp.srcBpm;      // retour à la vitesse d'origine
    clip.offset = (clip.offset || 0) * f;
    clip.duration *= f;
    if (clip.fadeIn) clip.fadeIn *= f;
    if (clip.fadeOut) clip.fadeOut *= f;
    if (clip.loopEnd) clip.loopEnd = clip.start + (clip.loopEnd - clip.start) * f;
    clip.id = clip.warp.src;
    delete clip.warp;
    clip.peaks = makePeaks(src);
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash('Warp retiré — tu retrouves la vitesse d\'origine');
}

// === Inverser le son (reverse) : à l'envers, pour les montées, les reverses de voix, les effets ===
// Même principe que le Warp : le clip pointe vers une copie inversée, l'original est gardé (clip.rev.src).
async function toggleReverse(clip) {
    if (clip.tune || clip.warp) { flash('Retire d\'abord l\'Auto-Tune ou le Warp de ce clip, puis inverse-le'); return; }
    const srcId = clip.id;
    const src = await loadBufferById(srcId);
    if (!src) { flash('Le son de ce clip est introuvable — impossible de l\'inverser'); return; }
    const total = src.duration;
    let newId, kind = 'reverse';
    if (clip.rev) newId = clip.rev.src;                  // on retrouve l'original
    else newId = `${srcId}_r${Date.now().toString(36)}`;
    let buf = null;
    if (clip.rev) {
        buf = await loadBufferById(newId);
        if (!buf) { flash('Le son d\'origine est introuvable — impossible de le remettre à l\'endroit'); return; }
    } else {
        buf = PulseAudio.getContext().createBuffer(src.numberOfChannels, src.length, src.sampleRate);
        for (let c = 0; c < src.numberOfChannels; c++) {
            const a = src.getChannelData(c), b = buf.getChannelData(c);
            for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i];
        }
        PulseAudio.registerBuffer(newId, buf);
        try { await PulsePersist.saveBlob(newId, PulseAudio.audioBufferToWav(buf), { kind }); }
        catch (e) { console.warn('Persist reverse failed', e); }
    }
    pushUndo();
    // La portion visible [offset, offset+durée] est la même, vue de l'autre bout
    clip.offset = Math.max(0, total - (clip.offset || 0) - clip.duration);
    const fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
    if (fi || fo) { clip.fadeIn = fo || 0; clip.fadeOut = fi || 0; if (!clip.fadeIn) delete clip.fadeIn; if (!clip.fadeOut) delete clip.fadeOut; }
    if (clip.rev) { clip.id = clip.rev.src; delete clip.rev; }
    else { clip.id = newId; clip.rev = { src: srcId }; }
    clip.peaks = makePeaks(buf);
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(clip.rev ? '✓ Son inversé — refais la même chose pour le remettre à l\'endroit' : '✓ Son remis à l\'endroit');
}

// Le tempo du projet change (tempo, signature, carte de tempo) : les régions MIDI et les clips calés suivent (pas pendant l'enregistrement)
// Avec une carte de tempo, on vérifie aussi en continu qu'une région déplacée de l'autre côté d'un changement joue au bon tempo.
let _tempoWatch = null, _warpWatchTimer = null, _pointerHeld = false;
const tempoKey = (p) => JSON.stringify([p.bpm, p.beatsPerBar || 4, p.tempos || [], p.signatures || []]);
function tempoSnapshot() {
    const p = state.project;
    return { proj: p, key: tempoKey(p), map: JSON.parse(JSON.stringify({ bpm: p.bpm, beatsPerBar: p.beatsPerBar, tempos: p.tempos || [], signatures: p.signatures || [] })) };
}
let _tempoTicking = false;
async function tempoWatchTick() {
    if (_tempoTicking || _warpBusy || state.recording || _pointerHeld) return;
    const w = _tempoWatch, key = tempoKey(state.project), same = w && w.proj === state.project;
    const changed = same && w.key !== key;
    if (!changed && !tempoVaries()) { if (!same) _tempoWatch = tempoSnapshot(); return; }   // tempo fixe et rien n'a bougé (ou projet rouvert / annulé : il est déjà juste)
    _tempoTicking = true;
    try {
        _tempoWatch = tempoSnapshot();
        if (window.PulseSynth && rerenderMidiForTempo(changed ? w.map : null) > 0) { renderTimelineTracks(); saveProject(); refreshPlaybackSoon(); }
        const todo = [];
        state.project.tracks.forEach(t => (t.clips || []).forEach(c => { if (c.warp && Math.abs(c.warp.bpm - bpmAtSec(c.start)) > 1e-6 && !c.tune) todo.push(c); }));
        for (const c of todo) await applyWarp(c, c.warp.srcBpm, bpmAtSec(c.start));
    } finally { _tempoTicking = false; }
}
function watchWarpTempo() {
    _tempoWatch = tempoSnapshot();
    clearInterval(_warpWatchTimer);
    document.addEventListener('pointerdown', () => { _pointerHeld = true; }, true);
    window.addEventListener('pointerup', () => { _pointerHeld = false; }, true);
    window.addEventListener('pointercancel', () => { _pointerHeld = false; }, true);
    window.addEventListener('blur', () => { _pointerHeld = false; });
    _warpWatchTimer = setInterval(tempoWatchTick, 700);
}

function openWarpPanel(trackIdx, clipIdx, x, y) {
    closeTransientPanels();
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip || clip.recording) return;
    const srcId = clip.warp ? clip.warp.src : clip.id;
    let srcBpm = clip.warp ? clip.warp.srcBpm : null;
    const panel = document.createElement('div');
    panel.className = 'fx-panel warp-panel';
    panel.innerHTML = `
        <div class="fx-panel-header"><span>⏱ Warp</span><button class="fx-panel-close">×</button></div>
        <div class="fx-panel-body">
            <p class="warp-txt">Cale ce son sur le tempo du projet, <b>sans changer sa hauteur</b>.</p>
            <div class="fx-row"><label class="fx-label">Tempo du son</label>
                <input type="text" class="set-num warp-bpm" value="…" inputmode="decimal"> <span>BPM</span>
                <button class="set-btn warp-half" data-tooltip="Le tempo trouvé est le double ou la moitié du vrai ?">÷2</button>
                <button class="set-btn warp-double">×2</button></div>
            <div class="fx-row"><label class="fx-label">Tempo du projet</label><span class="warp-proj"><b>${Math.round(bpmAtSec(clip.start) * 10) / 10}</b> BPM</span></div>
            <div class="warp-note"></div>
        </div>
        <div class="fx-panel-footer">
            ${clip.warp ? '<button class="warp-remove">Retirer le warp</button>' : '<button class="warp-adopt" data-tooltip="Le projet prend le tempo de ce son, rien n\'est étiré">Garder son tempo</button>'}
            <button class="warp-apply">Caler sur le projet</button>
        </div>`;
    document.body.appendChild(panel);
    panel.style.left = Math.min(x, window.innerWidth - 300) + 'px';
    panel.style.top = Math.max(8, Math.min(y, window.innerHeight - 260)) + 'px';
    const inp = panel.querySelector('.warp-bpm'), note = panel.querySelector('.warp-note');
    const refresh = () => {
        const v = parseFloat(String(inp.value).replace(',', '.'));
        const chk = Number.isFinite(v) ? PulseWarp.checkRatio(v, bpmAtSec(clip.start)) : { ok: false };
        panel.querySelector('.warp-apply').disabled = !chk.ok;
        note.textContent = !Number.isFinite(v) ? 'Écris le tempo du son (je le cherche tout seul si possible).'
            : !chk.ok ? 'Écart trop grand : essaie ÷2 ou ×2.'
            : Math.abs(v - bpmAtSec(clip.start)) < 0.05 ? 'Déjà au bon tempo : rien à caler.'
            : chk.big ? 'Gros changement de vitesse : le son peut un peu se dégrader.' : `Le son sera ${chk.ratio < 1 ? 'accéléré' : 'ralenti'} de ${Math.abs(Math.round((1 - chk.ratio) * 100))} %.`;
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('input', refresh);
    panel.querySelector('.warp-half').addEventListener('click', () => { inp.value = Math.round(parseFloat(inp.value) / 2 * 10) / 10; refresh(); });
    panel.querySelector('.warp-double').addEventListener('click', () => { inp.value = Math.round(parseFloat(inp.value) * 2 * 10) / 10; refresh(); });
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.warp-apply').addEventListener('click', async () => {
        const v = parseFloat(String(inp.value).replace(',', '.'));
        panel.remove();
        if (Math.abs(v - bpmAtSec(clip.start)) < 0.05) { flash('Déjà au bon tempo'); return; }
        await applyWarp(clip, v, bpmAtSec(clip.start));
    });
    const rm = panel.querySelector('.warp-remove');
    if (rm) rm.addEventListener('click', async () => { panel.remove(); await removeWarp(clip); });
    const adopt = panel.querySelector('.warp-adopt');
    if (adopt) adopt.addEventListener('click', () => {
        const v = parseFloat(String(inp.value).replace(',', '.'));
        if (!(v >= 40 && v <= 240)) { flash('Tempo entre 40 et 240 BPM'); return; }
        panel.remove(); pushUndo();
        state.project.bpm = Math.round(v * 10) / 10;
        document.getElementById('bpmInput').value = state.project.bpm;
        PulseAudio.setMetronomeBpm(state.project.bpm);
        renderRuler(); saveProject(); refreshPlaybackSoon();
        flash(`Le projet est maintenant à ${state.project.bpm} BPM, comme ce son`);
    });
    // Tempo du son : celui déjà connu, sinon détecté
    (async () => {
        if (srcBpm === null) {
            const buf = await loadBufferById(srcId);
            srcBpm = buf ? detectBpmStub(buf) : null;
        }
        if (document.body.contains(panel)) { inp.value = srcBpm !== null ? srcBpm : ''; refresh(); }
    })();
    setTimeout(() => {
        document.addEventListener('mousedown', function closeW(ev) {
            if (!document.body.contains(panel)) { document.removeEventListener('mousedown', closeW); return; }
            if (!ev.composedPath().includes(panel)) { panel.remove(); document.removeEventListener('mousedown', closeW); }
        });
    }, 100);
}

let _tuneBusy = false;
async function applyTune(clip, opts) {
    if (_tuneBusy) { flash('Un Auto-Tune est déjà en cours — attends qu\'il finisse'); return; }
    _tuneBusy = true;
    try {
        const srcId = clip.tune ? clip.tune.src : clip.id;
        const src = await loadBufferById(srcId);
        if (!src) { flash('Le son de ce clip est introuvable — impossible d\'appliquer l\'Auto-Tune'); return; }
        const sr = src.sampleRate;
        const off = clip.offset || 0;
        // On ne traite que la partie utilisée par le clip (+ une petite marge)
        const a = Math.max(0, Math.floor((off - 0.3) * sr));
        const b = Math.min(src.length, Math.ceil((off + clip.duration + 0.3) * sr));
        const slices = [];
        for (let ch = 0; ch < src.numberOfChannels; ch++) slices.push(src.getChannelData(ch).subarray(a, b));
        flash('🎤 Auto-Tune en cours…');
        let lastStep = 0;
        const res = await PulseTune.process(slices, sr, opts, (p) => {
            const step = Math.floor(p * 4);
            if (step > lastStep) { lastStep = step; flash(`🎤 Auto-Tune en cours… ${Math.min(99, Math.round(p * 100))} %`); }
        });
        if (res.voicedPct < 0.05) {
            flash('Je n\'entends pas de note dans ce clip — l\'Auto-Tune marche sur une voix, pas sur une instru ou un silence');
            return;
        }
        const out = PulseAudio.getContext().createBuffer(src.numberOfChannels, src.length, sr);
        const xf = Math.min(Math.round(0.005 * sr), Math.floor((b - a) / 4));
        for (let ch = 0; ch < src.numberOfChannels; ch++) {
            const dst = out.getChannelData(ch);
            const orig = src.getChannelData(ch);
            dst.set(orig);
            const tuned = res.channels[ch];
            for (let i = 0; i < tuned.length; i++) {
                // mini-fondu aux deux raccords avec l'original
                const w = Math.min(1, i / xf, (tuned.length - 1 - i) / xf);
                dst[a + i] = tuned[i] * w + orig[a + i] * (1 - w);
            }
        }
        const newId = `${srcId}_t${Date.now().toString(36)}`;
        PulseAudio.registerBuffer(newId, out);
        try { await PulsePersist.saveBlob(newId, PulseAudio.audioBufferToWav(out), { kind: 'tune' }); }
        catch (e) { console.warn('Persist tune failed', e); }
        if (!opts.noUndo) pushUndo();
        clip.id = newId;
        clip.tune = opts.notes
            ? { src: srcId, notes: opts.notes, source: opts.source || 'clavier', tonic: opts.tonic, minor: opts.minor, strength: opts.strength }
            : { src: srcId, root: res.root, auto: opts.root === 'auto', strength: opts.strength };
        clip.peaks = makePeaks(out);
        renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
        const key = opts.notes
            ? (opts.notes.every(Boolean) ? 'toutes les notes' : state.project.key?.label ? state.project.key.label : 'réglage manuel')
            : res.root < 0 ? 'toutes les notes' : PulseTune.keyLabel(res.root);
        flash(`✓ Auto-Tune appliqué (${key}) — clic droit sur le clip pour le régler ou le retirer`);
    } catch (err) {
        console.error(err);
        flash('L\'Auto-Tune n\'a pas pu traiter ce clip — réessaie sur un clip plus court');
    } finally {
        _tuneBusy = false;
    }
}

// Auto-Tune de piste : corrige toutes les prises de la piste, l'une après l'autre
function tuneOpts(a) {
    // PulseTune : Humain, Souplesse, Vibrato naturel et type de voix suivent jusqu'au moteur (tune.js)
    const more = { human: a.human || 0, flex: a.flex || 0, vibrato: a.vibrato || 0, voice: a.voice || 'mid' };
    return a.notes ? { notes: a.notes.slice(), source: a.source, strength: a.strength, tonic: a.tonic, minor: a.minor, ...more } : { root: 'auto', strength: a.strength, ...more };
}
async function tuneWholeTrack(trackIdx, onlyClips = null, noUndo = false) {
    const t = state.project.tracks[trackIdx];
    if (!t || !t.autotune || !t.autotune.on) return;
    const clips = (onlyClips || t.clips || []).filter(c => !c.midi && !c.recording);
    let n = 0;
    for (const c of clips) {
        if (c.tune && !onlyClips && JSON.stringify(c.tune.notes || null) === JSON.stringify(t.autotune.notes || null) && (c.tune.strength === t.autotune.strength)) continue;
        await applyTune(c, { ...tuneOpts(t.autotune), noUndo });
        n++;
    }
    if (!clips.length) flash(`Auto-Tune activé sur « ${t.name} » : les prochaines prises seront corrigées toutes seules`);
    renderMixer(); bindMixerEvents();
}
async function untuneWholeTrack(trackIdx) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    pushUndo();
    delete t.autotune;
    for (const c of (t.clips || [])) if (c.tune) await removeTune(c, true);
    saveProject(); renderMixer(); bindMixerEvents();
    flash(`Auto-Tune retiré de « ${t.name} »`);
}

async function removeTune(clip, noUndo = false) {
    if (!clip.tune) return;
    const src = await loadBufferById(clip.tune.src);
    if (!src) { flash('La prise d\'origine est introuvable — l\'Auto-Tune ne peut pas être retiré'); return; }
    if (!noUndo) pushUndo();
    clip.id = clip.tune.src;
    delete clip.tune;
    clip.peaks = makePeaks(src);
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash('Auto-Tune retiré — tu retrouves ta voix d\'origine');
}

// === Son de la piste : presets Pulse + 3 curseurs simples (PRESETS.md) ===
const SOUND_PRESETS = {
    lead:     { label: 'Voix lead', eq: { hpf: 80,  midGain: -2, presence: 2, air: 1 },   hold: 35, drive: 0,  space: 0,  deess: 30 },
    doublage: { label: 'Doublage',  eq: { hpf: 120, midGain: -2, presence: 1, air: 0 },   hold: 40, drive: 0,  space: 0,  deess: 40 },
    back:     { label: 'Back',      eq: { hpf: 150, midGain: -2, presence: 1, air: 0 },   hold: 55, drive: 0,  space: 36, deess: 40 },
    adlib:    { label: 'Ad-lib',    eq: { hpf: 120, midGain: -2, presence: 3, air: 1.5 }, hold: 50, drive: 15, space: 25, deess: 30 },
    phone:    { label: 'Téléphone', eq: { hpf: 400, midGain: 3,  presence: 2, air: -6, lpf: 3200 }, hold: 60, drive: 35, space: 0, deess: 0 },
    raw:      { label: 'Brut',      eq: null, hold: 0, drive: 0, space: 0, deess: 0 }
};
// Sons de groupe : ce qu'on met sur toutes les pistes d'un groupe d'un coup
const GROUP_PRESETS = {
    glue:  { label: 'Soudé',         eq: null, hold: 25, drive: 0,  space: 0,  deess: 0 },
    room:  { label: 'Même pièce',    eq: null, hold: 15, drive: 0,  space: 14, deess: 0 },
    wide:  { label: 'Grande salle',  eq: null, hold: 15, drive: 0,  space: 32, deess: 0 },
    warm:  { label: 'Chaud',         eq: { hpf: 30, midGain: 1, presence: -1, air: -1 }, hold: 25, drive: 20, space: 0, deess: 0 },
    raw:   { label: 'Brut',          eq: null, hold: 0, drive: 0, space: 0, deess: 0 }
};
const isBusTarget = (t) => (state.project.buses || []).includes(t);
// Sur un groupe on retrouve toute la chaîne de voix (c'est là que se font les vrais réglages) + les sons de groupe
const { raw: _rawVoice, ...VOICE_ONLY } = SOUND_PRESETS;
const presetsFor = (t) => isBusTarget(t) ? { ...VOICE_ONLY, ...GROUP_PRESETS } : SOUND_PRESETS;

// Traduit le réglage simple (preset + ton / tenue / grain) en vrais paramètres d'effets
function applySound(t) {
    if (!t || !t.sound) return;   // piste sans réglage de son : rien à appliquer (évite une exception)
    const snd = t.sound;
    const set = presetsFor(t);
    const P = set[snd.preset] || set.lead || set.raw;
    const tone = snd.tone || 0, hold = snd.hold || 0, drive = snd.drive || 0;
    const space = snd.space ?? P.space ?? 0, deess = snd.deess ?? P.deess ?? 0; // anciens projets : valeurs du preset
    const fx = [], params = {};
    if (P.eq || tone !== 0) {
        const base = P.eq || { hpf: 30, midGain: 0, presence: 0, air: 0 };
        fx.push('eq');
        params.eq = {
            hpf: base.hpf,
            midGain: Math.max(-12, Math.min(6, base.midGain + tone * 0.02)),
            presence: Math.max(-6, Math.min(6, base.presence - tone * 0.03)),   // jamais plus de +6 dB
            air: Math.max(-8, Math.min(6, base.air - tone * 0.03))
        };
        if (base.lpf) params.eq.lpf = base.lpf;
    }
    if (hold > 0) {
        fx.push('comp');
        params.comp = { ratio: +(1.5 + hold * 0.045).toFixed(2), threshold: Math.round(-14 - hold * 0.16), attack: 10, release: 50 };
    }
    if (drive > 0) { fx.push('sat'); params.sat = { drive }; }
    if (deess > 0) { fx.push('deess'); params.deess = { amount: deess }; }
    const echo = snd.echo || 0;
    // Sur une piste, « espace » et « écho » dosent les deux envois communs du morceau (une seule reverb, un seul écho
    // pour toutes les voix). Sur un groupe, ou si l'envoi a été retiré, l'effet est posé directement.
    // Un groupe a ses envois comme une piste : « espace » et « écho » dosent les mêmes envois communs
    const isTrack = true;
    const revSend = projectSends().find(sd => sd.type === 'reverb');
    const delSend = projectSends().find(sd => sd.type === 'delay');
    if (isTrack) {
        t.sends = t.sends || {};
        if (revSend) { if (space > 0) t.sends[revSend.id] = Math.round(space); else delete t.sends[revSend.id]; }
        if (delSend) { if (echo > 0) t.sends[delSend.id] = Math.round(echo); else delete t.sends[delSend.id]; }
    }
    if (echo > 0 && !delSend) {
        fx.push('delay');
        params.delay = { wet: Math.round(echo * 0.5), feedback: Math.round(20 + echo * 0.35) };
        if (snd.echoMs > 0) params.delay.ms = snd.echoMs; else params.delay.beats = snd.echoBeats || 0.5;
    }
    if (space > 0 && !revSend) { fx.push('reverb'); params.reverb = { wet: Math.round(space * 0.6), size: +(1.2 + space * 0.02).toFixed(2), decay: 2.5 }; }
    // EQ réglé à la main (points libres) : il prend la main sur celui du preset
    if (Array.isArray(t.eqBands)) { if (!fx.includes('eq')) fx.push('eq'); params.eq = { bands: t.eqBands }; }
    // Réglé à la main dans le panneau Pro (Comp, EQ…) : le curseur « Son » le laisse tel quel
    if (t.proKeep && t.effectParams) {
        Object.keys(t.proKeep).forEach(k => {
            if (t.proKeep[k] && t.effectParams[k]) { if (!fx.includes(k)) fx.push(k); params[k] = t.effectParams[k]; }
        });
    }
    t.effects = fx;
    t.effectParams = params;
}

function openSoundPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    // trackIdx : numéro de piste, ou directement un groupe
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const isBus = isBusTarget(t), PRESETS = presetsFor(t);
    const cur = { ...(t.sound || { preset: null, tone: 0, hold: isBus ? 0 : 35, drive: 0, space: 0, deess: 0 }) };
    if (!isBus) {
        const rs = projectSends().find(sd => sd.type === 'reverb'), ds = projectSends().find(sd => sd.type === 'delay');
        if (rs) cur.space = (t.sends || {})[rs.id] || 0;
        if (ds) cur.echo = (t.sends || {})[ds.id] || 0;
    }
    const curP = PRESETS[cur.preset] || {};
    const panel = document.createElement('div');
    panel.className = 'fx-panel sound-panel';
    const slider = (key, left, right, min, val) => `
        <div class="sound-row">
            <div class="sound-ends"><span>${left}</span><span>${right}</span></div>
            <input type="range" class="fx-slider" data-key="${key}" data-default="${curP[key] ?? 0}" min="${min}" max="100" step="1" value="${val}">
        </div>`;
    panel.innerHTML = `
        <div class="fx-panel-header"><span>Son de « ${esc(t.name)} »</span><button class="fx-panel-close">×</button></div>
        <div class="sound-presets">
            ${Object.entries(PRESETS).map(([k, p]) => `<button class="sound-chip ${cur.preset === k ? 'active' : ''}" data-preset="${k}">${p.label}</button>`).join('')}
        </div>
        ${isBus ? '<div class="sound-hint">Ce réglage s\'applique à toutes les pistes du groupe en même temps.</div>' : ''}
        <div class="fx-panel-body">
            ${slider('tone', 'Plus clair', 'Plus chaud', -100, cur.tone || 0)}
            ${slider('hold', 'Dynamique', 'Plus tenu', 0, cur.hold || 0)}
            ${slider('drive', 'Doux', 'Agressif', 0, cur.drive || 0)}
            ${slider('deess', 'S naturels', 'S adoucis', 0, cur.deess ?? curP.deess ?? 0)}
            ${slider('space', 'Sec', 'Reverb (effet de salle)', 0, cur.space ?? curP.space ?? 0)}
            ${slider('echo', 'Sans écho', 'Écho (répétitions)', 0, cur.echo || 0)}
            <div class="echo-time" ${cur.echo > 0 && isBus ? '' : 'hidden'}>
                <span>L'écho revient</span>
                <div class="echo-chips">
                    ${[[0.25, '¼ temps'], [0.5, '½ temps'], [1, '1 temps'], [2, '2 temps']].map(([b, l]) => `<button data-beats="${b}" class="${!(cur.echoMs > 0) && (cur.echoBeats || 0.5) === b ? 'active' : ''}">${l}</button>`).join('')}
                </div>
                <label class="echo-ms ${cur.echoMs > 0 ? 'active' : ''}">ou tous les <input type="number" min="20" max="2000" step="10" value="${cur.echoMs > 0 ? cur.echoMs : ''}" placeholder="—"> ms</label>
            </div>
        </div>
        <div class="fx-panel-footer sound-pro" ${isBus ? 'hidden' : ''}>
            <span>Mode Pro :</span>
            <button data-pro="eq">EQ</button><button data-pro="comp">Comp</button>
        </div>`;
    document.body.appendChild(panel);
    const rect = anchorEl.getBoundingClientRect();
    const pw = 270;
    let left = rect.right + 8;
    if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, rect.top - 20)) + 'px';

    let undoPushed = false;
    const commit = () => {
        if (!undoPushed) { pushUndo(); undoPushed = true; }
        applySound(t);
        renderMixer(); bindMixerEvents();
        refreshPlaybackSoon(); saveProject();
    };
    panel.querySelectorAll('.sound-chip').forEach(chip => chip.addEventListener('click', () => {
        const P = PRESETS[chip.dataset.preset];
        t.sound = { preset: chip.dataset.preset, tone: 0, hold: P.hold, drive: P.drive, space: P.space, deess: P.deess };
        commit();
        if (isBus) { renderTracksPanel(); bindTrackEvents(); }
        flash(`Son « ${P.label} » appliqué sur ${isBus ? 'le groupe ' : ''}${t.name}`);
        openSoundPanel(trackIdx, anchorEl);
    }));
    panel.querySelectorAll('.fx-slider').forEach(sl => sl.addEventListener('input', () => {
        t.sound = t.sound || { preset: isBus ? 'raw' : 'lead', tone: 0, hold: isBus ? 0 : 35, drive: 0, space: curP.space ?? 0, deess: curP.deess ?? 0 };
        t.sound[sl.dataset.key] = parseFloat(sl.value);
        if (sl.dataset.key === 'echo') panel.querySelector('.echo-time').hidden = !(t.sound.echo > 0 && isBus);
        commit();
    }));
    // Temps de l'écho : calé sur le rythme du morceau (suit le tempo), ou un nombre de millisecondes
    const echoBox = panel.querySelector('.echo-time');
    const paintEcho = () => {
        const s = t.sound || {};
        echoBox.querySelectorAll('[data-beats]').forEach(b => b.classList.toggle('active', !(s.echoMs > 0) && (s.echoBeats || 0.5) === parseFloat(b.dataset.beats)));
        echoBox.querySelector('.echo-ms').classList.toggle('active', s.echoMs > 0);
    };
    echoBox.querySelectorAll('[data-beats]').forEach(b => b.addEventListener('click', () => {
        t.sound.echoBeats = parseFloat(b.dataset.beats); delete t.sound.echoMs;
        echoBox.querySelector('input').value = '';
        paintEcho(); commit();
    }));
    const msInput = echoBox.querySelector('input');
    msInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') msInput.blur(); });
    msInput.addEventListener('change', () => {
        const v = parseFloat(msInput.value);
        if (v > 0) { t.sound.echoMs = Math.max(20, Math.min(2000, Math.round(v))); msInput.value = t.sound.echoMs; }
        else { delete t.sound.echoMs; msInput.value = ''; }
        paintEcho(); commit();
    });
    panel.querySelectorAll('[data-pro]').forEach(b => b.addEventListener('click', () => {
        openEffectPanel(trackIdx, b.dataset.pro, anchorEl);
    }));
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    setTimeout(() => {
        document.addEventListener('mousedown', function closeSnd(ev) {
            if (!document.body.contains(panel)) { document.removeEventListener('mousedown', closeSnd); return; }
            if (!panel.contains(ev.target) && !ev.target.closest('.strip-sound, .g-son')) {
                panel.remove();
                document.removeEventListener('mousedown', closeSnd);
            }
        });
    }, 100);
}
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mixer-strips .strip-sound'); // la tranche de gauche a son propre bouton
    if (btn) {
        const st = btn.closest('.strip');
        if (st.dataset.kind === 'bus') openSoundPanel(state.project.buses[parseInt(st.dataset.i)], btn);
        else openSoundPanel(parseInt(st.dataset.i), btn);
    }
});

// === Mon texte : un bloc-notes à côté du morceau, sauvegardé dans le projet ===
function setLyricsOpen(open) {
    const panel = document.getElementById('lyricsPanel');
    panel.hidden = !open;
    document.body.classList.toggle('lyrics-open', open);
    document.getElementById('btnLyrics').classList.toggle('active', open);
    try { localStorage.setItem('pulse_lyrics_open', open ? '1' : '0'); } catch {}
    if (open) document.getElementById('lyricsText').value = state.project.lyrics || '';
}
function initLyrics() {
    const ta = document.getElementById('lyricsText');
    let size = 15;
    try { size = parseInt(localStorage.getItem('pulse_lyrics_size')) || 15; } catch {}
    const applySize = () => { ta.style.fontSize = size + 'px'; try { localStorage.setItem('pulse_lyrics_size', size); } catch {} };
    applySize();
    document.getElementById('btnLyrics').addEventListener('click', () => {
        const open = document.getElementById('lyricsPanel').hidden;
        setLyricsOpen(open);
        if (open) ta.focus();
    });
    document.getElementById('lyricsClose').addEventListener('click', () => setLyricsOpen(false));
    document.getElementById('lyricsSmaller').addEventListener('click', () => { size = Math.max(11, size - 2); applySize(); });
    document.getElementById('lyricsBigger').addEventListener('click', () => { size = Math.min(31, size + 2); applySize(); });
    // Les raccourcis du studio (Espace, R, Q…) ne doivent pas partir pendant qu'on écrit
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { ta.blur(); return; }
        e.stopPropagation();
    });
    let timer = null;
    ta.addEventListener('input', () => {
        state.project.lyrics = ta.value;
        clearTimeout(timer);
        timer = setTimeout(saveProject, 600);
    });
    ta.addEventListener('blur', () => { clearTimeout(timer); if ((state.project.lyrics || '') === ta.value) saveProject(); });
    // « Suivre » : la ligne qui correspond à la mesure en cours s'allume et défile (téléprompteur pour poser sa voix)
    const view = document.getElementById('lyricsFollowView'), bar = document.getElementById('lyricsFollowBar');
    const fbtn = document.getElementById('lyricsFollow');
    const map = () => (state.project.lyricsMap = state.project.lyricsMap || { start: 1, per: 1 });
    let follow = false, lastK = -2;
    const lines = () => ta.value.split('\n').map(l => l.trim()).filter(Boolean);
    const paint = () => {
        view.style.fontSize = (size + 3) + 'px';
        const L = lines();
        view.innerHTML = L.length ? L.map((l, k) => `<div class="lf-line" data-k="${k}">${esc(l)}</div>`).join('')
            : '<div class="lf-empty">Écris ton texte, puis appuie sur Suivre : chaque ligne s\'allumera à sa mesure.</div>';
        lastK = -2; update();
    };
    const update = () => {
        if (!follow) return;
        const m = map(), spb = 60 / (state.project.bpm || 120), barSec = spb * (typeof bpb === 'function' ? bpb() : 4);
        const live = state.playing || state.recording;
        let pos = state.playhead / barSec;                        // en mesures depuis le début
        if (tempoVaries()) { const q = PulseTempo.beatsToBar(state.project, beatAtSec(state.playhead)); pos = q.bar + q.beat / q.beats; }
        const k = Math.floor((pos - (m.start - 1)) / m.per);
        const L = view.querySelectorAll('.lf-line');
        const now = live ? Math.max(-1, Math.min(L.length, k)) : -1;   // après la dernière ligne : tout est « passé », plus rien d'allumé
        if (now === lastK) return;
        lastK = now;
        L.forEach((el, i) => { el.classList.toggle('now', i === now); el.classList.toggle('past', now >= 0 && i < now); });
        if (now >= 0 && L[now]) L[now].scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    window.updateLyricsFollow = update;
    const setFollow = (on) => {
        follow = on;
        view.hidden = !on; bar.hidden = !on; ta.hidden = on;
        fbtn.classList.toggle('active', on); fbtn.textContent = on ? 'Écrire' : 'Suivre';
        try { localStorage.setItem('pulse_lyrics_follow', on ? '1' : '0'); } catch {}
        if (on) {
            document.getElementById('lfStart').value = map().start;
            document.getElementById('lfPer').value = String(map().per);
            paint();
        }
    };
    fbtn.addEventListener('click', () => setFollow(!follow));
    document.getElementById('lfStart').addEventListener('change', (e) => { map().start = Math.max(1, parseInt(e.target.value) || 1); saveProject(); lastK = -2; update(); });
    document.getElementById('lfPer').addEventListener('change', (e) => { map().per = parseFloat(e.target.value) || 1; saveProject(); lastK = -2; update(); });
    document.getElementById('lfStart').addEventListener('keydown', (e) => e.stopPropagation());
    window.lyricsFollowOn = () => follow;
    let wasFollow = false;
    try { wasFollow = localStorage.getItem('pulse_lyrics_follow') === '1'; } catch {}
    if (wasFollow && (state.project.lyrics || '').trim()) setTimeout(() => { if (!document.getElementById('lyricsPanel').hidden) setFollow(true); }, 0);
    let wasOpen = false;
    try { wasOpen = localStorage.getItem('pulse_lyrics_open') === '1'; } catch {}
    // On le rouvre s'il était ouvert, ou si ce projet a déjà un texte
    if (wasOpen || (state.project.lyrics || '').trim()) setLyricsOpen(true);
}

// Calage automatique voix / instru
async function runLatencyCalibration() {
    if (state.playing || state.recording) { flash('Arrête la lecture avant de lancer le réglage'); return; }
    flash('🔊 Réglage en cours : monte le son et approche ton casque (ou tes enceintes) du micro… 6 petits clics');
    let res;
    try { res = await PulseAudio.calibrateLatency(); }
    catch (err) { flash(micErrorMessage(err)); return; }
    if (res.ok) flash(`✓ Calage réglé : ton micro entend le son ${res.ms} ms après — tes prises seront recalées d'autant`);
    else if (res.reason === 'silence') flash('Le micro n\'a pas entendu les clics — monte le volume, colle le casque au micro, puis relance le réglage');
    else if (res.reason === 'unstable') flash('Mesure pas nette (trop de bruit autour) — fais le silence, puis relance le réglage');
    else flash('Réglage impossible pour l\'instant — arrête la lecture et réessaie');
}

// Applique un changement d'effet pendant la lecture : on reconstruit le graphe à la position courante
let _fxRefreshTimer = null;
function refreshPlaybackSoon() {
    if (!state.playing || state.recording) return;
    clearTimeout(_fxRefreshTimer);
    _fxRefreshTimer = setTimeout(() => {
        if (!state.playing || state.recording) return;
        PulseAudio.play(state.project, PulseAudio.getPlaybackPosition(), { smooth: true });
    }, 120);
}

// === Interfaces graphiques EQ / Compresseur ===
// La courbe de l'EQ est calculée avec les mêmes filtres que le son (passe-haut, médiums, présence, air).
function biquadDb(type, f0, g, q, f) {
    const w0 = 2 * Math.PI * f0 / 48000, cs = Math.cos(w0), sn = Math.sin(w0), A = Math.pow(10, g / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
        const al = sn / (2 * Math.pow(10, q / 20));
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'peaking') {
        const al = sn / (2 * q);
        b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
    } else if (type === 'lowpass') {
        const al = sn / (2 * Math.pow(10, q / 20));
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'notch') {
        const al = sn / (2 * q);
        b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'lowshelf') {
        const sq = 2 * Math.sqrt(A) * (sn / 2 * Math.SQRT2);
        b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq);
        a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq;
    } else { // highshelf
        const sq = 2 * Math.sqrt(A) * (sn / 2 * Math.SQRT2);
        b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq);
        a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq;
    }
    const w = 2 * Math.PI * f / 48000, c1 = Math.cos(w), c2 = Math.cos(2 * w);
    const num = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * c1 + 2 * b0 * b2 * c2;
    const den = a0 * a0 + a1 * a1 + a2 * a2 + 2 * (a0 * a1 + a1 * a2) * c1 + 2 * a0 * a2 * c2;
    return 10 * Math.log10(num / den);
}
const VIZ_W = 216;
// Écho : les répétitions posées sur la grille du tempo (en haut = gauche, en bas = droite en ping-pong)
function delayVizSvg(p, bpm) {
    const W = 420, H = 150, bars = 2, beatW = W / (bars * 4), base = H / 2;
    const beats = p.beats > 0 ? p.beats : 0.5, dt = beats * beatW, pp = !!p.pp;
    let g = '';
    for (let i = 0; i <= bars * 4; i++) g += `<line x1="${(i * beatW).toFixed(1)}" x2="${(i * beatW).toFixed(1)}" y1="0" y2="${H - 14}" class="${i % 4 ? 'viz-grid' : 'viz-grid viz-bar'}"/>${i < bars * 4 ? `<text x="${(i * beatW + 3).toFixed(1)}" y="${H - 3}" class="viz-txt">${Math.floor(i / 4) + 1}.${i % 4 + 1}</text>` : ''}`;
    g += `<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="viz-zero"/>`;
    if (pp) g += `<text x="4" y="12" class="viz-txt">G</text><text x="4" y="${H - 18}" class="viz-txt">D</text>`;
    const vw = Math.max(5, Math.min(dt * 0.55, 40));
    g += `<rect x="2" y="${base - 46}" width="${vw}" height="92" rx="3" class="dl-voice"/>`;
    const filt = Math.min(1, Math.log10(Math.max(20, p.hpf || 20) / 20) / 2 * 0.4 + (1 - Math.log10((p.lpf || 4000) / 1000) / 1.3) * 0.25);
    let a = 0.55 + 0.4 * (p.wet ?? 25) / 100, k = 1;
    for (let x = dt; x < W && a > 0.03; x += dt, k++) {
        const h = 92 * Math.sqrt(a), top = pp ? (k % 2 ? base - h : base) : base - h / 2, hh = pp ? h : h;
        g += `<rect x="${(x + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(4, Math.min(dt * 0.5, 30)).toFixed(1)}" height="${hh.toFixed(1)}" rx="2" class="dl-rep" style="opacity:${(0.35 + 0.65 * a).toFixed(2)}"/>`;
        if (k === 1 && (p.duck || 0) > 0) g += `<rect x="${(x + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(4, Math.min(dt * 0.5, 30)).toFixed(1)}" height="${(hh * p.duck / 100).toFixed(1)}" rx="2" class="dl-duck"/>`;
        a *= Math.max(0.05, (p.feedback ?? 35) / 100) * (1 - filt * 0.2);
    }
    const ms = Math.round(beats * 60000 / (bpm || 90));
    g += `<text x="${W - 4}" y="12" class="viz-txt" text-anchor="end">${beatsLabel(beats)} = ${ms} ms · ${Math.round(p.feedback ?? 35)} % de répétitions</text>`;
    if ((p.duck || 0) > 0) g += `<text x="${W - 4}" y="${H - 18}" class="viz-txt dl-duck-txt" text-anchor="end">ducking ${Math.round(p.duck)} % : l'écho se pousse pendant la voix</text>`;
    return `<svg class="viz-svg viz-delay" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}
// Reverb : la vie du son — pré-délai, premières réflexions, queue qui s'éteint (et le ducking qui la pousse pendant la voix)
function reverbVizSvg(p) {
    const W = 420, H = 150, base = H - 16, secs = 5, X = (t) => 6 + t / secs * (W - 12);
    let g = '';
    for (let s2 = 0; s2 <= secs; s2++) g += `<line x1="${X(s2).toFixed(1)}" x2="${X(s2).toFixed(1)}" y1="4" y2="${base}" class="viz-grid"/><text x="${(X(s2) + 3).toFixed(1)}" y="${H - 3}" class="viz-txt">${s2} s</text>`;
    const pre = (p.pre || 0) / 1000, size = p.size ?? 1.8, decay = p.decay ?? 2.5, duck = (p.duck || 0) / 100;
    if (pre > 0) g += `<rect x="${X(0)}" y="4" width="${(X(pre) - X(0)).toFixed(1)}" height="${base - 4}" class="rv-pre"/>`;
    g += `<rect x="${X(0)}" y="${base - 9}" width="${(X(1.2) - X(0)).toFixed(1)}" height="7" rx="3" class="dl-voice"/><text x="${X(0) + 3}" y="${base - 12}" class="viz-txt">voix</text>`;
    // même forme que le moteur : plus de taille et de déclin = queue plus longue
    const fb = Math.max(0.5, Math.min(0.97, 0.72 + 0.2 * Math.max(0, Math.min(1, (size - 1.2) / 2)) + (decay - 2.5) * 0.025));
    const rt = Math.min(secs * 1.2, 0.035 * 6.9 / -Math.log(fb) * (size / 1.8) * 1.6);
    for (let i = 0; i < 6; i++) { const t2 = pre + 0.008 * (i + 1) * (1 + (i * 37 % 7) / 9) * size, h = (base - 40) * (0.7 - i * 0.07); g += `<rect x="${(X(t2) - 1).toFixed(1)}" y="${(base - h).toFixed(1)}" width="2.5" height="${h.toFixed(1)}" class="rv-er"/>`; }
    let d = `M${X(pre).toFixed(1)},${base}`, ref = d;
    for (let i = 0; i <= 140; i++) {
        const t2 = pre + i / 140 * (secs - pre), env = Math.exp(-6.9 * (t2 - pre) / rt) * (1 - Math.exp(-(t2 - pre) * 60));
        const db0 = Math.max(0, 1 + 20 * Math.log10(Math.max(env, 1e-6)) / 60);
        const dk = duck * (t2 < 1.2 ? 1 : Math.exp(-(t2 - 1.2) * 10));
        d += `L${X(t2).toFixed(1)},${(base - (base - 30) * 0.8 * db0 * (1 - dk * 0.8)).toFixed(1)}`;
        ref += `L${X(t2).toFixed(1)},${(base - (base - 30) * 0.8 * db0).toFixed(1)}`;
    }
    g += `<path d="${d}L${X(secs)},${base}Z" class="rv-tail"/>`;
    if (duck > 0) g += `<path d="${ref}" class="rv-ref"/><text x="${X(1.3)}" y="22" class="viz-txt dl-duck-txt">ducking ${Math.round(duck * 100)} % : la reverb se pousse pendant la voix</text>`;
    g += `<text x="${W - 4}" y="12" class="viz-txt" text-anchor="end">queue ≈ ${rt.toFixed(1).replace('.', ',')} s${pre > 0 ? ` · démarre après ${Math.round(pre * 1000)} ms` : ''}</text>`;
    return `<svg class="viz-svg viz-rev" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="rvg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#A855F7" stop-opacity=".8"/><stop offset="1" stop-color="#A855F7" stop-opacity=".08"/></linearGradient></defs>${g}</svg>`;
}
// EQ de la reverb (comme l'EQ de sortie des reverbs pro) : il ne colore que l'effet, la voix d'origine n'est pas touchée.
// Double-clic = poser un point (tout à gauche = coupe-bas, tout à droite = coupe-haut), tirer, molette = largeur,
// double-clic sur un point = le retirer, clic droit = sa forme.
const RVEQ = { W: 420, H: 150, DB: 18, MAX: 8 };
const rvFx = (f) => Math.log(f / 20) / Math.log(1000) * RVEQ.W;
const rvXf = (x) => 20 * Math.pow(1000, Math.max(0, Math.min(1, x / RVEQ.W)));
const rvDy = (d) => RVEQ.H / 2 - Math.max(-RVEQ.DB, Math.min(RVEQ.DB, d)) / RVEQ.DB * (RVEQ.H / 2 - 10);
const rvYd = (y) => (RVEQ.H / 2 - y) / (RVEQ.H / 2 - 10) * RVEQ.DB;
const rvFmtF = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '').replace('.', ',') + ' kHz' : Math.round(f) + ' Hz';
function reverbEqSvg(bands, sel) {
    const { W, H } = RVEQ;
    let g = '';
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(f => { g += `<line x1="${rvFx(f).toFixed(1)}" x2="${rvFx(f).toFixed(1)}" y1="0" y2="${H}" class="viz-grid"/>`; });
    [[100, '100'], [1000, '1k'], [10000, '10k']].forEach(([f, l]) => { g += `<text x="${(rvFx(f) + 3).toFixed(1)}" y="${H - 4}" class="viz-txt">${l}</text>`; });
    [-12, -6, 6, 12].forEach(d => { g += `<line x1="0" x2="${W}" y1="${rvDy(d).toFixed(1)}" y2="${rvDy(d).toFixed(1)}" class="viz-grid"/><text x="4" y="${(rvDy(d) - 2).toFixed(1)}" class="viz-txt">${d > 0 ? '+' : ''}${d}</text>`; });
    g += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="viz-zero"/>`;
    const on = bands.filter(b => b.on !== false), tot = (f) => on.reduce((a, b) => a + eqBandDb(b, f), 0);
    // Comme le grand EQ : la courbe s'arrête net quand elle sort par le bas (coupe-bas / coupe-haut), sans trait plat collé en bas,
    // et ce qu'elle retire est assombri jusqu'au bord de l'écran
    let line = '', pen = false, shade = '', boost = '';
    for (let x = 0; x <= W; x += 2) {
        const v = tot(rvXf(x));
        const yl = H / 2 - Math.min(RVEQ.DB, v) / RVEQ.DB * (H / 2 - 10);   // sans butée en bas : la courbe sort par le bord
        if (yl > H + 4) { if (pen) line += `L${x},${H + 4}`; pen = false; }
        else { line += `${pen ? 'L' : (x ? `M${x - 2},${H + 4}L` : 'M')}${x},${yl.toFixed(1)}`; pen = true; }
        shade += `${x ? 'L' : 'M'}${x},${(v < -RVEQ.DB ? H : rvDy(Math.min(0, v))).toFixed(1)}`;
        boost += `${x ? 'L' : 'M'}${x},${rvDy(Math.max(0, v)).toFixed(1)}`;
    }
    g += `<path d="${shade}L${W},${H / 2}L0,${H / 2}Z" class="eq-cut"/><path d="${boost}L${W},${H / 2}L0,${H / 2}Z" class="rveq-fill"/><path d="${line}" class="rveq-line"/>`;
    bands.forEach((b, i) => {
        const x = rvFx(Math.max(20, Math.min(20000, b.freq))), y = EQ_FLAT(b.type) ? rvDy(tot(b.freq)) : rvDy(b.gain || 0);
        g += `<g class="rveq-pt ${i === sel ? 'sel' : ''} ${b.on === false ? 'off' : ''}" data-i="${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/><text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`;
    });
    if (!bands.length) g += `<text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" class="viz-txt rveq-empty">double-clic pour poser un point · tout à gauche = coupe-bas · tout à droite = coupe-haut</text>`;
    return `<svg class="viz-svg rveq-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}
function bindFxEq(panel, t, fxName = 'reverb') {
    const host = panel.querySelector('.rv-eq-host'), read = panel.querySelector('.rv-eq-read');
    if (!host) return;
    let sel = -1, undone = false;
    const bands = () => (((t.effectParams || {})[fxName] || {}).eq || []).map(b => ({ ...b }));
    const draw = () => {
        const arr = bands(); if (sel >= arr.length) sel = arr.length - 1;
        host.innerHTML = reverbEqSvg(arr, sel);
        readOut();
    };
    const readOut = () => {
        const arr = bands(), b = arr[sel];
        read.textContent = b ? `${sel + 1} · ${EQ_TYPES[b.type] || b.type} · ${rvFmtF(b.freq)}${EQ_FLAT(b.type) ? '' : ` · ${(b.gain > 0 ? '+' : '') + (b.gain || 0).toFixed(1).replace('.', ',')} dB`}${b.type === 'hpf' || b.type === 'lpf' ? ` · ${b.slope || 12} dB/oct` : ` · Q ${(b.q || 1).toFixed(2).replace('.', ',')}`}${b.on === false ? ' · éteint' : ''}`
            : (arr.length ? 'clique un point pour le régler' : '');
    };
    const save = (arr) => {
        if (!undone) { pushUndo(); undone = true; setTimeout(() => { undone = false; }, 1500); }
        t.effectParams = t.effectParams || {};
        const rp = t.effectParams[fxName] = t.effectParams[fxName] || {};
        if (arr.length) rp.eq = arr; else delete rp.eq;
        delete rp._preset;
        (t.proKeep = t.proKeep || {})[fxName] = true;
        t.effects = t.effects || [];
        if (!t.effects.includes(fxName)) t.effects.push(fxName);
        refreshPlaybackSoon(); saveProject(); draw();
    };
    const at = (e) => { const svg = host.querySelector('svg'), r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * RVEQ.W / r.width, (e.clientY - r.top) * RVEQ.H / r.height]; };
    const ptOf = (e) => { const g = e.target.closest && e.target.closest('.rveq-pt'); return g ? +g.dataset.i : -1; };
    host.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const i = ptOf(e); if (i < 0) return;
        e.preventDefault(); sel = i;
        // pas de nouveau dessin ici : il casserait le double-clic (qui retire le point)
        host.querySelectorAll('.rveq-pt').forEach(g => g.classList.toggle('sel', +g.dataset.i === i));
        const [x0, y0] = at(e), b0 = bands()[i];
        let moved = false;
        const move = (ev) => {
            const [x, y] = at(ev);
            if (!moved && Math.hypot(x - x0, y - y0) < 2) return;
            moved = true;
            const arr = bands(), b = arr[i]; if (!b) return;
            b.freq = Math.round(Math.max(20, Math.min(20000, rvXf(rvFx(b0.freq) + (x - x0)))));
            if (!EQ_FLAT(b.type)) b.gain = Math.round(Math.max(-RVEQ.DB, Math.min(RVEQ.DB, (b0.gain || 0) + rvYd(y) - rvYd(y0))) * 10) / 10;
            save(arr);
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); undone = false; if (!moved) readOut(); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    host.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const i = ptOf(e), arr = bands();
        if (i >= 0) { arr.splice(i, 1); sel = -1; save(arr); return; }
        if (arr.length >= RVEQ.MAX) { flash(`${RVEQ.MAX} points au plus dans l'EQ ${fxName === 'delay' ? 'de l\'écho' : 'de la reverb'}`); return; }
        const [x, y] = at(e);
        const b = x < RVEQ.W * 0.06 ? { type: 'hpf', freq: 120, gain: 0, q: 0.7071, slope: 24 }
            : x > RVEQ.W * 0.94 ? { type: 'lpf', freq: 9000, gain: 0, q: 0.7071, slope: 24 }
            : { type: 'bell', freq: Math.round(rvXf(x)), gain: Math.round(Math.max(-RVEQ.DB, Math.min(RVEQ.DB, rvYd(y))) * 10) / 10, q: 1 };
        arr.push(b); sel = arr.length - 1; save(arr);
    });
    host.addEventListener('wheel', (e) => {
        const i = ptOf(e) >= 0 ? ptOf(e) : sel, arr = bands(), b = arr[i]; if (!b) return;
        e.preventDefault();
        b.q = Math.round(Math.max(0.1, Math.min(18, (b.q || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) * 1000) / 1000;
        sel = i; save(arr);
    }, { passive: false });
    host.addEventListener('contextmenu', (e) => {
        const i = ptOf(e); if (i < 0) return;
        e.preventDefault(); e.stopPropagation(); closeAllMenus(); sel = i; draw();
        const menu = document.createElement('div');
        menu.className = 'track-ctx-menu';
        menu.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth - 200)}px;top:${Math.min(e.clientY, window.innerHeight - 300)}px;z-index:400;min-width:180px`;
        const b = bands()[i];
        const item = (label, run) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.textContent = label; it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); const arr = bands(); run(arr[i]); save(arr); }); menu.appendChild(it); };
        ['bell', 'lowshelf', 'highshelf', 'hpf', 'lpf', 'notch'].forEach(k => item((b.type === k ? '✓ ' : '   ') + EQ_TYPES[k], (x) => {
            x.type = k;
            if (k === 'hpf' || k === 'lpf') { x.gain = 0; x.q = 0.7071; x.slope = x.slope || 24; } else delete x.slope;
            if (k === 'lowshelf' || k === 'highshelf') x.q = 0.7;
        }));
        if (b.type === 'hpf' || b.type === 'lpf') { const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); [12, 24, 48].forEach(sl => item(((b.slope || 12) === sl ? '✓ ' : '   ') + `Pente ${sl} dB/oct`, (x) => { x.slope = sl; })); }
        const sep2 = document.createElement('div'); sep2.className = 'ctx-sep'; menu.appendChild(sep2);
        item(b.on === false ? 'Rallumer ce point' : 'Éteindre ce point', (x) => { if (x.on === false) delete x.on; else x.on = false; });
        const del = document.createElement('div'); del.className = 'ctx-item'; del.textContent = 'Retirer ce point';
        del.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); const arr = bands(); arr.splice(i, 1); sel = -1; save(arr); });
        menu.appendChild(del);
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
    });
    panel.querySelector('.rv-eq-clear').addEventListener('click', () => { sel = -1; save([]); });
    draw();
}

// Vue « analogique » du compresseur : un vumètre de réduction (0 dB à droite, 20 dB à gauche)
// rev = échelle façon console de bus : 0 à gauche, 20 à droite, aiguille dont on ne voit que la pointe
function compNeedleDeg(g, rev) { const k = Math.max(0, Math.min(20, g)) / 20 * 90; return rev ? -45 + k : 45 - k; }
function compAnalogSvg(gr = 0, rev = false) {
    const cx = 108, cy = 124, R = 88, a = (g) => compNeedleDeg(g, rev) * Math.PI / 180;
    const pt = (r, ang) => [cx + r * Math.sin(ang), cy - r * Math.cos(ang)];
    const ticks = (rev ? [0, 4, 8, 12, 16, 20] : [0, 1, 2, 3, 5, 7, 10, 15, 20]).map(g => {
        const [x1, y1] = pt(R - 9, a(g)), [x2, y2] = pt(R, a(g)), [tx, ty] = pt(R + 11, a(g));
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="vu-tick ${g >= 10 ? 'hot' : ''}"/><text x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}" text-anchor="middle" class="vu-num ${g >= 10 ? 'hot' : ''}">${g}</text>`;
    }).join('');
    const [ax, ay] = pt(R, a(20)), [bx, by] = pt(R, a(0)), [hx, hy] = pt(R, a(10));
    return `<svg class="viz-svg viz-vu" width="${VIZ_W}" height="132" viewBox="0 0 ${VIZ_W} 132">
        <rect x="4" y="4" width="${VIZ_W - 8}" height="124" rx="10" class="vu-face"/>
        <path d="M${ax.toFixed(1)},${ay.toFixed(1)} A${R},${R} 0 0 1 ${bx.toFixed(1)},${by.toFixed(1)}" class="vu-arc"/>
        <path d="M${ax.toFixed(1)},${ay.toFixed(1)} A${R},${R} 0 0 1 ${hx.toFixed(1)},${hy.toFixed(1)}" class="vu-arc hot"/>
        ${ticks}
        <text x="${cx}" y="62" text-anchor="middle" class="vu-title">RÉDUCTION  dB</text>
        <g class="vu-needle" transform="rotate(${(a(gr) * 180 / Math.PI).toFixed(1)} ${cx} ${cy})"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R + 4}" class="vu-hand"/></g>
        <circle cx="${cx}" cy="${cy}" r="6" class="vu-pivot"/>
    </svg><div class="viz-note vu-note">Réduction en direct : <b class="vu-val">${gr.toFixed(1)} dB</b></div>`;
}
function compVizSvg(p) {
    const S = 132, LO = -48, xy = (d) => (d - LO) / -LO * (S - 14) + 7, yy = (d) => S - xy(d) + 0;
    const th = p.threshold, r = Math.max(1, p.ratio), out0 = th + (0 - th) / r;
    // Même calcul que le moteur : genou doux de part et d'autre du seuil
    const sl = 1 - 1 / r, knee = Math.max(0, p.knee ?? 10), half = knee / 2;
    const outOf = (i) => { const o = i - th; return i - (o >= half ? o * sl : (o > -half && knee > 0) ? sl * (o + half) * (o + half) / (2 * knee) : 0); };
    let pathC = `M${xy(LO)},${yy(LO)}`;
    for (let i = LO + 1; i <= 0; i++) pathC += `L${xy(i).toFixed(1)},${yy(outOf(i)).toFixed(1)}`;
    const gr = (0 - out0);
    return `<svg class="viz-svg viz-comp" width="${VIZ_W}" height="${S}" viewBox="0 0 ${VIZ_W} ${S}"><g transform="translate(${(VIZ_W - S) / 2},0)">
        <rect x="7" y="7" width="${S - 14}" height="${S - 14}" class="viz-box"/>
        <line x1="${xy(LO)}" y1="${yy(LO)}" x2="${xy(0)}" y2="${yy(0)}" class="viz-grid"/>
        <line x1="${xy(th)}" y1="7" x2="${xy(th)}" y2="${S - 7}" class="viz-grid"/>
        <path d="${pathC}L${xy(0)},${yy(0)}L${xy(th)},${yy(th)}Z" class="viz-fill"/><path d="${pathC}" class="viz-line"/>
        <circle cx="${xy(th)}" cy="${yy(th)}" r="6" class="viz-pt" data-key="threshold"/>
        <circle cx="${xy(0)}" cy="${yy(out0)}" r="6" class="viz-pt" data-key="ratio"/>
        <text x="9" y="18" class="viz-txt">sortie</text><text x="${S - 40}" y="${S - 10}" class="viz-txt">entrée</text></g></svg>
        <div class="viz-note">Réduit jusqu'à <b>${gr.toFixed(1)} dB</b> sur les plus forts passages</div>`;
}

// === EQ libre (façon Pro-Q) : des points à volonté sur la courbe ===
const EQ_TYPES = { bell: 'Cloche', lowshelf: 'Plateau grave', highshelf: 'Plateau aigu', hpf: 'Coupe-bas', lpf: 'Coupe-haut', notch: 'Encoche', tilt: 'Pente' };
// Icône de chaque forme = sa petite courbe
const EQ_ICON_PATHS = { bell: 'M1 12 C6 12 7 3 11 3 C15 3 16 12 21 12', lowshelf: 'M1 4 C6 4 8 4 10 8 C12 12 15 12 21 12', highshelf: 'M1 12 C6 12 9 12 11 8 C13 4 16 4 21 4',
    hpf: 'M2 14 C5 6 8 4 12 4 L21 4', lpf: 'M1 4 L10 4 C14 4 17 6 20 14', notch: 'M1 4 L8 4 C10 4 10.6 14 11 14 C11.4 14 12 4 14 4 L21 4', tilt: 'M1 12 C8 12 9 9 11 8 C13 7 14 4 21 4' };
const eqIcon = (k) => `<svg width="22" height="16" viewBox="0 0 22 16"><path d="${EQ_ICON_PATHS[k]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const EQ_FLAT = (t) => t === 'hpf' || t === 'lpf' || t === 'notch';   // points posés sur la courbe (pas de gain)
const EQ_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const eqNote = (f) => { const n = Math.round(12 * Math.log2(f / 440)) + 57; return EQ_NOTES[(n % 12 + 12) % 12] + Math.floor(n / 12); };
const EQ_COLORS = ['#A855F7', '#F472B6', '#22D3EE', '#FBBF24', '#34D399', '#60A5FA', '#FB7185', '#C084FC'];
const EQ_MAX_BANDS = 24;
// Bandes d'un EQ : celles de l'EQ libre, ou celles de l'ancienne chaîne fixe (même son)
function eqBandsOf(ep) {
    if (Array.isArray(ep.bands)) return ep.bands;
    const g = (k, d) => ep[k] !== undefined ? ep[k] : d;
    const out = [
        { type: 'hpf', freq: g('hpf', 80), gain: 0, q: 1.0839 },
        { type: 'bell', freq: 300, gain: g('midGain', -2), q: 1 },
        { type: 'bell', freq: 4000, gain: g('presence', 2), q: 0.7 },
        { type: 'highshelf', freq: 10000, gain: g('air', 1), q: 0.7 }
    ];
    if (ep.lpf) out.push({ type: 'lpf', freq: ep.lpf, gain: 0, q: 1.0839 });
    return out;
}
// Réponse d'une bande : exactement les filtres du moteur (calés sur l'analogique), mis en cache tant que la bande ne change pas
const _eqCoefCache = new Map();
function eqBandDb(b, f) {
    if (b.on === false) return 0;
    const key = `${b.type}|${b.freq}|${b.gain || 0}|${b.q}|${b.slope || ''}`;
    let k = _eqCoefCache.get(key);
    if (!k) { k = PulseAudio.eqBandCoefs({ ...b, freq: Math.max(20, Math.min(20000, b.freq)) }, 48000); if (_eqCoefCache.size > 500) _eqCoefCache.clear(); _eqCoefCache.set(key, k); }
    const w = 2 * Math.PI * f / 48000, c1 = Math.cos(w), c2 = Math.cos(2 * w);
    let db = 0;
    for (const [b0, b1, b2, a1, a2] of k) {
        const num = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * c1 + 2 * b0 * b2 * c2;
        const den = 1 + a1 * a1 + a2 * a2 + 2 * (a1 + a1 * a2) * c1 + 2 * a2 * c2;
        db += 10 * Math.log10(Math.max(num, 1e-30) / den);
    }
    return db;
}

// Modèles d'EQ : un point de départ à affiner (hpf / lpf : q = pente)
const EQ_PRESETS = {
    clean: { label: 'Clean : tout à zéro', bands: [] },
    voix:    { label: 'Voix rap : propre et devant', bands: [{ type: 'hpf', freq: 80, q: 0.7 }, { type: 'bell', freq: 300, gain: -2.5, q: 1.2 }, { type: 'bell', freq: 3200, gain: 2.5, q: 0.9 }, { type: 'highshelf', freq: 10000, gain: 2, q: 1 }] },
    nettoyer:{ label: 'Nettoyer : enlever le gras', bands: [{ type: 'hpf', freq: 100, q: 0.7 }, { type: 'bell', freq: 250, gain: -3.5, q: 1.4 }, { type: 'bell', freq: 500, gain: -1.5, q: 1 }] },
    presence:{ label: 'Présence : passer devant l\'instru', bands: [{ type: 'hpf', freq: 90, q: 0.7 }, { type: 'bell', freq: 2800, gain: 3.5, q: 0.8 }, { type: 'bell', freq: 5500, gain: 1.5, q: 1 }] },
    air:     { label: 'Air : brillant', bands: [{ type: 'hpf', freq: 100, q: 0.7 }, { type: 'highshelf', freq: 9000, gain: 4, q: 1 }] },
    chaud:   { label: 'Chaud : plus rond', bands: [{ type: 'hpf', freq: 60, q: 0.7 }, { type: 'lowshelf', freq: 180, gain: 2.5, q: 1 }, { type: 'bell', freq: 4500, gain: -2, q: 0.9 }, { type: 'lpf', freq: 14000, q: 0.7 }] },
    phone:   { label: 'Téléphone', bands: [{ type: 'hpf', freq: 450, q: 1.2 }, { type: 'lpf', freq: 3200, q: 1.2 }, { type: 'bell', freq: 1500, gain: 3, q: 1 }] },
    place:   { label: 'Instru : faire de la place à la voix', bands: [{ type: 'bell', freq: 300, gain: -2, q: 0.9 }, { type: 'bell', freq: 2800, gain: -3, q: 0.9 }] },
    basse:   { label: 'Basse / 808 : nette', bands: [{ type: 'hpf', freq: 28, q: 0.7 }, { type: 'bell', freq: 250, gain: -3, q: 1.2 }, { type: 'bell', freq: 1200, gain: 1.5, q: 0.9 }] }
};

function openEqPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    // trackIdx : numéro de piste, ou directement un groupe
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    // EQ pas encore utilisé sur cette piste : il s'ouvre vide (aucun point), pas avec les 4 réglages de l'ancienne chaîne
    if (t && !(t.effects || []).includes('eq') && !(t.effectParams && t.effectParams.eq)) { t.effectParams = t.effectParams || {}; t.effectParams.eq = { bands: [] }; }
    if (!t) return;
    const already = findPlugWin(t, 'eq');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    const W = 760, H = 300, PB = 20, FMIN = 20, FMAX = 20000;   // PB : bande du bas pour les fréquences
    let DB = 12; try { DB = +localStorage.getItem('pulse_eq_range') || 12; } catch {}
    const mid = (H - PB) / 2;
    const fx = (f) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * W;
    const xf = (x) => FMIN * Math.pow(FMAX / FMIN, Math.max(0, Math.min(1, x / W)));
    const dy = (d) => mid - Math.max(-DB * 1.08, Math.min(DB * 1.08, d)) / DB * (mid - 14);
    const yd = (y) => (mid - y) / (mid - 14) * DB;
    let soloI = -1;
    if (t.effectParams.eq && t.effectParams.eq.solo !== undefined) delete t.effectParams.eq.solo;   // un solo oublié ne reste jamais
    const setSolo = (i) => {
        soloI = i;
        const ep = t.effectParams.eq; if (!ep) return;
        if (i >= 0) ep.solo = i; else delete ep.solo;
        refreshPlaybackSoon();
    };
    // Auto gain : la sortie compense ce que l'EQ ajoute ou retire en moyenne (de 100 Hz à 8 kHz)
    const autoOut = (arr) => {
        let s2 = 0, n = 0;
        for (let k = 0; k <= 40; k++) { const f = 100 * Math.pow(80, k / 40); s2 += Math.max(-12, arr.reduce((a, b) => a + eqBandDb(b, f), 0)); n++; }   // un creux profond (encoche) ne fausse pas tout
        return Math.round(-s2 / n * 10) / 10;
    };
    let sel = 0;
    const multi = new Set();            // points choisis ensemble (⇧ / ⌘ + clic, ou rectangle) ; `sel` reste le point principal
    const isSel = (i) => i === sel || multi.has(i);
    const bands = () => eqBandsOf(t.effectParams.eq || {});
    let eqUndo = false;                         // une seule étape d'annulation par geste (drapeau remis à zéro au relâchement)
    const commit = (arr) => {
        if (!eqUndo) {
            pushUndo(); eqUndo = true;
            const clear = () => { eqUndo = false; document.removeEventListener('mouseup', clear, true); };
            document.addEventListener('mouseup', () => setTimeout(clear, 0), { once: true, capture: true });
            setTimeout(clear, 2500);   // et pour les valeurs tapées au clavier
        }
        const before = eqBandsOf(t.effectParams.eq || {});
        t.eqBands = arr;                       // retenu à part : un preset de Son ne l'écrase plus
        const prev = t.effectParams.eq || {};
        t.effectParams.eq = { bands: arr };
        if (prev.autogain) { t.effectParams.eq.autogain = true; t.effectParams.eq.out = autoOut(arr); }
        if (soloI >= 0 && soloI < arr.length) t.effectParams.eq.solo = soloI; else soloI = -1;
        // Automation (mode A) : la bande qu'on vient de bouger devient la courbe affichée, et s'écrit pendant la lecture
        if (state.automationMode && arr.length === before.length) {
            arr.forEach((b, i) => ['freq', 'gain'].forEach(f => {
                const o0 = before[i] || {};
                if ((b[f] || 0) === (o0[f] || 0) || (f === 'gain' && !EQ_GAIN_TYPES.includes(b.type))) return;
                const pid = `fx:eq:b${i}-${f}`;
                autoSelectParam(t, pid); autoWriteSample(t, pid);
            }));
        }
        t.effects = t.effects || [];
        if (!t.effects.includes('eq')) t.effects.push('eq');
        refreshPlaybackSoon(); saveProject();
    };
    const fmtF = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kHz' : Math.round(f) + ' Hz';

    const panel = document.createElement('div');
    panel.className = 'fx-panel eq-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('eq') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">EQ <i>— ${esc(t.name || '')}</i></span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="eq-bar">
            <select class="eq-preset" data-tooltip="Un point de départ : tu peux ensuite tout bouger"><option value="">Modèles…</option>${Object.entries(EQ_PRESETS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
            <button class="eq-add" data-tooltip="Pose un point au milieu (ou double-clic sur la courbe)">+ Point</button>
            <button class="fx-reset">Réinitialiser</button>
            <span class="eq-sp"></span>
            <button class="eq-an on" data-tooltip="Le son de la piste derrière la courbe, pendant la lecture">Analyseur</button>
            <span class="eq-range" data-tooltip="Échelle verticale (elle s'agrandit toute seule si tu tires un point plus loin)">${[3, 6, 12, 30].map(r => `<span data-r="${r}" class="${r === DB ? 'on' : ''}">${r}</span>`).join('')}<input class="eq-range-in" type="text" value="${DB}" data-tooltip="Tape l'échelle que tu veux (1 à 36 dB)"><i>dB</i></span>
            <button class="eq-ag ${(t.effectParams.eq || {}).autogain ? 'on' : ''}" data-tooltip="Garde le même volume quand tu creuses ou que tu montes">Auto gain</button>
            <span class="eq-out" data-tooltip="Sortie de l'EQ">Sortie <b>0,0 dB</b></span>
        </div>
        <div class="eq-graph"><div class="eq-svghost"></div><div class="eq-detail eq-bub"></div></div>
        <div class="eq-hint">Double-clic pour poser un point (tout à gauche = coupe-bas, tout à droite = coupe-haut) · tire pour régler · molette = largeur (Q) · double-clic sur un point = le retirer · ⇧ + glisser = choisir plusieurs points</div>`;
    document.body.appendChild(panel);
    const graph = panel.querySelector('.eq-graph'), detail = panel.querySelector('.eq-detail'), host = panel.querySelector('.eq-svghost');
    let showAn = true;
    panel.querySelector('.eq-an').addEventListener('click', (e) => { showAn = !showAn; e.currentTarget.classList.toggle('on', showAn); });
    // Échelle : boutons, case à taper, et agrandissement automatique quand un point sort de l'écran
    const setRange = (r) => {
        DB = Math.max(1, Math.min(36, Math.round(r * 2) / 2));
        try { localStorage.setItem('pulse_eq_range', DB); } catch {}
        panel.querySelectorAll('.eq-range span').forEach(x => x.classList.toggle('on', +x.dataset.r === DB));
        const inp = panel.querySelector('.eq-range-in'); if (inp && document.activeElement !== inp) inp.value = String(DB).replace('.', ',');
        draw();
    };
    const fitRange = (g) => { const a = Math.abs(g); if (a > DB) setRange([6, 12, 18, 24, 30, 36].find(r => r >= a) || 36); };
    panel.querySelectorAll('.eq-range span').forEach(sp => sp.addEventListener('click', () => setRange(+sp.dataset.r)));
    const rin = panel.querySelector('.eq-range-in');
    rin.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') rin.blur(); });
    rin.addEventListener('change', () => { const v = parseFloat(rin.value.replace(',', '.')); if (Number.isFinite(v)) setRange(Math.abs(v)); else rin.value = DB; });
    panel.querySelector('.eq-ag').addEventListener('click', (e) => {
        pushUndo();
        const on = !(t.effectParams.eq || {}).autogain;
        const arr = bands();
        t.effectParams.eq = { ...(t.effectParams.eq || {}), bands: arr };
        if (on) { t.effectParams.eq.autogain = true; t.effectParams.eq.out = autoOut(arr); } else { delete t.effectParams.eq.autogain; delete t.effectParams.eq.out; }
        e.currentTarget.classList.toggle('on', on);
        refreshPlaybackSoon(); saveProject(); draw();
    });
    // La fenêtre fermée (n'importe comment) : le solo s'arrête
    const soloWatch = setInterval(() => { if (!panel.isConnected) { clearInterval(soloWatch); if (soloI >= 0) setSolo(-1); } }, 400);
    panel.querySelector('.eq-preset').addEventListener('change', (e) => {
        const P = EQ_PRESETS[e.target.value]; e.target.value = ''; if (!P) return;
        sel = 0; multi.clear();
        commit(P.bands.map(b => ({ gain: 0, ...b })));   // commit() pousse l'étape d'annulation
        draw();
        flash(`EQ « ${P.label.split(' : ')[0]} » posé — tire les points pour l'ajuster à ta voix`);
    });

    const draw = () => {
        const arr = bands();
        if (sel >= arr.length) sel = arr.length - 1;
        const total = (f) => arr.reduce((s2, b) => s2 + eqBandDb(b, f), 0);
        const N = 220;
        // La courbe s'arrête quand elle sort par le bas (coupe-bas / coupe-haut) : pas de trait plat collé en bas
        // Ce que la courbe retire est assombri (entre la courbe et le zéro)
        const floor = -DB * 1.08;
        let line = '', shade = '', pen = false;
        for (let i = 0; i <= N; i++) {
            const f = FMIN * Math.pow(FMAX / FMIN, i / N), d = total(f), x = (i / N * W).toFixed(1);
            if (d < floor) { pen = false; continue; }
            line += `${pen ? 'L' : 'M'}${x},${dy(d).toFixed(1)}`; pen = true;
        }
        for (let i = 0; i <= N; i++) { const f = FMIN * Math.pow(FMAX / FMIN, i / N), d = Math.min(0, total(f)); shade += `${i ? 'L' : 'M'}${(i / N * W).toFixed(1)},${(d < floor ? H - PB : dy(d)).toFixed(1)}`; }
        shade += `L${W},${mid}L0,${mid}Z`;
        const grid = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map(f => `<line x1="${fx(f).toFixed(1)}" y1="0" x2="${fx(f).toFixed(1)}" y2="${H - PB}" class="viz-grid"/><text x="${(fx(f) + 3).toFixed(1)}" y="${H - 6}" class="viz-txt">${f >= 1000 ? f / 1000 + 'k' : f}</text>`).join('');
        const st = DB <= 6 ? DB / 3 : DB / 2;
        let dbl = '';
        for (let d = -DB; d <= DB + 0.01; d += st) if (Math.abs(d) > 0.01) dbl += `<line x1="0" y1="${dy(d).toFixed(1)}" x2="${W}" y2="${dy(d).toFixed(1)}" class="viz-grid"/><text x="${W - 4}" y="${(dy(d) - 3).toFixed(1)}" class="viz-txt" text-anchor="end">${d > 0 ? '+' : ''}${+d.toFixed(1)}</text>`;
        // la zone du point choisi, teintée de sa couleur
        let fills = '';
        arr.forEach((b, i) => {
            if (!isSel(i) || b.on === false) return;
            let p = `M0,${mid}`;
            for (let k = 0; k <= N; k++) { const x = k / N * W; p += `L${x.toFixed(1)},${Math.max(-40, Math.min(H + 40, dy(eqBandDb(b, xf(x))))).toFixed(1)}`; }
            const c = EQ_COLORS[i % EQ_COLORS.length];
            fills += `<path d="${p}L${W},${mid}Z" fill="${c}" fill-opacity="${i === sel ? 0.22 : 0.12}" stroke="${c}" stroke-opacity=".3" stroke-width="1"/>`;
        });
        // Points dynamiques : jusqu'où ils peuvent aller (pointillés orange) + un trait du point à sa limite
        let dyns = '';
        arr.forEach((b, i) => {
            if (!PulseAudio.eqIsDynamic(b) || b.on === false) return;
            const lim = { ...b, gain: (b.gain || 0) + Number(b.dyn) };
            let p = '';
            for (let k = 0; k <= N; k++) { const x = k / N * W, f = xf(x); p += `${k ? 'L' : 'M'}${x.toFixed(1)},${dy(total(f) - eqBandDb(b, f) + eqBandDb(lim, f)).toFixed(1)}`; }
            const x = fx(b.freq).toFixed(1);
            dyns += `<path d="${p}" class="eq-dyn-lim"/><line x1="${x}" x2="${x}" y1="${dy(b.gain || 0).toFixed(1)}" y2="${dy(lim.gain).toFixed(1)}" class="eq-dyn-bar"/><circle cx="${x}" cy="${dy(lim.gain).toFixed(1)}" r="4" class="eq-dyn-end"/>`;
        });
        const pts = arr.map((b, i) => {
            const y = EQ_FLAT(b.type) ? dy(total(b.freq)) : dy((b.gain || 0));
            const x = fx(b.freq).toFixed(1), c = EQ_COLORS[i % EQ_COLORS.length];
            return `${i === sel ? `<circle cx="${x}" cy="${y.toFixed(1)}" r="14" fill="none" stroke="${c}" stroke-opacity=".55" pointer-events="none"/>` : ''}<circle cx="${x}" cy="${y.toFixed(1)}" r="${i === sel ? 9.5 : (multi.has(i) ? 9 : 8.5)}" class="eq-pt ${isSel(i) ? 'sel' : ''} ${b.on === false ? 'off' : ''}" data-i="${i}" fill="${b.on === false ? '#2a1f3a' : c}"/><text x="${x}" y="${(y + 3.5).toFixed(1)}" class="eq-num-pt" text-anchor="middle">${i + 1}</text>`;
        }).join('');
        host.innerHTML = `<svg class="eq-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}${dbl}
            <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" class="viz-zero"/>
            <path d="${shade}" class="eq-cut"/>${fills}${dyns}<path d="${line}" class="viz-line eq-line"/><g class="eq-live"></g>${pts}
            ${arr.length ? '' : `<text x="${W / 2}" y="${mid - 12}" class="eq-empty-txt" text-anchor="middle">Double-clic sur la courbe pour poser un point</text>`}
            ${soloI >= 0 ? `<text x="10" y="20" class="eq-solo-txt">🎧 Solo du point ${soloI + 1} : tu n'entends que sa zone</text>` : ''}</svg>`;
        const ep = t.effectParams.eq || {};
        panel.querySelector('.eq-out b').textContent = `${(ep.out || 0) > 0 ? '+' : ''}${(ep.out || 0).toFixed(1).replace('.', ',')} dB`;
        const b = arr[sel];
        if (!b) { detail.hidden = true; detail.innerHTML = ''; return; }
        detail.hidden = false;
        const flat = EQ_FLAT(b.type), cut = b.type === 'hpf' || b.type === 'lpf', shelf = b.type === 'lowshelf' || b.type === 'highshelf';
        detail.innerHTML = `
            <div class="eq-types">${Object.keys(EQ_TYPES).map(k => `<span data-type="${k}" class="${b.type === k ? 'on' : ''}" data-tooltip="${EQ_TYPES[k]}">${eqIcon(k)}</span>`).join('')}</div>
            <div class="eq-vals">
                <label><small>Fréq.</small><input class="eq-num eq-f" type="text" value="${Math.round(b.freq)}" style="color:${EQ_COLORS[sel % EQ_COLORS.length]}"><small>Hz · ${eqNote(b.freq)}</small></label>
                ${cut ? `<label><small>Pente</small><select class="eq-num eq-slope">${[12, 24, 36, 48].map(v => `<option value="${v}" ${(b.slope || 12) === v ? 'selected' : ''}>${v} dB/oct</option>`).join('')}</select><small>&nbsp;</small></label>`
                      : `<label><small>Gain</small><input class="eq-num eq-g" type="text" value="${(b.gain || 0).toFixed(1)}" ${flat ? 'disabled' : ''}><small>dB</small></label>`}
                <label><small>${cut ? 'Résonance' : 'Q'}</small><input class="eq-num eq-q" type="text" value="${(b.q || 1).toFixed(2)}" ${shelf || b.type === 'tilt' ? 'disabled' : ''}><small>&nbsp;</small></label>
            </div>
            ${PulseAudio.eqIsDynamic(b) ? `<div class="eq-dynrow">⚡ Dynamique · plage <button class="eq-dm">−</button><b>${Number(b.dyn) > 0 ? '+' : ''}${Number(b.dyn)} dB</b><button class="eq-dp">+</button> · seuil <input class="eq-num eq-thr" type="text" value="${b.thr ?? -30}"> dB</div>` : ''}
            <div class="eq-bub-foot"><span class="eq-tname"><span class="eq-dot" style="background:${EQ_COLORS[sel % EQ_COLORS.length]}"></span>${EQ_TYPES[b.type] || ''}</span>
                <span class="eq-ic">
                    <button class="eq-solo ${soloI === sel ? 'on' : ''}" data-tooltip="Solo : n'écouter que la zone de ce point">🎧</button>
                    <button class="eq-onoff ${b.on === false ? '' : 'on'}" data-tooltip="Met ce point en pause sans le supprimer">⏻</button>
                    <button class="eq-dyn ${PulseAudio.eqIsDynamic(b) ? 'on dyn' : ''}" ${['bell', 'lowshelf', 'highshelf', 'tilt'].includes(b.type) ? '' : 'disabled'} data-tooltip="Point dynamique : il ne bouge que quand sa zone dépasse le seuil (ex. une voix qui devient boueuse)">⚡</button>
                    <button class="eq-del" data-tooltip="Retirer ce point">✕</button>
                </span></div>`;
        // la bulle se pose au-dessus du point (en dessous s'il est tout en haut)
        const svg = host.querySelector('svg'), k = svg.clientWidth / W || 1;
        const px = fx(b.freq) * k, py = (flat ? dy(total(b.freq)) : dy(b.gain || 0)) * k;
        const bw = detail.offsetWidth || 270, gw = graph.clientWidth, gh = svg.clientHeight || graph.clientHeight, bh = detail.offsetHeight || 110;
        let bx = px - bw / 2, by;
        if (py - bh - 20 > 2) by = py - bh - 20;                 // au-dessus du point
        else if (py + 22 + bh < gh - 2) by = py + 22;            // sinon en dessous
        else { bx = px + 26 + bw < gw ? px + 26 : px - 26 - bw; by = py - bh / 2; }   // sinon à côté
        detail.style.left = Math.max(4, Math.min(gw - bw - 4, bx)) + 'px';
        detail.style.top = Math.max(2, Math.min(gh - bh - 2, by)) + 'px';
    };
    const update = (i, patch) => {
        const arr = bands().map(b => ({ ...b }));
        if (!arr[i]) return;
        Object.assign(arr[i], patch);
        arr[i].freq = Math.max(FMIN, Math.min(FMAX, arr[i].freq));
        arr[i].gain = Math.max(-24, Math.min(24, arr[i].gain || 0));
        arr[i].q = Math.max(0.1, Math.min(18, arr[i].q || 1));
        commit(arr);
        if (!EQ_FLAT(arr[i].type)) fitRange(arr[i].gain + (PulseAudio.eqIsDynamic(arr[i]) ? Number(arr[i].dyn) : 0));
        draw();
    };
    const addBand = (freq, gain, type = 'bell') => {
        const arr = bands().map(b => ({ ...b }));
        if (arr.length >= EQ_MAX_BANDS) { flash('24 points au maximum'); return; }
        arr.push(type === 'bell' ? { type, freq, gain, q: 1 } : { type, freq, gain: 0, q: 0.71, slope: 24 });
        multi.clear();
        sel = arr.length - 1;
        commit(arr); draw();
    };
    const removeBand = (i) => {
        const gone = multi.size > 1 && multi.has(i) ? multi : new Set([i]);
        const arr = bands().filter((_, k) => !gone.has(k));
        multi.clear();
        sel = Math.max(0, Math.min(sel, arr.length - 1));
        commit(arr); draw();
    };

    // Souris sur la courbe
    const pos = (e) => { const r = graph.querySelector('svg').getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
    graph.addEventListener('mousedown', (e) => {
        if (e.target.closest && e.target.closest('.eq-bub')) return;   // la bulle a ses propres boutons
        const pt = e.target.closest && e.target.closest('.eq-pt');
        if (!pt) {
            // Fond de la courbe : un rectangle choisit tous les points qu'il touche
            if (e.target.closest && e.target.closest('.eq-spec') && false) return;
            const box = graph.querySelector('svg').getBoundingClientRect();
            const x0 = e.clientX - box.left, y0 = e.clientY - box.top;
            if (x0 < 0 || y0 < 0 || x0 > box.width || y0 > box.height) return;
            const kx = W / box.width, ky = H / box.height;
            e.preventDefault();
            const rect = document.createElement('div');
            rect.className = 'eq-marquee';
            graph.appendChild(rect);
            const place = (x1, y1) => {
                const l = Math.min(x0, x1), tp = Math.min(y0, y1);
                rect.style.cssText = `left:${l}px;top:${tp}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`;
            };
            let moved = false;
            const mv = (ev) => { const x1 = ev.clientX - box.left, y1 = ev.clientY - box.top; if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4) moved = true; place(x1, y1); };
            const upm = (ev) => {
                document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', upm);
                rect.remove();
                if (!moved) { if (multi.size) { multi.clear(); draw(); } return; }
                const x1 = ev.clientX - box.left, y1 = ev.clientY - box.top;
                const l = Math.min(x0, x1) * kx, r2 = Math.max(x0, x1) * kx, tp = Math.min(y0, y1) * ky, bt = Math.max(y0, y1) * ky;
                const arr = bands(), hit = [];
                const total = (f) => arr.reduce((s2, b) => s2 + eqBandDb(b, f), 0);
                arr.forEach((b, i) => {
                    const cx = fx(b.freq), cy = EQ_FLAT(b.type) ? dy(total(b.freq)) : dy(b.gain || 0);
                    if (cx >= l && cx <= r2 && cy >= tp && cy <= bt) hit.push(i);
                });
                multi.clear();
                if (hit.length) { sel = hit[0]; hit.forEach(i => multi.add(i)); }
                draw();
                if (hit.length > 1) flash(`${hit.length} points choisis : tire-en un pour les bouger ensemble, Suppr pour les retirer`);
            };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', upm);
            return;
        }
        e.preventDefault();
        const i = parseInt(pt.dataset.i);
        // ⇧ ou ⌘ + clic : ajoute / retire ce point de la sélection
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
            if (!multi.size) multi.add(sel);
            if (multi.has(i) && multi.size > 1) { multi.delete(i); if (sel === i) sel = [...multi][0]; }
            else { multi.add(i); sel = i; }
            draw();
            return;
        }
        const group = multi.has(i) && multi.size > 1 ? [...multi] : null;
        if (!group) { multi.clear(); sel = i; draw(); }
        else { sel = i; draw(); }
        let undoDone = false;
        const start = bands().map(b => ({ ...b }));
        const p0 = pos(e);
        // le geste garde l'échelle du départ : si elle s'agrandit en route, le point ne s'emballe pas
        const DB0 = DB, yd0 = (y) => (mid - y) / (mid - 14) * DB0;
        const move = (ev) => {
            const { x, y } = pos(ev), b0 = start[i]; if (!b0) return;
            if (group) {
                // Tous les points choisis suivent : même décalage de fréquence (en rapport) et de gain
                const ratio = xf(Math.max(0, Math.min(W, fx(b0.freq) + (x - p0.x)))) / b0.freq;
                const dg = Math.round((yd0(y) - yd0(p0.y)) * 2) / 2;
                const arr = start.map((b, k) => {
                    if (!group.includes(k)) return { ...b };
                    const flat = EQ_FLAT(b.type);
                    return { ...b, freq: Math.max(FMIN, Math.min(FMAX, b.freq * ratio)), gain: flat ? 0 : Math.max(-24, Math.min(24, (b.gain || 0) + dg)) };
                });
                commit(arr);
                arr.forEach((b, k) => { if (group.includes(k) && !EQ_FLAT(b.type)) fitRange(b.gain); });
                draw();
                return;
            }
            const patch = { freq: xf(x) };
            if (!EQ_FLAT(b0.type)) patch.gain = Math.round(yd0(y) * 2) / 2;
            update(i, patch);
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    graph.addEventListener('dblclick', (e) => {
        if (e.target.closest && e.target.closest('.eq-bub')) return;
        const pt = e.target.closest && e.target.closest('.eq-pt');
        if (pt) { removeBand(parseInt(pt.dataset.i)); return; }
        const { x, y } = pos(e);
        // Comme Pro-Q : double-clic tout à gauche = coupe-bas, tout à droite = coupe-haut
        if (x < W * 0.05 || x > W * 0.95) { addBand(Math.round(xf(x)), 0, x < W * 0.05 ? 'hpf' : 'lpf'); return; }
        addBand(Math.round(xf(x)), Math.round(yd(y) * 2) / 2);
    });
    graph.addEventListener('wheel', (e) => {
        if (e.target.closest && e.target.closest('.eq-bub')) return;
        const pt = e.target.closest && e.target.closest('.eq-pt');
        const i = pt ? parseInt(pt.dataset.i) : sel;
        const b = bands()[i]; if (!b || b.type === 'lowshelf' || b.type === 'highshelf' || b.type === 'tilt') return;
        e.preventDefault();
        sel = i;
        update(i, { q: (b.q || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12) });
    }, { passive: false });

    // Détail du point choisi : on peut aussi écrire les valeurs
    const parseNum = (v) => parseFloat(String(v).replace(',', '.'));
    detail.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
    detail.addEventListener('change', (e) => {
        const el = e.target;
        if (el.classList.contains('eq-slope')) {
            update(sel, { slope: parseInt(el.value) || 12 });
        } else {
            const v = parseNum(el.value);
            if (!Number.isFinite(v)) { flash('Écris un nombre'); draw(); return; }
            if (el.classList.contains('eq-f')) update(sel, { freq: v });
            else if (el.classList.contains('eq-g')) update(sel, { gain: v });
            else if (el.classList.contains('eq-q')) update(sel, { q: v });
            else if (el.classList.contains('eq-thr')) update(sel, { thr: Math.max(-80, Math.min(0, v)) });
        }
    });
    detail.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-type]');
        if (tb) {
            const type = tb.dataset.type, b = bands()[sel]; if (!b || b.type === type) return;
            const patch = { type };
            if (type === 'hpf' || type === 'lpf') { patch.gain = 0; patch.q = 0.71; patch.slope = b.slope || 24; }
            else if (type === 'notch') { patch.gain = 0; patch.q = Math.max(2, b.q || 4); }
            else if (EQ_FLAT(b.type)) patch.q = 1;
            update(sel, patch);
            return;
        }
        const btn = e.target.closest('button'); if (!btn) return;
        if (btn.classList.contains('eq-del')) { if (soloI === sel) setSolo(-1); removeBand(sel); }
        if (btn.classList.contains('eq-onoff')) { const b = bands()[sel]; update(sel, { on: b.on === false ? true : false }); }
        if (btn.classList.contains('eq-solo')) { setSolo(soloI === sel ? -1 : sel); draw(); }
        if (btn.classList.contains('eq-dyn')) { const b = bands()[sel]; update(sel, PulseAudio.eqIsDynamic(b) ? { dyn: 0 } : { dyn: (b.gain || 0) > 0 ? -4 : -6, thr: b.thr ?? -30 }); }
        if (btn.classList.contains('eq-dm') || btn.classList.contains('eq-dp')) {
            const b = bands()[sel], v = Math.max(-24, Math.min(24, Number(b.dyn) + (btn.classList.contains('eq-dp') ? 1 : -1)));
            update(sel, { dyn: v || (btn.classList.contains('eq-dp') ? 1 : -1) });
        }
    });
    // Suppr / ⌫ : retire les points choisis (et n'efface pas une région derrière)
    const eqKeys = (ev) => {
        if (!panel.isConnected) { document.removeEventListener('keydown', eqKeys, true); return; }
        if (!isFrontPlug(panel)) return;   // plusieurs plugs ouverts : seule la fenêtre de devant écoute le clavier
        if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
            ev.preventDefault(); ev.stopPropagation();
            if (bands().length) removeBand(sel);
        }
    };
    document.addEventListener('keydown', eqKeys, true);
    panel.querySelector('.eq-add').addEventListener('click', () => addBand(1000, 0));
    panel.querySelector('.fx-reset').addEventListener('click', () => {
        pushUndo();
        delete t.eqBands;
        if (t.sound) applySound(t); else delete t.effectParams.eq;   // retour à l'EQ du preset de Son
        sel = 0; refreshPlaybackSoon(); saveProject(); draw();
        flash('EQ remis comme au départ');
    });
    panel.querySelector('.fx-panel-close').addEventListener('click', () => { if (soloI >= 0) setSolo(-1); panel.remove(); });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        pushUndo();
        t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes('eq')) t.effects.push('eq'); }
        else { const i = t.effects.indexOf('eq'); if (i >= 0) t.effects.splice(i, 1); }
        anchorEl.classList.toggle('active', !!e.target.checked);
        refreshPlaybackSoon(); saveProject();
    });
    draw();

    // Le son de la piste pendant la lecture, en fond de la courbe (comme sur les EQ de studio)
    const specOf = () => typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null);
    if (PulseAudio.getTrackSpectrum) {
        const cv = document.createElement('canvas');
        cv.className = 'eq-spec';
        cv.width = W; cv.height = H;
        graph.style.position = 'relative';
        graph.insertBefore(cv, graph.firstChild);   // derrière la courbe
        const g2 = cv.getContext('2d');
        let bins = null;
        const loop = () => {
            if (!panel.isConnected) return;
            if (!cv.isConnected) graph.insertBefore(cv, graph.firstChild);
            const sv = graph.querySelector('svg'); if (sv) { cv.style.width = sv.clientWidth + 'px'; cv.style.height = sv.clientHeight + 'px'; }
            g2.clearRect(0, 0, W, H);
            // points dynamiques : l'anneau orange montre où ils sont à l'instant
            const lv = graph.querySelector('.eq-live');
            if (lv) {
                const key = typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id;
                lv.innerHTML = (state.playing || state.recording) ? bands().map((b, i) => {
                    if (!PulseAudio.eqIsDynamic(b) || b.on === false) return '';
                    const g = PulseAudio.getEqDyn(key + ':' + i); if (g === null) return '';
                    return `<circle cx="${fx(b.freq).toFixed(1)}" cy="${dy(g).toFixed(1)}" r="15" class="eq-dyn-ring"/>`;
                }).join('') : '';
            }
            const an = showAn && (state.playing || state.recording) ? specOf() : null;
            if (an) {
                if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(an.frequencyBinCount);
                an.getFloatFrequencyData(bins);
                const nyq = (PulseAudio.getContext() ? PulseAudio.getContext().sampleRate : 48000) / 2;
                g2.beginPath(); g2.moveTo(0, H);
                for (let x = 0; x <= W; x += 2) {
                    // plusieurs raies tombent dans un même pixel dans les aigus : on garde la plus forte
                    const kOf = (f) => Math.min(bins.length - 1, Math.max(0, Math.round(f / nyq * (bins.length - 1))));
                    const k0 = kOf(xf(x - 1)), k1 = Math.max(k0, kOf(xf(x + 1)));
                    let db = -120;
                    if (k1 - k0 <= 1) {
                        // graves : moins d'une raie par pixel → on glisse entre deux raies (pas d'escalier)
                        const fb = Math.min(bins.length - 1.001, Math.max(0, xf(x) / nyq * (bins.length - 1))), i0 = Math.floor(fb), u = fb - i0;
                        const a = Number.isFinite(bins[i0]) ? bins[i0] : -120, b2 = Number.isFinite(bins[i0 + 1]) ? bins[i0 + 1] : -120;
                        db = a + (b2 - a) * u;
                    } else for (let k = k0; k <= k1; k++) if (Number.isFinite(bins[k]) && bins[k] > db) db = bins[k];
                    const y = (H - PB) - Math.max(0, Math.min(1, (db + 100) / 80)) * (H - PB - 10);
                    g2.lineTo(x, y);
                }
                g2.lineTo(W, H); g2.closePath();
                const gr = g2.createLinearGradient(0, 0, 0, H);
                gr.addColorStop(0, 'rgba(168, 85, 247, 0.42)'); gr.addColorStop(1, 'rgba(124, 58, 237, 0.04)');
                g2.fillStyle = gr; g2.fill();
                g2.strokeStyle = 'rgba(192, 132, 252, 0.55)'; g2.lineWidth = 1; g2.stroke();
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    const rect = anchorEl.getBoundingClientRect(), pw = Math.min(800, window.innerWidth - 16);
    let left = rect.right + 8;
    if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'eq', trackIdx);   // reste ouverte, déplaçable, à côté des autres plugs
}

// === Panneaux d'effets : un cadre commun pour tous (boutons rotatifs, Simple / Avancé, A / B) ===
// Une couleur par catégorie, sur le fond violet de Pulse
const FX_CAT_COLORS = { 'Dynamique': '#A855F7', 'Égaliseur et filtre': '#22D3EE', 'Distorsion': '#FB923C', 'Mouvement': '#F472B6',
    'Voix et hauteur': '#A3E635', 'Écho et espace': '#60A5FA', 'Stéréo': '#2DD4BF', 'Utilitaires': '#9A8CB8' };
// Position d'un réglage sur la course du bouton (0 à 1) ; les fréquences tournent en logarithmique, comme sur une console
function fxFrac(d, v) {
    const f = d.log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min);
    return Math.max(0, Math.min(1, f));
}
function fxFromFrac(d, f) { return d.log ? d.min * Math.pow(d.max / d.min, f) : d.min + f * (d.max - d.min); }
// Durée d'écho en notes, comme les noms de pistes du studio (DEL 1/8, DEL 1/4…)
function beatsLabel(b) {
    const N = { 0.125: '1/32', 0.25: '1/16', 0.375: '1/16 pointée', 0.5: '1/8', 0.75: '1/8 pointée', 1: '1/4', 1.5: '1/4 pointée', 2: '1/2' };
    if (Math.abs(b - 1 / 3) < 1e-6) return '1/8 triolet';
    if (Math.abs(b - 2 / 3) < 1e-6) return '1/4 triolet';
    return N[b] || `${b} temps`;
}
function fxFmt(d, v, isAuto) {
    if (d.toggle) return v ? 'Oui' : 'Non';
    if (d.fmt) return d.fmt(v);
    const dec = d.step < 1 ? Math.min(2, (String(d.step).split('.')[1] || '').length) : 0;
    const txt = (/Hz/.test(d.unit) && v >= 1000) ? `${+(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${+(+v).toFixed(dec)}${d.unit}`;
    return isAuto ? `Auto (${txt.trim()})` : txt;
}
// Chiffre court pour la graduation autour d'un bouton (« 8k », « 1/8 »…)
function fxShort(d, v) {
    if (d.fmt) return d.fmt(v);
    if (/Hz/.test(d.unit) && v >= 1000) return `${+(v / 1000).toFixed(1)}k`;
    return `${+(+v).toFixed(Math.abs(v) < 10 && v % 1 ? 1 : 0)}`;
}
// Bouton rotatif façon console : capuchon en métal brossé, graduations et chiffres autour (DA « Studio sombre »)
// Course de -135° à +135° ; l'arc de couleur part du zéro pour les réglages qui vont du négatif au positif
let fxKnobId = 0;
// Mode Bus : les boutons qui ont des crans tournent de cran en cran, comme sur une console
function fxStepped(d, skin) { return skin === 'U' && d.busSteps; }
function fxStepIdx(d, v, autoRel) {
    if (autoRel && d.busSteps.includes('auto')) return d.busSteps.indexOf('auto');
    let k = 0, best = Infinity;
    d.busSteps.forEach((st, i) => { if (st !== 'auto' && Math.abs(Math.log(st / v)) < best) { best = Math.abs(Math.log(st / v)); k = i; } });
    return k;
}
// Bouton plat à anneau lumineux (écran plein, gamme Digital) : l'anneau part du zéro pour un réglage + / −
function fxRingKnobSvg(d, v, big) {
    const S = big ? 66 : 54, c = S / 2, R = S * 0.42, f = Math.max(0, Math.min(1, fxFrac(d, v))), from = (d.min < 0 && d.max > 0) ? fxFrac(d, 0) : 0;
    const P = (fr, r) => { const a = (-135 + 270 * fr - 90) * Math.PI / 180; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
    const arc = (a, b) => { if (b < a) [a, b] = [b, a]; const [x1, y1] = P(a, R), [x2, y2] = P(b, R); return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${R} ${R} 0 ${(b - a) * 270 > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
    const [ix, iy] = P(f, R * 0.62), [jx, jy] = P(f, R * 0.3);
    return `<svg class="ring-knob" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><path d="${arc(0, 1)}" fill="none" stroke="#ffffff14" stroke-width="4.5" stroke-linecap="round"/>
        ${Math.abs(f - from) > 0.003 ? `<path d="${arc(from, f)}" fill="none" stroke="var(--fx-ring, #A855F7)" stroke-width="4.5" stroke-linecap="round" style="filter:drop-shadow(0 0 4px #A855F799)"/>` : ''}
        <circle cx="${c}" cy="${c}" r="${(R * 0.74).toFixed(1)}" fill="#120c1b" stroke="#ffffff1f"/><line x1="${jx.toFixed(1)}" y1="${jy.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;
}
function fxKnobSvg(d, v, big = !d.adv, skin = 'P', autoRel = false) {
    if (fxStepped(d, skin)) return fxKnobSteppedSvg(d, v, skin, autoRel);
    if (skin === 'S') return fxRingKnobSvg(d, v, big);
    const S = big ? 76 : 62, c = S / 2, R = S * 0.25, ang = (f) => -135 + 270 * f, id = 'km' + (++fxKnobId);
    const p = (deg, r) => [c + r * Math.sin(deg * Math.PI / 180), c - r * Math.cos(deg * Math.PI / 180)];
    const arc = (a, b, r) => {
        if (b < a) [a, b] = [b, a];
        const [x1, y1] = p(a, r), [x2, y2] = p(b, r);
        return `M${x1.toFixed(1)},${y1.toFixed(1)}A${r},${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
    };
    const f = fxFrac(d, v), from = (d.min < 0 && d.max > 0) ? fxFrac(d, 0) : 0;
    let ticks = '';
    for (let i = 0; i <= 10; i++) {
        const [x1, y1] = p(ang(i / 10), R + 4), [x2, y2] = p(ang(i / 10), R + (i % 5 ? 6.5 : 9));
        ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="kn-tick${i % 5 ? '' : ' major'}"/>`;
    }
    // Chiffres : début, milieu (ou zéro), fin
    const mid = (d.min < 0 && d.max > 0) ? 0 : fxFromFrac(d, 0.5);
    const lab = (big ? [[0, d.min], [fxFrac(d, mid), mid], [1, d.max]] : [[0, d.min], [1, d.max]]).map(([fr, val]) => {
        const [x, y] = p(ang(fr), R + 15);
        return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" class="kn-num">${esc(fxShort(d, val))}</text>`;
    }).join('');
    const [hx, hy] = p(ang(f), R * 0.78);
    return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
        <defs><radialGradient id="${id}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fbfaff"/><stop offset=".5" stop-color="#bdb8c9"/><stop offset="1" stop-color="#5f5a6c"/></radialGradient></defs>
        ${ticks}${lab}
        ${Math.abs(f - from) > 0.003 ? `<path d="${arc(ang(from), ang(f), R + 2)}" class="kn-val"/>` : ''}
        ${fxKnobCap(skin, c, R, id, ang(f), p)}</svg>`;
}
function fxKnobSteppedSvg(d, v, skin, autoRel) {
    const S = 84, c = S / 2, R = 18, n = d.busSteps.length, id = 'km' + (++fxKnobId), ang = (i) => -135 + 270 * i / (n - 1);
    const p = (deg, r) => [c + r * Math.sin(deg * Math.PI / 180), c - r * Math.cos(deg * Math.PI / 180)];
    const lab = (st) => st === 'auto' ? 'Auto' : (st >= 1000 ? `${+(st / 1000).toFixed(1)}s` : st >= 100 && d.key === 'release' ? `.${String(st / 100)}`.replace('.12', '1.2') : String(st));
    let marks = '';
    d.busSteps.forEach((st, i) => {
        const [x, y] = p(ang(i), R + 6), [tx, ty] = p(ang(i), R + 16);
        marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" class="kn-dot"/><text x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}" class="kn-num">${esc(lab(st))}</text>`;
    });
    return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${marks}${fxKnobCap(skin, c, R, id, ang(fxStepIdx(d, v, autoRel)), p)}</svg>`;
}
// Capuchon du bouton selon la façade : P métal brossé, O gros bouton noir strié (opto),
// F noir à bague violette (FET), U gris de console à capuchon violet (bus)
function fxKnobCap(skin, c, R, id, a, p) {
    const hand = (r, cls) => { const [x, y] = p(a, r); return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="${cls}"/>`; };
    const grad = (stops) => `<defs><radialGradient id="${id}c" cx="40%" cy="30%" r="80%">${stops.map(([o, col]) => `<stop offset="${o}" stop-color="${col}"/>`).join('')}</radialGradient></defs>`;
    if (skin === 'O') {
        const R2 = R * 1.12; let ribs = '';
        for (let j = 0; j < 24; j++) { const an = j * 15 * Math.PI / 180; ribs += `<line x1="${(c + R2 * Math.sin(an)).toFixed(1)}" y1="${(c - R2 * Math.cos(an)).toFixed(1)}" x2="${(c + (R2 - 3) * Math.sin(an)).toFixed(1)}" y2="${(c - (R2 - 3) * Math.cos(an)).toFixed(1)}" class="kn-rib"/>`; }
        return `${grad([[0, '#4a4452'], [1, '#0c0a0f']])}<circle cx="${c}" cy="${c + 3}" r="${R2}" class="kn-shadow"/><circle cx="${c}" cy="${c}" r="${R2}" fill="url(#${id}c)"/>${ribs}${hand(R2 * 0.85, 'kn-hand')}`;
    }
    if (skin === 'F') return `${grad([[0, '#4a4452'], [1, '#0c0a0f']])}<circle cx="${c}" cy="${c + 2}" r="${R + 1}" class="kn-shadow"/><circle cx="${c}" cy="${c}" r="${R + 1}" class="kn-bague"/><circle cx="${c}" cy="${c}" r="${R - 1.5}" fill="url(#${id}c)"/>${hand(R * 0.78, 'kn-hand')}`;
    // Bus : bouton de la planche « capuchons violets » — jupe argentée, gros capuchon violet bombé, reflet, trait blanc
    if (skin === 'U') return `<defs><radialGradient id="${id}c" cx="40%" cy="28%" r="80%"><stop offset="0" stop-color="#c4a3ff"/><stop offset="1" stop-color="#5b21b6"/></radialGradient>
        <linearGradient id="${id}j" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#cfd1d6"/><stop offset="1" stop-color="#6b6e76"/></linearGradient></defs>
        <circle cx="${c}" cy="${c + 3}" r="${R + 3}" class="kn-shadow"/><circle cx="${c}" cy="${c + 2}" r="${R + 2}" fill="url(#${id}j)"/>
        <circle cx="${c}" cy="${c}" r="${R - 1}" fill="url(#${id}c)"/><ellipse cx="${c - 4}" cy="${c - 7}" rx="7" ry="4" fill="#fff" opacity=".25"/>
        ${hand(R - 3, 'kn-hand kn-hand-u')}`;
    return `<circle cx="${c}" cy="${c + 2}" r="${R}" class="kn-shadow"/>
        <circle cx="${c}" cy="${c}" r="${R}" fill="url(#${id})" class="kn-cap"/>
        <circle cx="${c}" cy="${c}" r="${(R * 0.72).toFixed(1)}" class="kn-ring"/>${hand(R * 0.78, 'kn-hand')}`;
}
const FX_SKINS = ['P', 'O', 'F', 'U'];
const FX_SIZES = [1, 1.25, 1.5];
// Préréglages Red Records : PROVISOIRES. Ridwane les refera lui-même après ses tests avec de vraies pistes
// (« Enregistrer le réglage actuel » dans le plug, puis on les recopie ici). L'utilisateur peut toujours tout retoucher.
const FX_PRESETS = {
    delay: [
        { name: 'Del 1/8 ping-pong', params: { beats: 0.5, feedback: 35, wet: 30, pp: 1 } },
        { name: 'Del 1/16 ping-pong', params: { beats: 0.25, feedback: 30, wet: 25, pp: 1 } },
        { name: 'Del 1/4', params: { beats: 1, feedback: 35, wet: 25, pp: 0 } },
        { name: 'Del 1/2', params: { beats: 2, feedback: 30, wet: 22, pp: 0 } }
    ],
    pitch: [
        { name: 'Pitch −', params: { semi: -5, mix: 100 } },
        { name: 'Pitch +', params: { semi: 5, mix: 100 } },
        { name: 'Octave en dessous', params: { semi: -12, mix: 100 } }
    ],
    filter: [
        { name: 'Phone', params: { hpf: 500, lpf: 3000, slope: 24 } },
        { name: 'Radio', params: { hpf: 300, lpf: 5000, slope: 12 } }
    ],
    // Reverb : des types de salles classiques (comme dans toutes les reverbs), avec leur EQ de queue
    reverb: [
        { group: 'Petites salles', name: 'Ambiance', params: { wet: 15, size: 1.2, decay: 1.2, pre: 0, bright: 55, eq: [{ type: 'hpf', freq: 250, gain: 0, q: 0.7071, slope: 12 }] } },
        { group: 'Petites salles', name: 'Petite pièce', params: { wet: 18, size: 1.3, decay: 1.8, pre: 5, bright: 42, eq: [{ type: 'hpf', freq: 200, gain: 0, q: 0.7071, slope: 12 }, { type: 'highshelf', freq: 8000, gain: -3, q: 0.7 }] } },
        { group: 'Petites salles', name: 'Studio', params: { wet: 20, size: 1.6, decay: 2.2, pre: 10, bright: 50, eq: [{ type: 'hpf', freq: 180, gain: 0, q: 0.7071, slope: 12 }, { type: 'bell', freq: 400, gain: -3, q: 1 }] } },
        { group: 'Petites salles', name: 'Chambre', params: { wet: 20, size: 2.0, decay: 2.5, pre: 15, bright: 55, width: 110, eq: [{ type: 'hpf', freq: 160, gain: 0, q: 0.7071, slope: 12 }] } },
        { group: 'Plaques', name: 'Plaque', params: { wet: 20, size: 2.2, decay: 2.8, pre: 0, bright: 80, width: 120, eq: [{ type: 'hpf', freq: 300, gain: 0, q: 0.7071, slope: 24 }, { type: 'highshelf', freq: 6000, gain: 2, q: 0.7 }] } },
        { group: 'Plaques', name: 'Plaque voix', params: { wet: 18, size: 1.8, decay: 2.4, pre: 20, bright: 70, duck: 30, eq: [{ type: 'hpf', freq: 350, gain: 0, q: 0.7071, slope: 24 }, { type: 'bell', freq: 2500, gain: -3, q: 1.2 }, { type: 'lpf', freq: 10000, gain: 0, q: 0.7071, slope: 12 }] } },
        { group: 'Grandes salles', name: 'Salle', params: { wet: 22, size: 2.8, decay: 3.2, pre: 20, bright: 50, width: 120, eq: [{ type: 'hpf', freq: 150, gain: 0, q: 0.7071, slope: 12 }] } },
        { group: 'Grandes salles', name: 'Grande salle', params: { wet: 22, size: 3.2, decay: 3.8, pre: 30, bright: 45, width: 130, eq: [{ type: 'hpf', freq: 140, gain: 0, q: 0.7071, slope: 12 }, { type: 'highshelf', freq: 9000, gain: -2, q: 0.7 }] } },
        { group: 'Grandes salles', name: 'Cathédrale', params: { wet: 25, size: 3.2, decay: 5, pre: 40, bright: 35, width: 140, eq: [{ type: 'hpf', freq: 120, gain: 0, q: 0.7071, slope: 12 }, { type: 'lowshelf', freq: 300, gain: -3, q: 0.7 }] } },
        { group: 'Effets', name: 'Sombre et lointaine', params: { wet: 30, size: 3.0, decay: 4, pre: 60, bright: 10, width: 130, eq: [{ type: 'hpf', freq: 200, gain: 0, q: 0.7071, slope: 24 }, { type: 'lpf', freq: 4000, gain: 0, q: 0.7071, slope: 24 }] } },
        { group: 'Effets', name: 'Queue qui se pousse (ducking)', params: { wet: 28, size: 2.8, decay: 3.4, pre: 25, bright: 55, duck: 60, eq: [{ type: 'hpf', freq: 250, gain: 0, q: 0.7071, slope: 24 }] } },
        { name: 'Rev Room', params: { size: 1.4, wet: 18 } },
        { name: 'Rev Long', params: { size: 3.2, wet: 22 } }
    ],
    slapback: [
        { name: 'Slap', params: {} }
    ]
};
function userFxPresets() { try { return JSON.parse(localStorage.getItem('pulse_fx_user_presets') || '{}'); } catch { return {}; } }
function saveUserFxPreset(fx, name, params) {
    const all = userFxPresets();
    all[fx] = [...(all[fx] || []).filter(p => p.name !== name), { name, params }];
    try { localStorage.setItem('pulse_fx_user_presets', JSON.stringify(all)); } catch {}
}
const FX_SKIN_SEED = { O: 23, F: 37, U: 51 };
// Hasard reproductible : chaque machine garde « ses » rayures d'une ouverture à l'autre
function fxRnd(seed) { let x = seed; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }
// Usure d'une machine qui a vécu (tout en dessin, aucune image) : grain, taches, rayures, traces de doigts, vis
function fxWearSvg(sk, seed, W = 340, H = 340) {
    W = Math.round(W); H = Math.round(H);
    const r = fxRnd(seed), dark = { O: .3, F: .5, U: .38 }[sk], light = { O: '#ffffff', F: '#bba9d8', U: '#e7ebf3' }[sk], paint = { O: '#8f8798', F: '#6b6077', U: '#9aa0ad' }[sk];
    let s = `<svg class="fx-wear" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
        <filter id="wg${seed}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .32 -.05"/></filter>
        <filter id="wb${seed}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".02 .03" numOctaves="3" seed="${seed + 7}"/><feColorMatrix values="0 0 0 0 .12  0 0 0 0 .08  0 0 0 0 .04  0 0 0 ${dark * 1.1} -${dark * .42}"/></filter>
        <radialGradient id="wv${seed}" cx="50%" cy="45%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a1005" stop-opacity="${dark * .75}"/></radialGradient>
        <radialGradient id="ws${seed}" cx="35%" cy="30%"><stop offset="0" stop-color="#e6e6e6"/><stop offset="1" stop-color="#5c5c5c"/></radialGradient></defs>
        <rect width="${W}" height="${H}" filter="url(#wb${seed})"/><rect width="${W}" height="${H}" fill="url(#wv${seed})"/><rect width="${W}" height="${H}" filter="url(#wg${seed})"/>`;
    // Bus (console) : ni rayures ni traces de doigts, juste le grain et les vis
    for (let i = 0; i < (sk === 'U' ? 0 : 26); i++) {
        const x = r() * W, y = r() * H, l = 6 + r() * 40, a = (r() - .5) * .9;
        s += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + l * Math.cos(a)).toFixed(1)}" y2="${(y + l * Math.sin(a)).toFixed(1)}" stroke="${r() < .6 ? light : '#000'}" stroke-opacity="${(.12 + r() * .25).toFixed(2)}" stroke-width="${(.4 + r() * .5).toFixed(2)}"/>`;
    }
    for (let i = 0; i < (sk === 'U' ? 0 : 4); i++) s += `<ellipse cx="${(W * .15 + r() * W * .7).toFixed(0)}" cy="${(H * .5 + r() * H * .45).toFixed(0)}" rx="${(6 + r() * 8).toFixed(0)}" ry="${(4 + r() * 5).toFixed(0)}" fill="#000" opacity="${(.05 + r() * .06).toFixed(2)}"/>`;
    [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]].forEach(([x, y]) => {
        const a = r() * 180;
        s += `<circle cx="${x}" cy="${y + 1}" r="4" fill="#000" opacity=".5"/><circle cx="${x}" cy="${y}" r="4" fill="url(#ws${seed})" stroke="#2a2a2a" stroke-width=".6"/><circle cx="${x}" cy="${y}" r="4" fill="${paint}" opacity=".35"/>
            <line x1="${x - 2.9}" y1="${y}" x2="${x + 2.9}" y2="${y}" stroke="#1a1a1a" stroke-width="1.1" transform="rotate(${a.toFixed(0)} ${x} ${y})"/>${r() < .5 ? `<circle cx="${x + 1.2}" cy="${y + 1.6}" r="1.8" fill="#7a3d12" opacity=".45"/>` : ''}`;
    });
    return s + '</svg>';
}
// Vitre du vumètre : jaunie, reflet en biais, poussière
function fxGlassSvg(seed) {
    const r = fxRnd(seed + 11);
    let s = `<svg class="viz-glass" viewBox="0 0 216 132" preserveAspectRatio="none"><defs>
        <linearGradient id="gr${seed}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".35" stop-color="#fff" stop-opacity=".05"/><stop offset=".36" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <radialGradient id="gy${seed}" cx="50%" cy="40%" r="80%"><stop offset=".5" stop-color="#a87a1c" stop-opacity="0"/><stop offset="1" stop-color="#6b4a0c" stop-opacity=".35"/></radialGradient></defs>
        <rect width="216" height="132" fill="url(#gy${seed})"/><rect width="216" height="132" fill="url(#gr${seed})"/>`;
    for (let i = 0; i < 30; i++) s += `<circle cx="${(r() * 216).toFixed(0)}" cy="${(r() * 132).toFixed(0)}" r="${(.3 + r() * 1).toFixed(1)}" fill="${r() < .5 ? '#fff' : '#3a2a10'}" opacity="${(.15 + r() * .35).toFixed(2)}"/>`;
    return s + '</svg>';
}
// Mémoires A / B par piste et par effet (le temps de la séance, pas dans le projet)
const FX_AB = new WeakMap();
function fxAbStore(t, fxName) {
    if (!FX_AB.has(t)) FX_AB.set(t, {});
    const m = FX_AB.get(t);
    return m[fxName] || (m[fxName] = { cur: 'A', A: null, B: null });
}

// Fenêtres de plugs façon Logic : plusieurs ouvertes à la fois, déplaçables par le bandeau du haut,
// la dernière touchée passe devant. Elles restent ouvertes quand on clique ailleurs (fermeture : ×).
// Place une fenêtre à une position d'écran, en tenant compte de son zoom (qui multiplie aussi left / top)
function plugSetPos(panel, x, y) {
    const z = parseFloat(panel.style.zoom) || 1;
    panel.style.left = (x / z) + 'px'; panel.style.top = (y / z) + 'px';
}
function plugWins() { return [...document.querySelectorAll('.fx-panel.plug-win')]; }
function plugFront(p) {
    const others = plugWins().filter(x => x !== p).sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
    [...others, p].forEach((x, i) => { x.style.zIndex = 2000 + i; });
}
function isFrontPlug(p) { return plugWins().every(x => x === p || (+x.style.zIndex || 0) < (+p.style.zIndex || 0)); }
// Les autres panneaux (Son, Envoi, Auto-Tune…) restent « un à la fois » mais ne ferment plus les plugs
function closeTransientPanels() { document.querySelectorAll('.fx-panel:not(.plug-win)').forEach(p => p.remove()); }
function findPlugWin(t, fxName) { return plugWins().find(p => p._plugT === t && p.dataset.fx === fxName); }
function makePlugWindow(panel, t, fxName, trackIdx) {
    panel.classList.add('plug-win');
    panel._plugT = t; panel.dataset.fx = fxName;
    if (!panel._autoShow) {
        const pk = (k) => panel.querySelector(`.pk[data-key="${k}"]`);
        panel._autoShow = (k, v) => { const e = pk(k); if (e && e._pkShow) e._pkShow(v); };
        panel._autoRestore = (k) => { const e = pk(k); if (e && e._pkRestore) e._pkRestore(); };
    }
    plugFront(panel);
    panel.addEventListener('mousedown', () => { if (!isFrontPlug(panel)) plugFront(panel); }, true);
    const head = panel.querySelector('.fx-panel-header');
    if (head) head.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('button, input, label, select')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = (ev) => {
            // toujours un bout du bandeau à l'écran pour pouvoir la rattraper
            const x = Math.max(80 - r.width, Math.min(window.innerWidth - 80, ev.clientX - dx));
            const y = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - dy));
            plugSetPos(panel, Math.round(x), Math.round(y));
        };
        const up = () => { panel.classList.remove('dragging'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        panel.classList.add('dragging');
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    // Si la piste ou le groupe disparaît (suppression, autre projet), sa fenêtre se ferme
    const alive = () => typeof trackIdx === 'number' ? state.project.tracks[trackIdx] === t : (state.project.buses || []).includes(t);
    const watch = setInterval(() => {
        if (!panel.isConnected) return clearInterval(watch);
        if (!alive()) { panel.remove(); clearInterval(watch); }
    }, 500);
}

// === Limiteur (style « écran plein + panneau flottant », planche docs-planche-limiteur-gate-deesser-multibande.html) ===
// Petit bouton rotatif plat à bague lumineuse, partagé par les nouvelles façades
function proKnob(host, { label, min, max, val, fmt, onChange, onEnd, log, color = '#A855F7', big, key }) {
    const el = document.createElement('div'); el.className = 'pk' + (big ? ' big' : ''); host.appendChild(el);
    if (key) el.dataset.key = key;   // automation (mode A) : toucher le bouton affiche sa courbe sur la piste
    const fr = () => log ? Math.log(val / min) / Math.log(max / min) : (val - min) / (max - min);
    const draw = () => {
        const p = Math.max(0, Math.min(1, fr())), a = -135 + p * 270, rad = (d) => (d - 90) * Math.PI / 180, P = (d, R) => [32 + R * Math.cos(rad(d)), 32 + R * Math.sin(rad(d))];
        const [x1, y1] = P(-135, 27), [x2, y2] = P(a, 27), large = p * 270 > 180 ? 1 : 0, [ix, iy] = P(a, 17), [jx, jy] = P(a, 9);
        el.innerHTML = `<svg viewBox="0 0 64 64"><path d="M${P(-135, 27).join(' ')} A27 27 0 1 1 ${P(135, 27).join(' ')}" fill="none" stroke="#ffffff12" stroke-width="4.5" stroke-linecap="round"/>
            ${p > 0.003 ? `<path d="M${x1} ${y1} A27 27 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" style="filter:drop-shadow(0 0 4px ${color}99)"/>` : ''}
            <circle cx="32" cy="32" r="20" fill="#120c1b" stroke="#ffffff1a"/><line x1="${jx}" y1="${jy}" x2="${ix}" y2="${iy}" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>
            <span class="pk-l">${label}</span><span class="pk-v">${fmt(val)}</span>`;
    };
    let y0 = null, f0 = 0;
    el.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); y0 = e.clientY; f0 = fr();
        const mv = (ev) => { const f = Math.max(0, Math.min(1, f0 + (y0 - ev.clientY) / (ev.shiftKey ? 600 : 150))); val = log ? min * Math.pow(max / min, f) : min + f * (max - min); draw(); onChange && onChange(val); if (key) el.dispatchEvent(new Event('input', { bubbles: true })); };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); onEnd && onEnd(val); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    // double-clic sur le chiffre : on tape la valeur
    el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const v = el.querySelector('.pk-v'); if (!v) return;
        const inp = document.createElement('input'); inp.className = 'pk-in'; inp.value = String(Math.round(val * 10) / 10).replace('.', ',');
        v.replaceWith(inp); inp.focus(); inp.select();
        const done = (ok) => { const n = parseFloat(inp.value.replace(',', '.')); if (ok && Number.isFinite(n)) { val = Math.max(min, Math.min(max, n)); onChange && onChange(val); onEnd && onEnd(val); } draw(); };
        inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
    });
    draw();
    // pendant la lecture, le bouton suit la courbe (affichage seulement), puis revient au réglage
    let held = null;
    el._pkShow = (v) => { if (held === null) held = val; const k = val; val = v; draw(); val = k; };
    el._pkRestore = () => { if (held !== null) { held = null; draw(); } };
    return { set(v) { val = v; draw(); }, el };
}

function openLimiterPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'limit');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.limit) t.effectParams.limit = { ...FX_START.limit };
    const P = () => t.effectParams.limit;
    const ceil0 = () => P().ceiling ?? (state.project.ceilingDb ?? -0.3);
    const key = typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id;
    const W = 900, H = 380, T = 14, B = H - 10, PL = 760, N = 240;
    const Y = (d) => T + ((0 - Math.max(-36, Math.min(3, d))) / 36) * (B - T) * 0.92 + 18;
    const db = (v) => 20 * Math.log10(Math.max(v, 1e-5));
    const f1 = (v) => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',');
    let undoArmed = false;
    const commit = (live) => {
        if (!undoArmed) { pushUndo(); undoArmed = true; setTimeout(() => undoArmed = false, 800); }
        t.effects = t.effects || []; if (!t.effects.includes('limit')) t.effects.push('limit');
        if (!live) refreshPlaybackSoon();
        saveProject();
    };
    const panel = document.createElement('div');
    panel.className = 'fx-panel lim-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('limit') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">Limiteur <i>— ${esc(t.name || '')}</i></span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="lim-face">
            <svg class="lim-svg" viewBox="0 0 ${W} ${H}"></svg>
            <div class="lim-fp">
                <div class="lim-col"><span class="lim-t">Style</span><span class="lim-seg lim-sty"><span data-sty="0" data-tooltip="Propre : ne se remarque pas (le réglage d'avant)">Transparent</span><span data-sty="1" data-tooltip="Doux : la réduction arrive et repart en douceur, moins de pompage sur les basses">Doux</span><span data-sty="2" data-tooltip="Franc : attrape les pics au plus près, ça claque et c'est plus fort (un peu de couleur)">Franc</span></span></div>
                <div class="lim-sep"></div>
            </div>
        </div>
        <div class="lim-sb">
            <button class="lim-tp" data-tooltip="Pic réel : les crêtes entre les échantillons comptent aussi (calcul ×4). Ce que demandent Spotify et YouTube">Pic réel</button>
            <span>Plafond <b class="lim-c"></b></span><span class="lim-spacer"></span><span>Réduction max <b class="lim-g"></b></span><span>Sortie <b class="lim-o">—</b></span>
        </div>`;
    document.body.appendChild(panel);
    const svg = panel.querySelector('.lim-svg'), fp = panel.querySelector('.lim-fp');
    const kCeil = proKnob(fp, { key: 'ceiling', label: 'Plafond', min: -12, max: 0, val: ceil0(), color: '#F87171', fmt: (v) => f1(v) + ' dB', onChange: (v) => { P().ceiling = Math.round(v * 10) / 10; drawStatic(); }, onEnd: () => commit() });
    proKnob(fp, { label: 'Anticipation', min: 0.1, max: 10, val: P().lookahead ?? 1.5, log: true, fmt: (v) => v.toFixed(1).replace('.', ',') + ' ms', onChange: (v) => { P().lookahead = Math.round(v * 10) / 10; }, onEnd: () => commit() });
    proKnob(fp, { key: 'release', label: 'Relâchement', min: 5, max: 2000, val: P().release ?? 120, log: true, fmt: (v) => Math.round(v) + ' ms', onChange: (v) => { P().release = Math.round(v); }, onEnd: () => commit() });
    // historique (lecture en cours) : crête d'entrée, de sortie et réduction
    const hin = [], hout = [], hgr = [];
    let gainDrag = false;
    const drawStatic = () => {
        panel.querySelector('.lim-c').textContent = f1(ceil0()) + ' dB';
        panel.querySelector('.lim-tp').classList.toggle('on', !!P().tp);
        panel.querySelectorAll('.lim-sty span').forEach(el => el.classList.toggle('on', +el.dataset.sty === (P().style || 0)));
        kCeil.set(ceil0());
        draw();
    };
    const draw = () => {
        const c = ceil0(), g = P().gain || 0, yc = Y(c);
        let s = `<defs><linearGradient id="limg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C4B5FD" stop-opacity=".75"/><stop offset="1" stop-color="#7C3AED" stop-opacity=".16"/></linearGradient></defs>`;
        for (const d of [0, -5, -8, -11, -14, -17, -20, -23, -26, -29, -32]) { const y = Y(d); s += `<line x1="0" x2="${PL}" y1="${y}" y2="${y}" class="lim-grid ${d === 0 ? 'z' : ''}"/><text x="${PL - 6}" y="${y - 3}" class="lim-txt" text-anchor="end">${d} dB</text>`; }
        const n = hout.length;
        if (n > 1) {
            const xs = (i) => ((i + N - n) / (N - 1) * PL).toFixed(1);
            let a = `M${xs(0)} ${B}`, b = '';
            for (let i = 0; i < n; i++) { a += ` L${xs(i)} ${Y(db(hout[i])).toFixed(1)}`; b += `${i ? 'L' : 'M'}${xs(i)} ${Y(db(hin[i])).toFixed(1)}`; }
            s += `<path d="${a} L${xs(n - 1)} ${B} Z" fill="url(#limg)"/><path d="${b}" fill="none" class="lim-in"/>`;
            let gl = '';
            for (let i = 0; i < n; i++) gl += `${i ? 'L' : 'M'}${xs(i)} ${(yc + Math.min(-db(hgr[i]), 12) * 6).toFixed(1)}`;
            s += `<path d="${gl}" fill="none" class="lim-grl"/>`;
            let last = -99;
            for (let i = 1; i < n - 1; i++) {
                const r = -db(hgr[i]);
                if (r > 0.4 && r >= -db(hgr[i - 1]) && r >= -db(hgr[i + 1]) && i - last > 26) { last = i; const x = +xs(i), y = yc + Math.min(r, 12) * 6; s += `<rect x="${x - 30}" y="${y + 8}" width="60" height="20" rx="10" class="lim-lab"/><text x="${x}" y="${y + 22}" class="lim-labt" text-anchor="middle">−${r.toFixed(1).replace('.', ',')} dB</text>`; }
            }
        } else s += `<text x="${PL / 2}" y="${(T + B) / 2}" class="lim-txt big" text-anchor="middle">Lance la lecture : le son défile ici, et tu vois chaque pic que le limiteur retire</text>`;
        s += `<line x1="0" x2="${PL}" y1="${yc}" y2="${yc}" class="lim-ceil"/><text x="${PL - 80}" y="${yc - 5}" class="lim-ceilt" text-anchor="end">plafond ${f1(c)} dB</text>`;
        // poignée d'entrée (gain) à gauche
        const gy = Math.max(T + 30, Math.min(B - 120, B - 120 - g / 24 * (B - T - 170)));
        s += `<g class="lim-gain"><rect x="16" y="${T + 20}" width="34" height="${B - T - 120}" rx="17" class="lim-gtrack"/><rect x="8" y="${gy - 13}" width="50" height="26" rx="13" class="lim-gpill"/><text x="33" y="${gy + 4}" class="lim-gtxt" text-anchor="middle">${f1(g)}</text><text x="33" y="${B - 86}" class="lim-txt" text-anchor="middle">ENTRÉE</text></g>`;
        // vumètres
        const li = hin.length ? hin[hin.length - 1] : 0, lo = hout.length ? hout[hout.length - 1] : 0, toF = (v) => Math.max(0, Math.min(1, (db(v) + 40) / 40));
        [[PL + 24, li, 'IN'], [PL + 52, lo, 'OUT']].forEach(([x, v, nm]) => {
            const yT = T + 20, yB = B - 6, yv = yB - toF(v) * (yB - yT);
            s += `<rect x="${x}" y="${yT}" width="14" height="${yB - yT}" rx="3" class="lim-mbg"/><rect x="${x}" y="${yv}" width="14" height="${yB - yv}" rx="3" class="lim-m ${db(v) > c - 0.05 ? 'hot' : ''}"/><text x="${x + 7}" y="${T + 12}" class="lim-txt" text-anchor="middle">${nm}</text>`;
        });
        svg.innerHTML = s;
    };
    // boucle d'affichage : prend les mesures du limiteur pendant la lecture
    let lastPush = 0, grMax = 1;
    const loop = (ts) => {
        if (!panel.isConnected) return;
        const m = (state.playing || state.recording) && t.effects && t.effects.includes('limit') ? PulseAudio.getLimiterMeter(key) : null;
        if (m && ts - lastPush > 33) {
            lastPush = ts; hin.push(m.i); hout.push(m.o); hgr.push(m.gr); if (hin.length > N) { hin.shift(); hout.shift(); hgr.shift(); }
            grMax = Math.min(grMax, m.gr);
            panel.querySelector('.lim-g').textContent = '−' + (-db(grMax)).toFixed(1).replace('.', ',') + ' dB';
            panel.querySelector('.lim-o').textContent = f1(db(m.o)) + ' dB';
            draw();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // poignée d'entrée : tirer vers le haut pour pousser le volume dans le limiteur
    svg.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.lim-gain')) return;
        e.preventDefault(); gainDrag = true;
        const r = svg.getBoundingClientRect(), k = W / r.width;
        const mv = (ev) => { const y = (ev.clientY - r.top) * k; P().gain = Math.round(Math.max(0, Math.min(24, (B - 120 - y) / (B - T - 170) * 24)) * 10) / 10; autoTouch(t, 'fx:limit:gain'); draw(); };
        const up = () => { gainDrag = false; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); commit(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    svg.addEventListener('dblclick', (e) => { if (e.target.closest('.lim-gain')) { P().gain = 0; commit(); draw(); } });
    panel.querySelector('.lim-tp').addEventListener('click', () => { P().tp = P().tp ? 0 : 1; commit(); drawStatic(); });
    panel.querySelectorAll('.lim-sty span').forEach(el => el.addEventListener('click', () => {
        const v = +el.dataset.sty; if (v) P().style = v; else delete P().style;
        commit(); drawStatic();
        flash('Limiteur : style ' + el.textContent);
    }));
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        pushUndo(); t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes('limit')) t.effects.push('limit'); } else { const i = t.effects.indexOf('limit'); if (i >= 0) t.effects.splice(i, 1); }
        anchorEl && anchorEl.classList && anchorEl.classList.toggle('active', !!e.target.checked);
        refreshPlaybackSoon(); saveProject();
    });
    drawStatic();
    const rect = anchorEl.getBoundingClientRect(), pw = Math.min(820, window.innerWidth - 16);
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'limit', trackIdx);
}

// === Gate : la voix défile, la ligne du seuil se tire, la zone sombre = ce que le gate baisse ===
// Ratio : 1 à 99 = expandeur (baisse un peu), ∞ = gate franc (ratio 0 dans le moteur, le son d'avant)
const GATE_STYLES = {
    classique: { label: 'Classique', tip: 'Gate franc : coupe net entre les phrases', p: { ratio: 0, knee: 0, attack: 2, hold: 50, release: 150 } },
    propre:    { label: 'Propre',    tip: 'Expandeur doux : baisse le bruit sans couper net', p: { ratio: 4, knee: 6, attack: 1, hold: 30, release: 120 } },
    voix:      { label: 'Voix',      tip: 'Pour une voix : baisse les respirations, garde les fins de mots', p: { ratio: 2, knee: 10, attack: 5, hold: 80, release: 220, hp: 100 } }
};
function openGatePanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'gate');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.gate) t.effectParams.gate = { ...FX_START.gate };
    const P = () => t.effectParams.gate;
    const key = typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id;
    const W = 900, H = 400, T = 16, B = H - 128, mid = (T + B) / 2, PL = W - 70, N = 260;
    const db = (v) => 20 * Math.log10(Math.max(v, 1e-6));
    const amp = (d) => Math.max(0, (Math.max(-70, d) + 70) / 70) * (mid - T - 4);
    const ratioOf = () => P().ratio > 0 ? P().ratio : 100;   // 100 à l'écran = ∞
    const fmtF = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '').replace('.', ',') + ' kHz' : Math.round(f) + ' Hz';
    // ce que le gate retire pour un niveau d'entrée (dB) : même formule que le moteur
    const red = (d) => {
        const r = P().ratio > 0 ? P().ratio : 0, range = P().reduction ?? 40, thr = P().threshold ?? -45;
        if (!r) return d >= thr ? 0 : range;
        const u = thr - d, k = (P().knee || 0) / 2;
        const x = u <= -k ? 0 : u < k ? (u + k) * (u + k) / (4 * Math.max(P().knee || 0, 1e-3)) * (r - 1) : u * (r - 1);
        return Math.min(range, Math.max(0, x));
    };
    let undoArmed = false;
    const commit = () => {
        if (!undoArmed) { pushUndo(); undoArmed = true; setTimeout(() => undoArmed = false, 800); }
        t.effects = t.effects || []; if (!t.effects.includes('gate')) t.effects.push('gate');
        refreshPlaybackSoon(); saveProject();
    };
    const panel = document.createElement('div');
    panel.className = 'fx-panel lim-panel gate-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('gate') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">Gate <i>— ${esc(t.name || '')}</i></span>
            <span class="lim-seg gate-sty">${Object.entries(GATE_STYLES).map(([k, s]) => `<span data-sty="${k}" data-tooltip="${esc(s.tip)}">${s.label}</span>`).join('')}</span>
            <button class="lim-tp gate-listen" data-tooltip="Écouter le déclencheur : tu entends ce que le gate « voit » (pendant la lecture). Se coupe à la fermeture">🎧 Écouter</button>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="lim-face">
            <svg class="lim-svg gate-svg" viewBox="0 0 ${W} ${H}"></svg>
            <div class="lim-fp gate-fp"></div>
        </div>
        <div class="lim-sb"><span class="gate-hint">violet = ce qui passe · zone sombre = baissé</span><span class="lim-spacer"></span><span>Baisse max <b class="gate-g">—</b></span></div>`;
    document.body.appendChild(panel);
    const svg = panel.querySelector('.gate-svg'), fp = panel.querySelector('.gate-fp');
    const sep = () => { const d = document.createElement('div'); d.className = 'lim-sep'; fp.appendChild(d); };
    const kThr = proKnob(fp, { key: 'threshold', label: 'Seuil', min: -70, max: -20, val: P().threshold ?? -45, color: '#FBBF24', fmt: (v) => Math.round(v) + ' dB', onChange: (v) => { P().threshold = Math.round(v); draw(); }, onEnd: commit });
    const kRat = proKnob(fp, { key: 'ratio', label: 'Ratio', min: 1, max: 100, val: ratioOf(), log: true, fmt: (v) => v >= 99 ? '∞ : 1' : v.toFixed(1).replace('.', ',') + ' : 1', onChange: (v) => { P().ratio = v >= 99 ? 0 : Math.round(v * 10) / 10; draw(); }, onEnd: commit });
    const kRng = proKnob(fp, { key: 'reduction', label: 'Coupure', min: 6, max: 80, val: P().reduction ?? 40, fmt: (v) => Math.round(v) + ' dB', onChange: (v) => { P().reduction = Math.round(v); draw(); }, onEnd: commit });
    const kKnee = proKnob(fp, { key: 'knee', label: 'Genou', min: 0, max: 24, val: P().knee || 0, fmt: (v) => Math.round(v) + ' dB', onChange: (v) => { P().knee = Math.round(v); draw(); }, onEnd: commit });
    sep();
    const kAtt = proKnob(fp, { key: 'attack', label: 'Attaque', min: 0.1, max: 50, val: P().attack ?? 2, log: true, fmt: (v) => v.toFixed(1).replace('.', ',') + ' ms', onChange: (v) => { P().attack = Math.round(v * 10) / 10; }, onEnd: commit });
    const kHold = proKnob(fp, { key: 'hold', label: 'Maintien', min: 0, max: 500, val: P().hold ?? 50, fmt: (v) => Math.round(v) + ' ms', onChange: (v) => { P().hold = Math.round(v); }, onEnd: commit });
    const kRel = proKnob(fp, { key: 'release', label: 'Retour', min: 20, max: 500, val: P().release ?? 150, fmt: (v) => Math.round(v) + ' ms', onChange: (v) => { P().release = Math.round(v); }, onEnd: commit });
    sep();
    // Déclencheur : ce que le gate écoute (coupe-bas / coupe-haut). Deux poignées, ou la zone entière qu'on fait glisser
    const rg = document.createElement('div'); rg.className = 'lim-col gate-rgc';
    rg.innerHTML = `<span class="lim-t">Déclencheur</span><div class="gate-rg" data-tooltip="Ce que le gate écoute pour s'ouvrir : tire une poignée, ou la zone entière"><div class="gate-rf"></div><i class="gate-h a"></i><i class="gate-h b"></i></div><div class="gate-rv"><span class="va"></span><span class="vb"></span></div>`;
    fp.appendChild(rg);
    const FMIN = 20, FMAX = 20000, X = (f) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * 100, F = (p) => FMIN * Math.pow(FMAX / FMIN, p / 100);
    const lo = () => P().hp > 20 ? P().hp : 20, hi = () => P().lp > 0 && P().lp < 20000 ? P().lp : 20000;
    const drawRange = () => {
        rg.querySelector('.gate-rf').style.cssText = `left:${X(lo())}%;width:${X(hi()) - X(lo())}%`;
        rg.querySelector('.a').style.left = X(lo()) + '%'; rg.querySelector('.b').style.left = X(hi()) + '%';
        rg.querySelector('.va').textContent = lo() <= 20 ? 'Off' : fmtF(lo()); rg.querySelector('.vb').textContent = hi() >= 20000 ? 'Off' : fmtF(hi());
    };
    const setRange = (a, b) => {
        a = Math.round(a); b = Math.round(b);
        if (a <= 21) delete P().hp; else P().hp = a;
        if (b >= 19900) delete P().lp; else P().lp = b;
        drawRange();
    };
    const bar = rg.querySelector('.gate-rg');
    const dragOn = (el, move) => el.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const r = bar.getBoundingClientRect(), x0 = e.clientX, l0 = lo(), h0 = hi();
        const mv = (ev) => move((ev.clientX - r.left) / r.width * 100, (ev.clientX - x0) / r.width * 100, l0, h0);
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); commit(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    dragOn(rg.querySelector('.a'), (p) => setRange(Math.min(F(Math.max(0, p)), hi() / 1.3), hi()));
    dragOn(rg.querySelector('.b'), (p) => setRange(lo(), Math.max(F(Math.min(100, p)), lo() * 1.3)));
    dragOn(rg.querySelector('.gate-rf'), (p, dp, l0, h0) => {
        let a = X(l0) + dp, z = X(h0) + dp; if (a < 0) { z -= a; a = 0; } if (z > 100) { a -= z - 100; z = 100; }
        setRange(F(a), F(z));
    });
    bar.addEventListener('dblclick', () => { setRange(20, 20000); commit(); });
    // historique pendant la lecture : niveau vu par le gate (e) et gain appliqué (g)
    const he = [], hg = [];
    let gMin = 1;
    const draw = () => {
        const thr = P().threshold ?? -45;
        let s = `<defs><pattern id="gateht" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="7" fill="#ffffff0a"/></pattern>
            <linearGradient id="gatev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C084FC"/><stop offset="1" stop-color="#7C3AED"/></linearGradient></defs>`;
        s += `<line x1="0" x2="${PL}" y1="${mid}" y2="${mid}" class="lim-grid z"/>`;
        const n = he.length, xs = (i) => (i + N - n) / (N - 1) * PL;
        if (n > 1) {
            // zones baissées (gain sous 0,5) en sombre hachuré
            let s0 = -1;
            for (let i = 0; i <= n; i++) {
                const cl = i < n && hg[i] < 0.5;
                if (cl && s0 < 0) s0 = i;
                if (!cl && s0 >= 0) { const x = xs(s0), w = xs(i - 1) - x + PL / N; s += `<rect x="${x.toFixed(1)}" y="${T}" width="${w.toFixed(1)}" height="${B - T}" fill="#05030a" opacity=".6"/><rect x="${x.toFixed(1)}" y="${T}" width="${w.toFixed(1)}" height="${B - T}" fill="url(#gateht)"/>`; s0 = -1; }
            }
            let up = '', dn = '', up2 = '', dn2 = '';
            for (let i = 0; i < n; i++) {
                const x = xs(i).toFixed(1), a = amp(db(he[i])), a2 = amp(db(he[i] * hg[i]));
                up += `${i ? 'L' : 'M'}${x} ${(mid - a).toFixed(1)}`; dn = `L${x} ${(mid + a).toFixed(1)}` + dn;
                up2 += `${i ? 'L' : 'M'}${x} ${(mid - a2).toFixed(1)}`; dn2 = `L${x} ${(mid + a2).toFixed(1)}` + dn2;
            }
            s += `<path d="${up}${dn}Z" class="gate-in"/><path d="${up2}${dn2}Z" fill="url(#gatev)" class="gate-out"/>`;
        } else s += `<text x="${PL / 2}" y="${mid - 30}" class="lim-txt big" text-anchor="middle">Lance la lecture : la voix défile ici, la zone sombre montre ce que le gate baisse</text>`;
        // seuil : ligne jaune (et son reflet en bas), pastille à tirer
        const ty = mid - amp(thr);
        s += `<line x1="0" x2="${PL}" y1="${ty}" y2="${ty}" class="gate-thr"/><line x1="0" x2="${PL}" y1="${2 * mid - ty}" y2="${2 * mid - ty}" class="gate-thr ghost"/>
            <g class="gate-thrh"><rect x="0" y="${ty - 14}" width="${PL - 170}" height="28" fill="transparent"/><rect x="14" y="${ty - 12}" width="86" height="24" rx="12" class="gate-pill"/><text x="57" y="${ty + 4}" class="gate-pillt" text-anchor="middle">${Math.round(thr)} dB</text></g>`;
        // courbe entrée → sortie, en haut à droite
        const cx = PL - 160, cy = T + 4, cs = 132;
        s += `<rect x="${cx}" y="${cy}" width="${cs}" height="${cs}" rx="12" class="gate-io"/>`;
        const Pt = (i, o) => [cx + 10 + (i + 70) / 70 * (cs - 20), cy + cs - 10 - (Math.max(-70, o) + 70) / 70 * (cs - 20)];
        let c = '';
        for (let d = -70; d <= 0; d += 0.5) { const [x, y] = Pt(d, d - red(d)); c += (d === -70 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1); }
        s += `<path d="${c}" class="gate-curve"/><text x="${cx + cs / 2}" y="${cy + cs + 13}" class="lim-txt" text-anchor="middle">entrée → sortie</text>`;
        // vumètres entrée / sortie
        const le = n ? he[n - 1] : 0, lg = n ? hg[n - 1] : 1, toF = (v) => Math.max(0, Math.min(1, (db(v) + 70) / 70));
        [[PL + 14, le, 'IN'], [PL + 40, le * lg, 'OUT']].forEach(([x, v, nm]) => {
            const yT = T + 16, yB = B, yv = yB - toF(v) * (yB - yT);
            s += `<rect x="${x}" y="${yT}" width="14" height="${yB - yT}" rx="3" class="lim-mbg"/><rect x="${x}" y="${yv}" width="14" height="${yB - yv}" rx="3" class="lim-m"/><text x="${x + 7}" y="${T + 8}" class="lim-txt" text-anchor="middle">${nm}</text>`;
        });
        svg.innerHTML = s;
        panel.querySelectorAll('.gate-sty span').forEach(el => {
            const st = GATE_STYLES[el.dataset.sty].p;
            el.classList.toggle('on', Object.keys(st).every(k => (P()[k] ?? (k === 'ratio' ? 0 : undefined)) === st[k]));
        });
        panel.querySelector('.gate-listen').classList.toggle('on', !!P().listen);
        panel.querySelector('.gate-hint').textContent = P().listen ? '🎧 tu entends ce que le gate « voit »' : 'violet = ce qui passe · zone sombre = baissé';
    };
    const syncKnobs = () => { kThr.set(P().threshold ?? -45); kRat.set(ratioOf()); kRng.set(P().reduction ?? 40); kKnee.set(P().knee || 0); kAtt.set(P().attack ?? 2); kHold.set(P().hold ?? 50); kRel.set(P().release ?? 150); drawRange(); draw(); };
    let lastPush = 0;
    const loop = (ts) => {
        if (!panel.isConnected) return;
        const m = (state.playing || state.recording) && t.effects && t.effects.includes('gate') ? PulseAudio.getGateMeter(key) : null;
        if (m && ts - lastPush > 33) {
            lastPush = ts; he.push(m.e); hg.push(m.g); if (he.length > N) { he.shift(); hg.shift(); }
            gMin = Math.min(gMin, m.g); panel.querySelector('.gate-g').textContent = '−' + Math.round(-db(gMin)) + ' dB';
            draw();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // tirer la ligne du seuil
    svg.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.gate-thrh')) return;
        e.preventDefault();
        const r = svg.getBoundingClientRect(), k = W / r.width;
        const mv = (ev) => { const y = (ev.clientY - r.top) * k; P().threshold = Math.round(Math.max(-70, Math.min(-20, (mid - y) / (mid - T - 4) * 70 - 70))); kThr.set(P().threshold); autoTouch(t, 'fx:gate:threshold'); draw(); };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); commit(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    panel.querySelectorAll('.gate-sty span').forEach(el => el.addEventListener('click', () => {
        const st = GATE_STYLES[el.dataset.sty].p;
        commit(); Object.assign(P(), st); if (!('hp' in st)) delete P().hp; if (!st.ratio) delete P().ratio;
        refreshPlaybackSoon(); saveProject(); syncKnobs();
        flash(`Gate : style ${GATE_STYLES[el.dataset.sty].label}`);
    }));
    // écoute du déclencheur : seulement le temps de la fenêtre (jamais à l'export)
    panel.querySelector('.gate-listen').addEventListener('click', () => { if (P().listen) delete P().listen; else P().listen = true; refreshPlaybackSoon(); draw(); });
    const stopListen = () => { if (P() && P().listen) { delete P().listen; refreshPlaybackSoon(); } };
    panel.querySelector('.fx-panel-close').addEventListener('click', () => { stopListen(); panel.remove(); });
    new MutationObserver((_, o) => { if (!panel.isConnected) { stopListen(); o.disconnect(); } }).observe(document.body, { childList: true });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        pushUndo(); t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes('gate')) t.effects.push('gate'); } else { const i = t.effects.indexOf('gate'); if (i >= 0) t.effects.splice(i, 1); }
        refreshPlaybackSoon(); saveProject(); refreshStrips();
    });
    syncKnobs();
    const rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 80, right: 80, top: 80 };
    const pw = Math.min(900, window.innerWidth - 16);
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'gate', trackIdx);
}

// === De-esser (planche validée) : la voix défile, chaque « s » détecté s'allume en orange avec ce qu'on lui retire ===
// Seuil, Plage, zone des « s » (deux poignées, ou la zone entière qu'on fait glisser), Séparé / Large, Voix seule / Tout-terrain, Écouter.
const DEESS_V2 = { thr: -26, range: 10, lo: 5000, hi: 11000 };
function openDeessPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'deess');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.deess) t.effectParams.deess = { ...DEESS_V2 };
    const P = () => t.effectParams.deess;
    const old = () => P().thr === undefined;          // ancien réglage (Force) : il passe au nouveau moteur dès qu'on touche un bouton
    const V = (k) => P()[k] ?? DEESS_V2[k];
    const key = typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id;
    const W = 900, H = 400, T = 16, B = H - 128, mid = (T + B) / 2, PL = W - 70, N = 260;
    const db = (v) => 20 * Math.log10(Math.max(v, 1e-6));
    const amp = (d) => Math.max(0, (Math.max(-60, Math.min(0, d)) + 60) / 60) * (mid - T - 4);
    const fmtF = (f) => (f / 1000).toFixed(f >= 10000 ? 1 : 1).replace('.', ',') + ' kHz';
    let undoArmed = false;
    const commit = () => {
        if (!undoArmed) { pushUndo(); undoArmed = true; setTimeout(() => undoArmed = false, 800); }
        if (old()) { Object.keys(DEESS_V2).forEach(k => { if (P()[k] === undefined) P()[k] = DEESS_V2[k]; }); }
        delete P().amount; delete P().freq;
        t.effects = t.effects || []; if (!t.effects.includes('deess')) t.effects.push('deess');
        refreshPlaybackSoon(); saveProject();
    };
    const panel = document.createElement('div');
    panel.className = 'fx-panel lim-panel gate-panel ds-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('deess') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">De-esser <i>— ${esc(t.name || '')}</i></span>
            <span class="lim-seg ds-md"><span data-v="0" data-tooltip="Séparé : on baisse seulement les aigus, le reste de la voix ne bouge pas">Séparé</span><span data-v="1" data-tooltip="Large : toute la voix baisse un instant pendant le « s » (plus naturel sur certaines voix)">Large</span></span>
            <span class="lim-seg ds-rel"><span data-v="0" data-tooltip="Voix seule : réagit au niveau des « s » (une voix seule, bien enregistrée)">Voix seule</span><span data-v="1" data-tooltip="Tout-terrain : réagit aux « s » par rapport au reste de la voix (voix qui bouge beaucoup, bus de voix)">Tout-terrain</span></span>
            <button class="lim-tp ds-listen" data-tooltip="Écouter seulement ce qui est détecté (la zone des « s »), pendant la lecture. Se coupe à la fermeture">🎧 Écouter</button>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="lim-face">
            <svg class="lim-svg gate-svg ds-svg" viewBox="0 0 ${W} ${H}"></svg>
            <div class="lim-fp gate-fp ds-fp"></div>
        </div>
        <div class="lim-sb"><span class="ds-hint"></span><span class="lim-spacer"></span><span>Réduction <b class="ds-r">0,0 dB</b></span></div>`;
    document.body.appendChild(panel);
    const svg = panel.querySelector('.ds-svg'), fp = panel.querySelector('.ds-fp');
    const sep = () => { const d = document.createElement('div'); d.className = 'lim-sep'; fp.appendChild(d); };
    const kThr = proKnob(fp, { key: 'thr', label: 'Seuil', min: -60, max: 0, val: V('thr'), big: true, color: '#FBBF24', fmt: (v) => Math.round(v) + ' dB', onChange: (v) => { P().thr = Math.round(v); draw(); }, onEnd: commit });
    const kRng = proKnob(fp, { key: 'range', label: 'Plage', min: 0, max: 24, val: V('range'), big: true, color: '#FBBF24', fmt: (v) => Math.round(v) + ' dB', onChange: (v) => { if (old()) P().thr = V('thr'); P().range = Math.round(v); draw(); }, onEnd: commit });
    // anneau fin autour du Seuil : le niveau des « s » en direct (vert sous le seuil, orange au-dessus)
    kThr.el.style.position = 'relative';
    kThr.el.insertAdjacentHTML('beforeend', '<svg class="ds-lvl" viewBox="0 0 64 64"><path class="ds-lvl-a" fill="none" stroke-width="2" stroke-linecap="round"/></svg>');
    const lvlArc = (fr, over) => {
        // le bouton se redessine en entier quand il bouge : on remet l'anneau si besoin
        if (!kThr.el.querySelector('.ds-lvl')) kThr.el.insertAdjacentHTML('beforeend', '<svg class="ds-lvl" viewBox="0 0 64 64"><path class="ds-lvl-a" fill="none" stroke-width="2" stroke-linecap="round"/></svg>');
        const a = kThr.el.querySelector('.ds-lvl-a');
        const P2 = (d) => { const r = (d - 90) * Math.PI / 180; return [32 + 31 * Math.cos(r), 32 + 31 * Math.sin(r)]; };
        const f = Math.max(0, Math.min(1, fr)), e = -135 + 270 * f, [x1, y1] = P2(-135), [x2, y2] = P2(e);
        a.setAttribute('d', f > 0.005 ? `M${x1} ${y1} A31 31 0 ${f * 270 > 180 ? 1 : 0} 1 ${x2} ${y2}` : '');
        a.setAttribute('stroke', over ? '#FB923C' : '#34D399');
    };
    sep();
    const rg = document.createElement('div'); rg.className = 'lim-col gate-rgc';
    rg.innerHTML = `<span class="lim-t">Zone des « s »</span><div class="gate-rg ds-rg" data-tooltip="Où sont les sifflantes : tire une poignée, ou attrape le milieu pour déplacer toute la zone (double-clic = 5 à 11 kHz)"><div class="gate-rf"></div><i class="gate-h a"></i><i class="gate-h b"></i></div><div class="gate-rv"><span class="va"></span><span class="vb"></span></div>`;
    fp.appendChild(rg);
    const FMIN = 2000, FMAX = 20000, X = (f) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * 100, F = (p) => FMIN * Math.pow(FMAX / FMIN, Math.max(0, Math.min(100, p)) / 100);
    const drawRange = () => {
        rg.querySelector('.gate-rf').style.cssText = `left:${X(V('lo'))}%;width:${X(V('hi')) - X(V('lo'))}%`;
        rg.querySelector('.a').style.left = X(V('lo')) + '%'; rg.querySelector('.b').style.left = X(V('hi')) + '%';
        rg.querySelector('.va').textContent = fmtF(V('lo')); rg.querySelector('.vb').textContent = fmtF(V('hi'));
    };
    const setRange = (a, b) => { if (old()) P().thr = V('thr'); P().lo = Math.round(Math.max(FMIN, a) / 50) * 50; P().hi = Math.round(Math.min(FMAX, b) / 50) * 50; drawRange(); };
    const bar = rg.querySelector('.gate-rg');
    const dragOn = (el, move) => el.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const r = bar.getBoundingClientRect(), x0 = e.clientX, l0 = V('lo'), h0 = V('hi');
        const mv = (ev) => move((ev.clientX - r.left) / r.width * 100, (ev.clientX - x0) / r.width * 100, l0, h0);
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); commit(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    dragOn(rg.querySelector('.a'), (p) => setRange(Math.min(F(p), V('hi') / 1.25), V('hi')));
    dragOn(rg.querySelector('.b'), (p) => setRange(V('lo'), Math.max(F(p), V('lo') * 1.25)));
    dragOn(rg.querySelector('.gate-rf'), (p, dp, l0, h0) => {
        let a = X(l0) + dp, z = X(h0) + dp; if (a < 0) { z -= a; a = 0; } if (z > 100) { a -= z - 100; z = 100; }
        setRange(F(a), F(z));
    });
    bar.addEventListener('dblclick', () => { setRange(5000, 11000); commit(); });
    sep();
    // historique pendant la lecture : voix (v), niveau des « s » (s), réduction (r, dB)
    const hv = [], hs = [], hr = [];
    let rMax = 0;
    const draw = () => {
        const thr = V('thr'), rel = !!P().rel;
        let s = `<defs><linearGradient id="dsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs>`;
        for (const d of [0, -12, -24, -36, -48]) { const y = mid - amp(d); s += `<line x1="0" x2="${PL}" y1="${y}" y2="${y}" class="lim-grid ${d === 0 ? 'z' : ''}"/><text x="6" y="${y - 3}" class="lim-txt">${d} dB</text>`; }
        s += `<line x1="0" x2="${PL}" y1="${mid}" y2="${mid}" class="lim-grid z"/>`;
        const n = hv.length, xs = (i) => (i + N - n) / (N - 1) * PL;
        if (n > 1) {
            let up = '', dn = '';
            for (let i = 0; i < n; i++) { const x = xs(i).toFixed(1), a = amp(db(hv[i])); up += `${i ? 'L' : 'M'}${x} ${(mid - a).toFixed(1)}`; dn = `L${x} ${(mid + a * 0.85).toFixed(1)}` + dn; }
            s += `<path d="${up}${dn}Z" class="ds-voice"/>`;
            // chaque « s » baissé : la zone orange (avant) et ce qu'il en reste, avec une pastille « −x dB »
            let i0 = -1;
            for (let i = 0; i <= n; i++) {
                const on = i < n && hr[i] > 0.3;
                if (on && i0 < 0) i0 = i;
                if (!on && i0 >= 0) {
                    let a1 = '', a2 = '', b1 = '', mx = 0;
                    for (let k = i0; k < i; k++) { const x = xs(k).toFixed(1), sv = amp(db(hs[k])), s2 = amp(db(hs[k]) - hr[k]); a1 += `${k > i0 ? 'L' : 'M'}${x} ${(mid - sv).toFixed(1)}`; a2 += `${k > i0 ? 'L' : 'M'}${x} ${(mid - s2).toFixed(1)}`; mx = Math.max(mx, hr[k]); }
                    const xa = xs(i0).toFixed(1), xb = xs(i - 1).toFixed(1);
                    s += `<path d="${a1}L${xb} ${mid}L${xa} ${mid}Z" fill="url(#dsg)" opacity=".35"/><path d="${a2}L${xb} ${mid}L${xa} ${mid}Z" fill="url(#dsg)" class="ds-s"/>`;
                    s += `<rect x="${(+xa - 4).toFixed(1)}" y="${T + 2}" width="56" height="19" rx="9.5" class="ds-pill"/><text x="${(+xa + 24).toFixed(1)}" y="${T + 15}" class="ds-pillt" text-anchor="middle">−${mx.toFixed(1).replace('.', ',')}</text>`;
                    i0 = -1;
                }
            }
        } else s += `<text x="${PL / 2}" y="${mid - 30}" class="lim-txt big" text-anchor="middle">Lance la lecture : la voix défile ici, et chaque « s » baissé s'allume en orange</text>`;
        const ty = mid - amp(rel ? thr - 6 : thr);
        s += `<line x1="0" x2="${PL}" y1="${ty}" y2="${ty}" class="gate-thr"/>
            <g class="gate-thrh ds-thrh"><rect x="0" y="${ty - 14}" width="${PL}" height="28" fill="transparent"/><rect x="${PL - 150}" y="${ty - 12}" width="136" height="24" rx="12" class="gate-pill"/><text x="${PL - 82}" y="${ty + 4}" class="gate-pillt" text-anchor="middle">seuil ${Math.round(thr)} dB${rel ? ' (relatif)' : ''}</text></g>`;
        const lr = n ? hr[n - 1] : 0, lv = n ? hv[n - 1] : 0;
        [[PL + 14, Math.min(1, lr / Math.max(1, V('range'))), 'RÉD.', 'ds-m'], [PL + 40, Math.max(0, Math.min(1, (db(lv) + 60) / 60)), 'IN', '']].forEach(([x, f, nm, c]) => {
            const yT = T + 16, yB = B, yv = c ? yT + f * (yB - yT) : yB - f * (yB - yT);
            s += `<rect x="${x}" y="${yT}" width="14" height="${yB - yT}" rx="3" class="lim-mbg"/>${c ? `<rect x="${x}" y="${yT}" width="14" height="${(yv - yT).toFixed(1)}" rx="3" class="lim-m ${c}"/>` : `<rect x="${x}" y="${yv}" width="14" height="${yB - yv}" rx="3" class="lim-m"/>`}<text x="${x + 7}" y="${T + 8}" class="lim-txt" text-anchor="middle">${nm}</text>`;
        });
        svg.innerHTML = s;
        panel.querySelectorAll('.ds-md span').forEach(el => el.classList.toggle('on', +el.dataset.v === (P().wide ? 1 : 0)));
        panel.querySelectorAll('.ds-rel span').forEach(el => el.classList.toggle('on', +el.dataset.v === (P().rel ? 1 : 0)));
        panel.querySelector('.ds-listen').classList.toggle('on', !!P().listen);
        panel.querySelector('.ds-hint').textContent = P().listen ? '🎧 tu entends seulement les « s » détectés'
            : old() ? `Ancien réglage (force ${Math.round(P().amount || 0)} %) : touche un bouton pour passer au nouveau de-esser` : 'gris = la voix · orange = chaque « s » détecté, et ce qu\'il en reste';
    };
    const syncKnobs = () => { kThr.set(V('thr')); kRng.set(V('range')); drawRange(); draw(); };
    let lastPush = 0;
    const loop = (ts) => {
        if (!panel.isConnected) return;
        const m = (state.playing || state.recording) && t.effects && t.effects.includes('deess') && PulseAudio.getDeessMeter ? PulseAudio.getDeessMeter(key) : null;
        if (m && ts - lastPush > 33) {
            lastPush = ts; hv.push(m.v); hs.push(m.s); hr.push(m.r); if (hv.length > N) { hv.shift(); hs.shift(); hr.shift(); }
            rMax = Math.max(rMax, m.r); panel.querySelector('.ds-r').textContent = '−' + m.r.toFixed(1).replace('.', ',') + ' dB (max −' + rMax.toFixed(1).replace('.', ',') + ')';
            const det = P().rel ? db(m.s) - db(Math.max(m.f || m.v, 1e-6)) : db(m.s);
            lvlArc((det + 60) / 60, det > V('thr'));
            draw();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    svg.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.ds-thrh')) return;
        e.preventDefault();
        const r = svg.getBoundingClientRect(), k = W / r.width, rel = !!P().rel;
        const mv = (ev) => { const y = (ev.clientY - r.top) * k; P().thr = Math.round(Math.max(-60, Math.min(0, (mid - y) / (mid - T - 4) * 60 - 60 + (rel ? 6 : 0)))); kThr.set(P().thr); autoTouch(t, 'fx:deess:thr'); draw(); };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); commit(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    const seg = (sel, k) => panel.querySelectorAll(sel + ' span').forEach(el => el.addEventListener('click', () => {
        commit(); if (+el.dataset.v) P()[k] = true; else delete P()[k];
        refreshPlaybackSoon(); saveProject(); draw();
    }));
    seg('.ds-md', 'wide'); seg('.ds-rel', 'rel');
    panel.querySelector('.ds-listen').addEventListener('click', () => { if (old()) commit(); if (P().listen) delete P().listen; else P().listen = true; refreshPlaybackSoon(); draw(); });
    const stopListen = () => { if (P() && P().listen) { delete P().listen; refreshPlaybackSoon(); } };
    panel.querySelector('.fx-panel-close').addEventListener('click', () => { stopListen(); panel.remove(); });
    new MutationObserver((_, o) => { if (!panel.isConnected) { stopListen(); o.disconnect(); } }).observe(document.body, { childList: true });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        pushUndo(); t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes('deess')) t.effects.push('deess'); } else { const i = t.effects.indexOf('deess'); if (i >= 0) t.effects.splice(i, 1); }
        refreshPlaybackSoon(); saveProject(); refreshStrips();
    });
    syncKnobs(); lvlArc(0, false);
    const rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 80, right: 80, top: 80 };
    const pw = Math.min(900, window.innerWidth - 16);
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'deess', trackIdx);
}

// === Multibande à bandes libres (planche validée) : une bande seulement là où il y a un souci, jusqu'à 6 ===
// Double-clic dans le vide = nouvelle bande · le rond : gauche / droite = déplacer la bande, haut / bas = son seuil ·
// les deux poignées = ses limites · ✕ = la retirer. Plage négative = compresser, positive = remonter.
const MB_COLORS = ['#A855F7', '#22D3EE', '#F472B6', '#FBBF24', '#34D399', '#60A5FA'];
const mbName = (b) => { const f = Math.sqrt(b.lo * b.hi); return f < 120 ? 'Grave' : f < 500 ? 'Boue' : f < 2000 ? 'Médium' : f < 5000 ? 'Présence' : f < 10000 ? 'Sifflantes' : 'Air'; };
function openMbandPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'mband');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.mband) t.effectParams.mband = { bands: [] };
    const P = () => t.effectParams.mband, BS = () => (P().bands = P().bands || []);
    const key = typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id;
    const W = 900, H = 520, T = 30, B = H - 130, PL = 850, Y0 = 190, DBK = 7, MAXB = 6, F0 = 20, F1 = 20000;
    const X = (f) => Math.log(f / F0) / Math.log(F1 / F0) * PL, F = (x) => F0 * Math.pow(F1 / F0, Math.max(0, Math.min(PL, x)) / PL);
    const lr = (f, fc, hp) => { const r = Math.pow(f / fc, 4); return hp ? r / (1 + r) : 1 / (1 + r); };
    const resp = (b, f) => (b.lo > F0 * 1.05 ? lr(f, b.lo, true) : 1) * (b.hi < F1 * 0.95 ? lr(f, b.hi, false) : 1);
    const fmtF = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '').replace('.', ',') + ' kHz' : Math.round(f) + ' Hz';
    const db1 = (v) => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + ' dB';
    const YS = (d) => B - ((Math.max(-96, Math.min(-12, d)) + 96) / 84) * (B - Y0 - 10);
    let sel = BS().length ? 0 : -1, undoArmed = false;
    // L'étape d'annulation est prise AVANT le changement : au premier mouvement d'un geste (bouton, glisser),
    // ou tout de suite pour un clic (mode, solo, ✕, nouvelle bande) — chaque clic est sa propre étape
    const arm = () => { if (!undoArmed) { pushUndo(); undoArmed = true; } };
    const finish = () => {
        t.effects = t.effects || []; if (!t.effects.includes('mband')) t.effects.push('mband');
        refreshPlaybackSoon(); saveProject(); undoArmed = false;
    };
    const commit = finish;
    const step = (fn) => { pushUndo(); fn(); finish(); };
    const panel = document.createElement('div');
    panel.className = 'fx-panel lim-panel mb-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('mband') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">Multibande <i>— ${esc(t.name || '')}</i></span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="lim-face"><svg class="lim-svg mb-svg" viewBox="0 0 ${W} ${H}"></svg><div class="lim-fp mb-fp"></div></div>
        <div class="lim-sb"><span>Bandes <b class="mb-n"></b></span><span class="lim-spacer"></span><span class="mb-hint">Double-clic dans le vide = nouvelle bande · le rond : gauche / droite = déplacer, haut / bas = seuil</span></div>`;
    document.body.appendChild(panel);
    const svg = panel.querySelector('.mb-svg'), fp = panel.querySelector('.mb-fp');
    const gd = [0, 0, 0, 0, 0, 0];      // gain dynamique affiché, par bande (suivi pendant la lecture)
    let bins = null;
    const draw = () => {
        const bands = BS();
        let g = '<defs>' + bands.map((b, i) => `<linearGradient id="mbc${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${MB_COLORS[i]}" stop-opacity=".14"/><stop offset="1" stop-color="${MB_COLORS[i]}" stop-opacity=".02"/></linearGradient>`).join('') + '</defs>';
        bands.forEach((b, i) => { const x0 = X(b.lo), x1 = X(b.hi); g += `<rect class="mb-col" data-i="${i}" x="${x0.toFixed(1)}" y="${T - 4}" width="${(x1 - x0).toFixed(1)}" height="${B - T + 4}" fill="url(#mbc${i})" opacity="${i === sel ? 1 : 0.45}"/><line x1="${x0}" x2="${x0}" y1="${T}" y2="${B}" stroke="${MB_COLORS[i]}" stroke-opacity=".35" stroke-dasharray="3 5"/><line x1="${x1}" x2="${x1}" y1="${T}" y2="${B}" stroke="${MB_COLORS[i]}" stroke-opacity=".35" stroke-dasharray="3 5"/>`; });
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g += `<line x1="${X(f).toFixed(1)}" x2="${X(f).toFixed(1)}" y1="${T}" y2="${B}" class="lim-grid"/><text x="${(X(f) + 3).toFixed(1)}" y="${B - 4}" class="lim-txt">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
        for (const d of [12, 6, 0, -6, -12, -18]) { const y = Y0 - d * DBK; g += `<line x1="0" x2="${PL}" y1="${y}" y2="${y}" class="lim-grid ${d === 0 ? 'z' : ''}"/><text x="${PL - 4}" y="${y - 3}" class="lim-txt" text-anchor="end">${d > 0 ? '+' : ''}${d}</text>`; }
        // le son de la piste derrière (pendant la lecture)
        const an = (state.playing || state.recording) ? (typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null)) : null;
        if (an) {
            if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(an.frequencyBinCount);
            an.getFloatFrequencyData(bins);
            const nyq = (PulseAudio.getContext() ? PulseAudio.getContext().sampleRate : 48000) / 2;
            let d = `M0 ${B}`;
            for (let x = 0; x <= PL; x += 4) { const k = Math.min(bins.length - 1, Math.max(0, Math.round(F(x) / nyq * (bins.length - 1)))); const v = Number.isFinite(bins[k]) ? bins[k] : -120; d += ` L${x} ${YS(v).toFixed(1)}`; }
            g += `<path d="${d} L${PL} ${B} Z" class="mb-spec"/>`;
        }
        // ce que fait chaque bande : forme arrondie autour du 0 dB (et sa limite, la plage)
        bands.forEach((b, i) => {
            const c = MB_COLORS[i], on = i === sel; let a = '', lim = '';
            for (let x = 0; x <= PL; x += 5) { const r = resp(b, F(x)); a += `${x ? 'L' : 'M'}${x} ${(Y0 - ((b.mute ? -24 : gd[i]) + (b.out || 0)) * r * DBK).toFixed(1)}`; lim += `${x ? 'L' : 'M'}${x} ${(Y0 - ((b.range ?? -6) + (b.out || 0)) * r * DBK).toFixed(1)}`; }
            g += `<path d="${lim}" fill="none" stroke="${c}" stroke-opacity="${on ? 0.55 : 0.25}" stroke-width="1.2" stroke-dasharray="4 4"/>`;
            g += `<path d="${a} L${PL} ${Y0} L0 ${Y0} Z" fill="${c}" fill-opacity="${on ? 0.4 : 0.2}" stroke="${c}" stroke-width="${on ? 2 : 1.2}" ${on ? `style="filter:drop-shadow(0 0 6px ${c})"` : ''}/>`;
        });
        // courbe totale (0 dB partout où il n'y a pas de bande)
        let tot = '';
        for (let x = 0; x <= PL; x += 5) { const f = F(x); let sm = 1; bands.forEach((b, i) => { sm += resp(b, f) * (Math.pow(10, ((b.mute ? -60 : gd[i]) + (b.out || 0)) / 20) - 1); }); tot += `${x ? 'L' : 'M'}${x} ${(Y0 - 20 * Math.log10(Math.max(sm, 1e-3)) * DBK).toFixed(1)}`; }
        g += `<path d="${tot}" class="mb-total"/>`;
        // les ronds (déplacer / seuil) et les poignées de la bande choisie
        bands.forEach((b, i) => {
            const x = X(Math.sqrt(b.lo * b.hi)), on = i === sel, c = MB_COLORS[i], y = Y0 - ((b.thr ?? -30) + 30) * 2.2;
            g += `<g class="mb-dot" data-i="${i}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18" fill="transparent"/>${on ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="none" stroke="#fff" stroke-width="2"/>` : ''}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 9 : 7}" fill="${c}" stroke="#0b0712" stroke-width="2"/></g>`;
            if (on) { const lab = `${mbName(b)} · ${fmtF(b.lo)} – ${fmtF(b.hi)} · seuil ${Math.round(b.thr ?? -30)} dB`, w = lab.length * 6.1 + 20, lx = Math.max(4, Math.min(PL - w - 4, x - w / 2)); g += `<rect x="${lx.toFixed(1)}" y="${(y - 44).toFixed(1)}" width="${w.toFixed(1)}" height="22" rx="11" fill="#0b0712dd" stroke="${c}" stroke-opacity=".6"/><text x="${(lx + w / 2).toFixed(1)}" y="${(y - 29).toFixed(1)}" class="mb-lab" text-anchor="middle">${esc(lab)}</text>`; }
        });
        const b = bands[sel];
        if (b) { const bx0 = X(b.lo), bx1 = X(b.hi), by = B - 26, c = MB_COLORS[sel];
            g += `<line x1="${bx0}" x2="${bx1}" y1="${by}" y2="${by}" stroke="${c}" stroke-width="4" stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${c})"/>
                <g class="mb-tri" data-k="lo"><rect x="${bx0 - 14}" y="${by - 18}" width="28" height="32" fill="transparent"/><path d="M${bx0 - 11} ${by + 8} L${bx0 + 3} ${by - 12} L${bx0 + 3} ${by + 8} Z" fill="#e9e2f5"/></g>
                <g class="mb-tri" data-k="hi"><rect x="${bx1 - 14}" y="${by - 18}" width="28" height="32" fill="transparent"/><path d="M${bx1 + 11} ${by + 8} L${bx1 - 3} ${by - 12} L${bx1 - 3} ${by + 8} Z" fill="#e9e2f5"/></g>`; }
        if (!bands.length) g += `<text x="${PL / 2}" y="${Y0 - 20}" class="lim-txt big" text-anchor="middle">Double-clic là où tu veux travailler pour créer une bande (le reste du son n'est pas touché)</text>`;
        svg.innerHTML = g;
        panel.querySelector('.mb-n').textContent = bands.length + ' / ' + MAXB;
    };
    let knobs = {};
    const buildFp = () => {
        const b = BS()[sel]; fp.innerHTML = ''; fp.style.display = b ? '' : 'none'; knobs = {}; if (!b) return;
        const c = MB_COLORS[sel]; fp.style.borderColor = c + '77';
        const c0 = document.createElement('div'); c0.className = 'lim-col mb-c0';
        c0.innerHTML = `<span class="lim-t" style="color:${c}">● ${mbName(b)}</span>
            <span class="lim-seg mb-md"><span data-v="c" class="${(b.range ?? -6) <= 0 ? 'on' : ''}" data-tooltip="Baisser la zone quand elle déborde (au-dessus du seuil)">Compresser</span><span data-v="e" class="${(b.range ?? -6) > 0 ? 'on' : ''}" data-tooltip="Remonter la zone quand elle passe le seuil">Remonter</span></span>
            <span class="mb-sm"><span class="mb-pill mb-so ${b.solo ? 'on' : ''}" data-tooltip="Écouter seulement cette bande">S</span><span class="mb-pill mb-mu ${b.mute ? 'on' : ''}" data-tooltip="Couper cette zone du son">M</span><span class="mb-pill mb-del" data-tooltip="Retirer cette bande">✕</span></span>`;
        fp.appendChild(c0);
        c0.querySelectorAll('.mb-md span').forEach(x => x.addEventListener('click', () => { step(() => { const r = Math.abs(b.range ?? 6) || 6; b.range = x.dataset.v === 'c' ? -r : r; }); buildFp(); draw(); }));
        c0.querySelector('.mb-so').addEventListener('click', () => { step(() => { b.solo = !b.solo; if (b.solo) delete b.mute; if (!b.solo) delete b.solo; }); buildFp(); draw(); });
        c0.querySelector('.mb-mu').addEventListener('click', () => { step(() => { b.mute = !b.mute; if (b.mute) delete b.solo; if (!b.mute) delete b.mute; }); buildFp(); draw(); });
        c0.querySelector('.mb-del').addEventListener('click', () => { step(() => { BS().splice(sel, 1); sel = Math.min(sel, BS().length - 1); }); buildFp(); draw(); });
        const sp = document.createElement('div'); sp.className = 'lim-sep'; fp.appendChild(sp);
        const k = (key, o) => { knobs[key] = proKnob(fp, { color: c, onEnd: commit, key: `b${sel}-${key}`, ...o, onChange: (v) => { arm(); b[key] = o.round(v); draw(); } }); };
        k('thr', { label: 'Seuil', min: -60, max: 0, val: b.thr ?? -30, big: true, fmt: (v) => Math.round(v) + ' dB', round: (v) => Math.round(v) });
        k('range', { label: 'Plage', min: -24, max: 24, val: b.range ?? -6, fmt: db1, round: (v) => Math.round(v * 2) / 2 });
        k('att', { label: 'Attaque', min: 0.5, max: 200, val: b.att ?? 10, log: true, fmt: (v) => v.toFixed(1).replace('.', ',') + ' ms', round: (v) => Math.round(v * 10) / 10 });
        k('rel', { label: 'Relâchement', min: 20, max: 1000, val: b.rel ?? 120, log: true, fmt: (v) => Math.round(v) + ' ms', round: (v) => Math.round(v) });
        k('out', { label: 'Sortie', min: -12, max: 12, val: b.out || 0, fmt: db1, round: (v) => Math.round(v * 2) / 2 });
    };
    const at = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const tri = e.target.closest('.mb-tri'), dot = e.target.closest('.mb-dot'), col = e.target.closest('.mb-col');
        if (!tri && !dot) { if (col && +col.dataset.i !== sel) { sel = +col.dataset.i; buildFp(); draw(); } return; }
        e.preventDefault();
        if (dot && +dot.dataset.i !== sel) { sel = +dot.dataset.i; buildFp(); }
        const b = BS()[sel]; if (!b) return;
        const [x0, y0] = at(e), lo0 = b.lo, hi0 = b.hi, th0 = b.thr ?? -30;
        undoArmed = false;
        let moved = false;
        const mv = (ev) => {
            const [x, y] = at(ev); if (!moved && Math.hypot(x - x0, y - y0) < 2) return; if (!moved) arm(); moved = true;
            if (tri && tri.dataset.k === 'lo') { b.lo = Math.round(Math.max(F0, Math.min(b.hi / 1.25, F(x)))); autoTouch(t, `fx:mband:b${sel}-lo`); }
            else if (tri) { b.hi = Math.round(Math.min(F1, Math.max(b.lo * 1.25, F(x)))); autoTouch(t, `fx:mband:b${sel}-hi`); }
            else {
                const k = F(X(Math.sqrt(lo0 * hi0)) + (x - x0)) / Math.sqrt(lo0 * hi0); let lo = lo0 * k, hi = hi0 * k;
                if (lo < F0) { hi *= F0 / lo; lo = F0; } if (hi > F1) { lo *= F1 / hi; hi = F1; }
                b.lo = Math.round(lo); b.hi = Math.round(hi);
                if (x !== x0) { autoTouch(t, `fx:mband:b${sel}-lo`); autoTouch(t, `fx:mband:b${sel}-hi`); }
                b.thr = Math.round(Math.max(-60, Math.min(0, th0 + (y0 - y) / 2.2)));
                if (knobs.thr) knobs.thr.set(b.thr);
                autoTouch(t, `fx:mband:b${sel}-thr`);
            }
            draw();
        };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) commit(); buildFp(); draw(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    svg.addEventListener('dblclick', (e) => {
        if (e.target.closest('.mb-dot, .mb-tri')) return;
        const [x] = at(e); if (x > PL) return;
        if (BS().length >= MAXB) { flash(`${MAXB} bandes au plus`); return; }
        const f = F(x);
        step(() => { BS().push({ lo: Math.round(Math.max(F0, f / Math.SQRT2)), hi: Math.round(Math.min(F1, f * Math.SQRT2)), thr: -30, range: -6, att: 10, rel: 120, out: 0 }); sel = BS().length - 1; });
        buildFp(); draw();
    });
    let last = 0;
    const loop = (ts) => {
        if (!panel.isConnected) return;
        if (ts - last > 33) {
            last = ts;
            const m = (state.playing || state.recording) && t.effects && t.effects.includes('mband') && PulseAudio.getMbandMeter ? PulseAudio.getMbandMeter(key) : null;
            // les bandes allumées dans le moteur sont celles qui ne sont pas éteintes, dans l'ordre
            const live = BS().map((b, i) => i).filter(i => BS()[i].on !== false);
            BS().forEach((b, i) => { const j = live.indexOf(i), tg = m && j >= 0 && m.g ? (m.g[j] || 0) : 0; gd[i] += (tg - gd[i]) * 0.3; });
            if (m || (state.playing || state.recording) || gd.some(v => Math.abs(v) > 0.05)) draw();
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        pushUndo(); t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes('mband')) t.effects.push('mband'); } else { const i = t.effects.indexOf('mband'); if (i >= 0) t.effects.splice(i, 1); }
        refreshPlaybackSoon(); saveProject(); refreshStrips();
    });
    buildFp(); draw();
    const rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 80, right: 80, top: 80 };
    const pw = Math.min(900, window.innerWidth - 16);
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'mband', trackIdx);
}

// === Saturation multibande (planche validée, choix B) : une bande de départ sur tout le son, puis des bandes libres posées dessus ===
// Chaque bande libre prend sa zone à la bande de départ (rien n'est saturé deux fois). « + » en haut ou double-clic = nouvelle bande.
const MSAT_STY = {
    bande: { n: 'Bande', v: ['Propre', 'Chaude', 'Poussée'] }, lampe: { n: 'Lampe', v: ['Douce', 'Juteuse', 'Cassée'] }, ampli: { n: 'Ampli', v: ['Rond', 'Crunch', 'Hurlant'] },
    transfo: { n: 'Transfo', v: ['Léger', 'Coloré'] }, repli: { n: 'Repli', v: ['Doux', 'Dur'] }, lofi: { n: 'Lo-fi', v: ['Bits', 'Échantillons'] }
};
const MSAT_COLORS = ['#A855F7', '#F59E0B', '#22D3EE', '#F472B6', '#34D399', '#60A5FA', '#FB7185'];
// même courbe que le moteur (audio.js, msatCurve) : pour l'icône et l'encart « entrée → sortie »
function msatCurveUI(sty, x, k) {
    x = Math.max(-4, Math.min(4, x));
    if (sty === 'lampe') return Math.tanh(k * (x + 0.18 * x * x)) / Math.tanh(k * 1.18);
    if (sty === 'ampli') { const a = k * x; return Math.max(-1, Math.min(1, a / (1 + Math.abs(a)) * (1 + 1 / k))); }
    if (sty === 'transfo') return Math.sin(Math.max(-1, Math.min(1, x * (0.6 + k * 0.08))) * Math.PI / 2);
    if (sty === 'repli') { let a = x * (1 + k * 0.35); for (let i = 0; i < 4; i++) { if (a > 1) a = 2 - a; else if (a < -1) a = -2 - a; } return a; }
    if (sty === 'lofi') { const q = 10 - Math.min(7, k); return Math.floor(Math.tanh(k * x) / Math.tanh(k) * q + 0.5) / q; }
    return Math.tanh(k * x * 0.9) / Math.tanh(k * 0.9);
}
const msatIcon = (k) => { let p = ''; for (let i = 0; i <= 20; i++) { const x = -1 + i / 10, y = msatCurveUI(k, x, 4); p += (i ? 'L' : 'M') + (1 + (x + 1) / 2 * 20).toFixed(1) + ' ' + (15 - (Math.max(-1, Math.min(1, y)) + 1) / 2 * 14).toFixed(1); } return `<svg viewBox="0 0 22 16" width="22" height="16"><path d="${p}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; };
function openMsatPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'msat');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.msat) t.effectParams.msat = JSON.parse(JSON.stringify(FX_START.msat));
    const P = () => t.effectParams.msat, BS = () => (P().bands = P().bands || []);
    const W = 900, H = 520, T = 40, B = H - 130, PL = 846, F0 = 20, F1 = 20000, MAXB = 6;
    const X = (f) => Math.log(f / F0) / Math.log(F1 / F0) * PL, F = (x) => F0 * Math.pow(F1 / F0, Math.max(0, Math.min(PL, x)) / PL);
    const YS = (d) => B - ((Math.max(-96, Math.min(-12, d)) + 96) / 84) * (B - T - 40);
    const fmtF = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '').replace('.', ',') + ' kHz' : Math.round(f) + ' Hz';
    const free = () => BS().filter(b => !b.base), base = () => BS().find(b => b.base);
    const nm = (b) => b.base ? 'Tout le son' : mbName(b);
    const VKU = [0.6, 1, 1.7];
    let sel = BS().length > 1 ? 1 : 0, undoArmed = false, hx = null;
    const arm = () => { if (!undoArmed) { pushUndo(); undoArmed = true; } };
    const finish = () => { t.effects = t.effects || []; if (!t.effects.includes('msat')) t.effects.push('msat'); refreshPlaybackSoon(); saveProject(); undoArmed = false; };
    const step = (fn) => { pushUndo(); fn(); finish(); };
    const panel = document.createElement('div');
    panel.className = 'fx-panel lim-panel mb-panel ms-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('msat') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">Saturation multibande <i>— ${esc(t.name || '')}</i></span>
            <button class="lim-tp ms-ag" data-tooltip="Auto gain : le volume ne bouge presque pas quand on monte la chaleur">Auto gain</button>
            <span class="ms-glob"></span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="lim-face"><svg class="lim-svg ms-svg" viewBox="0 0 ${W} ${H}"></svg><div class="lim-fp mb-fp ms-fp"></div></div>
        <div class="lim-sb"><span>Bandes <b class="ms-n"></b></span><span class="lim-spacer"></span><span>« + » en haut ou double-clic = nouvelle bande · le rond : gauche / droite = déplacer, haut / bas = chaleur</span></div>`;
    document.body.appendChild(panel);
    const svg = panel.querySelector('.ms-svg'), fp = panel.querySelector('.ms-fp');
    // Mélange et Sortie de tout l'effet, dans le bandeau
    const glob = panel.querySelector('.ms-glob');
    const gk1 = proKnob(glob, { key: 'mix', label: 'Mélange', min: 0, max: 100, val: P().mix ?? 100, fmt: (v) => Math.round(v) + ' %', onChange: (v) => { arm(); P().mix = Math.round(v); }, onEnd: finish });
    const gk2 = proKnob(glob, { key: 'out', label: 'Sortie', min: -12, max: 12, val: P().out || 0, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + ' dB', onChange: (v) => { arm(); P().out = Math.round(v * 2) / 2; }, onEnd: finish });
    let bins = null;
    const draw = () => {
        const bands = BS(), bs = base(), bi = bands.indexOf(bs);
        let g = '<defs>' + bands.map((b, i) => `<linearGradient id="msc${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${MSAT_COLORS[i % 7]}" stop-opacity="${b.base ? 0.1 : 0.2}"/><stop offset="1" stop-color="${MSAT_COLORS[i % 7]}" stop-opacity=".02"/></linearGradient>`).join('') + '</defs>';
        if (bs) g += `<rect class="mb-col" data-i="${bi}" x="0" y="${T}" width="${PL}" height="${B - T}" fill="url(#msc${bi})" opacity="${bi === sel ? 1 : 0.6}"/>`;
        free().forEach(b => { const i = bands.indexOf(b), x0 = X(b.lo), x1 = X(b.hi), c = MSAT_COLORS[i % 7]; g += `<rect class="mb-col" data-i="${i}" x="${x0.toFixed(1)}" y="${T}" width="${(x1 - x0).toFixed(1)}" height="${B - T}" fill="#0b0712" opacity=".5"/><rect class="mb-col" data-i="${i}" x="${x0.toFixed(1)}" y="${T}" width="${(x1 - x0).toFixed(1)}" height="${B - T}" fill="url(#msc${i})" opacity="${i === sel ? 1 : 0.6}"/><line x1="${x0}" x2="${x0}" y1="${T}" y2="${B}" stroke="${c}" stroke-opacity=".5" stroke-dasharray="3 5"/><line x1="${x1}" x2="${x1}" y1="${T}" y2="${B}" stroke="${c}" stroke-opacity=".5" stroke-dasharray="3 5"/>`; });
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g += `<line x1="${X(f).toFixed(1)}" x2="${X(f).toFixed(1)}" y1="${T}" y2="${B}" class="lim-grid"/><text x="${(X(f) + 3).toFixed(1)}" y="${B + 14}" class="lim-txt">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
        const an = (state.playing || state.recording) ? (typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null)) : null;
        if (an) {
            if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(an.frequencyBinCount);
            an.getFloatFrequencyData(bins);
            const nyq = (PulseAudio.getContext() ? PulseAudio.getContext().sampleRate : 48000) / 2;
            let d = `M0 ${B}`;
            for (let x = 0; x <= PL; x += 4) { const k = Math.min(bins.length - 1, Math.max(0, Math.round(F(x) / nyq * (bins.length - 1)))); const v = Number.isFinite(bins[k]) ? bins[k] : -120; d += ` L${x} ${YS(v).toFixed(1)}`; }
            g += `<path d="${d} L${PL} ${B} Z" class="ms-spec"/>`;
        } else g += `<text x="${PL / 2}" y="${B - 16}" class="lim-txt" text-anchor="middle">Lance la lecture : le son de la piste (avec la chaleur ajoutée) s'affiche ici</text>`;
        if (!bs) g += `<text x="${PL / 2}" y="${T + 70}" class="lim-txt big" text-anchor="middle">Sans bande de départ : seules tes bandes saturent, le reste du son reste propre</text>`;
        bands.forEach((b, i) => {
            const on = i === sel, c = MSAT_COLORS[i % 7], heat = b.heat ?? 30, x = b.base ? PL * 0.16 : (X(b.lo) + X(b.hi)) / 2, y = B - 20 - (heat / 100) * (B - T - 90);
            const sty = MSAT_STY[b.sty || 'bande'] || MSAT_STY.bande;
            g += `<g class="mb-dot" data-i="${i}" style="cursor:${b.base ? 'ns-resize' : 'move'}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="20" fill="transparent"/>${on ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="none" stroke="#fff" stroke-width="2"/>` : ''}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 9 : 7}" fill="${b.mute ? '#3a2c50' : c}" stroke="#0b0712" stroke-width="2"/>
                <text x="${x.toFixed(1)}" y="${(y - 20).toFixed(1)}" class="mb-lab" text-anchor="middle">${esc(nm(b))} · ${sty.n} ${sty.v[b.va ?? 1] || ''} · ${heat} %</text></g>`;
            const zx = b.base ? 8 : X(b.lo) + 6, zy = b.base ? T + 8 : T + 30;
            g += `<g class="ms-sm"><rect class="ms-s" data-i="${i}" x="${zx}" y="${zy}" width="18" height="16" rx="5" fill="${b.solo ? '#FBBF24' : '#ffffff10'}" stroke="#ffffff22"/><text x="${zx + 9}" y="${zy + 11.5}" class="ms-smt ${b.solo ? 'on' : ''}" text-anchor="middle">S</text>
                <rect class="ms-m" data-i="${i}" x="${zx + 22}" y="${zy}" width="18" height="16" rx="5" fill="${b.mute ? '#F87171' : '#ffffff10'}" stroke="#ffffff22"/><text x="${zx + 31}" y="${zy + 11.5}" class="ms-smt ${b.mute ? 'on' : ''}" text-anchor="middle">M</text></g>`;
            if (!b.base && on) {
                const x0 = X(b.lo), x1 = X(b.hi), by = B - 24;
                g += `<line x1="${x0}" x2="${x1}" y1="${by}" y2="${by}" stroke="${c}" stroke-width="4" stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${c})"/>
                    <g class="mb-tri" data-k="lo"><rect x="${x0 - 14}" y="${by - 18}" width="28" height="32" fill="transparent"/><path d="M${x0 - 11} ${by + 8} L${x0 + 3} ${by - 12} L${x0 + 3} ${by + 8} Z" fill="#e9e2f5"/></g>
                    <g class="mb-tri" data-k="hi"><rect x="${x1 - 14}" y="${by - 18}" width="28" height="32" fill="transparent"/><path d="M${x1 + 11} ${by + 8} L${x1 - 3} ${by - 12} L${x1 - 3} ${by + 8} Z" fill="#e9e2f5"/></g>
                    <g class="ms-slp"><rect x="${((x0 + x1) / 2 - 32).toFixed(1)}" y="${by - 34}" width="64" height="18" rx="9" fill="#1a1228" stroke="${c}aa"/><text x="${((x0 + x1) / 2).toFixed(1)}" y="${by - 21}" class="ms-smt" text-anchor="middle">pente ${b.slope || 24} dB</text></g>`;
            }
        });
        if (hx !== null && free().length < MAXB) g += `<g class="ms-plus"><circle cx="${hx.toFixed(1)}" cy="${T + 12}" r="10" fill="#7C3AED" stroke="#C084FC"/><text x="${hx.toFixed(1)}" y="${T + 16.5}" class="ms-plust" text-anchor="middle">+</text></g>`;
        // encart : la courbe du style choisi
        const zs = bands[sel];
        if (zs) {
            const cx = PL - 136, cy = T + 40, cs = 120, k = (1 + (zs.heat ?? 30) / 100 * 7) * VKU[zs.va ?? 1], c = MSAT_COLORS[sel % 7];
            let p = ''; for (let i = 0; i <= 60; i++) { const xx = -1 + i / 30, yy = msatCurveUI(zs.sty || 'bande', xx, k); p += (i ? 'L' : 'M') + (cx + 8 + (xx + 1) / 2 * (cs - 16)).toFixed(1) + ' ' + (cy + cs - 8 - (Math.max(-1, Math.min(1, yy)) + 1) / 2 * (cs - 16)).toFixed(1); }
            g += `<rect x="${cx}" y="${cy}" width="${cs}" height="${cs}" rx="12" fill="#0b0712cc" stroke="${c}66"/><line x1="${cx + 8}" y1="${cy + cs - 8}" x2="${cx + cs - 8}" y2="${cy + 8}" stroke="#ffffff22" stroke-dasharray="3 4"/><path d="${p}" fill="none" stroke="${c}" stroke-width="2.2" style="filter:drop-shadow(0 0 5px ${c})"/><text x="${cx + cs / 2}" y="${cy + cs + 14}" class="lim-txt" text-anchor="middle">entrée → sortie</text>`;
        }
        svg.innerHTML = g;
        panel.querySelector('.ms-n').textContent = (bs ? 'départ + ' : '') + free().length + ' / ' + MAXB;
        panel.querySelector('.ms-ag').classList.toggle('on', P().ag !== false);
    };
    let kHeat = null;
    const buildFp = () => {
        fp.innerHTML = ''; const b = BS()[sel]; fp.style.display = b ? '' : 'none'; if (!b) return;
        const c = MSAT_COLORS[sel % 7]; fp.style.borderColor = c + '77';
        const sty = MSAT_STY[b.sty || 'bande'] || MSAT_STY.bande;
        const c0 = document.createElement('div'); c0.className = 'lim-col mb-c0';
        c0.innerHTML = `<span class="lim-t" style="color:${c}">● ${esc(nm(b))} · style</span>
            <div class="ms-stys">${Object.entries(MSAT_STY).map(([k, s2]) => `<button class="ms-sty ${(b.sty || 'bande') === k ? 'on' : ''}" data-k="${k}" style="--c:${c}">${msatIcon(k)}${s2.n}</button>`).join('')}</div>
            <span class="mb-sm"><span class="lim-seg ms-va">${sty.v.map((n, i) => `<span data-i="${i}" class="${(b.va ?? 1) === i ? 'on' : ''}">${n}</span>`).join('')}</span><span class="mb-pill mb-del" data-tooltip="${b.base ? 'Retirer la bande de départ : seules tes bandes saturent' : 'Retirer cette bande'}">✕</span></span>`;
        fp.appendChild(c0);
        c0.querySelectorAll('.ms-sty').forEach(x => x.addEventListener('click', () => { step(() => { b.sty = x.dataset.k; b.va = Math.min(b.va ?? 1, MSAT_STY[b.sty].v.length - 1); }); buildFp(); draw(); }));
        c0.querySelectorAll('.ms-va span').forEach(x => x.addEventListener('click', () => { step(() => { b.va = +x.dataset.i; }); buildFp(); draw(); }));
        c0.querySelector('.mb-del').addEventListener('click', () => { step(() => { BS().splice(sel, 1); sel = Math.max(0, Math.min(sel, BS().length - 1)); }); buildFp(); draw(); });
        const sep = () => { const d = document.createElement('div'); d.className = 'lim-sep'; fp.appendChild(d); }; sep();
        const pm = (v) => (v > 0 ? '+' : '') + Math.round(v);
        const k = (host, key, o) => proKnob(host, { color: c, onEnd: finish, key: `b${sel}-${key}`, ...o, onChange: (v) => { arm(); b[key] = o.round ? o.round(v) : Math.round(v); draw(); } });
        kHeat = k(fp, 'heat', { label: 'Chaleur', min: 0, max: 100, val: b.heat ?? 30, big: true, fmt: (v) => Math.round(v) + ' %' });
        k(fp, 'dyn', { label: 'Dynamique', min: -50, max: 50, val: b.dyn || 0, fmt: (v) => { v = Math.round(v); return v > 0 ? 'tasse ' + v : v < 0 ? 'aère ' + (-v) : '0'; } });
        k(fp, 'fb', { label: 'Résonance', min: 0, max: 100, val: b.fb || 0, fmt: (v) => Math.round(v) + ' %' });
        k(fp, 'mix', { label: 'Mélange', min: 0, max: 100, val: b.mix ?? 100, fmt: (v) => Math.round(v) + ' %' });
        k(fp, 'out', { label: 'Niveau', min: -24, max: 12, val: b.out || 0, fmt: (v) => pm(v) + ' dB', round: (v) => Math.round(v * 2) / 2 });
        sep();
        const tc = document.createElement('div'); tc.className = 'lim-col ms-tone'; tc.innerHTML = '<span class="lim-t">Ton du son saturé</span><div class="ms-tk"></div>'; fp.appendChild(tc);
        const tk = tc.querySelector('.ms-tk');
        [['lo2', 'Grave'], ['md', 'Médium'], ['hi2', 'Aigu'], ['pr', 'Présence']].forEach(([key, l]) => k(tk, key, { label: l, min: -12, max: 12, val: b[key] || 0, fmt: (v) => pm(v) + ' dB', round: (v) => Math.round(v * 2) / 2 }));
    };
    const at = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    // nouvelle bande libre : une octave autour de la souris, sans chevaucher les autres
    const addBand = (f) => {
        if (free().length >= MAXB) { flash(`${MAXB} bandes au plus (en plus de la bande de départ)`); return; }
        let lo = f / Math.SQRT2, hi = f * Math.SQRT2;
        for (const b of free()) { if (f >= b.lo && f < b.hi) return; if (b.hi <= f) lo = Math.max(lo, b.hi); if (b.lo >= f) hi = Math.min(hi, b.lo); }
        if (hi / lo < 1.2) return;
        step(() => { BS().push({ lo: Math.max(F0, Math.round(lo)), hi: Math.min(F1, Math.round(hi)), sty: 'ampli', va: 0, heat: 30 }); sel = BS().length - 1; });
        buildFp(); draw();
    };
    const near = (b, side) => { let v = side ? F1 : F0; for (const o of free()) { if (o === b) continue; if (side && o.lo >= b.hi - 1) v = Math.min(v, o.lo); if (!side && o.hi <= b.lo + 1) v = Math.max(v, o.hi); } return v; };
    svg.addEventListener('mouseleave', () => { if (hx !== null) { hx = null; draw(); } });
    svg.addEventListener('mousemove', (e) => { if (e.buttons) return; const [x, y] = at(e); const n = y < T + 26 && x < PL ? x : null; if (n !== hx) { hx = n; draw(); } });
    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const tg = e.target;
        if (tg.closest('.ms-plus')) { e.preventDefault(); addBand(F(hx)); return; }
        if (tg.closest('.ms-s')) { const b = BS()[+tg.dataset.i]; step(() => { b.solo = !b.solo; if (b.solo) delete b.mute; else delete b.solo; }); draw(); return; }
        if (tg.closest('.ms-m')) { const b = BS()[+tg.dataset.i]; step(() => { b.mute = !b.mute; if (b.mute) delete b.solo; else delete b.mute; }); draw(); return; }
        if (tg.closest('.ms-slp')) { const b = BS()[sel], L = [12, 24, 48]; step(() => { b.slope = L[(L.indexOf(b.slope || 24) + 1) % 3]; }); draw(); return; }
        const tri = tg.closest('.mb-tri'), dot = tg.closest('.mb-dot'), col = tg.closest('.mb-col');
        if (!tri && !dot) { if (col && +col.dataset.i !== sel) { sel = +col.dataset.i; buildFp(); draw(); } return; }
        e.preventDefault();
        if (dot && +dot.dataset.i !== sel) { sel = +dot.dataset.i; buildFp(); }
        const b = BS()[sel]; if (!b) return;
        const [x0, y0] = at(e), lo0 = b.lo, hi0 = b.hi, h0 = b.heat ?? 30;
        let moved = false; undoArmed = false;
        const mv = (ev) => {
            const [x, y] = at(ev); if (!moved && Math.hypot(x - x0, y - y0) < 2) return; if (!moved) arm(); moved = true;
            if (tri && tri.dataset.k === 'lo') { b.lo = Math.round(Math.max(near(b, 0), Math.min(b.hi / 1.25, F(x)))); autoTouch(t, `fx:msat:b${sel}-lo`); }
            else if (tri) { b.hi = Math.round(Math.min(near(b, 1), Math.max(b.lo * 1.25, F(x)))); autoTouch(t, `fx:msat:b${sel}-hi`); }
            else {
                if (!b.base) {
                    const k = F(X(Math.sqrt(lo0 * hi0)) + (x - x0)) / Math.sqrt(lo0 * hi0); let lo = lo0 * k, hi = hi0 * k; const L = near(b, 0), R = near(b, 1);
                    if (lo < L) { hi *= L / lo; lo = L; } if (hi > R) { lo *= R / hi; hi = R; }
                    if (lo >= L - 0.5 && hi <= R + 0.5) { b.lo = Math.round(lo); b.hi = Math.round(hi); if (x !== x0) { autoTouch(t, `fx:msat:b${sel}-lo`); autoTouch(t, `fx:msat:b${sel}-hi`); } }
                }
                b.heat = Math.round(Math.max(0, Math.min(100, h0 + (y0 - y) / (B - T - 90) * 100)));
                if (kHeat) kHeat.set(b.heat);
                autoTouch(t, `fx:msat:b${sel}-heat`);
            }
            draw();
        };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) finish(); buildFp(); draw(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    svg.addEventListener('dblclick', (e) => {
        if (e.target.closest('.mb-dot, .mb-tri, .ms-s, .ms-m, .ms-slp, .ms-plus')) return;
        const [x] = at(e); if (x > PL) return;
        addBand(F(x));
    });
    panel.querySelector('.ms-ag').addEventListener('click', () => { step(() => { if (P().ag === false) delete P().ag; else P().ag = false; }); draw(); });
    let last = 0;
    const loop = (ts) => { if (!panel.isConnected) return; if ((state.playing || state.recording) && ts - last > 50) { last = ts; draw(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        pushUndo(); t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes('msat')) t.effects.push('msat'); } else { const i = t.effects.indexOf('msat'); if (i >= 0) t.effects.splice(i, 1); }
        refreshPlaybackSoon(); saveProject(); refreshStrips();
    });
    buildFp(); draw();
    const rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 80, right: 80, top: 80 };
    const pw = Math.min(900, window.innerWidth - 16);
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'msat', trackIdx);
}

// Réglages de chaque effet (partagés : fenêtres de plugin et menu d'automation)
const FX_PANEL_DEFS = {
    eq: [
        { key: 'hpf',      label: 'Passe-Haut',  unit: 'Hz', min: 20,  max: 500, def: 80,  step: 1 },
        { key: 'midGain',  label: 'Médiums',      unit: 'dB', min: -12, max: 12,  def: -2,  step: 0.5 },
        { key: 'presence', label: 'Présence 4k',  unit: 'dB', min: -12, max: 12,  def: 2,   step: 0.5 },
        { key: 'air',      label: 'Air 10k',      unit: 'dB', min: -8,  max: 8,   def: 1,   step: 0.5 }
    ],
    comp: [
        { key: 'mode', label: 'Caractère', unit: '', min: 0, max: 3, def: 0, step: 1, choices: [0, 1, 2, 3], choiceLabels: ['Propre', 'Opto', 'FET', 'Bus'],
          tip: 'Propre : sans couleur · Opto : lent et doux, chaleur de lampe (voix) · FET : très rapide, ça claque (rap, batterie) · Bus : colle le mix' },
        { key: 'threshold', label: 'Seuil',    unit: ' dB', min: -40, max: 0,  def: -22, step: 1 },
        { key: 'ratio',     label: 'Ratio',     unit: ':1', min: 1,   max: 20, def: 3,   step: 0.5, busSteps: [1.5, 2, 4, 10, 20] },
        { key: 'mix',       label: 'Mélange',   unit: '%',  min: 0,   max: 100, def: 100, step: 1 },
        { key: 'attack',    label: 'Attaque',   unit: ' ms', min: 0.1, max: 100, def: 10, step: 0.1, adv: true, log: true, busSteps: [0.1, 0.3, 1, 3, 10, 30] },
        { key: 'release',   label: 'Relâchement', unit: ' ms', min: 10,  max: 1200, def: 50, step: 5, adv: true, log: true, busSteps: [100, 300, 600, 1200, 'auto'] },
        { key: 'knee',      label: 'Genou',     unit: ' dB', min: 0,   max: 24, def: 10,  step: 1, adv: true,
          tip: 'Douceur de l\'entrée en compression : 0 = net, 24 = très progressif' },
        // Rattrapage : sans réglage, Pulse remonte le volume tout seul (« Auto »), comme avant
        { key: 'makeup',    label: 'Rattrapage', unit: ' dB', min: -12, max: 24, def: 0, step: 0.5, adv: true,
          auto: (p) => Math.round(-p.threshold * (1 - 1 / Math.max(1, p.ratio)) * 0.35 * 2) / 2,
          tip: 'Volume rendu après compression. Alt-clic : revenir en automatique' }
    ],
    reverb: [
        { key: 'wet',   label: 'Quantité',    unit: '%',  min: 0,   max: 100, def: 18, step: 1 },
        { key: 'size',  label: 'Taille',     unit: 's',  min: 0.3, max: 5,   def: 1.8, step: 0.1 },
        { key: 'decay', label: 'Déclin',     unit: '',   min: 0.5, max: 5,   def: 2.5, step: 0.1 },
        { key: 'pre',   label: 'Pré-délai',  unit: ' ms', min: 0, max: 250, def: 0, step: 1, tip: 'Le temps avant que la reverb démarre : la voix reste devant' },
        { key: 'duck',  label: 'Ducking',    unit: '%',  min: 0,   max: 100, def: 0, step: 1, tip: 'La reverb se pousse pendant que la voix chante et ressort dans les trous' },
        { key: 'low',   label: 'Grave',      unit: ' Hz', min: 20, max: 1000, def: 20, step: 5, log: true, adv: true, tip: 'Retire les graves de la reverb (elle ne boue plus)' },
        { key: 'high',  label: 'Aigu',       unit: ' Hz', min: 1500, max: 20000, def: 20000, step: 100, log: true, adv: true, tip: 'Retire les aigus de la reverb (plus douce, moins de sifflantes)' },
        { key: 'bright', label: 'Brillance', unit: '',   min: 0,   max: 100, def: 50, step: 1, tip: 'Couleur de la queue : 0 = sombre et feutrée (pièce avec des rideaux), 100 = claire et brillante (pierre, plaque)' },
        { key: 'width', label: 'Largeur',    unit: '%',  min: 0,   max: 150, def: 100, step: 1, adv: true, tip: 'Largeur de la reverb : 0 = mono (au centre), 100 = normal, 150 = plus large que les enceintes' }
    ],
    crush: [
        { key: 'bits', label: 'Finesse du son', unit: ' bits', min: 4, max: 16, def: 8, step: 1 },
        { key: 'down', label: 'Son haché',      unit: '',      min: 1, max: 32, def: 4, step: 1 },
        { key: 'mix',  label: 'Mélange',        unit: '%',     min: 0, max: 100, def: 100, step: 1 }
    ],
    util: [
        { key: 'gain',   label: 'Volume',           unit: ' dB', min: -24, max: 24, def: 0, step: 0.5 },
        { key: 'invert', label: 'Inverser la phase', unit: '',   min: 0,   max: 1,  def: 0, step: 1, toggle: true },
        { key: 'mono',   label: 'Passer en mono',    unit: '',   min: 0,   max: 1,  def: 0, step: 1, toggle: true }
    ],
    width: [
        { key: 'width', label: 'Largeur', unit: '%', min: 0, max: 200, def: 100, step: 1 }
    ],
    tremolo: [
        { key: 'rate',  label: 'Vitesse',  unit: ' Hz', min: 0.5, max: 15,  def: 5,  step: 0.5 },
        { key: 'depth', label: 'Intensité', unit: '%',   min: 0,   max: 100, def: 50, step: 1 }
    ],
    phaser: [
        { key: 'rate',     label: 'Vitesse',     unit: ' Hz', min: 0.05, max: 3,   def: 0.4, step: 0.05 },
        { key: 'depth',    label: 'Étendue',     unit: '%',   min: 0,    max: 100, def: 70,  step: 1 },
        { key: 'feedback', label: 'Résonance',   unit: '%',   min: 0,    max: 90,  def: 40,  step: 1 },
        { key: 'mix',      label: 'Mélange',     unit: '%',   min: 0,    max: 100, def: 50,  step: 1 }
    ],
    flanger: [
        { key: 'rate',     label: 'Vitesse',     unit: ' Hz', min: 0.05, max: 2,   def: 0.25, step: 0.05 },
        { key: 'depth',    label: 'Profondeur',  unit: ' ms', min: 0.5,  max: 5,   def: 2,    step: 0.5 },
        { key: 'feedback', label: 'Résonance',   unit: '%',   min: 0,    max: 90,  def: 50,   step: 1 },
        { key: 'mix',      label: 'Mélange',     unit: '%',   min: 0,    max: 100, def: 50,   step: 1 }
    ],
    chorus: [
        { key: 'rate',  label: 'Vitesse',    unit: ' Hz', min: 0.1, max: 3,   def: 0.8, step: 0.1 },
        { key: 'depth', label: 'Profondeur', unit: ' ms', min: 1,   max: 10,  def: 5,   step: 0.5 },
        { key: 'mix',   label: 'Mélange',    unit: '%',   min: 0,   max: 100, def: 50,  step: 1 }
    ],
    doubler: [
        { key: 'width', label: 'Épaisseur', unit: '%', min: 0, max: 100, def: 50, step: 1 },
        { key: 'mix',   label: 'Mélange',   unit: '%', min: 0, max: 100, def: 50, step: 1 }
    ],
    slapback: [
        { key: 'time',     label: 'Retard',      unit: ' ms', min: 30, max: 300, def: 110, step: 5 },
        { key: 'feedback', label: 'Répétitions', unit: '%',   min: 0,  max: 50,  def: 12,  step: 1 },
        { key: 'mix',      label: 'Mélange',     unit: '%',   min: 0,  max: 100, def: 25,  step: 1 }
    ],
    gate: [
        { key: 'threshold', label: 'Seuil (en dessous = coupé)', unit: ' dB', min: -70, max: -20, def: -45, step: 1 },
        { key: 'release',   label: 'Retour du son',             unit: ' ms', min: 20,  max: 500, def: 150, step: 5 },
        { key: 'reduction', label: 'Coupure',                   unit: ' dB', min: 6,   max: 80,  def: 40,  step: 1 }
    ],
    filter: [
        { key: 'hpf',   label: 'Coupe-bas (graves)',  unit: ' Hz', min: 20,  max: 1000,  def: 80,    step: 5, log: true },
        { key: 'lpf',   label: 'Coupe-haut (aigus)',  unit: ' Hz', min: 1000, max: 20000, def: 20000, step: 100, log: true },
        { key: 'slope', label: 'Pente',                unit: ' dB', min: 12,  max: 24,    def: 12,    step: 12, choices: [12, 24] }
    ],
    sat: [
        { key: 'drive', label: 'Chaleur', unit: '%', min: 0, max: 100, def: 25, step: 1 }
    ],
    deess: [
        { key: 'amount', label: 'Force',      unit: '%',  min: 0,    max: 100,  def: 40,   step: 1 },
        { key: 'freq',   label: 'Fréquence', unit: ' Hz', min: 3000, max: 9000, def: 5500, step: 100 }
    ],
    pitch: [
        { key: 'semi', label: 'Hauteur', unit: ' dt', min: -12, max: 12, def: 0, step: 1, tip: 'En demi-tons : -12 = une octave plus grave, +12 = une octave plus aiguë' },
        { key: 'mix',  label: 'Mélange', unit: '%',   min: 0,   max: 100, def: 100, step: 1, tip: '100 % = seulement la voix transposée' }
    ],
    delay: [
        { key: 'beats',    label: 'Temps', unit: '',  min: 0.125, max: 2,  def: 0.5, step: 0.125, fmt: beatsLabel,
          choices: [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2], choiceLabels: ['1/16', '1/8 T', '1/8', '1/8 .', '1/4', '1/4 .', '1/2'] },
        { key: 'feedback', label: 'Répétitions',    unit: '%', min: 0,     max: 85, def: 35,  step: 1 },
        { key: 'wet',      label: 'Quantité',       unit: '%', min: 0,     max: 100, def: 25, step: 1 },
        { key: 'duck',     label: 'Ducking',        unit: '%', min: 0,     max: 100, def: 0,  step: 1, tip: 'L\'écho se pousse pendant que la voix chante et ressort dans les trous' },
        { key: 'hpf',      label: 'Coupe-bas',      unit: ' Hz', min: 20,  max: 2000, def: 20, step: 5, log: true, adv: true, tip: 'Retire les graves des répétitions' },
        { key: 'lpf',      label: 'Coupe-haut',     unit: ' Hz', min: 1000, max: 20000, def: 4000, step: 100, log: true, adv: true, tip: 'Chaque répétition s\'assombrit un peu plus' },
        { key: 'dry',      label: 'Voix d\'origine', unit: '%', min: 0,     max: 100, def: 100, step: 1, adv: true, tip: '0 % = seulement l\'écho (piste d\'effet ponctuel)' },
        { key: 'pp',       label: 'Ping-pong',      unit: '',  min: 0,     max: 1,   def: 0,  step: 1, toggle: true, tip: 'Les répétitions rebondissent de gauche à droite' }
    ]
};

function openEffectPanel(trackIdx, fxName, anchorEl) {
    if (fxName === 'eq') return openEqPanel(trackIdx, anchorEl);
    if (fxName === 'limit') return openLimiterPanel(trackIdx, anchorEl);
    if (fxName === 'gate') return openGatePanel(trackIdx, anchorEl);
    if (fxName === 'deess') return openDeessPanel(trackIdx, anchorEl);
    if (fxName === 'mband') return openMbandPanel(trackIdx, anchorEl);
    if (fxName === 'msat') return openMsatPanel(trackIdx, anchorEl);
    closeTransientPanels();
    // trackIdx : numéro de piste, ou directement un groupe
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    // Déjà ouvert : on le ramène devant au lieu d'en ouvrir un deuxième
    const already = findPlugWin(t, fxName);
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};

    const DEFS = FX_PANEL_DEFS;
    const defs = DEFS[fxName];
    if (!defs) return;
    const params = t.effectParams[fxName] || {};

    const panel = document.createElement('div');
    const FX_LABELS = { pitch: 'Pitch', crush: 'Bitcrusher', util: 'Utilitaire', width: 'Largeur stéréo', tremolo: 'Trémolo', phaser: 'Phaser', flanger: 'Flanger', chorus: 'Chorus', doubler: 'Doubleur de voix', slapback: 'Slapback', gate: 'Gate', filter: 'Filtre', eq: 'EQ 4 bandes', comp: 'Compresseur', reverb: 'Réverbération', sat: 'Saturation', deess: 'De-esser', delay: 'Écho' };
    // Mode Simple (l'essentiel) ou Avancé (tous les réglages), retenu d'une fois sur l'autre
    const hasAdv = defs.some(d => d.adv);
    let advanced = false;
    try { advanced = localStorage.getItem('pulse_fx_adv') === '1'; } catch {}
    const cat = (ADD_FX_CATEGORIES.find(c => c[1].includes(fxName)) || ['Effet'])[0];
    panel.className = 'fx-panel fx-pro' + (hasAdv && !advanced ? ' simple' : '') + (fxName === 'delay' || fxName === 'reverb' ? ' fx-wideface fx-screen' : '');
    panel.style.setProperty('--fx-accent', FX_CAT_COLORS[cat] || 'var(--violet-2)');
    const valOf = (d) => params[d.key] !== undefined ? params[d.key] : d.def;
    // Façade : seul le compresseur change d'habillage selon son caractère (Propre reste net, numérique)
    const SCREEN = fxName === 'delay' || fxName === 'reverb';   // écran plein + panneau flottant (gamme Digital)
    const skinOf = () => fxName === 'comp' ? (FX_SKINS[Math.round((t.effectParams.comp || {}).mode || 0)] || 'P') : SCREEN ? 'S' : 'P';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet">
                <input type="checkbox" class="fx-bypass" ${t.effects?.includes(fxName) ? 'checked' : ''}><span class="fx-power-btn">⏻</span>
            </label>
            <span class="fx-title"><i class="fx-cat">${esc(cat)}</i>${FX_LABELS[fxName] || fxName.toUpperCase()}</span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="fx-toolbar">
            ${hasAdv ? `<div class="fx-seg fx-mode"><button data-mode="simple" class="${advanced ? '' : 'on'}">Simple</button><button data-mode="adv" class="${advanced ? 'on' : ''}">Avancé</button></div>` : '<span></span>'}
            ${fxName === 'comp' ? '<button class="fx-autogain" data-tooltip="Gain automatique : Pulse remonte le volume perdu par la compression. Éteint = tu règles « Rattrapage » toi-même">Auto gain</button><button class="fx-view" data-tooltip="Changer l\'affichage : courbe ou vumètre analogique">Analogique</button>' : ''}
            <div class="fx-seg fx-ab" data-tooltip="Deux réglages à comparer : passe de A à B pour écouter la différence"><button data-ab="A" class="on">A</button><button data-ab="B">B</button></div>
        </div>
        <div class="fx-presets-bar">
            <select class="fx-preset" data-tooltip="Un point de départ réglé à la sauce Red Records : tu peux ensuite tout retoucher">
                <option value="">Préréglages…</option>
                ${[...new Set((FX_PRESETS[fxName] || []).map(p => p.group || 'Red Records'))].map(gname => `<optgroup label="${esc(gname)}">${(FX_PRESETS[fxName] || []).map((p, i) => (p.group || 'Red Records') !== gname ? '' : `<option value="f${i}" ${params._preset === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('')}
                ${(userFxPresets()[fxName] || []).length ? `<optgroup label="Les miens">${userFxPresets()[fxName].map((p, i) => `<option value="u${i}" ${params._preset === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>` : ''}
                <option value="__save">＋ Enregistrer le réglage actuel…</option>
            </select>
            <input class="fx-preset-name" type="text" maxlength="28" placeholder="Nom du préréglage, puis Entrée" hidden>
        </div>
        <div class="fx-face">
        ${fxName === 'comp' ? '<div class="fx-viz"></div>' : ''}
        ${fxName === 'delay' || fxName === 'reverb' ? `<div class="scr-col"><div class="rv-eq-head"><b>${fxName === 'delay' ? 'Répétitions' : 'Queue de la reverb'}</b></div><div class="fx-viz fx-viz-wide"></div></div>` : ''}
        ${fxName === 'reverb' || fxName === 'delay' ? `<div class="rv-eq"><div class="rv-eq-head"><b>${fxName === 'delay' ? 'EQ de l\'écho' : 'EQ de la reverb'}</b><span class="rv-eq-read"></span><button class="rv-eq-clear" data-tooltip="${fxName === 'delay' ? 'Retirer tous les points de l\'EQ de l\'écho' : 'Retirer tous les points de l\'EQ de la reverb'}">Effacer</button></div><div class="rv-eq-host"></div></div>` : ''}
        <div class="fx-main">
        <div class="fx-panel-body fx-knobs">
            ${defs.map(d => {
                const val = valOf(d);
                const ctl = d.toggle
                    ? `<button class="fx-toggle ${val ? 'on' : ''}" data-key="${d.key}">${val ? 'Oui' : 'Non'}</button>`
                    : d.choices
                    ? `<div class="fx-seg fx-choice" data-key="${d.key}">${d.choices.map((c, i) => `<button data-v="${c}" class="${c === val ? 'on' : ''}">${d.choiceLabels ? d.choiceLabels[i] : c + d.unit}</button>`).join('')}</div>`
                    : `<div class="fx-knob" data-key="${d.key}" tabindex="0">${fxKnobSvg(d, val, undefined, skinOf())}</div>`;
                return `
                <div class="fx-row ${d.adv ? 'fx-adv' : ''} ${d.toggle || d.choices ? 'fx-wide' : ''}" data-key="${d.key}" ${d.tip ? `data-tooltip="${esc(d.tip)}"` : ''}>
                    ${ctl}
                    <span class="fx-val" data-key="${d.key}" title="Double-clic : taper une valeur">${fxFmt(d, val, d.auto && params[d.key] === undefined)}</span>
                    <label class="fx-label">${d.label}</label>
                    <input type="range" class="fx-slider" data-key="${d.key}" data-default="${d.def}" hidden
                        min="${d.min}" max="${d.max}" step="${d.choices ? 'any' : d.step}" value="${val}">
                </div>`;
            }).join('')}
            ${fxName === 'comp' ? '<div class="fx-row fx-in-row"><button class="fx-in" data-tooltip="Allumer ou éteindre le compresseur">IN</button></div>' : ''}
        </div>
        <div class="fx-meter" data-tooltip="Niveau en sortie de la piste"><i><b></b></i><i><b></b></i><span>SORTIE</span></div>
        </div>
        </div>
        <div class="fx-panel-footer">
            <div class="fx-seg fx-size" data-tooltip="Taille de la fenêtre">${FX_SIZES.map(z => `<button data-z="${z}">${Math.round(z * 100)} %</button>`).join('')}</div>
            <span class="fx-hint" data-tooltip="Glisser vers le haut ou le bas · Maj = réglage fin · Alt-clic ou double-clic = valeur de départ · double-clic sur le chiffre = le taper">?</span>
            <button class="fx-reset">Réinitialiser</button>
        </div>`;

    document.body.appendChild(panel);
    makePlugWindow(panel, t, fxName, trackIdx);

    // Préréglages : on applique, puis on rouvre la fenêtre au même endroit pour que tous les boutons suivent
    const presetSel = panel.querySelector('.fx-preset'), presetName = panel.querySelector('.fx-preset-name');
    presetSel.addEventListener('change', () => {
        const v = presetSel.value;
        if (v === '__save') {
            presetSel.hidden = true; presetName.hidden = false; presetName.value = params._preset || ''; presetName.focus();
            return;
        }
        const pr = v[0] === 'f' ? (FX_PRESETS[fxName] || [])[+v.slice(1)] : v[0] === 'u' ? (userFxPresets()[fxName] || [])[+v.slice(1)] : null;
        if (!pr) return;
        pushUndo();
        const keepOut = (t.effectParams[fxName] || {}).out;
        t.effectParams[fxName] = JSON.parse(JSON.stringify({ ...pr.params, _preset: pr.name }));
        if (keepOut !== undefined) t.effectParams[fxName].out = keepOut;   // niveau de sortie d'un ancien retour devenu bus
        t.effects = t.effects || [];
        if (!t.effects.includes(fxName)) t.effects.push(fxName);   // choisir un préréglage, c'est vouloir l'effet
        refreshPlaybackSoon(); saveProject();
        const L = panel.style.left, T = panel.style.top;
        panel.remove();
        openEffectPanel(trackIdx, fxName, anchorEl);
        const np = findPlugWin(t, fxName); if (np) { np.style.left = L; np.style.top = T; }
        renderInspector(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
        flash(`Préréglage « ${pr.name} » : retouche ce que tu veux`);
    });
    presetName.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { presetName.hidden = true; presetSel.hidden = false; presetSel.value = ''; return; }
        if (e.key !== 'Enter') return;
        const name = presetName.value.trim(); if (!name) return;
        const cur = { ...(t.effectParams[fxName] || {}) }; delete cur._preset;
        saveUserFxPreset(fxName, name, cur);
        t.effectParams[fxName] = { ...cur, _preset: name }; saveProject();
        const L = panel.style.left, T = panel.style.top;
        panel.remove(); openEffectPanel(trackIdx, fxName, anchorEl);
        const np = findPlugWin(t, fxName); if (np) { np.style.left = L; np.style.top = T; }
        flash(`« ${name} » enregistré dans tes préréglages`);
    });

    // Taille fixe de la fenêtre (100 / 125 / 150 %), comme « Afficher » dans Logic : tout est dessiné, donc reste net
    let zoom = 1;
    try { zoom = FX_SIZES.includes(+localStorage.getItem('pulse_fx_size')) ? +localStorage.getItem('pulse_fx_size') : 1; } catch {}
    const rect = anchorEl.getBoundingClientRect();
    const fits = (z) => panel.offsetWidth * z <= window.innerWidth - 16 && panel.offsetHeight * z <= window.innerHeight - 16;
    // Agrandi avec « zoom » (et non une transformation) : la fenêtre est redessinée à sa vraie taille, donc nette
    // (une transformation faisait agrandir une image à 100 % par la carte graphique du Mac : flou).
    // Avec zoom, left / top sont aussi multipliés : on les divise (plugSetPos).
    const place = (keepLeft) => {
        const curTop = panel.style.top ? panel.getBoundingClientRect().top : null;
        if (!fits(zoom)) zoom = [...FX_SIZES].reverse().find(fits) || 1;   // jamais de fenêtre coupée par l'écran
        panel.querySelectorAll('.fx-size button').forEach(b => { b.disabled = !fits(+b.dataset.z); b.title = b.disabled ? 'Pas assez de place à l\'écran pour cette taille' : ''; });
        panel.style.transform = '';
        panel.style.zoom = zoom === 1 ? '' : String(zoom);
        const pw = panel.offsetWidth * zoom, ph = panel.offsetHeight * zoom;
        let left = keepLeft !== undefined ? keepLeft : rect.right + 8;
        if (left + pw > window.innerWidth - 8) left = keepLeft !== undefined ? window.innerWidth - pw - 8 : rect.left - pw - 8;
        plugSetPos(panel, Math.max(8, left), Math.max(8, Math.min(curTop != null ? curTop : rect.top - 20, window.innerHeight - ph - 8)));
        panel.querySelectorAll('.fx-size button').forEach(b => b.classList.toggle('on', +b.dataset.z === zoom));
    };
    place();
    panel.querySelectorAll('.fx-size button').forEach(b => b.addEventListener('click', () => {
        zoom = +b.dataset.z;
        try { localStorage.setItem('pulse_fx_size', String(zoom)); } catch {}
        place(panel.getBoundingClientRect().left);
    }));

    // Interface graphique : la courbe suit les curseurs, et les points se tirent à la souris
    const viz = panel.querySelector('.fx-viz');
    const curP = () => { const o = {}; defs.forEach(d => { const v = (t.effectParams[fxName] || {})[d.key]; o[d.key] = v !== undefined ? v : d.def; }); return o; };
    let analog = false;
    try { analog = localStorage.getItem('pulse_comp_view') === 'analog'; } catch {}
    let needle = 0;
    const viewBtn = panel.querySelector('.fx-view');
    const drawViz = () => {
        if (viz) {
            viz.innerHTML = fxName === 'delay' ? delayVizSvg(curP(), state.project.bpm || 90) : fxName === 'reverb' ? reverbVizSvg(curP())
                : analog ? compAnalogSvg(needle, skinOf() === 'U') : compVizSvg(curP());
            const sv = viz.querySelector('.viz-svg'), sk = skinOf();
            if (sv && sk !== 'P' && sk !== 'S') { const w = document.createElement('div'); w.className = 'viz-screen'; sv.replaceWith(w); w.appendChild(sv); w.insertAdjacentHTML('beforeend', fxGlassSvg(FX_SKIN_SEED[sk])); }
        }
        if (viewBtn) viewBtn.textContent = analog ? 'Courbe' : 'Analogique';
    };
    const setParam = (key, val) => {
        const sl = panel.querySelector(`.fx-slider[data-key="${key}"]`); if (!sl) return;
        const d = defs.find(x => x.key === key);
        val = Math.max(d.min, Math.min(d.max, val));
        if (!d.choices) val = Math.round(val / d.step) * d.step;   // un choix (1/8 triolet…) garde sa valeur exacte
        sl.value = val; sl.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (viz) {
        drawViz();
        viz.addEventListener('mousedown', (e) => {
            const pt = e.target.closest && e.target.closest('.viz-pt'); if (!pt) return;
            e.preventDefault();
            const key = pt.dataset.key, svg = viz.querySelector('svg'), g = svg.querySelector('g');
            const move = (ev) => {
                const r = svg.getBoundingClientRect(), gx = g ? (VIZ_W - 132) / 2 : 0;
                const x = (ev.clientX - r.left) / zoom - gx, y = (ev.clientY - r.top) / zoom;
                const S = 132, toDb = (v) => -48 + (v - 7) / (S - 14) * 48;
                if (key === 'threshold') setParam('threshold', toDb(x));
                else { const th = curP().threshold, out0 = toDb(S - y); if (th < -1) setParam('ratio', -th / Math.max(0.05, out0 - th)); }
            };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        });
        panel.addEventListener('input', () => { if (!analog || fxName !== 'comp') drawViz(); });
        panel.addEventListener('click', (e) => { if (fxName !== 'comp' && e.target.closest('.fx-choice, .fx-toggle')) setTimeout(drawViz, 0); });
        if (viewBtn) viewBtn.addEventListener('click', () => {
            analog = !analog;
            try { localStorage.setItem('pulse_comp_view', analog ? 'analog' : 'curve'); } catch {}
            drawViz();
        });
        // Aiguille : réduction estimée d'après le niveau du son après compression (même courbe que le réglage)
        let buf = null;
        const tick = () => {
            if (!panel.isConnected) return;
            if (analog) {
                let target = 0;
                // La vraie réduction, envoyée par le compresseur lui-même ; à défaut, une estimation d'après le son qui sort
                const real = (state.playing || state.recording) && t.effects && t.effects.includes('comp') && PulseAudio.getCompReduction
                    ? PulseAudio.getCompReduction(typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id) : null;
                if (real !== null) target = Math.min(20, real);
                const an = (real === null && (state.playing || state.recording)) ? (typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null)) : null;
                if (an && t.effects && t.effects.includes('comp')) {
                    if (!buf || buf.length !== an.fftSize) buf = new Float32Array(an.fftSize);
                    an.getFloatTimeDomainData(buf);
                    let pk = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > pk) pk = v; }
                    const out = 20 * Math.log10(Math.max(pk, 1e-6)), p = curP();
                    if (out > p.threshold) target = Math.max(0, (out - p.threshold) * (Math.max(1, p.ratio) - 1));
                    target = Math.min(20, target) * ((p.mix ?? 100) / 100);
                }
                needle += (target - needle) * (target > needle ? 0.35 : 0.12);
                const nd = viz.querySelector('.vu-needle');
                if (nd) nd.setAttribute('transform', `rotate(${compNeedleDeg(needle, skinOf() === 'U').toFixed(1)} 108 124)`);
                const vv = viz.querySelector('.vu-val'); if (vv) vv.textContent = needle.toFixed(1) + ' dB';
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    if (fxName === 'reverb' || fxName === 'delay') bindFxEq(panel, t, fxName);

    // Events
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    // Bouton IN (façade Bus) : le même interrupteur que le bouton marche, en version console
    const inBtn = panel.querySelector('.fx-in');
    const syncIn = () => { if (inBtn) inBtn.classList.toggle('on', panel.querySelector('.fx-bypass').checked); };
    if (inBtn) { syncIn(); inBtn.addEventListener('click', () => panel.querySelector('.fx-bypass').click()); }
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        syncIn();
        t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes(fxName)) t.effects.push(fxName); }
        else { const i = t.effects.indexOf(fxName); if (i >= 0) t.effects.splice(i, 1); }
        anchorEl.classList.toggle('active', !!e.target.checked);
        refreshPlaybackSoon();
        saveProject();
    });
    // Remet l'affichage d'un réglage (bouton, valeur, interrupteur) d'accord avec le projet
    const refreshCell = (key) => {
        const d = defs.find(x => x.key === key); if (!d) return;
        const cur = t.effectParams[fxName] || {};
        const isAuto = d.auto && cur[key] === undefined;
        const val = isAuto ? d.auto(curP()) : (cur[key] !== undefined ? cur[key] : d.def);
        const sl = panel.querySelector(`.fx-slider[data-key="${key}"]`); if (sl) sl.value = val;
        const autoRel = key === 'release' && skinOf() === 'U' && !!cur.autoRel;
        const kn = panel.querySelector(`.fx-knob[data-key="${key}"]`); if (kn) kn.innerHTML = fxKnobSvg(d, val, undefined, skinOf(), autoRel);
        const tg = panel.querySelector(`.fx-toggle[data-key="${key}"]`); if (tg) { tg.classList.toggle('on', !!val); tg.textContent = val ? 'Oui' : 'Non'; }
        panel.querySelectorAll(`.fx-choice[data-key="${key}"] button`).forEach(b => b.classList.toggle('on', +b.dataset.v === val));
        const vl = panel.querySelector(`.fx-val[data-key="${key}"]`); if (vl) vl.textContent = autoRel ? 'Auto' : fxFmt(d, val, isAuto);
    };
    // Automation : pendant la lecture, les boutons suivent la courbe (affichage seulement) ; à l'arrêt, retour au réglage enregistré
    panel._autoShow = (key, val) => {
        const d = defs.find(x => x.key === key); if (!d) return;
        const sl = panel.querySelector(`.fx-slider[data-key="${key}"]`); if (sl && document.activeElement !== sl) sl.value = val;
        const kn = panel.querySelector(`.fx-knob[data-key="${key}"]`); if (kn) kn.innerHTML = fxKnobSvg(d, val, undefined, skinOf(), false);
        const vl = panel.querySelector(`.fx-val[data-key="${key}"]`); if (vl) vl.textContent = fxFmt(d, val, false);
    };
    panel._autoRestore = (key) => refreshCell(key);
    let skinNow = null;
    const applySkin = () => {
        const sk = skinOf(); if (sk === skinNow) return;
        skinNow = sk;
        const keepRect = panel.style.left ? panel.getBoundingClientRect() : null;
        // Façade Bus : chaque réglage cranté se pose sur le cran le plus proche (le son suit ce qu'on voit)
        if (sk === 'U') {
            let moved = false;
            defs.forEach(d => { if (d.busSteps) { const v = valOf2(d), st = d.busSteps[fxStepIdx(d, v, false)]; if (st !== v) { (t.effectParams[fxName] = t.effectParams[fxName] || {})[d.key] = st; moved = true; } } });
            if (moved) commit();
        }
        ['P', 'O', 'F', 'U', 'S'].forEach(x => panel.classList.toggle('skin-' + x, x === sk));
        const face = panel.querySelector('.fx-face'), old = face.querySelector('.fx-wear');
        if (old) old.remove();
        if (sk !== 'P' && sk !== 'S') face.insertAdjacentHTML('afterbegin', fxWearSvg(sk, FX_SKIN_SEED[sk], face.offsetWidth || 340, face.offsetHeight || 340));   // à la taille réelle : vis bien rondes
        if (keepRect) {   // la façade Bus est plus large : on recale la fenêtre, mais elle reste exactement où elle était si elle tient à l'écran
            place(keepRect.left);
            const z = parseFloat(panel.style.zoom) || 1;
            if (keepRect.left + panel.offsetWidth * z <= window.innerWidth - 8 && keepRect.top + panel.offsetHeight * z <= window.innerHeight - 8) plugSetPos(panel, keepRect.left, keepRect.top);
        }
        if (viz) drawViz();
    };
    // Auto gain : allumé = le rattrapage suit le seuil et le ratio ; éteint = 0 dB (on le règle soi-même)
    const agBtn = panel.querySelector('.fx-autogain');
    const syncAutoGain = () => { if (agBtn) agBtn.classList.toggle('on', (t.effectParams[fxName] || {}).makeup === undefined); };
    if (agBtn) agBtn.addEventListener('click', () => {
        pushUndo();
        t.effectParams[fxName] = t.effectParams[fxName] || {};
        if (t.effectParams[fxName].makeup === undefined) t.effectParams[fxName].makeup = 0; else delete t.effectParams[fxName].makeup;
        (t.proKeep = t.proKeep || {})[fxName] = true;
        refreshCell('makeup'); syncAutoGain(); commit();
        flash(t.effectParams[fxName].makeup === undefined ? 'Auto gain allumé : Pulse compense le volume' : 'Auto gain éteint : rattrapage à 0 dB, à régler toi-même');
    });
    const refreshAll = () => { applySkin(); defs.forEach(d => refreshCell(d.key)); syncAutoGain(); if (viz && !analog) drawViz(); };
    const commit = () => {
        // Compresseur en lecture : réglage envoyé en direct (pas de coupure) ; sinon on reconstruit comme avant
        const live = fxName === 'comp' && state.playing && PulseAudio.updateComp
            && PulseAudio.updateComp(typeof trackIdx === 'number' ? 't' + trackIdx : 'b' + t.id, t.effectParams.comp);
        if (!live) refreshPlaybackSoon();
        saveProject();
    };
    const valOf2 = (d) => { const v = (t.effectParams[fxName] || {})[d.key]; return v !== undefined ? v : d.def; };
    panel.querySelectorAll('.fx-slider').forEach(sl => {
        sl.addEventListener('change', () => { sl._undone = false; });
        sl.addEventListener('input', () => {
            const key = sl.dataset.key;
            const val = parseFloat(sl.value);
            if (!sl._undone) { pushUndo(); sl._undone = true; }
            t.effectParams[fxName] = t.effectParams[fxName] || {};
            t.effectParams[fxName][key] = val;
            (t.proKeep = t.proKeep || {})[fxName] = true;   // réglé à la main : le curseur « Son » n'y touche plus
            if (key === 'mode') { applySkin(); defs.forEach(d => refreshCell(d.key)); }
            refreshCell(key);
            defs.forEach(d => { if (d.auto && d.key !== key) refreshCell(d.key); });   // le rattrapage auto suit le seuil et le ratio
            syncAutoGain();
            commit();
        });
    });
    // Retour à la valeur de départ (ou au mode automatique)
    const resetKey = (key) => {
        const d = defs.find(x => x.key === key); if (!d) return;
        pushUndo();
        t.effectParams[fxName] = t.effectParams[fxName] || {};
        if (d.auto) delete t.effectParams[fxName][key]; else t.effectParams[fxName][key] = d.def;
        refreshAll(); commit();
    };
    const endGesture = (key) => { const sl = panel.querySelector(`.fx-slider[data-key="${key}"]`); if (sl) sl._undone = false; };
    const setStep = (d, i) => {
        const st = d.busSteps[Math.max(0, Math.min(d.busSteps.length - 1, i))];
        const ep = (t.effectParams[fxName] = t.effectParams[fxName] || {});
        if (d.key === 'release') {
            const auto = st === 'auto';
            if (!!ep.autoRel !== auto) { pushUndo(); if (auto) ep.autoRel = 1; else delete ep.autoRel; commit(); }
            if (auto) { refreshCell('release'); return; }
        }
        setParam(d.key, st);
    };
    // Boutons rotatifs : glisser vers le haut / le bas, Maj pour le réglage fin, molette, flèches du clavier
    panel.querySelectorAll('.fx-knob').forEach(kn => {
        const key = kn.dataset.key, d = defs.find(x => x.key === key);
        const stepped = () => fxStepped(d, skinOf());
        const idxNow = () => fxStepIdx(d, parseFloat(panel.querySelector(`.fx-slider[data-key="${key}"]`).value), key === 'release' && !!(t.effectParams[fxName] || {}).autoRel);
        const fracNow = () => stepped() ? idxNow() / (d.busSteps.length - 1) : fxFrac(d, parseFloat(panel.querySelector(`.fx-slider[data-key="${key}"]`).value));
        const toFrac = (f) => stepped() ? setStep(d, Math.round(f * (d.busSteps.length - 1))) : setParam(key, fxFromFrac(d, f));
        kn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            if (e.altKey) { resetKey(key); return; }
            kn.focus();
            const y0 = e.clientY, f0 = fracNow();
            panel.classList.add('dragging');
            const move = (ev) => toFrac(Math.max(0, Math.min(1, f0 + (y0 - ev.clientY) / (ev.shiftKey ? 800 : 160))));
            const up = () => { panel.classList.remove('dragging'); endGesture(key); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        });
        kn.addEventListener('dblclick', () => resetKey(key));
        kn.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (stepped()) setStep(d, idxNow() - Math.sign(e.deltaY));
            else setParam(key, fxFromFrac(d, Math.max(0, Math.min(1, fracNow() - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.025)))));
            clearTimeout(kn._wt); kn._wt = setTimeout(() => endGesture(key), 400);
        }, { passive: false });
        kn.addEventListener('keydown', (e) => {
            const dir = (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? 1 : (e.key === 'ArrowDown' || e.key === 'ArrowLeft') ? -1 : 0;
            if (!dir) return;
            e.preventDefault(); e.stopPropagation();
            if (stepped()) { setStep(d, idxNow() + dir); endGesture(key); return; }
            setParam(key, parseFloat(panel.querySelector(`.fx-slider[data-key="${key}"]`).value) + dir * d.step * (e.shiftKey ? 1 : (d.max - d.min) / d.step > 60 ? 5 : 1));
            endGesture(key);
        });
    });
    panel.querySelectorAll('.fx-toggle').forEach(b => b.addEventListener('click', () => {
        setParam(b.dataset.key, b.classList.contains('on') ? 0 : 1); endGesture(b.dataset.key);
    }));
    panel.querySelectorAll('.fx-choice button').forEach(b => b.addEventListener('click', () => {
        const key = b.closest('.fx-choice').dataset.key; setParam(key, +b.dataset.v); endGesture(key);
    }));
    // Double-clic sur la valeur : on tape le chiffre exact (« 8k » = 8000)
    panel.querySelectorAll('.fx-val').forEach(v => v.addEventListener('dblclick', () => {
        const key = v.dataset.key, d = defs.find(x => x.key === key);
        if (!d || d.toggle || d.choices) return;
        const inp = document.createElement('input');
        inp.className = 'fx-val-edit';
        inp.value = panel.querySelector(`.fx-slider[data-key="${key}"]`).value;
        v.replaceWith(inp); inp.focus(); inp.select();
        let done = false;
        const finish = (ok) => {
            if (done) return; done = true;
            inp.replaceWith(v);
            if (!ok) return;
            const m = String(inp.value).trim().replace(',', '.').match(/^(-?\d*\.?\d+)\s*(k?)/i);
            if (!m) { flash('Valeur non comprise : tape un nombre, par exemple 4 ou 8k'); return; }
            setParam(key, parseFloat(m[1]) * (m[2] ? 1000 : 1)); endGesture(key);
        };
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
        inp.addEventListener('blur', () => finish(true));
    }));
    // Simple / Avancé
    panel.querySelectorAll('.fx-mode button').forEach(b => b.addEventListener('click', () => {
        advanced = b.dataset.mode === 'adv';
        try { localStorage.setItem('pulse_fx_adv', advanced ? '1' : '0'); } catch {}
        panel.classList.toggle('simple', !advanced);
        panel.querySelectorAll('.fx-mode button').forEach(x => x.classList.toggle('on', x === b));
    }));
    // A / B : deux réglages mémorisés le temps de la séance, pour comparer à l'oreille
    const ab = fxAbStore(t, fxName);
    panel.querySelectorAll('.fx-ab button').forEach(x => x.classList.toggle('on', x.dataset.ab === ab.cur));
    panel.querySelectorAll('.fx-ab button').forEach(b => b.addEventListener('click', () => {
        const to = b.dataset.ab; if (to === ab.cur) return;
        ab[ab.cur] = { ...(t.effectParams[fxName] || {}) };
        if (!ab[to]) ab[to] = { ...ab[ab.cur] };   // B part d'une copie de A
        pushUndo();
        t.effectParams[fxName] = { ...ab[to] };
        ab.cur = to;
        panel.querySelectorAll('.fx-ab button').forEach(x => x.classList.toggle('on', x.dataset.ab === to));
        refreshAll(); commit();
        flash(`Réglage ${to}`);
    }));
    refreshAll();
    place(panel.getBoundingClientRect().left);   // la hauteur réelle est connue une fois l'écran dessiné
    // Vumètre de sortie (crête, retombée douce) : vide à l'arrêt
    const meterBars = panel.querySelectorAll('.fx-meter b');
    let mBuf = null, mLvl = 0;
    const meterTick = () => {
        if (!panel.isConnected) return;
        let pk = 0;
        const an = (state.playing || state.recording) ? (typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null)) : null;
        if (an) {
            if (!mBuf || mBuf.length !== an.fftSize) mBuf = new Float32Array(an.fftSize);
            an.getFloatTimeDomainData(mBuf);
            for (let i = 0; i < mBuf.length; i++) { const a = Math.abs(mBuf[i]); if (a > pk) pk = a; }
        }
        const target = pk > 1e-4 ? Math.max(0, Math.min(1, (20 * Math.log10(pk) + 60) / 60)) : 0;
        mLvl = target > mLvl ? target : mLvl * 0.92;
        meterBars.forEach(b => { b.style.height = (mLvl * 100).toFixed(1) + '%'; });
        requestAnimationFrame(meterTick);
    };
    requestAnimationFrame(meterTick);
    panel.querySelector('.fx-reset').addEventListener('click', () => {
        pushUndo();
        const keepOut = (t.effectParams[fxName] || {}).out;
        delete t.effectParams[fxName];
        if (keepOut !== undefined) t.effectParams[fxName] = { out: keepOut };
        if (t.proKeep) delete t.proKeep[fxName];
        refreshPlaybackSoon();
        saveProject();
        panel.remove();
        flash(`${FX_LABELS[fxName]} réinitialisé`);
    });

    // Plus de fermeture au clic ailleurs : la fenêtre reste ouverte comme dans Logic (fermeture : ×)
}

// L'automation (courbes, menu de réglage, modes d'écriture, suivi pendant la lecture) est dans automation.js

function closeAutomationLane() {
    document.querySelectorAll('.automation-lane.visible').forEach(l => l.classList.remove('visible'));
}

// === Tap tempo (mode toggle style tabtempo) ===
// T = active/désactive le mode. En mode : Espace tape sur le beat.
// Médiane des intervalles → BPM. 2s d'inactivité → sort du mode auto.
const tap = { times: [], timeoutId: null };

function toggleTapMode() {
    state.tapMode = !state.tapMode;
    const btn = document.getElementById('btnTap');
    document.body.classList.toggle('tap-mode', state.tapMode);

    if (state.tapMode) {
        tap.times = [];
        btn.textContent = 'ESPACE';
        btn.classList.add('active');
        flash('Tape sur Espace en rythme avec la musique — Pulse trouve le tempo');
    } else {
        btn.textContent = 'TAP';
        btn.classList.remove('active');
        clearTimeout(tap.timeoutId);
        if (tap.times.length >= 2) {
            saveProject();
            flash(`✓ Tempo trouvé : ${state.project.bpm} BPM`);
        } else {
            flash('Recherche du tempo arrêtée');
        }
        tap.times = [];
    }
}

function tapOnce() {
    if (!state.tapMode) return;
    const now = performance.now();
    tap.times.push(now);
    if (tap.times.length > 8) tap.times.shift();

    const btn = document.getElementById('btnTap');
    btn.classList.add('counting');
    setTimeout(() => btn.classList.remove('counting'), 200);

    if (tap.times.length >= 2) {
        const intervals = [];
        for (let i = 1; i < tap.times.length; i++) {
            intervals.push(tap.times[i] - tap.times[i-1]);
        }
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        let bpm = Math.round(60000 / median);
        while (bpm < 40)  bpm *= 2;
        while (bpm > 240) bpm /= 2;
        bpm = Math.round(bpm);

        state.project.bpm = bpm;
        document.getElementById('bpmInput').value = bpm;
        btn.textContent = `${bpm}`;
        if (window.PulseAudio) PulseAudio.setMetronomeBpm(bpm);
        renderRuler();
        saveProject();
    } else {
        btn.textContent = '…';
    }

    // Auto-exit après 2s sans tap
    clearTimeout(tap.timeoutId);
    tap.timeoutId = setTimeout(() => {
        if (state.tapMode) toggleTapMode();
    }, 2000);
}

// === Ajuster BPM (×2 ou ÷2) ===
function adjustBpm(factor) {
    let bpm = Math.round(state.project.bpm * factor);
    bpm = Math.max(40, Math.min(240, bpm));
    if (bpm !== state.project.bpm) pushUndo();
    state.project.bpm = bpm;
    document.getElementById('bpmInput').value = bpm;
    if (window.PulseAudio) PulseAudio.setMetronomeBpm(bpm);
    refreshPlaybackSoon();
    renderRuler();
    saveProject();
    flash(`BPM : ${bpm}`);
}

// === Clip de démo (temporaire, pour tester Q/S avant le moteur audio) ===
function addDemoClip() {
    const t = state.project.tracks[state.selectedTrack];
    if (!t) return;
    t.clips = t.clips || [];
    const start = state.playhead;
    const duration = 8;
    t.clips.push({
        name: `Demo ${t.clips.length + 1}`,
        start,
        duration
    });
    renderTimelineTracks();
    saveProject();
    flash('Clip démo ajouté');
}

// Nudge clip sélectionné (← / →)
// fine = Shift tenu → 1/48 beat (proche d'une frame à 30fps)
// sinon → 1 unité snap
function nudgeSelectedClip(dir, fine) {
    if (!state.selectedClip) return;
    const { trackIdx, clipIdx } = state.selectedClip;
    const t = state.project.tracks[trackIdx];
    const clip = t?.clips[clipIdx];
    if (!clip) return;
    pushUndo();
    const beatSec = 60 / bpmAtSec(clip.start);
    const snapUnit = fine
        ? beatSec / 48   // ~1 frame à 30fps
        : (() => {
            const eff = getEffectiveSnap();
            return eff === 'bar'      ? beatSec * bpbAtSec(clip.start)
                 : eff === 'fine'     ? beatSec / 8
                 : eff === 'division' ? beatSec / 4
                 : beatSec;
        })();
    clip.start = Math.max(0, clip.start + dir * snapUnit);
    renderTimelineTracks();
    saveProject();
    // Scroll pour garder le clip visible
    const clipCenterPx = (clip.start + clip.duration / 2) * state.pxPerSecond;
    const tl = document.querySelector('.timeline');
    if (tl) {
        const margin = tl.clientWidth * 0.25;
        if (clipCenterPx < tl.scrollLeft + margin) tl.scrollLeft = clipCenterPx - margin;
        else if (clipCenterPx > tl.scrollLeft + tl.clientWidth - margin) tl.scrollLeft = clipCenterPx - tl.clientWidth + margin;
    }
}

// Sélectionner tous les clips de la piste active (Cmd+A)
// ⌘A comme dans Logic : toutes les régions de toutes les pistes (⌥⌘A : seulement la piste choisie)
function selectAllClips() {
    const keys = [];
    state.project.tracks.forEach((t, ti) => (t.clips || []).forEach((c, ci) => { if (!c.recording) keys.push(`${ti}:${ci}`); }));
    if (!keys.length) { flash('Rien à choisir : il n\'y a pas encore de région'); return; }
    document.querySelectorAll('.range-selection').forEach(el => el.remove());
    state.selection = null;
    state.selectedClips = new Set(keys);
    const [ti, ci] = keys[0].split(':').map(Number);
    state.selectedClip = { trackIdx: ti, clipIdx: ci };
    renderTimelineTracks();
    flash(keys.length > 1 ? `${keys.length} régions choisies — Suppr les efface, glisser les déplace ensemble` : '1 région choisie');
}
function selectAllClipsOnTrack() {
    const t = state.project.tracks[state.selectedTrack];
    if (!t || !t.clips.length) { flash('Cette piste est vide'); return; }
    const ti = state.selectedTrack;
    state.selectedClips.clear();
    t.clips.forEach((_, ci) => state.selectedClips.add(`${ti}:${ci}`));
    state.selectedClip = { trackIdx: ti, clipIdx: t.clips.length - 1 };
    // Sélection de plage couvrant tous les clips
    const starts = t.clips.map(c => c.start);
    const ends   = t.clips.map(c => c.start + c.duration);
    state.selection = { start: Math.min(...starts), end: Math.max(...ends), tracks: [ti, ti] };
    state.loop = { start: Math.min(...starts), end: Math.max(...ends) };
    state.looping = false;
    renderTimelineTracks();
    renderLoopOverlay();
    flash(`${t.clips.length} clip${t.clips.length > 1 ? 's' : ''} sélectionné${t.clips.length > 1 ? 's' : ''}`);
}

// U = boucle calée sur les régions choisies (comme « Set Locators by Selection » de Logic) ; la lecture reste où elle est
function loopFromSelection() {
    const keys = state.selectedClips.size ? [...state.selectedClips]
        : (state.selectedClip ? [`${state.selectedClip.trackIdx}:${state.selectedClip.clipIdx}`] : []);
    const cs = keys.map(k => { const [ti, ci] = k.split(':').map(Number); const t = state.project.tracks[ti]; return t && t.clips[ci]; }).filter(Boolean);
    if (!cs.length) { flash('Choisis une région d\'abord : U cale la boucle dessus'); return; }
    state.loop = { start: Math.min(...cs.map(c => c.start)), end: Math.max(...cs.map(c => c.start + c.duration)) };
    state.looping = true;
    renderLoopOverlay(); updateLoopButton(); saveProject(); refreshPlaybackSoon();
    flash(cs.length > 1 ? 'Boucle calée sur les régions choisies' : 'Boucle calée sur la région choisie');
}

// ⌘R = répéter la région choisie une fois de plus, juste après elle (comme « Repeat Regions » de Logic) ; même mécanique que la poignée en bas à droite
function repeatSelectedClip() {
    if (!state.selectedClip) { flash('Choisis une région d\'abord : ⌘R la répète juste après'); return; }
    const { trackIdx, clipIdx } = state.selectedClip;
    const t = state.project.tracks[trackIdx], clip = t && t.clips[clipIdx];
    if (!clip || clip.recording || !clip.duration) return;
    pushUndo();
    const cur = (clip.loopEnd && clip.loopEnd > clip.start + clip.duration) ? clip.loopEnd : clip.start + clip.duration;
    clip.loopEnd = cur + clip.duration;
    carveBehind(t, clip, clip.start, clip.loopEnd);
    renderAll(); saveProject(); refreshPlaybackSoon();
    flash('Région répétée × ' + (((clip.loopEnd - clip.start) / clip.duration)).toFixed(0) + ' (⌘R encore pour ajouter une répétition)');
}

// Zoom to fit : tout le projet visible d'un coup (Cmd+Shift+F)
function zoomToFit() {
    const end = computeProjectEndSec();
    const timeline = document.querySelector('.timeline');
    if (!timeline) return;
    const availWidth = timeline.clientWidth - 60;
    const totalSec = Math.max(end + 4, 10);
    const newPx = Math.max(ZOOM_MIN, Math.min(zoomMax(), availWidth / totalSec));
    setZoom(newPx, 0);
    timeline.scrollLeft = 0;
    flash('Zoom : tout le projet');
}

// Persister zoom + scroll position dans localStorage
const ZOOM_KEY = 'pulse_zoom_v1';
// Zoom : de la séance entière (1 px = 1 s) jusqu'à la milliseconde (1 px ≈ 0,4 ms)
const ZOOM_MIN = 1, ZOOM_MAX = 2400;
// Zoom maximum comme Logic / Pro Tools : jusqu'à voir chaque échantillon (la forme d'onde devient une ligne).
// Limite : la timeline ne doit pas dépasser ~30 millions de pixels de large (au-delà, le moteur de la page décroche).
function zoomMax() {
    const totalSec = Math.max(180, computeProjectEndSec() + 60);
    return Math.max(ZOOM_MAX, Math.min(192000, 3e7 / totalSec));
}
function saveViewState() {
    const timeline = document.querySelector('.timeline');
    localStorage.setItem(ZOOM_KEY, JSON.stringify({
        pxPerSecond: state.pxPerSecond,
        trackHeight: state.trackHeight,
        scrollLeft: timeline ? timeline.scrollLeft : 0,
        project: state.project && state.project.id,
        playhead: state.playOrigin != null && state.playing ? state.playOrigin : state.playhead
    }));
}
// === Journal de problèmes (pour comprendre un redémarrage inattendu de la page) ===
// Au chargement, si la session précédente ne s'est pas fermée proprement, on le note avec ce qu'elle faisait (lecture, enregistrement…).
const DIAG_KEY = 'pulse_diag';
function diagLog() { try { return JSON.parse(localStorage.getItem(DIAG_KEY) || '[]'); } catch { return []; } }
function diagAdd(kind, detail) {
    try {
        const l = diagLog(); l.push({ t: new Date().toISOString(), kind, detail: String(detail || '').slice(0, 300) });
        localStorage.setItem(DIAG_KEY, JSON.stringify(l.slice(-20)));
    } catch {}
}
(function diagInit() {
    try {
        const prev = JSON.parse(localStorage.getItem('pulse_session') || 'null');
        if (prev && prev.open) diagAdd('redémarrage', `la page a redémarré sans se fermer — elle faisait : ${prev.doing || 'rien de particulier'}${prev.wk ? ' — effets créés/arrêtés : ' + prev.wk : ''}`);
        // wk = effets audio créés / arrêtés (fuite mémoire du 29/10) ; mem = mémoire JS si le moteur la donne
        const mark = (open) => { try { const wk = window.__pulseWk; localStorage.setItem('pulse_session', JSON.stringify({ open, doing: (window.state && (state.recording ? 'enregistrement' : state.playing ? 'lecture' : 'arrêt')) || '', wk: wk ? wk.created + '/' + wk.retired : '', at: Date.now() })); } catch {} };
        mark(true);
        setInterval(() => mark(true), 3000);
        window.addEventListener('pagehide', () => mark(false));
        window.addEventListener('error', (e) => diagAdd('erreur', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
        window.addEventListener('unhandledrejection', (e) => diagAdd('erreur', 'promesse : ' + (e.reason && e.reason.message || e.reason)));
    } catch {}
})();
// La position du curseur est retenue toutes les 2 s (seulement si elle a bougé)
let _lastSavedPh = null;
setInterval(() => {
    try {
        const ph = state.playOrigin != null && state.playing ? state.playOrigin : state.playhead;
        if (ph !== _lastSavedPh && state.project) { _lastSavedPh = ph; saveViewState(); }
    } catch {}
}, 2000);
function restoreViewState() {
    try {
        const s = JSON.parse(localStorage.getItem(ZOOM_KEY) || 'null');
        if (!s) return;
        if (s.pxPerSecond) { state.pxPerSecond = s.pxPerSecond; }
        if (s.trackHeight) { state.trackHeight = s.trackHeight; }
        // Si la page est rechargée (plantage de la fenêtre, mise à jour…), le curseur revient où il était — pour le même projet
        if (typeof s.playhead === 'number' && s.project && s.project === state.project.id && !state.playing) {
            state.playhead = s.playhead;
            setTimeout(() => { try { updatePlayhead(); updateChrono(); } catch {} }, 150);
        }
        if (s.scrollLeft) {
            setTimeout(() => {
                const tl = document.querySelector('.timeline');
                if (tl) tl.scrollLeft = s.scrollLeft;
            }, 100);
        }
    } catch {}
}

// === Zoom timeline ===
// anchorSec : point fixe (curseur souris si fourni, sinon playhead)
// Position (en secondes) du pointeur s'il est au-dessus de la timeline, sinon du curseur de lecture
const _ptr = { x: null, y: null };
document.addEventListener('mousemove', (e) => { _ptr.x = e.clientX; _ptr.y = e.clientY; }, { passive: true });
function zoomAnchorSec() {
    const tl = document.querySelector('.timeline');
    if (tl && _ptr.x != null) {
        const r = tl.getBoundingClientRect();
        if (_ptr.x >= r.left && _ptr.x <= r.right && _ptr.y >= r.top && _ptr.y <= r.bottom) {
            return Math.max(0, (_ptr.x - r.left + tl.scrollLeft) / state.pxPerSecond);
        }
    }
    return baseCursorSec();
}
// Où zoomer : sur le curseur de base s'il y en a un (au milieu de l'écran) ; sans base posée, autour de la souris
// quand elle survole la timeline (le point sous la souris ne bouge pas)
function zoomTarget() {
    const hasBase = state.playing || state.recording || (!state.baseCleared && state.userBaseSec != null);
    if (!hasBase) {
        const tl = document.querySelector('.timeline');
        if (tl && _ptr.x != null) {
            const r = tl.getBoundingClientRect();
            if (_ptr.x >= r.left && _ptr.x <= r.right && _ptr.y >= r.top && _ptr.y <= r.bottom)
                return { sec: Math.max(0, (_ptr.x - r.left + tl.scrollLeft) / state.pxPerSecond), center: false };
        }
    }
    return { sec: baseCursorSec(), center: true };
}
// Le curseur de base (là où la lecture revient à l'arrêt) plutôt que celui qui défile ; sans base, le curseur de lecture
function baseCursorSec() {
    if ((state.playing || state.paused) && state.playOrigin != null && returnOnStop()) return state.playOrigin;
    return state.playhead;
}
// Pendant une lecture ou une prise : si tu zoomes ou défiles toi-même, la timeline arrête de suivre le curseur
function suspendFollow() {
    if ((state.playing || state.recording) && !state.followOff) {
        state.followOff = true;
        flash('Le défilement automatique est en pause pour que tu travailles où tu veux — il revient au prochain Espace');
    }
}
// center = true : le point visé finit pile au milieu de l'écran (E / Z et molette, sur le curseur)
function setZoom(px, anchorSec, center = false) {
    const timeline = document.querySelector('.timeline');
    const oldPx = state.pxPerSecond;
    const newPx = Math.max(ZOOM_MIN, Math.min(zoomMax(), px));
    if (newPx === oldPx) return;

    // Par défaut le zoom se fait autour du pointeur de la souris (comme Pro Tools), sinon autour du curseur
    const anchor = (anchorSec !== undefined) ? anchorSec : zoomAnchorSec();
    const anchorPxBefore = anchor * oldPx;
    const screenOffset = anchorPxBefore - timeline.scrollLeft;
    state.pxPerSecond = newPx;

    renderTimelineTracks();
    renderRuler();
    updatePlayhead();

    const anchorPxAfter = anchor * newPx;
    timeline.scrollLeft = center ? Math.max(0, anchorPxAfter - timeline.clientWidth / 2) : anchorPxAfter - screenOffset;
    saveViewState();
}

// --- Dupliquer une piste (Cmd+D, style Logic) : canal + effets, sans les clips ---
function duplicateTrack(idx) {
    const src = state.project.tracks[idx];
    if (!src) return;
    pushUndo();
    const copy = {
        ...src,
        name: src.name + ' copy',
        clips: [],           // pas de régions — comportement Logic
        takes: [], takesOpen: false, takeSeq: 0,
        isCapture: false,    // la copie n'est jamais Capture Lane
        armed: false
    };
    // Copie profonde : régler la copie ne doit jamais toucher l'original
    ['effectParams', 'sends', 'busSends', 'preSends', 'sound', 'automation', 'autotune'].forEach(k => {
        if (src[k] && typeof src[k] === 'object') copy[k] = JSON.parse(JSON.stringify(src[k]));
    });
    if (src.effects) copy.effects = [...src.effects];
    state.project.tracks.splice(idx + 1, 0, copy);
    state.selectedTrack = idx + 1;
    renderAll();
    saveProject();
    flash(`Piste dupliquée : « ${copy.name} »`);
}

// --- Supprimer la piste sélectionnée (⌘⌫) ---
// Supprimer pendant une prise : les numéros de piste ne doivent pas bouger tant que la capture tourne
// (elle repère sa piste par son numéro). La piste disparaît et se tait tout de suite, et elle est
// vraiment retirée dès que la prise est finie.
const _pendDel = new Set();
function isPendDel(t) { return _pendDel.has(t); }
let _pendDelTimer = null;
function deleteTracksDuringRec(idxs) {
    const capIdx = state._cap ? state._cap.trackIdx : -1;
    const lcIdx = state._livingClip ? state._livingClip.trackIdx : -1;
    const ok = idxs.filter(i => i !== capIdx && i !== lcIdx && state.project.tracks[i] && !state.project.tracks[i].isCapture);
    if (!ok.length) { flash('C\'est la piste qui enregistre : arrête la prise (Espace) pour la supprimer'); return; }
    ok.forEach(i => { const t = state.project.tracks[i]; _pendDel.add(t); t._wasMuted = !!t.muted; t.muted = true; });
    PulseAudio.refreshAudibility(state.project);
    if (ok.includes(state.selectedTrack)) state.selectedTrack = capIdx >= 0 ? capIdx : state.selectedTrack;
    state.selectedTracks = new Set();
    renderAll();
    flash(ok.length > 1 ? `${ok.length} pistes supprimées` : `Piste « ${state.project.tracks[ok[0]].name} » supprimée`);
    if (!_pendDelTimer) _pendDelTimer = setInterval(flushPendingDeletes, 400);
}
function flushPendingDeletes() {
    if (state.recording || state._cap || state._finalizing) return;   // la prise n'est pas encore rangée
    clearInterval(_pendDelTimer); _pendDelTimer = null;
    const idxs = state.project.tracks.map((t, i) => _pendDel.has(t) ? i : -1).filter(i => i >= 0);
    _pendDel.clear();
    if (!idxs.length) return;
    const sel = state.project.tracks[state.selectedTrack];
    idxs.forEach(i => { state.project.tracks[i].muted = !!state.project.tracks[i]._wasMuted; delete state.project.tracks[i]._wasMuted; });
    pushUndo();   // ⌘Z remet les pistes telles qu'avant (avec la prise déjà rangée)
    for (let k = idxs.length - 1; k >= 0; k--) state.project.tracks.splice(idxs[k], 1);
    const ni = state.project.tracks.indexOf(sel);
    state.selectedTrack = ni >= 0 ? ni : Math.max(0, Math.min(state.selectedTrack, state.project.tracks.length - 1));
    state.selectedClip = null;
    renderAll(); saveProject();
}
function deleteSelectedTrack() {
    if (state.recording || state._cap) {
        const sel = selectedTrackIdxs();
        return deleteTracksDuringRec(sel.length ? sel : [state.selectedTrack]);
    }
    const many = selectedTrackIdxs().filter(i => !state.project.tracks[i]?.isCapture);
    if (many.length > 1) {
        pushUndo();
        for (let k = many.length - 1; k >= 0; k--) state.project.tracks.splice(many[k], 1);
        state.selectedTrack = Math.max(0, Math.min(many[0], state.project.tracks.length - 1));
        state.selectedTracks = new Set(); state.selectedClip = null;
        renderAll(); saveProject();
        flash(`${many.length} pistes supprimées (⌘Z pour les récupérer)`);
        return;
    }
    const idx = state.selectedTrack;
    const t = state.project.tracks[idx];
    if (!t) return;
    if (t.isCapture) { flash('Cette piste ne peut pas être supprimée'); return; }
    pushUndo();
    if (window.PulsePianoRoll && PulsePianoRoll.isOpen()) PulsePianoRoll.close(true);
    // Nettoyer les blobs orphelins
    (t.clips || []).forEach(c => {
        if (!c.id) return;
        const shared = state.project.tracks.flatMap(tr => tr.clips || []).filter(cl => cl.id === c.id).length;
        /* audio conservé pour Annuler — nettoyé au prochain démarrage (cleanupOrphanAudio) */
    });
    state.project.tracks.splice(idx, 1);
    state.selectedTrack = Math.min(idx, state.project.tracks.length - 1);
    state.selectedClip = null;
    renderAll();
    saveProject();
    flash(`Piste « ${t.name} » supprimée — ⌘Z pour la remettre`);
}

// --- Ajouter une piste (avec mini-menu) ---
function addTrack(type = null, anchorEl = null) {
    if (type) {
        _doAddTrack(type);
        return;
    }
    // Menu contextuel depuis le bouton +
    closeAllMenus();
    const btn = anchorEl || document.getElementById('btnAddTrack');
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;z-index:200;min-width:160px`;
    const types = [
        { type: 'audio', icon: '🎙', label: 'Ma voix (enregistrer au micro)' },
        { type: 'inst',  icon: '🎵', label: 'Instru (déposer un MP3 ou un WAV)' },
        { type: 'keys',  icon: '🎹', label: 'Piano (jouer ou dessiner des notes)' },
        { type: 'drums', icon: '🪘', label: 'Batterie (poser des coups sur une grille)' }
    ];
    types.forEach(({ type: t, icon, label }) => {
        const el = document.createElement('div');
        el.className = 'ctx-item';
        el.textContent = `${icon}  ${label}`;
        el.addEventListener('click', () => { menu.remove(); _doAddTrack(t); });
        menu.appendChild(el);
    });
    document.body.appendChild(menu);
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 50);
}

function _doAddTrack(type = 'audio') {
    pushUndo();
    const i = state.project.tracks.length;
    const typeLabels = { audio: 'Piste', inst: 'Instru', beat: 'Beat', keys: 'Piano', drums: 'Batterie' };
    // Un nom jamais en double (Piste 3 supprimée puis recréée, etc.)
    const labelBase = typeLabels[type] || 'Piste';
    let num = i + 1;
    const usedNames = new Set(state.project.tracks.map(x => x.name));
    while (usedNames.has(`${labelBase} ${num}`)) num++;
    state.project.tracks.push({
        name: `${labelBase} ${num}`,
        type: ['inst', 'beat', 'keys', 'drums'].includes(type) ? type : 'audio',
        color: TYPE_COLORS[type] || COLORS[i % COLORS.length],
        clips: [],
        volume: 100,
        ...(type === 'keys' ? { midiInst: 'piano' } : type === 'drums' ? { midiInst: 'drums' } : {})
    });
    state.selectedTrack = state.project.tracks.length - 1;
    renderAll();
    saveProject();
    if (type === 'keys' || type === 'drums') {
        // Piano / batterie : la première région s'ouvre tout de suite, prête à recevoir des notes
        createMidiClip(state.project.tracks.length - 1, state.playhead || 0, true);
        return;
    }
    flash(`${labelBase} ${num} créée`);
}

// --- Rendu complet ---
function renderAll() {
    pruneEmptySpots();
    renderTracksPanel();
    renderTimelineTracks();
    renderRuler();
    renderMixer();
    bindTrackEvents();
    bindMixerEvents();
    renderLoopOverlay();
    updateLoopButton();
    updateUndoBtn();
    updateDocTitle();
    syncMonitor();
    // Le tempo affiché suit toujours le projet (réouverture, annulation…)
    syncBpmField();
}
// Champ BPM du haut : comme l'écran de Logic, il montre le tempo à la tête de lecture (le tempo du projet s'il ne change jamais)
function shownBpm() { return tempoVaries() ? bpmAtSec(Math.max(0, state.playhead)) : state.project.bpm; }
function syncBpmField() {
    const el = document.getElementById('bpmInput');
    if (!el || document.activeElement === el) return;
    const v = String(shownBpm());
    if (el.value !== v) el.value = v;
}

// --- Events mixer : automation + faders live + pan ---
function bindMixerEvents() {
    // Envois : dose par piste, retours, ajout
    document.querySelectorAll('.mixer-strips .send-level').forEach(sl => {
        const st = sl.closest('.strip');
        const t = st.dataset.kind === 'bus' ? state.project.buses[parseInt(st.dataset.i)] : state.project.tracks[parseInt(st.dataset.i)];
        if (!t) return;
        const id = sl.closest('.strip-send-row').dataset.send;
        let undoPushed = false;
        sl.addEventListener('input', () => {
            if (!undoPushed) { pushUndo(); undoPushed = true; }
            t.sends = t.sends || {};
            const v = parseInt(sl.value);
            if (v > 0) t.sends[id] = v; else delete t.sends[id];
            // Le panneau Son montre la même dose (ce sont les mêmes envois)
            const sends = projectSends(), key = id === sends.find(x => x.type === 'reverb')?.id ? 'space' : id === sends.find(x => x.type === 'delay')?.id ? 'echo' : null;
            if (key && t.sound) t.sound[key] = v;
            sl.closest('.strip-send-row').classList.toggle('on', v > 0);
            refreshPlaybackSoon();
        });
        sl.addEventListener('change', () => { undoPushed = false; saveProject(); });
        sl.closest('.strip-send-row').classList.toggle('on', parseInt(sl.value) > 0);
    });
    document.querySelectorAll('.mixer-strips .strip-return').forEach(strip => {
        const id = strip.dataset.send;
        strip.querySelector('.return-edit').addEventListener('click', (e) => openSendPanel(id, e.currentTarget));
        const tb = strip.querySelector('.return-tobus'); if (tb) tb.addEventListener('click', () => convertSendToBus(id));
        const f = strip.querySelector('.return-fader');
        let undone = false;
        f.addEventListener('input', () => {
            const sd = projectSends().find(x => x.id === id);
            if (!sd) return;
            if (!undone) { pushUndo(); undone = true; }
            sd.volume = parseInt(f.value);
            strip.querySelector('.strip-db').textContent = `${volumeToDb(sd.volume)} dB`;
            refreshPlaybackSoon();
        });
        f.addEventListener('change', () => { undone = false; saveProject(); });
    });
    document.querySelectorAll('.mixer-strips .master-edit').forEach(btn => btn.addEventListener('click', () => openMasterPanel(busById(btn.dataset.bus), btn)));
    const addBtn = document.querySelector('.mixer-strips .strip-add-send');
    if (addBtn) addBtn.addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        closeAllMenus();
        const menu = document.createElement('div');
        menu.className = 'track-ctx-menu';
        menu.style.cssText = `position:fixed;left:${Math.min(r.left, window.innerWidth - 190)}px;top:${Math.max(8, r.top + r.height / 2 - 40)}px;z-index:300;`;
        menu.innerHTML = '<div class="ctx-item" data-type="bus">Nouveau bus</div>';
        menu.querySelectorAll('.ctx-item').forEach(it => it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); if (it.dataset.type === 'bus') createBus({ withTracks: [] }); else addSend(it.dataset.type); }));
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
    });

    document.querySelectorAll('.mixer-strips .strip').forEach(strip => {
        const kind = strip.dataset.kind;
        if (kind === 'send') return;
        const i = parseInt(strip.dataset.i);
        // Listes d'effets et d'envois (les mêmes que la tranche de gauche) : clic, croix, glisser, « + »
        if (kind === 'track' || kind === 'bus') bindSlotLists(strip, kind, kind === 'track' ? state.project.tracks[i] : state.project.buses[i], i);

        // Clics sur slots FX (ne reste que la case « Groupe » d'un groupe verrouillé)
        strip.querySelectorAll('.strip-fx-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                if (kind === 'bus') {
                    const b = state.project.buses[i];
                    const param = slot.dataset.fx;
                    if (!b || param === 'preset') return;
                    b.effects = b.effects || [];
                    if (!b.effects.includes(param)) { pushUndo(); b.effects.push(param); slot.classList.add('active'); refreshPlaybackSoon(); saveProject(); }
                    openEffectPanel(b, param, slot);
                    return;
                }
                if (kind !== 'track') return;
                const param = slot.dataset.fx;
                if (param === 'tune') {   // l'Auto-Tune est un effet de piste : même fenêtre que sur une région, mais pour toute la piste
                    const r = slot.getBoundingClientRect();
                    openTunePanel(i, -1, r.right + 8, r.top - 20, true);
                    return;
                }
                if (state.automationMode) {
                    openAutomationFor(i, param);
                    return;
                }
                const t = state.project.tracks[i];
                t.effects = t.effects || [];
                const isActive = t.effects.includes(param);
                if (!isActive) {
                    pushUndo();
                    t.effects.push(param);
                    slot.classList.add('active');
                    saveProject();
                }
                openEffectPanel(i, param, slot);
            });
            slot.addEventListener('contextmenu', (e) => {
                if (kind === 'bus') {
                    e.preventDefault();
                    const b = state.project.buses[i], param = slot.dataset.fx;
                    const k = b && b.effects ? b.effects.indexOf(param) : -1;
                    if (k >= 0) { pushUndo(); b.effects.splice(k, 1); slot.classList.remove('active'); refreshPlaybackSoon(); saveProject(); }
                    return;
                }
                if (kind !== 'track') return;
                e.preventDefault();
                const param = slot.dataset.fx;
                const t = state.project.tracks[i];
                t.effects = t.effects || [];
                const idx = t.effects.indexOf(param);
                if (idx >= 0) { pushUndo(); t.effects.splice(idx, 1); slot.classList.remove('active'); saveProject(); }
            });
        });

        // Fader de volume : update live + persist
        const fader = strip.querySelector('.fader');
        if (fader) {
            let mixUndo = false;
            fader.addEventListener('change', () => { mixUndo = false; });
            fader.addEventListener('input', (e) => {
                if (!mixUndo && kind !== 'master') { pushUndo(); mixUndo = true; }
                const v = fader.dataset.vmap === '1' ? posToVol(parseFloat(e.target.value)) : parseInt(e.target.value);
                if (kind === 'track') {
                    const t = state.project.tracks[i];
                    const prevV = t.volume ?? 100;
                    t.volume = v;
                    if (window.PulseAudio) PulseAudio.updateTrackVolume(i, v);
                    syncInspectorVolume(i);
                    followSelectedVolume(i, prevV, v);
                } else if (kind === 'bus') {
                    const b = state.project.buses[i];
                    if (b) { b.volume = v; PulseAudio.updateBusVolume(b.id, b.muted ? 0 : v); }
                }
                // Mise à jour visuelle du dB
                const dbEl = strip.querySelector('.strip-db');
                if (dbEl) dbEl.textContent = `${volumeToDb(v)} dB`;
            });
            fader.addEventListener('change', () => saveProject());
        }

        // Gauche / droite d'un groupe
        const bpan = strip.querySelector('.bus-pan');
        if (bpan && kind === 'bus') {
            const b = state.project.buses[i];
            let pu = false;
            bpan.addEventListener('change', () => { pu = false; saveProject(); });
            bpan.addEventListener('input', () => {
                if (!pu) { pushUndo(); pu = true; }
                b.pan = parseInt(bpan.value);
                refreshPlaybackSoon();
            });
            bpan.addEventListener('dblclick', () => { pushUndo(); bpan.value = 0; b.pan = 0; refreshPlaybackSoon(); saveProject(); });
        }

        // Pan knob : drag vertical pour pan L/R
        const knob = strip.querySelector('.strip-pan-knob');
        if (knob && kind === 'track') {
            knob.addEventListener('mousedown', (e) => startPanDrag(e, knob, i));
        }
    });
}

function startPanDrag(e, knob, trackIdx) {
    e.preventDefault();
    const startX = e.clientX;
    const t = state.project.tracks[trackIdx];
    const startPan = t.pan || 0;
    let undone = false;

    const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (!undone && dx !== 0) { pushUndo(); undone = true; }
        const pan = Math.max(-100, Math.min(100, startPan + dx));
        t.pan = pan;
        updatePanKnobVisual(knob, pan);
        if (window.PulseAudio) PulseAudio.updateTrackPan(trackIdx, pan);
        syncTrackPan(trackIdx);
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveProject();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function updatePanKnobVisual(knob, pan) {
    // Rotation du marqueur selon pan (-100 → -135deg, +100 → +135deg)
    const deg = (pan / 100) * 135;
    knob.style.transform = `rotate(${deg}deg)`;
}

async function bounceTrack(trackIdx) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    flash('Fusion de la piste en cours…');
    try {
        const wavBlob = await PulseAudio.exportTrackWav(state.project, trackIdx);
        if (!wavBlob) { flash('Cette piste est vide — il n\'y a rien à fusionner'); return; }

        // Décoder le WAV résultant
        const arrBuf = await wavBlob.arrayBuffer();
        const audioBuf = await PulseAudio.getContext().decodeAudioData(arrBuf.slice(0));
        const peaks = makePeaks(audioBuf);

        const newId = `bounce_${Date.now().toString(36)}`;
        PulseAudio.registerBuffer(newId, audioBuf);

        // Sauvegarder en IndexedDB
        if (window.PulsePersist) await PulsePersist.saveBlob(newId, wavBlob, { kind: 'bounce' });

        // Le rendu part du début du morceau : le clip fusionné aussi (sinon tout serait décalé)
        const startSec = 0;

        pushUndo();
        t.clips = [{
            id: newId,
            name: `${t.name} (fusion)`,
            start: startSec,
            duration: audioBuf.duration,
            peaks
        }];
        // Tout ce qui est maintenant « dans » le son est remis à zéro, sinon ce serait appliqué deux fois :
        // volume, placement, effets, envois, courbe de volume, prises rangées
        t.volume = 100;
        t.pan = 0;
        delete t.effects; delete t.effectParams; delete t.sound; delete t.automation;
        t.sends = {};
        t.takes = [];

        renderAll(); saveProject();
        flash(`✓ « ${t.name} » fusionnée en un seul clip`);
    } catch (err) {
        console.error(err);
        flash('La fusion n\'a pas marché — réessaie ; rien n\'a été modifié');
    }
}

// Panneau flottant de gain pour un clip individuel
// Les régions sur lesquelles agit une action : toute la sélection multiple si cette région en fait partie, sinon elle seule
// Cale le début des régions sur la grille la plus proche (finesse de la grille, même si l'aimant est sur Libre)
function quantizeClipsToGrid(clips) {
    clips = (clips || []).filter(c => c && !c.recording);
    if (!clips.length) return;
    const beatSec = 60 / state.project.bpm, res = state.gridRes || 'auto';
    let eff = res;
    if (res === 'auto') {
        const beatPx = state.pxPerSecond * beatSec;
        eff = beatPx >= 120 ? 'division' : beatPx >= 40 ? 'beat' : 'bar';
    }
    const unit = eff === 'bar' ? beatSec * bpb() : eff === 'fine' ? beatSec / 8 : eff === 'division' ? beatSec / 4 : beatSec;
    const label = eff === 'bar' ? 'la mesure' : eff === 'beat' ? 'le temps' : eff === 'fine' ? '1/32' : '1/16';
    pushUndo();
    let moved = 0;
    clips.forEach(c => {
        const ns = tempoVaries() ? snapToGrid(c.start, eff) : Math.max(0, Math.round(c.start / unit) * unit), d = ns - c.start;
        if (Math.abs(d) < 1e-4) return;
        c.start = ns;
        if (c.loopEnd) c.loopEnd += d;
        moved++;
        const t = state.project.tracks.find(tr => (tr.clips || []).includes(c));
        if (t) {
            carveBehind(t, c, c.start, (c.loopEnd && c.loopEnd > c.start + c.duration) ? c.loopEnd : c.start + c.duration);
            t.clips.sort((a, b) => a.start - b.start);
        }
    });
    state.selectedClip = null; state.selectedClips.clear();
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(moved ? `${moved > 1 ? moved + ' régions calées' : 'Région calée'} sur ${label} — ⌘Z pour annuler` : 'Déjà calé sur la grille');
}
function clipsActedOn(trackIdx, clipIdx) {
    const key = `${trackIdx}:${clipIdx}`;
    const one = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!one) return [];
    if (state.selectedClips.size > 1 && state.selectedClips.has(key)) {
        return [...state.selectedClips].map(k => { const [ti, ci] = k.split(':').map(Number); return state.project.tracks[ti]?.clips[ci]; }).filter(c => c && !c.recording);
    }
    return [one];
}
function openClipGainPanel(trackIdx, clipIdx) {
    document.querySelectorAll('.clip-gain-panel').forEach(p => p.remove());
    const t = state.project.tracks[trackIdx];
    const clip = t?.clips[clipIdx];
    if (!clip) return;

    const acted = clipsActedOn(trackIdx, clipIdx);
    const currentGain = clip.gain !== undefined ? clip.gain : 1.0;
    const currentDb = currentGain > 0 ? 20 * Math.log10(currentGain) : -60;

    const panel = document.createElement('div');
    panel.className = 'fx-panel clip-gain-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <span>${acted.length > 1 ? `Gain de ${acted.length} clips` : 'Gain du clip'}</span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="fx-panel-body">
            <div class="fx-row">
                <label class="fx-label">Gain</label>
                <input type="range" class="fx-slider" id="clipGainSlider" data-default="0"
                    min="-24" max="12" step="0.1" value="${currentDb.toFixed(1)}">
                <span class="fx-val" id="clipGainVal">${currentDb.toFixed(1)} dB</span>
            </div>
        </div>
        <div class="fx-panel-footer">
            <button class="fx-reset" id="clipGainReset">Réinitialiser</button>
        </div>`;

    document.body.appendChild(panel);
    const clipEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
    if (clipEl) {
        const rect = clipEl.getBoundingClientRect();
        panel.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
        panel.style.top = Math.max(8, rect.bottom + 4) + 'px';
    } else {
        panel.style.left = '50%';
        panel.style.top = '40%';
    }

    const sl = panel.querySelector('#clipGainSlider');
    const vl = panel.querySelector('#clipGainVal');
    sl.addEventListener('input', () => {
        const db = parseFloat(sl.value);
        vl.textContent = `${db.toFixed(1)} dB`;
        const gain = db <= -24 ? 0 : Math.pow(10, db / 20);
        acted.forEach(c => { c.gain = Math.round(gain * 1000) / 1000; });
        // Mise à jour visuelle waveform
        const clipEl2 = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (clipEl2) {
            const waveEl = clipEl2.querySelector('.clip-wave-svg');
            if (waveEl) {
                // Recalcule la waveform en temps réel
                const newSvg = renderClipWaveform(clip, parseFloat(clipEl2.style.width || '0'));
                clipEl2.querySelector('.clip-wave-svg')?.insertAdjacentHTML('afterend', newSvg);
                clipEl2.querySelector('.clip-wave-svg')?.remove();
            }
            const gainTag = clipEl2.querySelector('.clip-gain-tag');
            if (gainTag && clip.gain !== 1) gainTag.textContent = `${db.toFixed(1)}dB`;
        }
        saveProject();
    });
    sl.addEventListener('change', () => { pushUndo(); renderTimelineTracks(); });
    panel.querySelector('#clipGainReset').addEventListener('click', () => {
        pushUndo(); acted.forEach(c => { delete c.gain; }); renderTimelineTracks(); saveProject(); panel.remove();
        flash('Volume du clip remis comme à l\'origine');
    });
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    setTimeout(() => {
        document.addEventListener('mousedown', function closeGain(ev) {
            if (!panel.contains(ev.target)) { panel.remove(); document.removeEventListener('mousedown', closeGain); }
        });
    }, 100);
}

// Menu contextuel sur zone vide de la timeline
function openTimelineEmptyContextMenu(x, y, trackIdx, atSec) {
    closeAllMenus();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200;`;
    const items = [
        state.clipboard ? { label: `Coller ici (${secondsToDuration(atSec)})`, action: () => {
            state.playhead = atSec; updatePlayhead(); updateChrono(); pasteClip();
        }} : null,
        (['keys', 'drums'].includes(state.project.tracks[trackIdx]?.type)) ? { label: '🎹 Créer une région ici (piano roll / pas)', action: () => createMidiClip(trackIdx, atSec) } : null,
        (['keys', 'drums'].includes(state.project.tracks[trackIdx]?.type)) ? { label: '⬆ Importer un fichier .mid ici…', action: () => pickMidiFile(trackIdx, atSec) } : null,
        (['keys', 'drums'].includes(state.project.tracks[trackIdx]?.type)) ? { label: '⬇ Exporter cette piste en .mid', action: () => exportMidiTrack(trackIdx) } : null,
        { label: 'Poser un marqueur ici', action: () => addMarker(atSec) },
        { sep: true },
        { label: 'Couper à gauche du curseur (D)', action: () => { state.playhead = atSec; updatePlayhead(); trimLeft(); }},
        { label: 'Couper à droite du curseur (F)', action: () => { state.playhead = atSec; updatePlayhead(); trimRight(); }},
        { sep: true },
        state.project.tracks.some(t => t.hidden) ? { label: 'Afficher les pistes masquées (' + state.project.tracks.filter(t => t.hidden).length + ')', action: () => showHiddenTracks() } : null,
        { label: 'Ajouter une piste audio', action: () => _doAddTrack('audio') },
        { label: 'Ajouter une piste instrument (piano roll)', action: () => _doAddTrack('keys') },
        { label: 'Ajouter une piste batterie (séquenceur)', action: () => _doAddTrack('drums') }
    ].filter(Boolean);

    items.forEach(item => {
        if (item.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; menu.appendChild(d); return; }
        const el = document.createElement('div');
        el.className = 'ctx-item';
        el.textContent = item.label;
        el.addEventListener('click', () => { item.action(); menu.remove(); });
        menu.appendChild(el);
    });
    document.body.appendChild(menu);
    // Ajuster si hors écran
    const mr = menu.getBoundingClientRect();
    if (mr.right  > window.innerWidth)  menu.style.left = (x - mr.width) + 'px';
    if (mr.bottom > window.innerHeight) menu.style.top  = (y - mr.height) + 'px';
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 50);
}

// Ferme un menu au clic AILLEURS (un clic sur une de ses entrées doit d'abord arriver jusqu'à elle)
// Panneau de couleurs : colorie les régions choisies, sinon les pistes choisies
function openColorPanel() {
    closeAllMenus();
    document.querySelectorAll('.color-panel').forEach(x => x.remove());
    const clipKeys = new Set(state.selectedClips);
    if (state.selectedClip) clipKeys.add(`${state.selectedClip.trackIdx}:${state.selectedClip.clipIdx}`);
    const trackIdxs = clipKeys.size ? [] : selectedTrackIdxs();
    const what = clipKeys.size ? (clipKeys.size > 1 ? `${clipKeys.size} régions` : 'la région') : (trackIdxs.length > 1 ? `${trackIdxs.length} pistes` : 'la piste');
    const apply = (color) => {
        pushUndo();
        if (clipKeys.size) clipKeys.forEach(k => { const [ti, ci] = k.split(':').map(Number); const c = state.project.tracks[ti]?.clips[ci]; if (c) { if (color) c.color = color; else delete c.color; } });
        else trackIdxs.forEach(i => { const t = state.project.tracks[i]; if (t && color) t.color = color; });
        rerenderTracks(); saveProject();
    };
    const panel = document.createElement('div');
    panel.className = 'color-panel track-ctx-menu';
    const swatches = [];
    COLOR_TONES.forEach(([sa, l]) => COLOR_HUES.forEach(h => swatches.push(hslHex(h, sa, l))));
    ['#F5F5F7', '#C7C7CC', '#8E8E93', '#636366', '#3A3A3C', '#1C1C1E'].forEach(g => swatches.push(g));
    panel.innerHTML = `<div class="color-panel-title">Couleur de ${what}</div>
        <div class="color-grid">${swatches.map(c => `<button class="ctx-swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
        <div class="color-panel-foot"><label>Autre couleur <input type="color" class="color-custom" value="#A855F7"></label>${clipKeys.size ? '<button class="color-reset">Couleur de la piste</button>' : ''}</div>`;
    panel.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:350;padding:12px;min-width:280px';
    panel.addEventListener('click', (e) => {
        const sw = e.target.closest('.ctx-swatch[data-c]'); if (sw) { apply(sw.dataset.c); return; }
        if (e.target.closest('.color-reset')) { apply(null); panel.remove(); }
    });
    panel.querySelector('.color-custom').addEventListener('change', (e) => apply(e.target.value.toUpperCase()));
    document.body.appendChild(panel);
    dismissMenuOnOutside(panel);
    const esc = (e) => { if (e.key === 'Escape') { panel.remove(); document.removeEventListener('keydown', esc, true); } };
    document.addEventListener('keydown', esc, true);
}
function dismissMenuOnOutside(menu) {
    setTimeout(() => {
        const off = (e) => {
            if (menu.contains(e.target)) return;
            document.removeEventListener('mousedown', off);
            menu.remove();
        };
        document.addEventListener('mousedown', off);
    }, 10);
}
function closeAllMenus() {
    document.querySelectorAll('.track-ctx-menu').forEach(m => m.remove());
}

// --- Réglages de piste (menu clic droit) : phase, verrou, masquer ---
// Inverser la phase (Ø) : passe par l'effet Utilitaire (réglage « Inverser la phase »), donc même son à l'export et dans Rust
function toggleTrackPhase(t) {
    pushUndo();
    t.effects = t.effects || []; t.effectParams = t.effectParams || {};
    const on = !(t.effectParams.util && t.effectParams.util.invert);
    if (on) {
        if (!t.effects.includes('util')) t.effects.push('util');
        t.effectParams.util = { gain: 0, mono: 0, ...(t.effectParams.util || {}), invert: 1 };
    } else {
        const u = t.effectParams.util || {};
        u.invert = 0;
        if (!u.gain && !u.mono) { t.effects = t.effects.filter(n => n !== 'util'); delete t.effectParams.util; }   // plus rien à faire : on retire l'effet
    }
    renderAll(); saveProject(); refreshPlaybackSoon();
    flash(on ? 'Phase inversée (Ø) sur « ' + t.name + ' »' : 'Phase remise normale sur « ' + t.name + ' »');
}
// Verrouiller la piste : ses régions ne bougent plus, on ne peut plus y enregistrer
function toggleTrackLocked(t) {
    if (t.frozen) { flash('❄ Piste gelée : dégèle-la d\'abord (clic droit > Son > Dégeler)'); return; }
    pushUndo();
    if (t.locked) delete t.locked; else { t.locked = true; t.armed = false; }
    renderTracksPanel(); bindTrackEvents(); renderTimelineTracks(); saveProject();
    flash(t.locked ? '🔒 Piste verrouillée : plus de déplacement ni d\'enregistrement par accident' : 'Piste déverrouillée');
}
// Geler la piste (comme Logic) : régions + effets rendus en un seul son, joué à la place → l'ordinateur souffle.
// Volume, pan, envois et sortie restent réglables ; régions et effets sont figés (piste verrouillée) jusqu'au dégel.
let _freezeBusy = false;
async function freezeTrack(t) {
    if (t.frozen) return;
    if (_freezeBusy) { flash('Un gel est déjà en cours — attends qu\'il finisse'); return; }
    if (state.recording) { flash('Arrête l\'enregistrement avant de geler une piste'); return; }
    if (!(t.clips || []).some(c => !c.muted && !c.recording)) { flash('Rien à geler : cette piste n\'a pas de région'); return; }
    _freezeBusy = true;
    flash(`❄ Gel de « ${t.name} » en cours…`);
    try {
        const r = await PulseAudio.renderFreeze(state.project, state.project.tracks.indexOf(t));
        if (!r) { flash('Rien à geler : la piste est silencieuse'); return; }
        const id = `frz_${Date.now().toString(36)}`;
        PulseAudio.registerBuffer(id, r.buffer);
        try { await PulsePersist.saveBlob(id, PulseAudio.audioBufferToWav(r.buffer), { kind: 'freeze' }); }
        catch (e) { console.warn('Persist freeze failed', e); }
        pushUndo();
        t.frozen = { id, gain: r.gain, ...(t.locked ? { wasLocked: true } : {}) };
        t.locked = true; t.armed = false;
        renderAll(); saveProject(); refreshPlaybackSoon();
        flash('❄ Piste gelée : elle joue son rendu, effets compris. Volume, pan et envois restent réglables (clic droit > Son > Dégeler pour la modifier)');
    } catch (err) {
        console.error(err);
        flash('Le gel n\'a pas pu se faire — libère de la place sur ton disque et réessaie');
    } finally { _freezeBusy = false; }
}
function unfreezeTrackData(t) {
    if (!t.frozen) return;
    if (!t.frozen.wasLocked) delete t.locked;
    delete t.frozen;
}
function unfreezeTrack(t) {
    if (!t.frozen) return;
    pushUndo(); unfreezeTrackData(t);
    renderAll(); saveProject(); refreshPlaybackSoon();
    flash('Piste dégelée : ses régions et ses effets jouent de nouveau en direct');
}
// Masquer la piste : elle disparaît de l'écran mais continue de jouer (comme dans Logic)
function toggleTrackHidden(t) {
    pushUndo();
    if (t.hidden) delete t.hidden; else t.hidden = true;
    renderAll(); saveProject();
    flash(t.hidden ? 'Piste masquée (elle joue toujours) — clic droit dans le vide > Afficher les pistes masquées' : 'Piste affichée');
}
// Délai de piste (ms) : petit panneau, on tape la valeur (+ = plus tard, − = plus tôt) ; 0 = retiré
function openTrackDelayPanel(t, x, y) {
    closeTransientPanels();
    const panel = document.createElement('div');
    panel.className = 'fx-panel warp-panel track-delay-panel';
    panel.innerHTML = `
        <div class="fx-panel-header"><span>Délai de piste — ${esc(t.name || '')}</span><button class="fx-panel-close">×</button></div>
        <div class="fx-panel-body">
            <p class="warp-txt">Décale le son de toute la piste, sans bouger les régions. <b>+</b> = plus tard, <b>−</b> = plus tôt (pour recaler une piste en retard).</p>
            <div class="fx-row"><label class="fx-label">Délai</label><input type="text" class="set-num td-ms" value="${String(t.delayMs || 0).replace('.', ',')}" inputmode="decimal"> <span>ms</span></div>
        </div>
        <div class="fx-panel-footer"><button class="td-zero">Remettre à 0</button><button class="td-ok">Appliquer</button></div>`;
    document.body.appendChild(panel);
    panel.style.left = Math.min(x, window.innerWidth - 300) + 'px';
    panel.style.top = Math.max(8, Math.min(y, window.innerHeight - 220)) + 'px';
    const inp = panel.querySelector('.td-ms');
    const apply = (v) => {
        if (!Number.isFinite(v) || Math.abs(v) > 500) { flash('Délai entre −500 et +500 ms'); return; }
        panel.remove();
        pushUndo();
        v = Math.round(v * 10) / 10;
        if (v) t.delayMs = v; else delete t.delayMs;
        renderAll(); saveProject(); refreshPlaybackSoon();
        flash(v ? `Délai de « ${t.name} » : ${v > 0 ? '+' : ''}${String(v).replace('.', ',')} ms` : `Délai de « ${t.name} » retiré`);
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') apply(parseFloat(String(inp.value).replace(',', '.').replace('−', '-'))); if (e.key === 'Escape') panel.remove(); });
    panel.querySelector('.td-ok').addEventListener('click', () => apply(parseFloat(String(inp.value).replace(',', '.').replace('−', '-'))));
    panel.querySelector('.td-zero').addEventListener('click', () => apply(0));
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
// Notes de piste (comme le bloc-notes de piste de Logic) : texte libre, gardé avec le projet ; un 📝 s'affiche sur la piste
function openTrackNotesPanel(t, x, y) {
    closeTransientPanels();
    const panel = document.createElement('div');
    panel.className = 'fx-panel warp-panel track-notes-panel';
    panel.innerHTML = `
        <div class="fx-panel-header"><span>Notes — ${esc(t.name || '')}</span><button class="fx-panel-close">×</button></div>
        <div class="fx-panel-body"><textarea class="tn-txt" rows="6" placeholder="Ce que tu veux retenir sur cette piste (réglages, idées, à refaire…)"></textarea></div>
        <div class="fx-panel-footer"><button class="tn-ok">Enregistrer</button></div>`;
    document.body.appendChild(panel);
    panel.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    panel.style.top = Math.max(8, Math.min(y, window.innerHeight - 280)) + 'px';
    const ta = panel.querySelector('.tn-txt');
    ta.value = t.notes || '';
    const save = () => {
        const v = ta.value.replace(/\s+$/, '');
        panel.remove();
        if (v === (t.notes || '')) return;
        pushUndo();
        if (v) t.notes = v; else delete t.notes;
        renderTracksPanel(); bindTrackEvents(); saveProject();
        flash(v ? 'Notes de la piste enregistrées' : 'Notes de la piste effacées');
    };
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') panel.remove(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); });
    panel.querySelector('.tn-ok').addEventListener('click', save);
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    setTimeout(() => ta.focus(), 30);
}
function showHiddenTracks() {
    const n = state.project.tracks.filter(t => t.hidden).length;
    if (!n) return;
    pushUndo(); state.project.tracks.forEach(t => { delete t.hidden; });
    renderAll(); saveProject();
    flash(n > 1 ? n + ' pistes affichées' : 'Piste affichée');
}

// --- Menu contextuel sur une piste ---
function openTrackContextMenu(x, y, idx, t) {
    closeAllMenus();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200;`;
    const items = [
        { label: 'Renommer',          action: () => { const el = document.querySelector(`.track-name[data-i="${idx}"]`); if (el) { el.classList.add('editing'); el.focus(); document.execCommand('selectAll'); } } },
        { label: 'Dupliquer (sans clips)', action: () => duplicateTrack(idx) },
        t.isCapture ? null : { label: 'Supprimer la piste', action: () => { state.selectedTrack = idx; deleteSelectedTrack(); }, danger: true },
        { sep: true },
        { label: t.muted ? 'Désactiver Mute'  : 'Mute',  action: () => toggleMute(idx) },
        { label: t.solo  ? 'Désactiver Solo'  : 'Solo',  action: () => toggleSolo(idx) },
        { label: t.armed ? 'Ne plus enregistrer ici': 'Enregistrer sur cette piste', action: () => {
            if (t.type === 'keys' || t.type === 'drums') { flash('Cette piste joue des notes : pour enregistrer ta voix, ajoute une piste « Ma voix » avec le bouton +'); return; }
            if (t.armed) t.armed = false; else armTrackExclusive(state.project.tracks.indexOf(t));
            syncMonitor();
            renderTracksPanel(); bindTrackEvents(); saveProject();
        }},
        { sep: true },
        { label: 'Groupe', children: [
        ...(state.project.buses || []).filter(b => isVisibleGroup(b) && b.id !== t.output)
            .map(b => ({ label: `Ranger dans le groupe « ${b.name} »`, action: () => moveTrackToGroup(state.project.tracks.indexOf(t), b.id) })),
        (t.takes || []).length ? { label: 'Supprimer les prises mises de côté', action: () => clearTrackTakes(state.project.tracks.indexOf(t)) } : null,
        { label: 'Nouveau groupe avec cette piste', action: () => createGroupWithTrack(state.project.tracks.indexOf(t)) },
        trackGroup(t) ? { label: `Sortir du groupe « ${trackGroup(t).name} »`, action: () => removeTrackFromGroup(state.project.tracks.indexOf(t)) } : null
        ]},
        { label: 'Son', children: [
            (t.clips || []).filter(c => !c.recording).length > 1
            ? { label: 'Fusionner tous les clips de la piste en un seul', action: () => bounceTrack(idx) }
            : null,
            { label: 'Son de la piste (Voix lead, Doublage, Back…)', action: () => { const el = document.querySelector(`.track-item[data-i="${state.project.tracks.indexOf(t)}"]`); if (el) openSoundPanel(state.project.tracks.indexOf(t), el); } },
        (t.type === 'audio' || !t.type) && !t.isCapture && !isInstruTrack(t)
            ? { label: t.autotune && t.autotune.on ? 'Auto-Tune de la piste (modifier ou retirer)…' : 'Auto-Tune de la piste…', action: () => { const ti = state.project.tracks.indexOf(t); const el = document.querySelector(`.track-item[data-i="${ti}"]`); const r = el ? el.getBoundingClientRect() : { right: 300, top: 120 }; openTunePanel(ti, -1, r.right + 8, r.top, true); } }
            : null,
            { label: (t.effectParams && t.effectParams.util && t.effectParams.util.invert) ? 'Phase : remettre normale (Ø)' : 'Inverser la phase (Ø)', action: () => toggleTrackPhase(t) },
            t.frozen ? { label: '❄ Dégeler la piste', action: () => unfreezeTrack(t) }
            : !t.isCapture && (t.clips || []).some(c => !c.recording) ? { label: '❄ Geler la piste (soulage l\'ordinateur)', action: () => freezeTrack(t) } : null
        ]},
        { label: 'Réglages', children: [
            { label: t.locked ? 'Déverrouiller la piste' : 'Verrouiller la piste', action: () => toggleTrackLocked(t) },
            { label: t.hidden ? 'Afficher la piste' : 'Masquer la piste', action: () => toggleTrackHidden(t) },
            { label: t.notes ? 'Notes de la piste (modifier)…' : 'Notes de la piste…', action: () => openTrackNotesPanel(t, x, y) },
            { label: t.delayMs ? `Délai de piste : ${t.delayMs > 0 ? '+' : ''}${String(t.delayMs).replace('.', ',')} ms…` : 'Délai de piste…', action: () => openTrackDelayPanel(t, x, y) }
        ]},
        { label: 'Changer la couleur', submenu: COLORS.map(c => ({ color: c, action: () => { pushUndo(); t.color = c; renderAll(); saveProject(); } })) }
    ].filter(Boolean);

    items.forEach(item => {
        if (item.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; menu.appendChild(d); return; }
        if (item.children) { ctxAddSubmenu(menu, item); return; }
        if (item.submenu) {
            const div = document.createElement('div');
            div.className = 'ctx-item ctx-colors';
            item.submenu.forEach(s => {
                const swatch = document.createElement('div');
                swatch.className = 'ctx-swatch';
                swatch.style.background = s.color;
                swatch.addEventListener('click', () => { s.action(); menu.remove(); });
                div.appendChild(swatch);
            });
            const lbl = document.createElement('div');
            lbl.className = 'ctx-item-label';
            lbl.textContent = item.label;
            menu.appendChild(lbl);
            menu.appendChild(div);
            return;
        }
        const el = document.createElement('div');
        el.className = 'ctx-item' + (item.danger ? ' ctx-danger' : '');
        el.textContent = item.label;
        el.addEventListener('click', () => { item.action(); menu.remove(); });
        menu.appendChild(el);
    });

    document.body.appendChild(menu);
    // Fermer si clic en dehors
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 50);
}

// === Effet sur une région (planche A : pastilles) ===
// clip.fx = { name, effects: [...], effectParams: {...} } : passe avant les effets de la piste, l'écho continue après la fin
function clipHasFx(c) { return !!(c && c.fx && (c.fx.effects || []).length); }
const CLIP_FX_QUICK = [
    ['Écho 1/8 P-Pong', 'delay', () => ({ ...FX_PRESETS.delay[0].params, _preset: FX_PRESETS.delay[0].name })],
    ['Écho 1/4', 'delay', () => ({ ...FX_PRESETS.delay[2].params, _preset: FX_PRESETS.delay[2].name })],
    ['Pitch −', 'pitch', () => ({ ...FX_PRESETS.pitch[0].params, _preset: FX_PRESETS.pitch[0].name })],
    ['Pitch +', 'pitch', () => ({ ...FX_PRESETS.pitch[1].params, _preset: FX_PRESETS.pitch[1].name })],
    ['Phone', 'filter', () => ({ ...FX_PRESETS.filter[0].params, _preset: FX_PRESETS.filter[0].name })]
];
function clipFxHtml(c, widthPx) {
    if (!clipHasFx(c)) return '';
    const names = c.fx.effects;
    // Région minuscule : un petit logo seul, qui ouvre la liste
    if (widthPx < 34 + names.length * 56) return `<div class="clip-fx-pills"><span class="clip-fx-logo" data-tooltip="Effets sur cette région : ${esc(names.map(n => FX_NAMES[n] || n).join(', '))} (clic pour les voir)">✦${names.length > 1 ? names.length : ''}</span></div>`;
    return `<div class="clip-fx-pills">${names.map(n => `<span class="clip-fx-pill" data-fx="${n}" data-tooltip="Clic : régler cet effet · × : le retirer de la région">${esc((c.fx.labels || {})[n] || FX_NAMES[n] || n)}<i data-del="1">×</i></span>`).join('')}</div>`;
}
// Une région coupée ou copiée garde ses effets : chacune doit avoir les siens (sinon régler l'une change l'autre)
function ownClipFx(clip) {
    if (!clip.fx) return clip.fx;
    const shared = state.project.tracks.some(t => (t.clips || []).some(o => o !== clip && o.fx === clip.fx));
    if (shared) clip.fx = JSON.parse(JSON.stringify(clip.fx));
    return clip.fx;
}
function addClipFx(trackIdx, clipIdx, fxName, params, label) {
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx]; if (!clip || clip.midi) return;
    pushUndo();
    clip.fx = ownClipFx(clip) || { effects: [], effectParams: {} };
    clip.fx.name = `Région « ${clip.name || 'Clip'} »`;
    if (!clip.fx.effects.includes(fxName)) clip.fx.effects.push(fxName);
    clip.fx.effectParams = clip.fx.effectParams || {};
    clip.fx.effectParams[fxName] = params ? params : (clip.fx.effectParams[fxName] || (FX_START[fxName] ? JSON.parse(JSON.stringify(FX_START[fxName])) : {}));
    if (label) (clip.fx.labels = clip.fx.labels || {})[fxName] = label; else if (clip.fx.labels) delete clip.fx.labels[fxName];
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(`${label || FX_NAMES[fxName] || fxName} posé sur la région (seulement ce passage) — ⌘Z pour annuler`);
}
function removeClipFx(clip, fxName) {
    if (!clipHasFx(clip)) return;
    pushUndo();
    ownClipFx(clip);
    const w = findPlugWin(clip.fx, fxName); if (w) w.remove();
    const names = fxName ? [fxName] : [...clip.fx.effects];
    names.forEach(n => { const w2 = findPlugWin(clip.fx, n); if (w2) w2.remove(); });
    clip.fx.effects = clip.fx.effects.filter(n => !names.includes(n));
    names.forEach(n => { delete clip.fx.effectParams[n]; if (clip.fx.labels) delete clip.fx.labels[n]; });
    if (!clip.fx.effects.length) delete clip.fx;
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(fxName ? `${FX_NAMES[fxName] || fxName} retiré de la région` : 'Effets de la région retirés');
}
function openClipFx(clip, fxName, anchor) {
    ownClipFx(clip);
    clip.fx.name = `Région « ${clip.name || 'Clip'} »`;
    openEffectPanel(clip.fx, fxName, anchor);
}
function openClipFxMenu(x, y, trackIdx, clipIdx, anchor) {
    closeAllMenus();
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx]; if (!clip) return;
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${Math.min(x, window.innerWidth - 240)}px;top:${Math.min(y, window.innerHeight - 320)}px;z-index:300;min-width:220px`;
    const head = (t) => { const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = t; menu.appendChild(h); };
    const item = (label, run) => { const it = document.createElement('div'); it.className = 'ctx-item'; it.textContent = label; it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); run(); }); menu.appendChild(it); };
    if (clipHasFx(clip)) {
        head('Sur cette région');
        clip.fx.effects.forEach(n => item(`Régler : ${(clip.fx.labels || {})[n] || FX_NAMES[n] || n}`, () => openClipFx(clip, n, anchor || document.body)));
    }
    head('Ajouter sur cette région');
    CLIP_FX_QUICK.forEach(([label, fx, params]) => item(label, () => addClipFx(trackIdx, clipIdx, fx, params(), label)));
    item('Autre effet…', () => {
        clip.fx = ownClipFx(clip) || { effects: [], effectParams: {} };
        clip.fx.name = `Région « ${clip.name || 'Clip'} »`;
        const a = anchor || document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`) || document.body;
        openAddEffectMenu(a, clip.fx, clip.fx);
    });
    if (clipHasFx(clip)) item('Retirer les effets de la région', () => removeClipFx(clip, null));
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
}
// Clic sur une pastille : régler l'effet ; × : le retirer ; logo d'une petite région : la liste
document.addEventListener('mousedown', (e) => {
    const el = e.target.closest && e.target.closest('.clip-fx-pill, .clip-fx-logo'); if (!el || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const clipEl = el.closest('.clip'), row = el.closest('.timeline-track');
    const ti = +row.dataset.i, ci = +clipEl.dataset.ci, clip = state.project.tracks[ti]?.clips[ci]; if (!clip) return;
    if (el.classList.contains('clip-fx-logo')) { const r = el.getBoundingClientRect(); openClipFxMenu(r.left, r.bottom + 2, ti, ci, el); return; }
    if (e.target.closest('[data-del]')) { removeClipFx(clip, el.dataset.fx); return; }
    openClipFx(clip, el.dataset.fx, el);
}, true);

// --- Joindre / décaler / verrouiller des régions (menu Édition) ---
const clipEndOf = (c) => (c.loopEnd && c.loopEnd > c.start + c.duration) ? c.loopEnd : c.start + c.duration;
// Joindre : les régions audio choisies sur la même piste deviennent UNE région (rendu à l'identique, effets de région compris)
async function joinSelectedClips(trackIdx, clipIdx, opts = {}) {
    const t = state.project.tracks[trackIdx];
    const cs = (opts.single ? [t.clips[clipIdx]] : clipsActedOn(trackIdx, clipIdx)).filter(c => c && t.clips.includes(c));
    if (cs.length < (opts.single ? 1 : 2)) { flash('Choisis au moins deux régions de la même piste (Shift + clic, ou ⌘A) puis Joindre'); return; }
    if (cs.some(c => clipIsLocked(c))) return;
    if (cs.every(c => c.midi) && !opts.single) return joinMidiClips(t, cs);
    if (cs.some(c => c.midi)) { flash(opts.single ? 'Une région de notes est déjà « réelle » : rien à convertir' : 'Joindre : choisis soit des régions audio, soit des régions de notes (pas les deux)'); return; }
    flash(opts.single ? 'Conversion en cours…' : 'Jonction en cours…');
    try {
        const t0 = Math.min(...cs.map(c => c.start)), t1 = Math.max(...cs.map(clipEndOf));
        const solo = { ...t, clips: JSON.parse(JSON.stringify(cs)), volume: 100, pan: 0, effects: undefined, effectParams: undefined,
            sound: undefined, automation: undefined, sends: {}, busSends: {}, takes: [], muted: false, group: undefined };
        const tmp = { ...state.project, tracks: [solo], buses: [], sends: [] };
        const wav = await PulseAudio.exportTrackWav(tmp, 0);
        if (!wav) { flash('Ces régions sont vides : rien à joindre'); return; }
        const ctx = PulseAudio.getContext();
        const full = await ctx.decodeAudioData((await wav.arrayBuffer()).slice(0));
        const sr = full.sampleRate, a = Math.round(t0 * sr), b = Math.min(full.length, Math.round(t1 * sr));
        const out = ctx.createBuffer(full.numberOfChannels, Math.max(1, b - a), sr);
        for (let ch = 0; ch < full.numberOfChannels; ch++) out.getChannelData(ch).set(full.getChannelData(ch).subarray(a, b));
        const blob = PulseAudio.audioBufferToWav(out);
        const newId = `join_${Date.now().toString(36)}`;
        PulseAudio.registerBuffer(newId, out);
        if (window.PulsePersist) await PulsePersist.saveBlob(newId, blob, { kind: 'join' });
        pushUndo();
        t.clips = t.clips.filter(c => !cs.includes(c));
        t.clips.push({ id: newId, name: (cs[0].name || t.name) + (opts.single ? ' (converti)' : ' (joint)'), start: t0, duration: out.duration, peaks: makePeaks(out) });
        t.clips.sort((x, y) => x.start - y.start);
        state.selectedClip = null; state.selectedClips.clear();
        renderAll(); saveProject(); refreshPlaybackSoon();
        flash(opts.single ? '✓ Région convertie en son réel (effets, fondus et répétitions compris) — ⌘Z pour revenir en arrière' : `✓ ${cs.length} régions jointes en une seule — ⌘Z pour revenir en arrière`);
    } catch (err) {
        console.error(err);
        flash('La jonction n\'a pas marché — rien n\'a été modifié');
    }
}
// Joindre des régions de notes : une seule région qui contient toutes les notes à leur place (répétitions et coupes comprises)
async function joinMidiClips(t, cs) {
    if (new Set(cs.map(c => c.midi.inst)).size > 1) { flash('Ces régions jouent des instruments différents : impossible de les joindre'); return; }
    const t0 = Math.min(...cs.map(c => c.start)), t1 = Math.max(...cs.map(clipEndOf));
    const bpm = bpmAtSec(t0), spb = 60 / bpm;     // la région jointe prend le tempo de son début
    const notes = [];
    cs.forEach(c => {
        const off = c.offset || 0, end = clipEndOf(c), cspb = 60 / (c.midi.bpm || bpm);
        for (let base = c.start; base < end - 1e-6; base += c.duration) {
            c.midi.notes.forEach(n => {
                const rel = n.s * cspb - off;   // place de la note dans ce tour de la région
                if (rel < -1e-6 || rel >= c.duration - 1e-6) return;
                const abs = base + rel; if (abs >= end - 1e-6) return;
                const d = Math.min(n.d * cspb, end - abs, c.duration - rel);
                notes.push({ ...n, s: Math.round((abs - t0) / spb * 1e6) / 1e6, d: Math.max(0.01, Math.round(d / spb * 1e6) / 1e6) });
            });
        }
    });
    notes.sort((a, b) => a.s - b.s || a.p - b.p);
    pushUndo();
    const clip = { start: t0, duration: t1 - t0, offset: 0, name: (cs[0].name || t.name) + ' (joint)', color: cs[0].color };
    await bakeMidiClip(clip, { inst: cs[0].midi.inst, beats: (t1 - t0) / spb, notes }, bpm);
    t.clips = t.clips.filter(c => !cs.includes(c));
    t.clips.push(clip);
    t.clips.sort((a, b) => a.start - b.start);
    state.selectedClip = null; state.selectedClips.clear();
    renderAll(); saveProject(); refreshPlaybackSoon();
    flash(`✓ ${cs.length} régions jointes en une seule — ⌘Z pour revenir en arrière`);
}
// Décaler les régions choisies de quelques millisecondes (recaler finement une prise)
function nudgeClipsMs(clips, ms) {
    const trackLocked = (c) => state.project.tracks.some(t => t.locked && (t.clips || []).includes(c));
    clips = (clips || []).filter(c => c && !c.recording && !c.locked && !trackLocked(c));
    if (!clips.length) { flash('🔒 Région ou piste verrouillée : déverrouille-la d\'abord'); return; }
    pushUndo();
    clips.forEach(c => { const d = Math.max(-c.start, ms / 1000); c.start += d; if (c.loopEnd) c.loopEnd += d; });
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(`Région décalée de ${ms > 0 ? '+' : ''}${ms} ms`);
}
function toggleClipsLocked(clips) {
    clips = (clips || []).filter(c => c && !c.recording);
    if (!clips.length) return;
    const lock = !clips.every(c => c.locked);
    pushUndo(); clips.forEach(c => { if (lock) c.locked = true; else delete c.locked; });
    renderTimelineTracks(); saveProject();
    flash(lock ? '🔒 Région verrouillée : elle ne bouge plus ni ne se coupe par accident' : 'Région déverrouillée');
}
function clipIsLocked(clip) {
    const tr = clip && state.project.tracks.find(x => (x.clips || []).includes(clip));
    if (tr && tr.frozen) { flash('❄ Piste gelée : ses régions sont figées (clic droit sur la piste > Son > Dégeler)'); return true; }
    if (tr && tr.locked) { flash('🔒 Piste verrouillée (clic droit sur la piste > Réglages > Déverrouiller)'); return true; }
    if (clip && clip.locked) { flash('🔒 Région verrouillée (clic droit > Réglages > Déverrouiller)'); return true; }
    return false;
}
// Ligne de menu avec sous-menu qui s'ouvre à droite (ou à gauche s'il n'y a pas la place)
function ctxAddSubmenu(menu, item) {
    const row = document.createElement('div');
    row.className = 'ctx-item ctx-has-sub';
    row.textContent = item.label;
    let panel = null, timer = null;
    const closePanel = () => { if (panel) { panel.remove(); panel = null; } };
    const open = () => {
        clearTimeout(timer);
        menu.querySelectorAll('.ctx-subpanel').forEach(p => { if (p !== panel) p.remove(); });
        if (panel) return;
        panel = document.createElement('div');
        panel.className = 'track-ctx-menu clip-ctx-menu ctx-subpanel';
        panel.style.cssText = 'position:fixed;z-index:201;';
        item.children.filter(Boolean).forEach(ch => {
            if (ch.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; panel.appendChild(d); return; }
            const el = document.createElement('div');
            el.className = 'ctx-item' + (ch.danger ? ' ctx-danger' : '');
            el.textContent = ch.label;
            el.addEventListener('click', () => { ch.action(); menu.remove(); });
            panel.appendChild(el);
        });
        menu.appendChild(panel);
        const rr = row.getBoundingClientRect(), pr = panel.getBoundingClientRect();
        let left = rr.right + 2; if (left + pr.width > window.innerWidth) left = Math.max(4, rr.left - pr.width - 2);
        let top = rr.top - 6; if (top + pr.height > window.innerHeight) top = Math.max(4, window.innerHeight - pr.height - 6);
        panel.style.left = left + 'px'; panel.style.top = top + 'px';
        panel.addEventListener('mouseenter', () => clearTimeout(timer));
        panel.addEventListener('mouseleave', () => { timer = setTimeout(closePanel, 250); });
    };
    row.addEventListener('mouseenter', open);
    row.addEventListener('click', open);
    row.addEventListener('mouseleave', () => { timer = setTimeout(closePanel, 250); });
    menu.appendChild(row);
}

// --- Hauteur, vitesse, niveau, fondus, boucle d'une région (menu clic droit) ---
// Transposer : passe par l'effet Pitch de la région (même son à l'export et dans Rust). Plage ±12 demi-tons.
function transposeClips(trackIdx, clipIdx, semi) {
    const cs = clipsActedOn(trackIdx, clipIdx).filter(c => !c.midi && !c.recording);
    if (!cs.length) { flash('Transposer marche sur les régions audio (pour des notes : le piano roll)'); return; }
    if (cs.some(c => clipIsLocked(c))) return;
    pushUndo();
    cs.forEach(c => {
        c.fx = ownClipFx(c) || (semi ? { effects: [], effectParams: {} } : c.fx);
        if (!semi) {
            if (c.fx && c.fx.effects.includes('pitch')) {
                c.fx.effects = c.fx.effects.filter(n => n !== 'pitch'); delete c.fx.effectParams.pitch; if (c.fx.labels) delete c.fx.labels.pitch;
                if (!c.fx.effects.length) delete c.fx;
            }
            return;
        }
        c.fx.name = `Région « ${c.name || 'Clip'} »`;
        if (!c.fx.effects.includes('pitch')) c.fx.effects.push('pitch');
        c.fx.effectParams = c.fx.effectParams || {};
        c.fx.effectParams.pitch = { semi, mix: 100 };
        (c.fx.labels = c.fx.labels || {}).pitch = (semi > 0 ? '+' : '') + semi + ' dt';
    });
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(semi ? `Région transposée de ${semi > 0 ? '+' : ''}${semi} demi-ton${Math.abs(semi) > 1 ? 's' : ''} (la voix change aussi de timbre) — ⌘Z pour annuler` : 'Hauteur d\'origine remise');
}
// Vitesse : même mécanique que le Warp (la durée change, pas la hauteur). ×2 = deux fois plus vite
async function speedClip(trackIdx, clipIdx, f) {
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip || clip.midi || clip.recording) { flash('La vitesse marche sur une région audio'); return; }
    if (clipIsLocked(clip)) return;
    const P = bpmAtSec(clip.start);
    await applyWarp(clip, P / f, P);
}
// Normaliser à un niveau choisi (crête de la région)
function normalizeClipTo(trackIdx, clipIdx, db) {
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip || clip.midi) return;
    if (clipIsLocked(clip)) return;
    if (!clip.id) { flash('Le son de ce clip n\'est pas encore chargé — attends une seconde et réessaie'); return; }
    const gain = PulseAudio.computeNormalizeGain(clip.id, db);
    if (gain === null) { flash('Ce clip est silencieux — il n\'y a rien à normaliser'); return; }
    pushUndo();
    clip.gain = Math.round(gain * 1000) / 1000;
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(`✓ Région normalisée : crête à ${String(db).replace('.', ',')} dB — ⌘Z pour revenir en arrière`);
}
// Fondu d'entrée / de sortie à une durée donnée (en secondes), au plus la moitié de la région
function setClipFade(trackIdx, clipIdx, which, sec) {
    const cs = clipsActedOn(trackIdx, clipIdx).filter(c => !c.recording);
    if (cs.some(c => clipIsLocked(c))) return;
    pushUndo();
    cs.forEach(c => {
        const v = Math.min(sec, c.duration / 2);
        if (which === 'in') { if (v > 0) c.fadeIn = v; else { delete c.fadeIn; delete c.fadeInCurve; } }
        else { if (v > 0) c.fadeOut = v; else { delete c.fadeOut; delete c.fadeOutCurve; } }
    });
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(sec > 0 ? `Fondu ${which === 'in' ? 'd\'entrée' : 'de sortie'} : ${sec >= 1 ? sec + ' s' : Math.round(sec * 1000) + ' ms'}` : `Fondu ${which === 'in' ? 'd\'entrée' : 'de sortie'} retiré`);
}
// Boucle (case « Loop » de Logic) : la région se répète jusqu'à la région suivante de la piste (sinon 8 fois)
function loopClipUntilNext(trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx], clip = t && t.clips[clipIdx];
    if (!clip || clip.recording || !clip.duration) return;
    if (clipIsLocked(clip)) return;
    const next = t.clips.filter(o => o !== clip && !o.recording && o.start >= clip.start + clip.duration - 1e-6).sort((a, b) => a.start - b.start)[0];
    const end = next ? next.start : clip.start + clip.duration * 8;
    if (end <= clip.start + clip.duration + 0.05) { flash('Pas de place pour répéter : la région suivante est collée'); return; }
    pushUndo();
    clip.loopEnd = end;
    renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
    flash(next ? 'Région bouclée jusqu\'à la suivante' : 'Région répétée 8 fois (tire la poignée en bas à droite pour ajuster)');
}

// --- Menu contextuel sur un clip ---
function openClipContextMenu(x, y, trackIdx, clipIdx) {
    closeAllMenus();
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;

    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu clip-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200;`;

    // Fondus : celui du côté où on a cliqué (moitié gauche = entrée, moitié droite = sortie), crossfade compris
    const clipDom = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
    const crect = clipDom ? clipDom.getBoundingClientRect() : null;
    const side = crect && x > crect.left + crect.width / 2 ? 'out' : 'in';
    const endOf = (c) => (c.loopEnd && c.loopEnd > c.start + c.duration) ? c.loopEnd : c.start + c.duration;
    const others = (state.project.tracks[trackIdx].clips || []).filter(c => c !== clip && !c.recording && !c.muted);
    // chevauchement « partiel » seulement : une région entièrement contenue dans l'autre n'a pas de fondu enchaîné
    const prevOv = others.filter(c => c.start < clip.start - 1e-6 && endOf(c) > clip.start + 1e-6 && endOf(c) < endOf(clip) - 1e-6).sort((a, b) => endOf(b) - endOf(a))[0];
    const nextOv = others.filter(c => c.start > clip.start + 1e-6 && c.start < endOf(clip) - 1e-6 && endOf(c) > endOf(clip) + 1e-6).sort((a, b) => a.start - b.start)[0];
    const hasIn = (clip.fadeIn || 0) > 0 || !!prevOv, hasOut = (clip.fadeOut || 0) > 0 || !!nextOv;
    const removeFade = (which) => {
        pushUndo();
        if (which === 'in') {
            delete clip.fadeIn; delete clip.fadeInCurve;
            if (prevOv) {   // fondu enchaîné : la région reprend sa place, collée à la précédente
                const cut = Math.min(endOf(prevOv) - clip.start, clip.duration - 0.05);
                clip.start += cut; clip.offset = (clip.offset || 0) + cut; clip.duration -= cut;
            }
        } else {
            delete clip.fadeOut; delete clip.fadeOutCurve;
            if (nextOv) clip.duration = Math.max(0.05, nextOv.start - clip.start);
        }
        renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
        flash(which === 'in' ? 'Fondu d\'entrée supprimé' : 'Fondu de sortie supprimé');
    };
    const fadeItems = [];
    if (!clip.midi || hasIn || hasOut) {
        const first = side === 'in' ? 'in' : 'out';
        const label = (w) => (w === 'in' ? (prevOv ? 'Supprimer le fondu enchaîné (début)' : 'Supprimer le fondu d\'entrée') : (nextOv ? 'Supprimer le fondu enchaîné (fin)' : 'Supprimer le fondu de sortie'));
        const has = { in: hasIn, out: hasOut };
        [first, first === 'in' ? 'out' : 'in'].forEach(w => { if (has[w]) fadeItems.push({ label: label(w), action: () => removeFade(w) }); });
    }

    const acted = () => clipsActedOn(trackIdx, clipIdx);
    const selectThis = () => { if (!(state.selectedClips.size > 1 && state.selectedClips.has(`${trackIdx}:${clipIdx}`))) state.selectedClip = { trackIdx, clipIdx }; };
    const items = [
        clip.midi ? { label: clip.midi.inst === 'drums' ? '🥁 Ouvrir le séquenceur de pas' : '🎹 Ouvrir le piano roll', action: () => openMidiEditor(trackIdx, clipIdx) } : null,
        clip.midi ? { label: '🔗 Dupliquer en lien (les deux restent identiques)', action: () => linkDuplicateMidi(trackIdx, clipIdx) } : null,
        clip.midi ? { label: '⬇ Exporter en fichier .mid', action: () => exportMidiClip(trackIdx, clipIdx) } : null,
        clip.midi && clip.midi.pid ? { label: 'Rendre cette région indépendante', action: () => { pushUndo(); delete clip.midi.pid; renderTimelineTracks(); saveProject(); flash('Cette région n\'est plus liée aux autres'); } } : null,
        (!clip.midi && String(clip.id || '').startsWith('rec_')) ? { label: '🎙 Refaire cette prise', action: () => redoTake(trackIdx, clipIdx) } : null,
        { label: 'Renommer',        action: () => startClipRename(trackIdx, clipIdx) },
        { sep: true },
        { label: 'Édition', children: [
            { label: 'Scinder ici', action: () => splitClipAt(trackIdx, clipIdx, state.playhead) },
            { label: 'Dupliquer', action: () => {
                pushUndo();
                const fullEnd = (clip.loopEnd && clip.loopEnd > clip.start + clip.duration) ? clip.loopEnd : clip.start + clip.duration;
                const copy = { ...JSON.parse(JSON.stringify(clip)), start: fullEnd };    // juste après la région (répétition comprise)
                if (clip.loopEnd) copy.loopEnd = fullEnd + (clip.loopEnd - clip.start);
                state.project.tracks[trackIdx].clips.push(copy);
                carveBehind(state.project.tracks[trackIdx], copy, copy.start, (copy.loopEnd && copy.loopEnd > copy.start + copy.duration) ? copy.loopEnd : copy.start + copy.duration);
                state.project.tracks[trackIdx].clips.sort((a, b) => a.start - b.start);
                state.selectedClip = { trackIdx, clipIdx: state.project.tracks[trackIdx].clips.indexOf(copy) };
                renderTimelineTracks(); saveProject();
            }},
            { label: 'Joindre les régions choisies', action: () => joinSelectedClips(trackIdx, clipIdx) },
            clip.midi ? null : { label: 'Convertir en nouvelle prise (effets, fondus, répétitions compris)', action: () => joinSelectedClips(trackIdx, clipIdx, { single: true }) },
            clip.loopEnd ? null : { label: 'Boucler jusqu\'à la région suivante', action: () => loopClipUntilNext(trackIdx, clipIdx) },
            { label: 'Répéter une fois de plus  (⌘R)', action: () => { state.selectedClip = { trackIdx, clipIdx }; repeatSelectedClip(); } },
            clip.loopEnd ? { label: 'Supprimer la répétition', action: () => { pushUndo(); delete clip.loopEnd; renderTimelineTracks(); saveProject(); } } : null,
            { sep: true },
            { label: 'Couper  (⌘X)', action: () => { selectThis(); cutSelectedClip(); } },
            { label: 'Copier  (⌘C)', action: () => { selectThis(); copySelectedClip(); } },
            { label: 'Coller au curseur  (⌘V)', action: () => pasteClip() },
            { sep: true },
            { label: 'Caler le début sur la grille', action: () => quantizeClipsToGrid(acted()) },
            { label: 'Décaler de −10 ms', action: () => nudgeClipsMs(acted(), -10) },
            { label: 'Décaler de +10 ms', action: () => nudgeClipsMs(acted(), 10) },
            { label: 'Décaler de −1 ms', action: () => nudgeClipsMs(acted(), -1) },
            { label: 'Décaler de +1 ms', action: () => nudgeClipsMs(acted(), 1) },
            { label: 'Caler la boucle sur cette région  (U)', action: () => { state.selectedClip = { trackIdx, clipIdx }; loopFromSelection(); } }
        ]},
        { label: 'Son', children: [
            { label: 'Volume de ce clip…', action: () => openClipGainPanel(trackIdx, clipIdx) },
            { label: 'Monter ce clip au volume maximum', action: () => {
                if (!clip.id) { flash('Le son de ce clip n\'est pas encore chargé — attends une seconde et réessaie'); return; }
                const gain = PulseAudio.computeNormalizeGain(clip.id);
                if (gain === null) { flash('Ce clip est silencieux — il n\'y a rien à monter'); return; }
                pushUndo();
                clip.gain = Math.round(gain * 1000) / 1000;
                renderTimelineTracks(); saveProject();
                flash('✓ Clip monté au volume maximum — ⌘Z pour revenir en arrière');
            }},
            clip.midi ? null : { label: 'Normaliser à −1 dB', action: () => normalizeClipTo(trackIdx, clipIdx, -1) },
            clip.midi ? null : { label: 'Normaliser à −3 dB', action: () => normalizeClipTo(trackIdx, clipIdx, -3) },
            clip.midi ? null : { label: 'Normaliser à −6 dB', action: () => normalizeClipTo(trackIdx, clipIdx, -6) },
            { label: 'Remettre le volume d\'origine', action: () => {
                pushUndo(); delete clip.gain; renderTimelineTracks(); saveProject(); flash('Volume du clip remis comme à l\'origine');
            }},
            clip.midi ? null : { label: clip.rev ? '⏪ Remettre à l\'endroit' : '⏪ Inverser le son (à l\'envers)', action: () => toggleReverse(clip) },
            clip.midi ? null : { label: clip.warp ? '⏱ Warp (modifier ou retirer)…' : '⏱ Caler sur le tempo du projet…', action: () => openWarpPanel(trackIdx, clipIdx, x, y) }
        ]},
        clip.midi ? null : { label: 'Hauteur et vitesse', children: [
            ...[-12, -7, -5, -2, -1, 1, 2, 5, 7, 12].map(v => ({ label: `Transposer de ${v > 0 ? '+' : ''}${v} demi-ton${Math.abs(v) > 1 ? 's' : ''}`, action: () => transposeClips(trackIdx, clipIdx, v) })),
            { label: 'Remettre la hauteur d\'origine', action: () => transposeClips(trackIdx, clipIdx, 0) },
            { sep: true },
            ...[[0.5, '× 0,5 (deux fois plus lent)'], [0.75, '× 0,75'], [0.9, '× 0,9'], [1.1, '× 1,1'], [1.25, '× 1,25'], [1.5, '× 1,5'], [2, '× 2 (deux fois plus vite)']].map(([f, l]) => ({ label: 'Vitesse ' + l, action: () => speedClip(trackIdx, clipIdx, f) }))
        ]},
        { label: 'Fondus', children: [
            ...fadeItems, ...(fadeItems.length ? [{ sep: true }] : []),
            ...[0.01, 0.05, 0.25, 1].map(v => ({ label: `Fondu d'entrée ${v >= 1 ? v + ' s' : Math.round(v * 1000) + ' ms'}`, action: () => setClipFade(trackIdx, clipIdx, 'in', v) })),
            ...[0.01, 0.05, 0.25, 1].map(v => ({ label: `Fondu de sortie ${v >= 1 ? v + ' s' : Math.round(v * 1000) + ' ms'}`, action: () => setClipFade(trackIdx, clipIdx, 'out', v) }))
        ]},
        clip.midi ? null : { label: 'Effets', children: [
            { label: clipHasFx(clip) ? '✦ Effets de la région…' : '✦ Effet sur cette région…', action: () => openClipFxMenu(x, y, trackIdx, clipIdx) },
            clipHasFx(clip) ? { label: 'Retirer les effets de la région', action: () => removeClipFx(clip, null) } : null
        ]},
        { label: 'Réglages', children: [
            { label: clip.muted ? 'Remettre le son du clip' : 'Couper le son du clip', action: () => {
                const all = acted(), m = !clip.muted;
                pushUndo(); all.forEach(c => { c.muted = m; }); renderTimelineTracks(); saveProject();
            }},
            { label: clip.locked ? 'Déverrouiller la région' : 'Verrouiller la région', action: () => toggleClipsLocked(acted()) }
        ]},
        { sep: true },
        { label: 'Supprimer',       action: () => {
            state.selectedClip = { trackIdx, clipIdx };
            deleteSelectedClip();
        }, danger: true },
        { sep: true },
        { label: 'Couleur du clip', submenu: COLORS.map(c => ({
            color: c, action: () => { pushUndo(); clip.color = c; renderTimelineTracks(); saveProject(); }
        }))},
        { label: 'Plus de couleurs…  (⌥C)', action: () => { state.selectedClip = { trackIdx, clipIdx }; openColorPanel(); } }
    ].filter(Boolean);

    items.forEach(item => {
        if (item.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; menu.appendChild(d); return; }
        if (item.children) { ctxAddSubmenu(menu, item); return; }
        if (item.submenu) {
            const lbl = document.createElement('div');
            lbl.className = 'ctx-item-label';
            lbl.textContent = item.label;
            menu.appendChild(lbl);
            const row = document.createElement('div');
            row.className = 'ctx-item ctx-colors';
            item.submenu.forEach(s => {
                const sw = document.createElement('div');
                sw.className = 'ctx-swatch';
                sw.style.background = s.color;
                sw.addEventListener('click', () => { s.action(); menu.remove(); });
                row.appendChild(sw);
            });
            menu.appendChild(row);
            return;
        }
        const el = document.createElement('div');
        el.className = 'ctx-item' + (item.danger ? ' ctx-danger' : '');
        el.textContent = item.label;
        el.addEventListener('click', () => { item.action(); menu.remove(); });
        menu.appendChild(el);
    });

    document.body.appendChild(menu);
    // Garder dans l'écran
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth)  menu.style.left = (x - mr.width) + 'px';
    if (mr.bottom > window.innerHeight) menu.style.top = (y - mr.height) + 'px';

    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 50);
}


// === Icônes des menus clic droit : traits fins aux couleurs de Pulse, à la place des emojis ===
const CTX_ICON_PATHS = {
    pencil: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z"/><path d="M13.5 7.5l3 3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
    scissors: '<circle cx="6" cy="6.5" r="2.6"/><circle cx="6" cy="17.5" r="2.6"/><path d="M8 8l12 9M8 16l12-9"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/>',
    volmax: '<path d="M12 19V6"/><path d="M6.5 11.5L12 6l5.5 5.5"/><path d="M5 3.5h14"/>',
    reset: '<path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9H9"/><path d="M8 5.5l-3.5 4 3.5 4"/>',
    reverse: '<path d="M11 6.5L4 12l7 5.5z"/><path d="M20 6.5L13 12l7 5.5z"/>',
    warp: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4.2l2.8 1.6"/><path d="M9.5 3h5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
    repeat: '<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H18"/><path d="M15 4l3 3-3 3"/><path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6"/><path d="M9 20l-3-3 3-3"/><path d="M3.5 3.5l17 17"/>',
    palette: '<path d="M12 3.5C7 3.5 3.5 7 3.5 11.5S7 20 11 20c1.6 0 2-1 1.5-2-.6-1.3.2-2.5 1.7-2.5H17c2 0 3.5-1.5 3.5-3.5C20.5 7 16.5 3.5 12 3.5z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="7.8" r="1"/><circle cx="16" cy="10.5" r="1"/>',
    piano: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.2 5v14M14.8 5v14"/><path d="M7.5 5v7M12 5v7M16.5 5v7" stroke-width="3"/>',
    drums: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
    upload: '<path d="M12 16V5"/><path d="M7 9.5l5-5 5 5"/><path d="M5 19.5h14"/>',
    plus: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>',
    split: '<path d="M12 3v18" stroke-dasharray="2.5 3"/><path d="M7 8H3.5M7 16H3.5M17 8h3.5M17 16h3.5"/>',
    wave: '<path d="M3 12h2.5l2-6 3 12 3-9 2 5 1.5-2H21"/>',
    dot: '<circle cx="12" cy="12" r="2.2"/>'
};
// [expression sur le texte du menu, icône] : le premier qui correspond gagne
const CTX_ICON_RULES = [
    [/^(🥁|🪘|ouvrir le séquenceur)/i, 'drums'], [/^🎙/, 'mic'], [/^🎵/, 'wave'], [/^(🎹|ouvrir le piano|créer une région)/i, 'piano'],
    [/^(🔗|dupliquer en lien|rendre cette région)/i, 'link'], [/^(⬇|exporter)/i, 'download'], [/^(⬆|importer)/i, 'upload'],
    [/^(🎤|auto-?tune)/i, 'mic'], [/^(⏪|inverser|remettre à l)/i, 'reverse'], [/^(⏱|caler sur|warp)/i, 'warp'],
    [/^renommer/i, 'pencil'], [/^dupliquer/i, 'copy'], [/^couper|^diviser|^scinder/i, 'scissors'],
    [/mute|désactiver mute|^couper le son|muet/i, 'mute'], [/monter ce clip|volume maximum|normalis/i, 'volmax'],
    [/remettre le volume|volume d.origine|valeur d.origine|remettre à/i, 'reset'], [/volume/i, 'volume'],
    [/supprimer la répétition|répétition/i, 'repeat'], [/supprimer|effacer|retirer|vider/i, 'trash'],
    [/couleur/i, 'palette'], [/^(ajouter|nouvelle|nouveau|créer)/i, 'plus'], [/fusion|fusionner|rassembler/i, 'wave']
];
function ctxIconSvg(name) {
    return `<svg class="ctx-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CTX_ICON_PATHS[name] || CTX_ICON_PATHS.dot}</svg>`;
}
function decorateCtxMenu(menu) {
    if (!menu || menu.classList.contains('mic-menu') || menu.dataset.iconed) return;
    menu.dataset.iconed = '1';
    menu.querySelectorAll('.ctx-item').forEach(el => {
        if (el.classList.contains('ctx-colors') || el.children.length || el.dataset.noIcon != null) return;
        const raw = el.textContent;
        if (!raw.trim()) return;
        let name = 'dot';
        for (const [re, ic] of CTX_ICON_RULES) { if (re.test(raw.trim())) { name = ic; break; } }
        const clean = raw.replace(/^[\s←-⯿⏩-⏿\u{1F300}-\u{1FAFF}️]+/u, '').trim() || raw.trim();
        el.textContent = '';
        const ic = document.createElement('span'); ic.className = 'ctx-ic-wrap'; ic.innerHTML = ctxIconSvg(name);
        const tx = document.createElement('span'); tx.className = 'ctx-tx'; tx.textContent = clean;
        el.append(ic, tx);
        el.classList.add('has-icon');
    });
}
new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(n => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('track-ctx-menu')) decorateCtxMenu(n);
    });
}).observe(document.body, { childList: true });

// --- Events pistes ---
function bindTrackEvents() {
    bindTrackResize();
    bindGroupResize();
    // Drag depuis n'importe où sur la piste + clic pour sélectionner
    document.querySelectorAll('.track-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.t-mini, .t-knob, .t-vol, .takes-toggle')) return;
            if (e.target.closest('.track-name.editing')) return;

            const fromIdx = parseInt(el.dataset.i);
            if (state.project.tracks[fromIdx]?.isCapture) return;

            const list = document.getElementById('tracksList');
            const indicator = document.createElement('div');
            indicator.className = 'track-drop-indicator';
            let insertBefore = fromIdx;
            let didDrag = false;
            const startY = e.clientY;

            const getItems = () => [...list.querySelectorAll('.track-item')];

            const onMove = (ev) => {
                if (!didDrag && Math.abs(ev.clientY - startY) < 6) return;
                didDrag = true;
                document.body.classList.add('is-dragging');
                const items = getItems();
                insertBefore = items.length;
                for (let i = 0; i < items.length; i++) {
                    const r = items[i].getBoundingClientRect();
                    if (ev.clientY < r.top + r.height / 2) { insertBefore = i; break; }
                }
                if (state.project.tracks[0]?.isCapture && insertBefore === 0) insertBefore = 1;
                const listRect = list.getBoundingClientRect();
                if (insertBefore < items.length) {
                    indicator.style.top = (items[insertBefore].getBoundingClientRect().top - listRect.top - 2) + 'px';
                } else {
                    indicator.style.top = (items[items.length - 1].getBoundingClientRect().bottom - listRect.top + 2) + 'px';
                }
                if (!indicator.parentNode) list.appendChild(indicator);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                indicator.remove();
                document.body.classList.remove('is-dragging');
                if (didDrag) {
                    if (insertBefore !== fromIdx && insertBefore !== fromIdx + 1) {
                        pushUndo();
                        const tracks = state.project.tracks;
                        const moved = tracks.splice(fromIdx, 1)[0];
                        const insertAt = insertBefore > fromIdx ? insertBefore - 1 : insertBefore;
                        tracks.splice(insertAt, 0, moved);
                        if (state.selectedTrack === fromIdx) state.selectedTrack = insertAt;
                        state.selectedTracks = new Set();
                        // Comme Logic : la piste passe par le groupe sous lequel elle est posée (entre ses pistes ou juste en dessous) ;
                        // posée entre des pistes seules, elle sort de son groupe.
                        const prev = tracks[insertAt - 1], next = tracks[insertAt + 1];
                        const oldBus = trackGroup(moved);
                        let dest = null;
                        if (next && trackGroup(next)) dest = next.output;
                        else if (prev && trackGroup(prev)) dest = prev.output;
                        else if (oldBus) dest = oldBus.output || 'master';
                        let msg = null;
                        if (dest && dest !== moved.output) {
                            moved.output = dest;
                            const nb = busById(dest);
                            if (nb) nb.collapsed = false;
                            msg = nb && isVisibleGroup(nb) ? `« ${moved.name} » est dans « ${nb.name} » : son son passe par ce groupe` : `« ${moved.name} » sortie du groupe`;
                            if (oldBus && oldBus.isGroup && oldBus.id !== dest && !tracks.some(x => x.output === oldBus.id) && !groupChildren(oldBus).length) {
                                state.project.buses = state.project.buses.filter(b2 => b2 !== oldBus);
                            }
                            refreshPlaybackSoon();
                        }
                        renderAll();
                        saveProject();
                        if (msg) flash(msg);
                    }
                } else {
                    const isMac = /Mac/i.test(navigator.platform);
                    const cmd = e.metaKey || (!isMac && e.ctrlKey);
                    if (e.shiftKey) {
                        // Tout, de la piste choisie jusqu'à celle-ci (la piste choisie reste l'ancre)
                        const a = state.selectedTrack, lo = Math.min(a, fromIdx), hi = Math.max(a, fromIdx);
                        state.selectedTracks = new Set();
                        for (let k = lo; k <= hi; k++) state.selectedTracks.add(k);
                    } else if (cmd) {
                        // Ajoute (ou retire) cette piste de la sélection
                        const cur = new Set(selectedTrackIdxs());
                        if (cur.has(fromIdx) && cur.size > 1) {
                            cur.delete(fromIdx);
                            if (state.selectedTrack === fromIdx) state.selectedTrack = [...cur][0];
                        } else { cur.add(fromIdx); state.selectedTrack = fromIdx; }
                        state.selectedTracks = cur;
                    } else {
                        state.selectedTrack = fromIdx;
                        state.selectedTracks = new Set();
                    }
                    dropStaleClipSelection();
                    renderTracksPanel();
                    bindTrackEvents();
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });

    // Clic droit sur une piste → menu contextuel
    document.querySelectorAll('.track-item').forEach(el => {
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const idx = parseInt(el.dataset.i);
            const t = state.project.tracks[idx];
            if (!t) return;
            openTrackContextMenu(e.clientX, e.clientY, idx, t);
        });
    });

    document.querySelectorAll('.track-name[contenteditable="true"]').forEach(el => {
        // Un clic sélectionne la piste ; il faut un double-clic (ou « Renommer ») pour changer le nom
        // (le 2e appui est détecté sur le mousedown : la liste est redessinée entre les deux clics, le « dblclick » natif se perdrait)
        const startEdit = () => { el.classList.add('editing'); el.focus(); document.execCommand('selectAll'); };
        el.addEventListener('mousedown', (e) => {
            if (el.classList.contains('editing')) return;
            e.preventDefault();
            if (e.detail >= 2) startEdit();
        });
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); if (!el.classList.contains('editing')) startEdit(); });
        el.addEventListener('blur', () => {
            el.classList.remove('editing');
            const i = parseInt(el.dataset.i);
            // On ne prend que les nodes de texte directs (le chip LIVE est dans un span contenteditable=false)
            let txt = '';
            el.childNodes.forEach(n => {
                if (n.nodeType === Node.TEXT_NODE) txt += n.textContent;
            });
            txt = txt.replace(/\s+LIVE\s*$/i, '').trim();
            const newName = txt || `Piste ${i + 1}`;
            if (state.project.tracks[i].name !== newName) pushUndo();
            state.project.tracks[i].name = newName;
            saveProject();
            renderMixer();
            renderTracksPanel();
            bindTrackEvents();
        });
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        });
    });

    // Bouton × supprimer piste
    document.querySelectorAll('.m-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.del);
            state.selectedTrack = i;
            deleteSelectedTrack();
        });
    });

    // Volume directement sur la piste (le même réglage que le fader de gauche et le mixeur)
    document.querySelectorAll('.t-vol').forEach(sl => {
        const i = parseInt(sl.dataset.i);
        let undoPushed = false;
        sl.style.setProperty('--fill', sl.value + '%');
        sl.addEventListener('input', () => sl.style.setProperty('--fill', sl.value + '%'));
        ['mousedown', 'click', 'dblclick'].forEach(n => sl.addEventListener(n, (e) => e.stopPropagation()));
        sl.addEventListener('input', () => {
            const t = state.project.tracks[i]; if (!t) return;
            if (!undoPushed) { pushUndo(); undoPushed = true; }
            const v = posToVol(parseFloat(sl.value));
            const prevV = t.volume ?? 100;
            t.volume = v;
            PulseAudio.updateTrackVolume(i, v);
            followSelectedVolume(i, prevV, v);
            sl.dataset.tooltip = `Volume : ${volumeToDb(v)} dB (⌘ + clic = 0 dB, double-clic = écrire la valeur)`;
            syncInspectorVolume(i);
        });
        sl.addEventListener('change', () => { undoPushed = false; saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
        sl.addEventListener('dblclick', (e) => { if (!e.metaKey && !e.ctrlKey) openValueEntry(sl); });   // double-clic = écrire le niveau (⌘ + clic = 0 dB)
    });

    // Gauche / droite directement sur la piste : bouton rond (glisser, molette, double-clic = centre)
    document.querySelectorAll('.t-knob').forEach(el => {
        const i = parseInt(el.dataset.i);
        const paint = (v) => {
            el.dataset.pan = v; el.setAttribute('aria-valuenow', v);
            el.innerHTML = panKnobSvg(v);
            el.dataset.tooltip = panTip(v);
        };
        const apply = (v, persist) => {
            const t = state.project.tracks[i]; if (!t) return;
            v = Math.max(-100, Math.min(100, Math.round(v)));
            t.pan = v; paint(v);
            PulseAudio.updateTrackPan(i, v);
            syncTrackPan(i);
            if (persist) {
                saveProject();
                if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }   // même réglage dans le mixer
            }
        };
        let badge = null;
        const showBadge = (v) => {
            if (!badge) { badge = document.createElement('div'); badge.className = 'knob-badge'; document.body.appendChild(badge); }
            const r = el.getBoundingClientRect();
            badge.textContent = panLabel(v);
            badge.style.left = (r.left + r.width / 2) + 'px'; badge.style.top = (r.top - 6) + 'px';
        };
        const hideBadge = () => { if (badge) { badge.remove(); badge = null; } };
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const t = state.project.tracks[i]; if (!t) return;
            const sx = e.clientX, sy = e.clientY, v0 = t.pan || 0;
            let moved = false;
            document.body.classList.add('resizing-col');
            const move = (ev) => {
                // Droite ou haut = vers la droite ; Shift = réglage fin
                const d = (ev.clientX - sx) - (ev.clientY - sy);
                if (!moved && Math.abs(d) < 2) return;
                if (!moved) { pushUndo(); moved = true; }
                apply(v0 + d * (ev.shiftKey ? 0.25 : 1), false);
                showBadge(state.project.tracks[i].pan || 0);
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.body.classList.remove('resizing-col');
                hideBadge();
                if (moved) apply(state.project.tracks[i].pan || 0, true);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); pushUndo(); apply(0, true); flash('Gauche / droite : centre'); });
        el.addEventListener('click', (e) => e.stopPropagation());
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const t = state.project.tracks[i]; if (!t) return;
            apply((t.pan || 0) + (e.deltaY < 0 ? 2 : -2), true);
        }, { passive: false });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault(); e.stopPropagation();
            const t = state.project.tracks[i]; if (!t) return;
            apply((t.pan || 0) + (e.key === 'ArrowRight' ? 5 : -5), true);
        });
    });

    document.querySelectorAll('.t-mini').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const i = parseInt(el.dataset.i);
            const flag = el.dataset.flag;
            const t = state.project.tracks[i];
            if (!t) return;

            if (flag === 'rec' && (t.type === 'keys' || t.type === 'drums')) {
                flash('Cette piste joue des notes : pour enregistrer ta voix, ajoute une piste « Ma voix » avec le bouton +');
                return;
            }

            if (flag === 'mute') { t.muted = !t.muted; PulseAudio.refreshAudibility(state.project); }
            if (flag === 'solo') { toggleSolo(i, e.metaKey || e.ctrlKey); return; }
            if (flag === 'rec')  { if (t.armed) t.armed = false; else armTrackExclusive(i); }
            if (flag === 'mon') {
                toggleTrackMonitor(t);
                const on = trackMonitored(t);
                el.classList.toggle('active', on);
                syncMonitor();
                saveProject();
                if (!on) flash('Retour casque coupé sur cette piste');
                else if (!PulseAudio.isMonitorOn()) flash('Active « M\'entendre dans le casque par Pulse » dans les Réglages');
                else flash('🎧 Tu t\'entends dans le casque');
                renderTracksPanel(); bindTrackEvents();
                return;
            }

            if (flag === 'rec') { el.classList.toggle('active'); syncMonitor(); renderTracksPanel(); bindTrackEvents(); }
            else el.classList.toggle('active');
            saveProject();
        });
    });
}

// === Interactions timeline (clic zone vide, drag clip, sélection plage) ===
function bindTimelineClick() {
    const timeline = document.querySelector('.timeline');
    const ruler = document.getElementById('timelineRuler');
    const tracks = document.getElementById('timelineTracks');

    // Convertit un event en seconde dans la timeline (compense scroll)
    const eventToTime = (e) => {
        const rect = timeline.getBoundingClientRect();
        return Math.max(0, (e.clientX - rect.left + timeline.scrollLeft) / state.pxPerSecond);
    };

    // Une piste est coupée en deux : moitié basse = curseur (pose le point de départ), moitié haute = sélection (le retire)
    const placeOrSelect = (e) => {
        const tr = e.target.closest && e.target.closest('.timeline-track');
        if (tr) { const r = tr.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { clearPlayBase(); return; } }
        setPlayheadFromEvent(e);
    };
    const setPlayheadFromEvent = (e) => {
        state.baseCleared = false;   // placer le curseur = poser un point de départ
        // Le curseur se cale sur la grille comme les clips (Shift = placement libre)
        state.playhead = snapPlayheadToEdges(snapTime(eventToTime(e), e.shiftKey), e.shiftKey);
        state.userBaseSec = state.playhead;
        if (state.playing) {
            state.playOrigin = state.playhead;
            state.startTime = performance.now() - state.playhead * 1000;
        }
        updatePlayhead();
        updateChrono();
    };

    let _zoomAcc = { h: 1, sec: 0, raf: 0 };
    // --- Zoom Cmd+scroll / Option+scroll / Opt+Cmd+scroll (style Logic) ---
    const handleZoomWheel = (e) => {
        const hZoom = e.metaKey || e.ctrlKey;
        const vZoom = e.altKey;
        if (!hZoom && !vZoom) return;
        e.preventDefault();
        suspendFollow();
        if (hZoom) {
            // Molette : comme E / Z, le zoom se cale sur le curseur (de base si tu as cliqué), au milieu de l'écran
            _ptr.x = e.clientX; _ptr.y = e.clientY;
            const zt = zoomTarget(); _zoomAcc.sec = zt.sec; _zoomAcc.center = zt.center;
            _zoomAcc.h *= Math.pow(1.15, Math.max(-1, Math.min(1, -e.deltaY / 100)));
        } else {
            heightWheel(e);
        }
        if (_zoomAcc.h !== 1 && !_zoomAcc.raf) _zoomAcc.raf = requestAnimationFrame(() => {
            const a = _zoomAcc; _zoomAcc = { h: 1, sec: 0, raf: 0 };
            if (a.h !== 1) setZoom(state.pxPerSecond * a.h, a.sec, a.center !== false);
        });
    };
    timeline.addEventListener('wheel', handleZoomWheel, { passive: false });
    timeline.addEventListener('wheel', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (Math.abs(e.deltaX) > 0 || e.shiftKey) suspendFollow();
    }, { passive: true });

    // --- Règle, façon Logic : la bande du haut est la boucle (cycle), le reste déplace le curseur ---
    const CYCLE_STRIP_H = 10;
    ruler.addEventListener('mousemove', (e) => {
        const inStrip = e.clientY - ruler.getBoundingClientRect().top < CYCLE_STRIP_H;
        let c = 'crosshair';
        if (inStrip) {
            c = 'pointer';
            if (state.loop) {
                const la = Math.min(state.loop.start, state.loop.end), lb = Math.max(state.loop.start, state.loop.end), t = eventToTime(e), edge = 8 / state.pxPerSecond;
                if (Math.abs(t - la) <= edge || Math.abs(t - lb) <= edge) c = 'ew-resize';
            }
        }
        ruler.style.cursor = c;
        ruler.setAttribute('data-tooltip', inStrip ? 'Boucle : glisse pour la dessiner, clique dessus pour l\'allumer ou l\'éteindre (touche C)' : '');
    });
    ruler.addEventListener('mousedown', (e) => {
        e.preventDefault(); // empêche la sélection de texte sur les labels
        if (e.altKey) return startLoopSelection(e, eventToTime);
        // Bande de boucle (les 10 px du haut de la règle, comme la barre du cycle de Logic) : glisser = créer la boucle,
        // sur une boucle existante : le milieu la déplace, un bord l'étire, un clic l'allume / l'éteint
        if (e.clientY - ruler.getBoundingClientRect().top < CYCLE_STRIP_H) {
            if (state.loop) {
                const la = Math.min(state.loop.start, state.loop.end), lb = Math.max(state.loop.start, state.loop.end);
                const t = eventToTime(e), edge = 8 / state.pxPerSecond;
                if (t >= la - edge && t <= lb + edge) return editLoopRegion(e, eventToTime, Math.abs(t - la) <= edge ? 'left' : Math.abs(t - lb) <= edge ? 'right' : 'move');
            }
            return startLoopSelection(e, eventToTime);
        }
        // Reste de la règle : un clic ou un glissé déplace le curseur
        setPlayheadFromEvent(e);
        const onMove = (ev) => setPlayheadFromEvent(ev);
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // --- Smart Tool : cursor qui change selon la zone du clip ---
    tracks.addEventListener('mousemove', (e) => {
        const clipEl = e.target.closest('.clip');
        // Moitié haute d'une piste = flèche (sélection), moitié basse = croix (curseur)
        const rowEl = e.target.closest('.timeline-track');
        const rowRect = rowEl ? rowEl.getBoundingClientRect() : null;
        const lowerHalf = rowRect ? e.clientY >= rowRect.top + rowRect.height / 2 : true;
        if (rowEl) rowEl.style.cursor = lowerHalf ? 'crosshair' : 'default';
        if (!clipEl) return;
        // Pas de curseur spécial sur un clip en enregistrement
        const _cii = parseInt(clipEl.dataset.ci);
        const _tt = e.target.closest('.timeline-track');
        if (_tt) {
            const _c = state.project.tracks[parseInt(_tt.dataset.i)]?.clips[_cii];
            if (_c?.recording) { clipEl.style.cursor = ''; return; }
        }
        const rect = clipEl.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const relY = e.clientY - rect.top;
        const edgeZone = 7;   // même largeur que le clic (étirer la région)
        // Zone fade = top 45% du clip, 30% de la largeur ou 36px min
        const fadeZone = Math.min(32, rect.width * 0.3);   // petite zone fixe en pixels (comme .clip-fade-zone en CSS)
        const inTopHalf = relY < rect.height * 0.45;

        // Bords = étirer ; coins hauts = fondu ; poignée bas-droite = répéter
        if (e.target.closest('[data-loop-handle]'))          { clipEl.style.cursor = 'e-resize'; clipEl.title = 'Répéter le clip'; }
        else if (relX < edgeZone || relX > rect.width - edgeZone){ clipEl.style.cursor = 'var(--cur-trim)'; }
        else if (inTopHalf && (relX < fadeZone || relX > rect.width - fadeZone)) { clipEl.style.cursor = relX < fadeZone ? 'var(--cur-fade)' : 'var(--cur-fade-out)'; }
        else { clipEl.style.cursor = lowerHalf ? 'crosshair' : 'default'; clipEl.title = ''; }
    });
    tracks.addEventListener('mouseleave', (e) => {
        const clipEl = e.target.closest('.clip');
        if (clipEl) clipEl.style.cursor = '';
    });

    // Double-clic sur une région audio : la scinder là où on clique (sur son nom : la renommer).
    // Détecté dès le 2e appui (mousedown) car la liste est redessinée entre les deux clics et le « dblclick » natif se perdrait.
    let _dblAt = 0;
    const clipDouble = (e, trackIdx, clipIdx, immediate = false) => {
        if (performance.now() - _dblAt < 500) return;
        _dblAt = performance.now();
        const mc = state.project.tracks[trackIdx]?.clips[clipIdx];
        if (!mc || mc.recording) return;
        if (e.target.closest('.clip-name')) { startClipRename(trackIdx, clipIdx); return; }
        const cut = (at) => splitClipAt(trackIdx, clipIdx, at);
        if (immediate) { cut(snapTime(eventToTime(e), e.metaKey || e.ctrlKey)); return; }
        // Comme Logic : 1er clic, 2e clic ; on garde le bouton enfoncé pour choisir l'endroit, la coupe se fait au relâché
        const trackEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"]`);
        const line = document.createElement('div');
        line.className = 'split-line';
        if (trackEl) trackEl.appendChild(line);
        let at = snapTime(eventToTime(e), e.metaKey || e.ctrlKey);
        let rawAt = at;
        const lo = mc.start + 0.02, hi = mc.start + mc.duration - 0.02;
        const place = () => {
            at = Math.max(lo, Math.min(hi, at));
            line.style.left = (at * state.pxPerSecond) + 'px';
        };
        const looped = mc.loopEnd && mc.loopEnd > mc.start + mc.duration + 1e-6;
        if (looped) { flash('Cette région est répétée : supprime sa répétition (clic droit) avant de la scinder'); return; }
        place();
        document.body.classList.add('is-splitting');
        const onMove = (ev) => { at = snapTime(eventToTime(ev), ev.metaKey || ev.ctrlKey); rawAt = at; place(); };
        const finish = (doCut) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('keydown', onKey, true);
            document.body.classList.remove('is-splitting');
            line.remove();
            if (doCut) {
                // relâché loin de la région : on annule plutôt que de laisser une miette
                const raw = rawAt;
                if (raw < lo - 0.25 || raw > hi + 0.25) { flash('Coupe annulée : relâche sur la région'); return; }
                cut(at);
            }
        };
        const onUp = () => finish(true);
        const onKey = (ke) => { if (ke.key === 'Escape') { ke.preventDefault(); ke.stopPropagation(); finish(false); flash('Coupe annulée'); } };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('keydown', onKey, true);
    };
    // Double-click sur un clip → rename inline
    tracks.addEventListener('dblclick', (e) => {
        const handleEl = e.target.closest('.fade-curve-handle');
        if (handleEl) {
            const tEl = e.target.closest('.timeline-track'), cEl = e.target.closest('.clip');
            const cl = tEl && cEl && state.project.tracks[parseInt(tEl.dataset.i)]?.clips[parseInt(cEl.dataset.ci)];
            if (cl) { pushUndo(); delete cl[handleEl.dataset.fade === 'in' ? 'fadeInCurve' : 'fadeOutCurve']; saveProject(); refreshPlaybackSoon(); renderTimelineTracks(); flash('Fondu droit'); }
            return;
        }
        const clipEl = e.target.closest('.clip');
        const trackEl = e.target.closest('.timeline-track');
        if (!trackEl) return;
        const trackIdx = parseInt(trackEl.dataset.i);
        if (!clipEl) {   // double-clic dans le vide d'une piste instrument / batterie : nouvelle région (comme Logic)
            const tr = state.project.tracks[trackIdx];
            if (tr && (tr.type === 'keys' || tr.type === 'drums') && !e.target.closest('.instru-dropzone')) createMidiClip(trackIdx, eventToTime(e));
            return;
        }
        const clipIdx = parseInt(clipEl.dataset.ci);
        const mc = state.project.tracks[trackIdx]?.clips[clipIdx];
        if (mc && mc.midi) { openMidiEditor(trackIdx, clipIdx); return; }
        clipDouble(e, trackIdx, clipIdx, true);
    });

    // Clic droit sur un clip → menu contextuel
    tracks.addEventListener('contextmenu', (e) => {
        const clipEl = e.target.closest('.clip');
        e.preventDefault();
        if (mouseTool('right') === 'toolmenu') return;   // le menu des outils s'est ouvert au mousedown
        const trackEl = e.target.closest('.timeline-track');
        if (!trackEl) return;
        const trackIdx = parseInt(trackEl.dataset.i);
        if (clipEl && !e.target.closest('.instru-dropzone')) {
            const clipIdx = parseInt(clipEl.dataset.ci);
            const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
            if (!clip || clip.recording) return;
            if (mouseTool('right') !== 'menu') return;   // le clic droit est un outil (voir mousedown)
            openClipContextMenu(e.clientX, e.clientY, trackIdx, clipIdx);
        } else {
            openTimelineEmptyContextMenu(e.clientX, e.clientY, trackIdx, eventToTime(e));
        }
    });

    // --- Tracks area : 3 comportements ---
    tracks.addEventListener('mousedown', (e) => {
        const clipEl = e.target.closest('.clip');
        const trackEl = e.target.closest('.timeline-track');

        // Clic droit sur une région : l'outil choisi dans Réglages (volume par défaut)
        if (e.button === 2) {
            if (mouseTool('right') === 'toolmenu') { e.preventDefault(); openToolMenu('left', e.clientX, e.clientY); return; }
            if (clipEl && trackEl && !e.target.closest('.instru-dropzone')) {
                const tool = mouseTool('right');
                if (tool !== 'menu') {
                    const ti = parseInt(trackEl.dataset.i), ci = parseInt(clipEl.dataset.ci);
                    if (tool === 'none') return;
                    e.preventDefault();
                    runClipTool(tool, e, ti, ci, eventToTime, true);
                }
            }
            return;
        }

        if (trackEl) {
            const trackIdx = parseInt(trackEl.dataset.i);
            if (trackIdx !== state.selectedTrack) {
                state.selectedTrack = trackIdx;
                renderTracksPanel();
                bindTrackEvents();
            }
            if (clipEl && e.button === 0 && e.detail >= 2 && !e.target.closest('.instru-dropzone, .fade-curve-handle, .fade-handle')) {
                const dc = state.project.tracks[trackIdx]?.clips[parseInt(clipEl.dataset.ci)];
                if (dc && !dc.midi && !dc.recording) {
                    e.preventDefault();
                    clipDouble(e, trackIdx, parseInt(clipEl.dataset.ci));
                    return;
                }
                // Région de notes : le 2e appui rouvre l'éditeur (le « dblclick » natif se perd, la liste est redessinée entre les deux clics)
                if (dc && dc.midi && !dc.recording) { e.preventDefault(); openMidiEditor(trackIdx, parseInt(clipEl.dataset.ci)); return; }
            }

            if (clipEl) {
                const _ci = parseInt(clipEl.dataset.ci);
                const _clip = state.project.tracks[trackIdx]?.clips[_ci];
                // Clip en cours d'enregistrement → ne pas interagir, laisser placer le curseur
                if (_clip && !_clip.recording) {
                    // ⌘ + clic : l'outil choisi dans Réglages (muter la région par défaut)
                    const cmdTool = mouseTool('cmd');
                    if (e.metaKey && !e.shiftKey && cmdTool !== 'none' && !e.target.closest('.clip-fade-zone, .fade-curve-handle, [data-loop-handle]')) {
                        if (cmdTool !== 'pointer') {
                            e.preventDefault();
                            if (runClipTool(cmdTool, e, trackIdx, _ci, eventToTime, false) !== false) return;
                        }
                    }
                    // Clic normal avec un autre outil que le Pointeur (le Ciseau garde son geste plus bas)
                    const leftTool = mouseTool('left');
                    if (!e.metaKey && !e.shiftKey && !['pointer', 'cut', 'pencil'].includes(leftTool) && !e.target.closest('.fade-curve-handle, [data-loop-handle]')) {
                        e.preventDefault();
                        if (runClipTool(leftTool, e, trackIdx, _ci, eventToTime, false) !== false) return;
                    }
                    // Shift+click → multi-sélection
                    if (e.shiftKey && !e.target.closest('.clip-fade-zone') && !e.target.closest('[data-loop-handle]')) {
                        const key = `${trackIdx}:${_ci}`;
                        e.preventDefault();
                        // Shift + clic = ajouter / retirer la région ; Shift + glisser = sélectionner une plage (même au-dessus d'une région)
                        const sx = e.clientX, sy = e.clientY;
                        const onMv = (ev) => {
                            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
                            document.removeEventListener('mousemove', onMv);
                            document.removeEventListener('mouseup', onUpShift);
                            startRangeSelection(e, eventToTime);
                            // le geste continue : on rejoue la position actuelle dans la sélection de plage
                            document.dispatchEvent(new MouseEvent('mousemove', { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }));
                        };
                        const onUpShift = () => {
                            document.removeEventListener('mousemove', onMv);
                            document.removeEventListener('mouseup', onUpShift);
                            // La région déjà choisie fait partie de la sélection (Shift + clic AJOUTE, ne remplace pas)
                            if (state.selectedClips.size === 0 && state.selectedClip) {
                                state.selectedClips.add(`${state.selectedClip.trackIdx}:${state.selectedClip.clipIdx}`);
                            }
                            if (state.selectedClips.has(key)) {
                                state.selectedClips.delete(key);
                            } else {
                                state.selectedClips.add(key);
                                state.selectedClip = { trackIdx, clipIdx: _ci };
                            }
                            renderTimelineTracks();
                        };
                        document.addEventListener('mousemove', onMv);
                        document.addEventListener('mouseup', onUpShift);
                        return;
                    }
                    // Click normal → efface la multi-sélection
                    // (une région qui fait déjà partie de la sélection la garde : on peut alors tout déplacer d'un coup)
                    if (!e.shiftKey && !(state.selectedClips.size > 1 && state.selectedClips.has(`${trackIdx}:${_ci}`))) state.selectedClips.clear();
                    // Outil ciseau
                    if (state.tool === 'scissors') {
                        splitClipAt(trackIdx, _ci, eventToTime(e));
                        return;
                    }
                    // Poignée d'arrondi du fondu
                    const curveHandle = e.target.closest('.fade-curve-handle');
                    if (curveHandle) return startFadeCurveDrag(e, curveHandle.dataset.fade, trackIdx, _ci);
                    const rect = clipEl.getBoundingClientRect();
                    const relX = e.clientX - rect.left;
                    const relY = e.clientY - rect.top;
                    // Poignée de répétition (coin bas-droit) : seulement sur la poignée elle-même
                    if (e.target.closest('[data-loop-handle]')) return startLoopDrag(e, clipEl, trackIdx, _ci);
                    // Bords gauche et droit : étirer / rétrécir la région (prioritaire sur les fondus, des deux côtés pareil)
                    const edge = 7;
                    if (relX < edge) return startClipTrim(e, clipEl, trackIdx, _ci, 'left');
                    if (relX > rect.width - edge) return startClipTrim(e, clipEl, trackIdx, _ci, 'right');
                    // Fondu (zone haute) : il ne démarre que si on glisse. Un simple clic choisit la région, comme ailleurs.
                    const fadeZoneEl = e.target.closest('.clip-fade-zone');
                    const fadeZone = Math.min(32, rect.width * 0.3);   // petite zone fixe en pixels (comme .clip-fade-zone en CSS)
                    const inTopHalf = relY < rect.height * 0.45;
                    const fadeDir = fadeZoneEl ? fadeZoneEl.dataset.fade
                        : (inTopHalf && relX < fadeZone ? 'in' : (inTopHalf && relX > rect.width - fadeZone ? 'out' : null));
                    if (fadeDir) {
                        const sx0 = e.clientX, sy0 = e.clientY;
                        e.preventDefault();
                        const onMv = (ev) => {
                            if (Math.hypot(ev.clientX - sx0, ev.clientY - sy0) < 4) return;
                            document.removeEventListener('mousemove', onMv);
                            document.removeEventListener('mouseup', onUpF);
                            startFadeDrag(e, fadeDir, trackIdx, _ci);
                            document.dispatchEvent(new MouseEvent('mousemove', { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }));
                        };
                        const onUpF = () => {
                            document.removeEventListener('mousemove', onMv);
                            document.removeEventListener('mouseup', onUpF);
                            placeOrSelect(e);
                            startClipDrag(e, clipEl, trackIdx);
                            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        };
                        document.addEventListener('mousemove', onMv);
                        document.addEventListener('mouseup', onUpF);
                        return;
                    }
                    // Moitié basse d'une région : comme dans le vide. Un clic pose le curseur (et choisit la région),
                    // clic enfoncé + glisser = sélection d'une plage. Moitié haute : on attrape la région pour la déplacer.
                    // (dans une plage déjà choisie, on garde le geste habituel : glisser déplace toute la plage)
                    const inRange = (() => { const sl = state.selection; if (!sl) return false;
                        const tt = eventToTime(e), a0 = Math.min(sl.start, sl.end), b0 = Math.max(sl.start, sl.end);
                        return tt >= a0 && tt <= b0 && (!sl.tracks || (trackIdx >= sl.tracks[0] && trackIdx <= sl.tracks[1])); })();
                    if (relY >= rect.height / 2 && !e.altKey && !inRange) {
                        placeOrSelect(e);
                        const sx0 = e.clientX, sy0 = e.clientY;
                        const onMvL = (ev) => {
                            if (Math.hypot(ev.clientX - sx0, ev.clientY - sy0) < 4) return;
                            document.removeEventListener('mousemove', onMvL); document.removeEventListener('mouseup', onUpL);
                            if (state.selection) clearRangeSelection();
                            state.selectedClip = null; state.selectedClips.clear();
                            document.querySelectorAll('.clip.is-selected').forEach(x => x.classList.remove('is-selected'));
                            startRangeSelection(e, eventToTime);
                            document.dispatchEvent(new MouseEvent('mousemove', { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }));
                        };
                        const onUpL = () => {
                            document.removeEventListener('mousemove', onMvL); document.removeEventListener('mouseup', onUpL);
                            if (state.selection) clearRangeSelection();
                            state.selectedClip = { trackIdx, clipIdx: _ci };
                            document.querySelectorAll('.clip.is-selected').forEach(x => x.classList.remove('is-selected'));
                            clipEl.classList.add('is-selected');
                        };
                        document.addEventListener('mousemove', onMvL); document.addEventListener('mouseup', onUpL);
                        return;
                    }
                    // Moitié haute : outil de sélection (retire le point de départ) et déplacement de la région
                    placeOrSelect(e);
                    return startClipDrag(e, clipEl, trackIdx);
                }
            }
            if (e.shiftKey) {
                return startRangeSelection(e, eventToTime);
            }
        }

        // Outils du clic normal dans le vide (comme Logic) : Marquee = plage partout, Crayon = région de notes, Loupe = zoom
        if (trackEl && e.button === 0 && !e.metaKey && !e.shiftKey) {
            const lt = mouseTool('left');
            if (lt === 'marquee') {
                if (state.selection) clearRangeSelection();
                state.selectedClip = null; state.selectedClips = new Set();
                document.querySelectorAll('.clip.is-selected').forEach(x => x.classList.remove('is-selected'));
                return startRangeSelection(e, eventToTime);
            }
            if (lt === 'zoom') { e.preventDefault(); suspendFollow(); setZoom(e.altKey ? state.pxPerSecond / 1.5 : state.pxPerSecond * 1.5, eventToTime(e)); return; }
            if (lt === 'pencil') {
                const ti = parseInt(trackEl.dataset.i), tr = state.project.tracks[ti];
                if (tr && (tr.type === 'keys' || tr.type === 'drums') && !e.target.closest('.instru-dropzone')) { e.preventDefault(); createMidiClip(ti, snapTime(eventToTime(e), false)); return; }
            }
        }

        // Moitié haute d'une piste, dans le vide : comme l'outil Pointeur de Logic, glisser trace un cadre
        // qui sélectionne les régions touchées en entier. Moitié basse : sélection d'une plage (zone Marquee de Logic).
        if (trackEl && e.button === 0 && !e.altKey && !e.shiftKey) {
            const trR = trackEl.getBoundingClientRect();
            if (e.clientY - trR.top < trR.height / 2) {
                if (state.selection) clearRangeSelection();
                deselectTracksByTimelineClick();
                placeOrSelect(e);
                return startRegionLasso(e);
            }
        }
        // Tout en bas, sous la dernière piste (hors piste) : comme Logic, c'est le Pointeur → cadre de sélection des régions
        // (un simple clic désélectionne tout sans bouger le curseur)
        if (!trackEl && e.button === 0 && !e.altKey && !e.shiftKey && !e.metaKey && mouseTool('left') !== 'marquee' && !e.target.closest('.empty-cta')) {
            if (state.selection) clearRangeSelection();
            deselectTracksByTimelineClick();
            return startRegionLasso(e);
        }

        // Clic sur zone vide → place le curseur + efface la sélection ;
        // clic enfoncé et glissé → on choisit une plage (visible seulement sur les pistes survolées), Suppr l'efface
        if (state.selection) clearRangeSelection();
        deselectTracksByTimelineClick();
        placeOrSelect(e);
        const sx = e.clientX, sy = e.clientY;
        const onMove = (ev) => {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            startRangeSelection(e, eventToTime);
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Zones vides du conteneur .timeline (sous les pistes) : mêmes comportements
    timeline.addEventListener('mousedown', (e) => {
        if (e.target.closest('.timeline-ruler, .timeline-tracks, .clip, .instru-dropzone')) return;
        if (state.selection) clearRangeSelection();
        deselectTracksByTimelineClick();
        // Tout en bas, hors piste : Pointeur de Logic → cadre de sélection des régions (le curseur ne bouge pas)
        if (e.button === 0 && !e.altKey && !e.shiftKey && !e.metaKey && mouseTool('left') !== 'marquee') return startRegionLasso(e);
        setPlayheadFromEvent(e);
        const onMove = (ev) => setPlayheadFromEvent(ev);
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// === Outils de la souris (comme dans Logic) : ce que font ⌘ + clic et clic droit sur une région ===
// Par défaut : ⌘ + clic = muter la région, clic droit (glisser) = son volume. Réglable dans Réglages.
const MOUSE_TOOLS_KEY = 'pulse_mouse_tools';
const MOUSE_TOOL_DEFAULT = { left: 'pointer', cmd: 'mute', right: 'gain' };
// Les outils de Logic (même liste, même ordre). Clic normal = 1er menu, ⌘ + clic = 2e, clic droit = 3e.
const MOUSE_TOOL_LABELS = {
    pointer: 'Outil Pointeur',
    pencil: 'Outil Crayon',
    erase: 'Outil Gomme',
    text: 'Outil Texte',
    cut: 'Outil Ciseaux',
    glue: 'Outil Colle',
    solo: 'Outil Solo',
    mute: 'Outil Muet',
    zoom: 'Outil Loupe',
    fade: 'Outil Fondu',
    marquee: 'Outil Marquee',
    gain: 'Outil Gain',
    menu: 'Menu contextuel',
    toolmenu: 'Menu des outils',
    none: 'Rien'
};
const MOUSE_TOOL_HELP = {
    pointer: 'Choisir, déplacer, étirer les régions (haut de piste : cadre de sélection, bas : plage)',
    pencil: 'Dessiner une région de notes sur une piste d\'instrument',
    erase: 'Effacer la région cliquée',
    text: 'Renommer la région',
    cut: 'Couper la région à l\'endroit du clic',
    glue: 'Joindre les régions choisies',
    solo: 'Écouter la piste seule tant que le bouton est enfoncé',
    mute: 'Muter / démuter la région',
    zoom: 'Zoomer (Option : dézoomer)',
    fade: 'Glisser sur le début ou la fin de la région pour un fondu',
    marquee: 'Choisir une plage de temps, partout sur la piste',
    gain: 'Volume de la région (glisser vers le haut / le bas)',
    menu: 'Ouvre le menu de la région',
    toolmenu: 'Ouvre ce menu pour changer l\'outil du clic normal',
    none: ''
};
const MOUSE_TOOL_LISTS = {
    left: ['pointer', 'pencil', 'erase', 'text', 'cut', 'glue', 'solo', 'mute', 'zoom', 'fade', 'marquee', 'gain'],
    cmd: ['pointer', 'pencil', 'erase', 'text', 'cut', 'glue', 'solo', 'mute', 'zoom', 'fade', 'marquee', 'gain', 'none'],
    right: ['pointer', 'pencil', 'erase', 'text', 'cut', 'glue', 'solo', 'mute', 'zoom', 'fade', 'marquee', 'gain', 'menu', 'toolmenu', 'none']
};
const MOUSE_TOOL_ICONS = {
    pointer: '<path d="M5 3l14 8-6 1.5L10 19z" fill="currentColor" stroke="none"/>',
    pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 6l3 3"/>',
    erase: '<path d="M8 20h12"/><path d="M4 15l9-9 6 6-7 7H8z"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
    glue: '<path d="M9 3h6v4H9z"/><path d="M7 7h10l-1 13H8z"/>',
    solo: '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor" stroke="none">S</text>',
    mute: '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor" stroke="none">M</text>',
    zoom: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/>',
    fade: '<path d="M3 20C10 20 14 4 21 4"/>',
    marquee: '<path d="M5 3v18"/><path d="M19 3v18"/><path d="M9 12h6" stroke-dasharray="2 2"/>',
    gain: '<path d="M4 8v8M8 5v14M12 9v6M16 6v12M20 10v4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    toolmenu: '<path d="M5 3l10 6-4 1-2 5z" fill="currentColor" stroke="none"/><path d="M14 16h7M17.5 13v6"/>',
    none: '<path d="M6 6l12 12"/>'
};
function mouseTool(which) {
    try { const v = JSON.parse(localStorage.getItem(MOUSE_TOOLS_KEY) || '{}'); if (MOUSE_TOOL_LABELS[v[which]] && (MOUSE_TOOL_LISTS[which] || []).includes(v[which])) return v[which]; } catch {}
    return MOUSE_TOOL_DEFAULT[which];
}
function setMouseTool(which, value, quiet) {
    let v = {}; try { v = JSON.parse(localStorage.getItem(MOUSE_TOOLS_KEY) || '{}') || {}; } catch {}
    v[which] = value;
    try { localStorage.setItem(MOUSE_TOOLS_KEY, JSON.stringify(v)); } catch {}
    if (which === 'left') {   // l'ancien bouton ciseau (B) suit l'outil du clic normal
        state.tool = value === 'cut' ? 'scissors' : 'pointer';
        document.body.classList.toggle('tool-scissors', value === 'cut');
        const btn = document.getElementById('btnScissors'); if (btn) btn.classList.toggle('active', value === 'cut');
        document.body.dataset.leftTool = value;
    }
    renderToolMenus();
    if (!quiet) flash(`${which === 'left' ? 'Clic' : which === 'cmd' ? '⌘ + clic' : 'Clic droit'} : ${MOUSE_TOOL_LABELS[value]}`);
}
// Les 3 menus d'outils à côté de l'aimant, comme dans Logic
function renderToolMenus() {
    const host = document.getElementById('toolCtl');
    if (!host) return;
    const ico = (k) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MOUSE_TOOL_ICONS[k] || ''}</svg>`;
    const tip = { left: 'Outil du clic', cmd: 'Outil du ⌘ + clic', right: 'Outil du clic droit' };
    host.innerHTML = ['left', 'cmd', 'right'].map(w => {
        const k = mouseTool(w);
        return `<button class="tool-pick" data-which="${w}" data-tool="${k}" data-tooltip="${tip[w]} : ${MOUSE_TOOL_LABELS[k]}">${ico(k)}<span class="tool-caret">▾</span></button>`;
    }).join('');
    host.querySelectorAll('.tool-pick').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = b.getBoundingClientRect();
        openToolMenu(b.dataset.which, r.left, r.bottom + 4);
    }));
}
// Dernière position de la souris (le menu des outils s'ouvre dessous avec Y)
const _lastMouse = { x: 300, y: 200 };
document.addEventListener('mousemove', (e) => { _lastMouse.x = e.clientX; _lastMouse.y = e.clientY; }, { passive: true });
function openToolMenu(which, x, y) {
    document.querySelectorAll('.tool-menu').forEach(m => m.remove());
    const ico = (k) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MOUSE_TOOL_ICONS[k] || ''}</svg>`;
    const cur = mouseTool(which);
    const m = document.createElement('div');
    m.className = 'tool-menu';
    m.innerHTML = `<div class="tool-menu-title">${which === 'left' ? 'Clic' : which === 'cmd' ? '⌘ + clic' : 'Clic droit'}</div>` +
        MOUSE_TOOL_LISTS[which].map(k => `<button class="tool-menu-item ${k === cur ? 'is-on' : ''}" data-tool="${k}" title="${MOUSE_TOOL_HELP[k] || ''}">${ico(k)}<span>${MOUSE_TOOL_LABELS[k]}</span>${k === cur ? '<span class="tool-check">✓</span>' : ''}</button>`).join('');
    document.body.appendChild(m);
    const mr = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(x, innerWidth - mr.width - 6)) + 'px';
    m.style.top = Math.max(6, Math.min(y, innerHeight - mr.height - 6)) + 'px';
    m.querySelectorAll('.tool-menu-item').forEach(it => it.addEventListener('click', (e) => { e.stopPropagation(); m.remove(); setMouseTool(which, it.dataset.tool); }));
    const close = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', esc, true); } };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); m.remove(); document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', esc, true); } };
    setTimeout(() => { document.addEventListener('mousedown', close, true); document.addEventListener('keydown', esc, true); }, 0);
}
function runClipTool(tool, e, trackIdx, clipIdx, eventToTime, fromRight) {
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip || clip.recording) return;
    if (tool === 'mute') {
        pushUndo(); clip.muted = !clip.muted;
        renderTimelineTracks(); saveProject(); refreshPlaybackSoon();
        flash(clip.muted ? 'Région mutée' : 'Région active');
    } else if (tool === 'cut') {
        splitClipAt(trackIdx, clipIdx, snapTime(eventToTime(e), false));
    } else if (tool === 'gain') {
        startClipGainDrag(e, trackIdx, clipIdx, fromRight);
    } else if (tool === 'menu') {
        openClipContextMenu(e.clientX, e.clientY, trackIdx, clipIdx);
    } else if (tool === 'toolmenu') {
        openToolMenu('left', e.clientX, e.clientY);
    } else if (tool === 'erase') {
        if (clipIsLocked(clip)) { flash('Région verrouillée'); return; }
        const key = `${trackIdx}:${clipIdx}`;
        if (!(state.selectedClips.size > 1 && state.selectedClips.has(key))) { state.selectedClips = new Set(); state.selectedClip = { trackIdx, clipIdx }; }
        deleteSelectedClip();
    } else if (tool === 'text') {
        state.selectedClip = { trackIdx, clipIdx };
        startClipRename(trackIdx, clipIdx);
    } else if (tool === 'glue') {
        if (!state.selectedClips.has(`${trackIdx}:${clipIdx}`)) { flash('Outil Colle : choisis d\'abord les régions à joindre (cadre ou Shift + clic), puis clique sur l\'une d\'elles'); return; }
        joinSelectedClips(trackIdx, clipIdx);
    } else if (tool === 'solo') {
        startToolSolo(e, trackIdx);
    } else if (tool === 'zoom') {
        suspendFollow && suspendFollow();
        setZoom(e.altKey ? state.pxPerSecond / 1.5 : state.pxPerSecond * 1.5, eventToTime(e));
    } else if (tool === 'fade') {
        const el = e.target.closest('.clip');
        const r = el ? el.getBoundingClientRect() : null;
        state.selectedClip = { trackIdx, clipIdx };
        startFadeDrag(e, r && e.clientX - r.left > r.width / 2 ? 'out' : 'in', trackIdx, clipIdx);
    } else if (tool === 'marquee') {
        state.selectedClip = null; state.selectedClips = new Set();
        document.querySelectorAll('.clip.is-selected').forEach(x => x.classList.remove('is-selected'));
        startRangeSelection(e, eventToTime);
    } else {
        return false;   // pointeur, crayon sur une région, rien : comportement normal
    }
    return true;
}
// Outil Solo : la piste joue seule tant que le bouton est enfoncé (comme dans Logic), puis tout revient comme avant
function startToolSolo(e, trackIdx) {
    const before = state.project.tracks.map(t => !!t.solo);
    state.project.tracks.forEach((t, i) => { t.solo = i === trackIdx; });
    renderTracksPanel(); bindTrackEvents(); refreshPlaybackSoon();
    if (!state.playing) togglePlay();
    const up = () => {
        document.removeEventListener('mouseup', up);
        state.project.tracks.forEach((t, i) => { t.solo = before[i]; });
        renderTracksPanel(); bindTrackEvents(); refreshPlaybackSoon();
    };
    document.addEventListener('mouseup', up);
}
// Volume d'une région en tirant vers le haut / le bas. Clic droit sans bouger = le menu habituel.
function startClipGainDrag(startEvent, trackIdx, clipIdx, menuIfNoMove) {
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;
    // Option (Alt) + clic droit = remet le volume de la région à 0 dB d'un coup (comme Option + clic sur un fader dans Logic)
    if (startEvent.altKey) {
        startEvent.preventDefault();
        if (clip.gain != null && clip.gain !== 1) {
            pushUndo(); delete clip.gain;
            saveProject(); refreshPlaybackSoon(); renderTimelineTracks();
        }
        flash('Volume de la région remis à 0 dB');
        // le menu du clic droit ne s'ouvre pas ensuite
        const swallow = (ev) => { ev.preventDefault(); document.removeEventListener('contextmenu', swallow, true); };
        document.addEventListener('contextmenu', swallow, true);
        setTimeout(() => document.removeEventListener('contextmenu', swallow, true), 400);
        return;
    }
    const sx = startEvent.clientX;
    let sy = startEvent.clientY;
    let db0 = clip.gain > 0 ? 20 * Math.log10(clip.gain) : (clip.gain === 0 ? -24 : 0);
    let moved = false, lastY = sy;
    document.body.classList.add('resizing-row');
    // En tirant : appuyer sur Option remet 0 dB tout de suite, et on continue à tirer depuis là
    const onAlt = (ke) => {
        if (ke.key !== 'Alt' || ke.repeat) return;
        if (!moved) { pushUndo(); moved = true; }
        db0 = 0; sy = lastY; delete clip.gain;
        const el = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (el) {
            const wave = el.querySelector('.clip-wave-svg:not(.loop-wave)');
            const w = parseFloat(el.style.getPropertyValue('--orig-w'));
            if (wave && w > 0) wave.outerHTML = renderClipWaveform(clip, w);
            let badge = el.querySelector('.gain-badge');
            if (!badge) { badge = document.createElement('div'); badge.className = 'fade-badge gain-badge'; el.appendChild(badge); }
            badge.textContent = '0.0 dB';
        }
    };
    document.addEventListener('keydown', onAlt);
    const move = (ev) => {
        lastY = ev.clientY;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        if (!moved) { pushUndo(); moved = true; }
        const db = Math.max(-24, Math.min(12, Math.round((db0 - (ev.clientY - sy) * 0.2) * 2) / 2));
        if (Math.abs(db) < 0.01) delete clip.gain; else clip.gain = db <= -24 ? 0 : Math.round(Math.pow(10, db / 20) * 1000) / 1000;
        const el = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (!el) return;
        const wave = el.querySelector('.clip-wave-svg:not(.loop-wave)');
        const w = parseFloat(el.style.getPropertyValue('--orig-w'));
        if (wave && w > 0) wave.outerHTML = renderClipWaveform(clip, w);
        let badge = el.querySelector('.gain-badge');
        if (!badge) { badge = document.createElement('div'); badge.className = 'fade-badge gain-badge'; el.appendChild(badge); }
        badge.textContent = db <= -24 ? 'muet' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
    };
    const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('keydown', onAlt);
        document.body.classList.remove('resizing-row');
        if (moved) { saveProject(); refreshPlaybackSoon(); renderTimelineTracks(); }
        else if (menuIfNoMove) openClipContextMenu(ev.clientX, ev.clientY, trackIdx, clipIdx);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    startEvent.preventDefault();
}

// La région posée est prioritaire (comme Logic) : tout ce qui est derrière elle, entre a et b, est coupé ou supprimé
function carveBehind(track, keep, a, b) {
    const out = [];
    for (const o of (track.clips || [])) {
        if (o === keep || o.recording) { out.push(o); continue; }
        const os = o.start, nat = o.start + o.duration;
        const oe = (o.loopEnd && o.loopEnd > nat) ? o.loopEnd : nat;               // étendue réelle, répétition comprise
        if (oe <= a + 1e-4 || os >= b - 1e-4) { out.push(o); continue; }          // loin de la zone : on n'y touche pas
        if (os >= a - 1e-4 && oe <= b + 1e-4) continue;                            // entièrement recouverte : elle disparaît
        const off = o.offset || 0;
        const looped = oe > nat + 1e-6;
        if (os < a - 1e-4) {
            // le début survit : on le raccourcit jusqu'à a (la répétition est coupée là aussi)
            const left = { ...o, fadeOut: 0 };
            if (looped && a > nat + 1e-6) left.loopEnd = a; else { left.duration = Math.min(o.duration, a - os); left.loopEnd = undefined; }
            out.push(left);
            if (!looped && oe > b + 1e-4) {                                        // posée en plein milieu : le reste revient après
                out.push({ ...o, start: b, duration: oe - b, offset: off + (b - os), fadeIn: 0, loopEnd: undefined });
            }
        } else if (!looped) {                                                      // seul le début est recouvert
            out.push({ ...o, start: b, duration: oe - b, offset: off + (b - os), fadeIn: 0 });
        }
        // région répétée dont seul le début est recouvert : le reste de la répétition disparaît avec lui
    }
    out.sort((x, y) => x.start - y.start);
    track.clips = out;
}

// === Déplacer un clip (drag) ou le sélectionner si simple click ===
function startClipDrag(startEvent, clipEl, trackIdx) {
    const clipIdx = parseInt(clipEl.dataset.ci);
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip || clip.recording) return;
    if (clipIsLocked(clip)) return;

    // La région est choisie dès l'appui (comme Logic), sans attendre le relâché : plus besoin d'« insister » pour la saisir
    if (!startEvent.altKey && !(state.selectedClips.size > 1 && state.selectedClips.has(`${trackIdx}:${clipIdx}`))) {
        state.selectedClip = { trackIdx, clipIdx };
        document.querySelectorAll('.clip.is-selected').forEach(e => e.classList.remove('is-selected'));
        clipEl.classList.add('is-selected');
    }

    // Détection trim handles : si on clique sur bord gauche/droit → mode trim
    const rect = clipEl.getBoundingClientRect();
    const relX = startEvent.clientX - rect.left;
    const edgeZone = 7; // px
    if (relX < edgeZone) return startClipTrim(startEvent, clipEl, trackIdx, clipIdx, 'left');
    if (relX > rect.width - edgeZone) return startClipTrim(startEvent, clipEl, trackIdx, clipIdx, 'right');

    const duplicate = startEvent.altKey;
    let working = clip;
    const start0 = clip.start, loop0 = clip.loopEnd;
    if (duplicate) {
        pushUndo();   // avant de poser la copie : ⌘Z la retire proprement
        working = { ...clip, peaks: clip.peaks ? clip.peaks.slice() : undefined };
        t.clips.push(working);
        if (clip.id && window.PulseAudio && PulseAudio.hasBuffer(clip.id)) {
            working.id = clip.id; // partage le buffer
        }
        renderTimelineTracks();
    }

    // Plusieurs régions choisies : elles partent toutes ensemble (même décalage dans le temps, chacune reste sur sa piste)
    const followers = [];
    if (!duplicate && state.selectedClips.size > 1 && state.selectedClips.has(`${trackIdx}:${clipIdx}`)) {
        state.selectedClips.forEach(k => {
            const [ti, ci] = k.split(':').map(Number);
            const fc = state.project.tracks[ti]?.clips[ci];
            if (fc && fc !== clip && !fc.recording) followers.push({ ti, clip: fc, start0: fc.start, loop0: fc.loopEnd });
        });
    }
    const groupMove = followers.length > 0;
    // Écart de lignes du déplacement vertical de groupe, et test « est-ce que tout le monde peut descendre / monter de d lignes ? »
    let groupRowDelta = 0;
    const kindOf = (tk) => (tk.type === 'keys' || tk.type === 'drums') ? tk.type : 'audio';
    const groupRowsFit = (d) => [{ ti: trackIdx, clip: working }, ...followers].every(m => {
        const from = state.project.tracks[m.ti], to = state.project.tracks[m.ti + d];
        return to && !to.locked && kindOf(from) === kindOf(to) && document.querySelector(`.timeline-track[data-i="${m.ti + d}"]`);
    });
    let startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let originalStart = working.start;
    let dragged = false;
    let undoPushed = !!duplicate;
    let targetTrackIdx = trackIdx;
    // Un appui sur Shift pendant qu'on tient le clip fige sa position dans le temps (on ne change que de piste) ;
    // un second appui le libère.
    // La position figée est celle d'où la région est partie (pas l'endroit où elle se trouve au moment de l'appui)
    const gestureStart = working.start;
    // Verrou d'axe (Shift) : le sens du geste décide. Surtout de haut en bas → la région garde sa place dans le temps et change de piste ;
    // surtout de gauche à droite → elle reste sur sa piste et ne fait que glisser dans le temps.
    let locked = false, lockedStart = gestureStart, lastX = startEvent.clientX, lastY = startEvent.clientY, lockAxis = null;
    const onShift = (ke) => {
        if (ke.key !== 'Shift' || ke.repeat) return;
        locked = !locked;
        lockAxis = null;
        if (locked) lockedStart = gestureStart;
        else { originalStart = working.start; startX = lastX; }   // on repart d'ici, sans saut
        document.body.classList.toggle('axis-locked', locked);
        flash(locked ? '🔒 Axe verrouillé : glisse de haut en bas pour changer de piste, ou de gauche à droite pour rester sur la piste (Shift pour libérer)' : '🔓 Déplacement libre');
    };
    document.addEventListener('keydown', onShift);

    const snapLine = getSnapLine();

    // Trouver la piste survolée à partir des coordonnées Y
    let rowRects = null, rowScroll = -1;
    const getHoveredTrackIdx = (clientY) => {
        const tlEl = document.querySelector('.timeline');
        const sc = tlEl ? tlEl.scrollTop : 0;
        if (!rowRects || sc !== rowScroll) {
            rowScroll = sc;
            rowRects = [...document.querySelectorAll('.timeline-track')].map(el => { const r = el.getBoundingClientRect(); return { i: parseInt(el.dataset.i), top: r.top, bottom: r.bottom }; });
        }
        let best = trackIdx;
        rowRects.forEach(r => { if (clientY >= r.top && clientY < r.bottom) best = r.i; });
        return best;
    };

    const onMove = (ev) => {
        lastX = ev.clientX;
        const dx = ev.clientX - startX;
        if (!dragged && Math.abs(dx) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        if (!dragged) {
            if (!undoPushed) { pushUndo(); undoPushed = true; } // snapshot avant la 1ère modif
            dragged = true;
            document.body.classList.add('is-dragging');
        }

        lastY = ev.clientY;
        if (locked && !lockAxis) {
            const adx = Math.abs(ev.clientX - startEvent.clientX), ady = Math.abs(ev.clientY - startY);
            if (Math.max(adx, ady) > 6) lockAxis = adx >= ady ? 'h' : 'v';
        }
        const timeFrozen = locked && lockAxis !== 'h';       // verrou vertical (ou pas encore décidé) : le temps ne bouge pas
        const trackFrozen = locked && lockAxis === 'h';      // verrou horizontal : on reste sur la piste d'origine
        // ⌘ tenu = placement libre le temps du geste (sinon : mode intelligent, ⌘G pour le couper)
        const dt = dx / state.pxPerSecond;
        const raw = timeFrozen ? lockedStart : originalStart + dt;
        const newStart = timeFrozen ? lockedStart : snapTime(raw, ev.metaKey || ev.ctrlKey);
        working.start = newStart;
        if (loop0 !== undefined) working.loopEnd = loop0 + (newStart - start0);   // la répétition suit la région
        if (groupMove) {
            // même décalage pour tout le monde, sans que personne ne passe avant 0
            const minStart = Math.min(start0, ...followers.map(f => f.start0));
            const delta = Math.max(newStart - start0, -minStart);
            working.start = start0 + delta;
            if (loop0 !== undefined) working.loopEnd = loop0 + delta;
            followers.forEach(f => {
                f.clip.start = f.start0 + delta;
                if (f.loop0 !== undefined) f.clip.loopEnd = f.loop0 + delta;
                const fi = state.project.tracks[f.ti].clips.indexOf(f.clip);
                const fel = document.querySelector(`.timeline-track[data-i="${f.ti}"] .clip[data-ci="${fi}"]`);
                if (fel) fel.style.left = (f.clip.start * state.pxPerSecond) + 'px';
            });
        }

        // Cible de la piste (drag vertical cross-track)
        let newTarget = trackFrozen ? trackIdx : getHoveredTrackIdx(ev.clientY);
        if (groupMove) {
            // Plusieurs régions : elles changent de piste ensemble, avec le même écart de lignes ; on s'arrête avant qu'une sorte du projet ou tombe sur une piste incompatible
            const want = newTarget - trackIdx, step = Math.sign(want);
            let rd = 0;
            for (let d = step; step !== 0 && Math.abs(d) <= Math.abs(want); d += step) {
                if (!groupRowsFit(d)) break;
                rd = d;
            }
            newTarget = trackIdx + rd;
            groupRowDelta = rd;
            followers.forEach(f => {
                const fi = state.project.tracks[f.ti].clips.indexOf(f.clip);
                const fel = document.querySelector(`.timeline-track[data-i="${f.ti}"] .clip[data-ci="${fi}"]`);
                if (!fel) return;
                const src = document.querySelector(`.timeline-track[data-i="${f.ti}"]`), dst = document.querySelector(`.timeline-track[data-i="${f.ti + rd}"]`);
                if (rd && src && dst) { fel.style.transform = `translateY(${dst.getBoundingClientRect().top - src.getBoundingClientRect().top}px)`; fel.style.zIndex = '50'; fel.style.opacity = '0.85'; }
                else { fel.style.transform = ''; fel.style.zIndex = ''; fel.style.opacity = ''; }
            });
        }
        if (newTarget !== targetTrackIdx) {
            document.querySelector(`.timeline-track[data-i="${targetTrackIdx}"]`)?.classList.remove('drag-over');
            targetTrackIdx = newTarget;
            document.querySelector(`.timeline-track[data-i="${targetTrackIdx}"]`)?.classList.add('drag-over');
        }

        const freshEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${t.clips.indexOf(working)}"]`);
        if (freshEl) {
            freshEl.style.left = (newStart * state.pxPerSecond) + 'px';
            // Décalage vertical visuel si on change de piste
            if (targetTrackIdx !== trackIdx) {
                const srcTrack = document.querySelector(`.timeline-track[data-i="${trackIdx}"]`);
                const dstTrack = document.querySelector(`.timeline-track[data-i="${targetTrackIdx}"]`);
                if (srcTrack && dstTrack) {
                    const dy = dstTrack.getBoundingClientRect().top - srcTrack.getBoundingClientRect().top;
                    freshEl.style.transform = `translateY(${dy}px)`;
                    freshEl.style.zIndex = '50';
                    freshEl.style.opacity = '0.85';
                }
            } else {
                freshEl.style.transform = '';
                freshEl.style.zIndex = '';
                freshEl.style.opacity = '';
            }
        }

        if (snapSpec().mode !== 'off' && !timeFrozen && !(ev.metaKey || ev.ctrlKey) && Math.abs(newStart - raw) > 0.001) {
            snapLine.style.left = (newStart * state.pxPerSecond) + 'px';
            snapLine.style.display = 'block';
        } else {
            snapLine.style.display = 'none';
        }
    };

    const onUp = () => {
        document.removeEventListener('keydown', onShift);
        document.body.classList.remove('axis-locked');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging');
        snapLine.style.display = 'none';
        document.querySelectorAll('.timeline-track.drag-over').forEach(el => el.classList.remove('drag-over'));

        // Nettoyage visuel
        const freshEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${t.clips.indexOf(working)}"]`);
        if (freshEl) { freshEl.style.transform = ''; freshEl.style.zIndex = ''; freshEl.style.opacity = ''; }

        if (!dragged) {
            state.selectedClip = { trackIdx, clipIdx: t.clips.indexOf(working) };
            if (groupMove) { state.selectedClips.clear(); }   // un simple clic, sans glisser : on ne garde que cette région
            renderTimelineTracks();
        } else {
            if (targetTrackIdx !== trackIdx) {
                // Déplacer le clip vers la piste cible
                const srcIdx = t.clips.indexOf(working);
                if (srcIdx >= 0) t.clips.splice(srcIdx, 1);
                const dstT = state.project.tracks[targetTrackIdx];
                dstT.clips.push(working);
                dstT.clips.sort((a, b) => a.start - b.start);
            }
            // Réglage « L'automation suit les régions » : les points sous la région partent avec elle
            if (!duplicate && autoFollowRegions()) {
                const len = ((working.loopEnd && working.loopEnd > working.start + working.duration) ? working.loopEnd - working.start : working.duration);
                moveAutomationWithRegion(t, state.project.tracks[targetTrackIdx], start0, start0 + len, working.start - start0);
            }
            // Comme Logic : la région qu'on pose est prioritaire, elle recouvre (et coupe) ce qui était derrière
            const destTrack = state.project.tracks[targetTrackIdx];
            carveBehind(destTrack, working, working.start, (working.loopEnd && working.loopEnd > working.start + working.duration) ? working.loopEnd : working.start + working.duration);
            if (groupMove) {
                if (groupRowDelta) followers.forEach(f => {   // les suiveuses changent de piste du même écart que la région tenue
                    const from = state.project.tracks[f.ti], to = state.project.tracks[f.ti + groupRowDelta];
                    const k = from.clips.indexOf(f.clip); if (k >= 0) from.clips.splice(k, 1);
                    to.clips.push(f.clip); to.clips.sort((a, b) => a.start - b.start);
                    f.ti += groupRowDelta;
                });
                followers.forEach(f => {
                    const ft = state.project.tracks[f.ti];
                    carveBehind(ft, f.clip, f.clip.start, (f.clip.loopEnd && f.clip.loopEnd > f.clip.start + f.clip.duration) ? f.clip.loopEnd : f.clip.start + f.clip.duration);
                });
                // les positions ont pu changer : on re-désigne la sélection par les régions elles-mêmes
                state.selectedClips.clear();
                [{ ti: targetTrackIdx, clip: working }, ...followers].forEach(f => {
                    const ci = state.project.tracks[f.ti].clips.indexOf(f.clip);
                    if (ci >= 0) state.selectedClips.add(`${f.ti}:${ci}`);
                });
            }
            state.selectedClip = { trackIdx: targetTrackIdx, clipIdx: destTrack.clips.indexOf(working) };
            renderTimelineTracks();
            saveProject();
        }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    startEvent.preventDefault();
}

// Ligne magnétique de snap (singleton dans la timeline)
function getSnapLine() {
    let line = document.getElementById('snapLine');
    if (!line) {
        line = document.createElement('div');
        line.id = 'snapLine';
        line.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:rgba(168,85,247,0.8);pointer-events:none;z-index:20;display:none;';
        const tracks = document.getElementById('timelineTracks');
        if (tracks) tracks.appendChild(line);
    }
    return line;
}

// === Renommer un clip inline ===
function startClipRename(trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip) return;
    const clipEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
    if (!clipEl) return;
    const nameEl = clipEl.querySelector('.clip-name');
    if (!nameEl) return;
    nameEl.setAttribute('contenteditable', 'true');
    nameEl.focus();
    // Sélection du texte
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const commit = () => {
        const txt = nameEl.textContent.replace(/⚠.*$/, '').trim();
        clip.name = txt || 'Clip';
        nameEl.removeAttribute('contenteditable');
        renderTimelineTracks();
        saveProject();
    };
    nameEl.addEventListener('blur', commit, { once: true });
    nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
        if (e.key === 'Escape') { nameEl.textContent = clip.name; nameEl.blur(); }
        e.stopPropagation();
    });
}

// === Supprimer le clip sélectionné ===
function deleteSelectedClip() {
    if (state.recording) { flash('Une prise est en cours : arrête-la (Espace) avant de supprimer'); return; }
    {   // région ou piste verrouillée : on ne supprime pas par accident
        const ks = state.selectedClips.size ? [...state.selectedClips] : (state.selectedClip ? [`${state.selectedClip.trackIdx}:${state.selectedClip.clipIdx}`] : []);
        if (ks.some(k => { const [ti, ci] = k.split(':').map(Number); const c = state.project.tracks[ti] && state.project.tracks[ti].clips[ci]; return c && clipIsLocked(c); })) return;
    }
    // Multi-sélection : supprimer tous les clips sélectionnés
    if (state.selectedClips.size > 0) {
        pushUndo();
        // Regrouper par piste et trier par index décroissant pour ne pas décaler les indices
        const toDelete = [...state.selectedClips].map(key => {
            const [ti, ci] = key.split(':').map(Number);
            return { ti, ci };
        });
        // Ajouter le clip principal s'il n'est pas déjà dans la sélection
        if (state.selectedClip) {
            const pKey = `${state.selectedClip.trackIdx}:${state.selectedClip.clipIdx}`;
            if (!state.selectedClips.has(pKey)) {
                toDelete.push({ ti: state.selectedClip.trackIdx, ci: state.selectedClip.clipIdx });
            }
        }
        toDelete.sort((a, b) => b.ci - a.ci); // décroissant pour garder les indices valides
        const trackGroups = {};
        toDelete.forEach(({ ti, ci }) => {
            if (!trackGroups[ti]) trackGroups[ti] = [];
            trackGroups[ti].push(ci);
        });
        for (const [ti, cis] of Object.entries(trackGroups)) {
            const t = state.project.tracks[parseInt(ti)];
            if (!t) continue;
            cis.sort((a, b) => b - a);
            cis.forEach(ci => {
                const clip = t.clips[ci];
                if (!clip) return;
                const sharedCount = state.project.tracks.flatMap(tr => tr.clips || []).filter(c => c.id === clip.id).length;
                /* audio conservé pour Annuler — nettoyé au prochain démarrage (cleanupOrphanAudio) */
                t.clips.splice(ci, 1);
            });
        }
        state.selectedClip = null;
        state.selectedClips.clear();
        renderTimelineTracks();
        saveProject();
        flash(`${toDelete.length} clips supprimés`);
        return;
    }
    if (!state.selectedClip) return;
    const { trackIdx, clipIdx } = state.selectedClip;
    const t = state.project.tracks[trackIdx];
    if (!t || !t.clips[clipIdx]) return;
    pushUndo();
    const clip = t.clips[clipIdx];
    const sharedCount = state.project.tracks.flatMap(tr => tr.clips || []).filter(c => c.id === clip.id).length;
    /* audio conservé pour Annuler — nettoyé au prochain démarrage (cleanupOrphanAudio) */
    t.clips.splice(clipIdx, 1);
    state.selectedClip = null;
    renderTimelineTracks();
    saveProject();
    flash('Clip supprimé');
}

function copySelectedClip() {
    if (!state.selectedClip) { flash('Clique d\'abord sur un clip pour le sélectionner'); return; }
    const { trackIdx, clipIdx } = state.selectedClip;
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;
    state.clipboard = { clip: JSON.parse(JSON.stringify(clip)), trackIdx };
    flash('Clip copié');
}

function pasteClip() {
    if (!state.clipboard) { flash('Presse-papier vide'); return; }
    const { clip } = state.clipboard;
    // Comme Logic : ça se colle sur la piste choisie (sinon sur la piste d'origine)
    const trackIdx = state.project.tracks[state.selectedTrack] ? state.selectedTrack : state.clipboard.trackIdx;
    const targetTrack = state.project.tracks[trackIdx];
    if (!targetTrack) return;
    if (clip.midi) {
        const wantDrums = clip.midi.inst === 'drums';
        if (targetTrack.type !== 'keys' && targetTrack.type !== 'drums') { flash('Une région de notes se colle sur une piste Piano ou Batterie'); return; }
        if (wantDrums !== (targetTrack.type === 'drums')) {
            flash(wantDrums ? 'Cette région est une batterie : colle-la sur une piste Batterie' : 'Cette région est un instrument : colle-la sur une piste Piano');
            return;
        }
    }
    pushUndo();
    targetTrack.clips = targetTrack.clips || [];
    // On garde le même `id` pour partager le buffer audio — un clip copié joue le même audio
    let start = state.playhead;
    // Déjà une copie pile ici : la suivante se pose juste après (sinon on empile des clips identiques sans le voir)
    while (targetTrack.clips.some(o => !o.recording && o.id === clip.id && Math.abs(o.start - start) < 1e-3)) start += clip.duration;
    const pasted = { ...JSON.parse(JSON.stringify(clip)), start };
    if (clip.loopEnd) pasted.loopEnd = start + (clip.loopEnd - clip.start);   // la répétition suit la copie
    targetTrack.clips.push(pasted);
    carveBehind(targetTrack, pasted, pasted.start, (pasted.loopEnd && pasted.loopEnd > pasted.start + pasted.duration) ? pasted.loopEnd : pasted.start + pasted.duration);   // la copie collée est prioritaire
    targetTrack.clips.sort((a, b) => a.start - b.start);
    const newIdx = targetTrack.clips.indexOf(pasted);
    state.selectedTrack = trackIdx;
    state.selectedClip = { trackIdx, clipIdx: newIdx };
    renderAll();
    saveProject();
    flash('Clip collé à ' + secondsToDuration(start));
}

// === Loop region (Alt+drag dans le ruler, Logic style) ===
// Déplacer / étirer la boucle depuis la règle (la grille aimante les bords, Maj = libre) ; un simple clic l'allume ou l'éteint
function editLoopRegion(startEvent, eventToTime, mode) {
    const a0 = Math.min(state.loop.start, state.loop.end), b0 = Math.max(state.loop.start, state.loop.end);
    const t0 = eventToTime(startEvent), sx = startEvent.clientX;
    let moved = false;
    const onMove = (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < 4) return;
        if (!moved) { moved = true; pushUndo(); }
        const t = eventToTime(ev);
        let a = a0, b = b0;
        if (mode === 'move') { const d = snapTime(a0 + (t - t0), ev.shiftKey) - a0; a = Math.max(0, a0 + d); b = a + (b0 - a0); }
        else if (mode === 'left') a = Math.min(snapTime(t, ev.shiftKey), b0 - 0.1);
        else b = Math.max(snapTime(t, ev.shiftKey), a0 + 0.1);
        state.loop = { start: a, end: b };
        renderLoopOverlay();
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!moved) { state.looping = !state.looping; flash(state.looping ? 'Boucle allumée' : 'Boucle éteinte (clic sur la zone pour la rallumer)'); }
        renderLoopOverlay(); updateLoopButton(); saveProject();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}
function startLoopSelection(startEvent, eventToTime) {
    const start = snapTime(eventToTime(startEvent), startEvent.shiftKey);
    state.loop = { start, end: start };
    renderLoopOverlay();
    const onMove = (ev) => {
        state.loop.end = snapTime(eventToTime(ev), ev.shiftKey);
        renderLoopOverlay();
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (Math.abs(state.loop.end - state.loop.start) < 0.1) state.loop = null;
        else {
            state.looping = true;
            tipOnce('pulse_tip_loop', 'Boucle allumée — clique dessus pour l\'éteindre (touche C), tire ses bords pour l\'ajuster');
            // La lecture part du début de la boucle, sauf si le curseur (le point de départ) est déjà posé à l'intérieur
            const la = Math.min(state.loop.start, state.loop.end), lb = Math.max(state.loop.start, state.loop.end);
            if (!(state.playhead >= la && state.playhead < lb) && !state.playing) { state.playhead = la; state.baseCleared = false; state.userBaseSec = null; updatePlayhead(); updateChrono(); }
        }
        renderLoopOverlay();
        updateLoopButton();
        saveProject();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function renderLoopOverlay() {
    const ruler = document.getElementById('timelineRuler');
    const tracksEl = document.getElementById('timelineTracks');
    let rulerOverlay = ruler.querySelector('.loop-region');
    let tracksOverlay = tracksEl ? tracksEl.querySelector('.loop-region-tracks') : null;

    if (!state.loop) {
        if (rulerOverlay) rulerOverlay.remove();
        if (tracksOverlay) tracksOverlay.remove();
        return;
    }

    // Overlay ruler (handle de boucle, coloré)
    if (!rulerOverlay) {
        rulerOverlay = document.createElement('div');
        rulerOverlay.className = 'loop-region';
        ruler.appendChild(rulerOverlay);
    }
    // Overlay zone de pistes (fond semi-transparent)
    if (tracksEl && !tracksOverlay) {
        tracksOverlay = document.createElement('div');
        tracksOverlay.className = 'loop-region-tracks';
        tracksEl.appendChild(tracksOverlay);
    }

    const a = Math.min(state.loop.start, state.loop.end);
    const b = Math.max(state.loop.start, state.loop.end);
    const left = (a * state.pxPerSecond) + 'px';
    const width = ((b - a) * state.pxPerSecond) + 'px';

    rulerOverlay.style.left = left;
    rulerOverlay.style.width = width;
    rulerOverlay.classList.toggle('active', !!state.looping);

    if (tracksOverlay) {
        tracksOverlay.style.left = left;
        tracksOverlay.style.width = width;
        tracksOverlay.classList.toggle('active', !!state.looping);
        // Plage prise sur certaines pistes : la zone colorée ne couvre que celles-là (la règle garde la boucle entière)
        const tr = state.selection && state.selection.tracks;
        const rows = [...document.querySelectorAll('.timeline-tracks .timeline-track')];
        const first = tr && rows.find(r => parseInt(r.dataset.i) === tr[0]);
        const last = tr && rows.find(r => parseInt(r.dataset.i) === tr[1]);
        if (first && last) {
            tracksOverlay.style.top = first.offsetTop + 'px';
            tracksOverlay.style.height = (last.offsetTop + last.offsetHeight - first.offsetTop) + 'px';
            tracksOverlay.style.bottom = 'auto';
        } else {
            tracksOverlay.style.top = ''; tracksOverlay.style.height = ''; tracksOverlay.style.bottom = '';
        }
    }
}

function updateLoopButton() {
    const btn = document.getElementById('btnLoop');
    if (btn) { btn.style.color = state.looping ? 'var(--violet-3)' : ''; btn.classList.toggle('active', !!state.looping); }
}

// === Répétition de clip (drag coin bas-droit → loopEnd) ===
function startLoopDrag(startEvent, clipEl, trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip || clip.recording) return;
    if (clipIsLocked(clip)) return;
    pushUndo();
    document.body.classList.add('is-trimming');

    let indicator = document.getElementById('trimIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'trimIndicator';
        indicator.style.cssText = 'position:fixed;background:var(--bg-2);color:var(--text-1);border:1px solid var(--border);padding:4px 10px;border-radius:8px;font-size:12px;font-family:ui-monospace,monospace;z-index:300;pointer-events:none;display:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        document.body.appendChild(indicator);
    }

    const onMove = (ev) => {
        const rawTime = (ev.clientX - document.querySelector('.timeline').getBoundingClientRect().left
            + document.querySelector('.timeline').scrollLeft) / state.pxPerSecond;
        const snapped = snapTime(rawTime, ev.shiftKey);
        // Le loopEnd doit être au moins clip.start + clip.duration (= pas de loop)
        const minEnd = clip.start + clip.duration;
        if (snapped <= minEnd + 0.05) {
            delete clip.loopEnd;
        } else {
            clip.loopEnd = snapped;
        }
        // Mise à jour directe
        const el = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (el) {
            const totalDur = clip.loopEnd ? clip.loopEnd - clip.start : clip.duration;
            el.style.width = (totalDur * state.pxPerSecond) + 'px';
        }
        const loopDur = clip.loopEnd ? clip.loopEnd - clip.start - clip.duration : 0;
        indicator.textContent = loopDur > 0 ? `× ${(loopDur / clip.duration + 1).toFixed(1)} — ${secondsToDuration(clip.loopEnd - clip.start)}` : 'Pas de répétition';
        indicator.style.display = 'block';
        indicator.style.left = (ev.clientX + 12) + 'px';
        indicator.style.top = (ev.clientY - 28) + 'px';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-trimming');
        indicator.style.display = 'none';
        renderTimelineTracks();
        saveProject();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    startEvent.preventDefault();
    startEvent.stopPropagation();
}

// === Trim des bords d'un clip (poignées gauche/droite) ===
function startClipTrim(startEvent, clipEl, trackIdx, clipIdx, side) {
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip) return;
    if (clipIsLocked(clip)) return;
    pushUndo(); // snapshot avant modification
    document.body.classList.add('is-trimming');
    const startX = startEvent.clientX;
    const originalStart = clip.start;
    const originalDuration = clip.duration;
    const originalOffset = clip.offset || 0;
    const srcDur = (clip.id && PulseAudio.getBufferDuration(clip.id)) || (originalOffset + originalDuration);
    const maxDuration = Math.max(0.1, srcDur - originalOffset);
    let limitFlashed = false;
    let trimWaveRaf = 0;
    // Comme Logic : si la région fait partie d'une sélection, tirer son bord tire le même bord de toutes les régions choisies
    const others = [];
    if (state.selectedClips && state.selectedClips.size > 1 && state.selectedClips.has(`${trackIdx}:${clipIdx}`)) {
        for (const key of state.selectedClips) {
            const [ti, ci] = key.split(':').map(Number);
            if (ti === trackIdx && ci === clipIdx) continue;
            const c = state.project.tracks[ti]?.clips?.[ci];
            if (!c || c.recording || clipIsLocked(c)) continue;
            const off = c.offset || 0;
            const src = (c.id && PulseAudio.getBufferDuration(c.id)) || (off + c.duration);
            others.push({ ti, ci, c, start: c.start, dur: c.duration, off, max: Math.max(0.05, src - off) });
        }
    }
    const paintClip = (ti, ci, c) => {
        const el = document.querySelector(`.timeline-track[data-i="${ti}"] .clip[data-ci="${ci}"]`);
        if (!el) return;
        el.style.left  = (c.start    * state.pxPerSecond) + 'px';
        el.style.width = (c.duration * state.pxPerSecond) + 'px';
    };

    // Indicateur de durée pendant le trim
    let trimIndicator = document.getElementById('trimIndicator');
    if (!trimIndicator) {
        trimIndicator = document.createElement('div');
        trimIndicator.id = 'trimIndicator';
        trimIndicator.style.cssText = 'position:fixed;background:var(--bg-2);color:var(--text-1);border:1px solid var(--border);padding:4px 10px;border-radius:8px;font-size:12px;font-family:ui-monospace,monospace;z-index:300;pointer-events:none;display:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        document.body.appendChild(trimIndicator);
    }

    const hitLimit = () => {
        if (limitFlashed) return;
        limitFlashed = true;
        flash('Bout de la prise atteint — il n\'y a plus de son au-delà');
    };
    const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dt = dx / state.pxPerSecond;
        if (side === 'left') {
            const raw = originalStart + dt;
            let snapped = snapTime(Math.min(originalStart + originalDuration - 0.1, raw), ev.shiftKey);
            // Butée : début du fichier source (et début du projet)
            const minStart = Math.max(0, originalStart - originalOffset);
            if (snapped < minStart) { snapped = minStart; hitLimit(); }
            snapped = Math.min(snapped, originalStart + originalDuration - 0.05);
            const diff = snapped - originalStart;
            clip.start = snapped;
            clip.duration = originalDuration - diff;
            clip.offset = originalOffset + diff;
            for (const o of others) {
                // même décalage, avec les butées propres à chaque région
                const d = Math.max(-o.off, -o.start, Math.min(o.dur - 0.05, diff));
                o.c.start = o.start + d; o.c.duration = o.dur - d; o.c.offset = o.off + d;
                paintClip(o.ti, o.ci, o.c);
            }
        } else {
            const raw = originalDuration + dt;
            let d = Math.max(0.05, snapTime(clip.start + raw, ev.shiftKey) - clip.start);
            // Butée : fin du fichier source
            if (d > maxDuration) { d = maxDuration; hitLimit(); }
            clip.duration = d;
            if (clip.loopEnd && clip.loopEnd <= clip.start + clip.duration) delete clip.loopEnd;
            const delta = d - originalDuration;
            for (const o of others) {
                o.c.duration = Math.max(0.05, Math.min(o.max, o.dur + delta));
                if (o.c.loopEnd && o.c.loopEnd <= o.c.start + o.c.duration) delete o.c.loopEnd;
                paintClip(o.ti, o.ci, o.c);
            }
        }
        // Mise à jour directe de l'élément (pas de re-render complet)
        const el = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (el) {
            el.style.left  = (clip.start    * state.pxPerSecond) + 'px';
            el.style.width = (clip.duration * state.pxPerSecond) + 'px';
            // On ne tire pas l'image : la forme d'onde est redessinée à chaque instant, on voit ce qui se cache derrière
            if (!trimWaveRaf) trimWaveRaf = requestAnimationFrame(() => {
                trimWaveRaf = 0;
                const w = clip.duration * state.pxPerSecond;
                el.style.setProperty('--orig-w', w + 'px');
                const wave = el.querySelector('.clip-wave-svg:not(.loop-wave)');
                if (wave && !clip.recording) wave.outerHTML = renderClipWaveform(clip, w);
            });
        }
        // Indicateur durée
        trimIndicator.textContent = secondsToDuration(clip.duration);
        trimIndicator.style.display = 'block';
        trimIndicator.style.left = (ev.clientX + 12) + 'px';
        trimIndicator.style.top  = (ev.clientY - 28) + 'px';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-trimming');
        if (trimIndicator) trimIndicator.style.display = 'none';
        renderTimelineTracks(); // re-render final pour synchro waveform/tooltip
        saveProject();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    startEvent.preventDefault();
    startEvent.stopPropagation();
}

// === Sélection d'une plage (shift+drag) ===
// Piste sous le pointeur (au-dessus de la 1re ou sous la dernière : la plus proche)
function trackIdxAtY(clientY) {
    const rows = [...document.querySelectorAll('.timeline-tracks .timeline-track')];
    if (!rows.length) return 0;
    let best = parseInt(rows[0].dataset.i);
    for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (clientY >= b.top) best = parseInt(r.dataset.i);
    }
    return best;
}

// Cadre de sélection des régions (outil Pointeur de Logic) : toute région touchée par le cadre est choisie en entier.
// Un simple clic sans glisser désélectionne les régions.
function startRegionLasso(startEvent) {
    const host = document.getElementById('timelineTracks');
    const sx = startEvent.clientX, sy = startEvent.clientY;
    let box = null, sel = new Set();
    startEvent.preventDefault();
    const onMove = (ev) => {
        if (!box) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            box = document.createElement('div');
            box.className = 'region-lasso';
            document.body.appendChild(box);
        }
        const x1 = Math.min(sx, ev.clientX), x2 = Math.max(sx, ev.clientX);
        const y1 = Math.min(sy, ev.clientY), y2 = Math.max(sy, ev.clientY);
        Object.assign(box.style, { left: x1 + 'px', top: y1 + 'px', width: (x2 - x1) + 'px', height: (y2 - y1) + 'px' });
        sel = new Set();
        host.querySelectorAll('.timeline-track .clip').forEach(c => {
            const ti = c.closest('.timeline-track').dataset.i, ci = c.dataset.ci;
            const clip = state.project.tracks[+ti]?.clips[+ci];
            const r = c.getBoundingClientRect();
            const hit = !!clip && !clip.recording && r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2;
            c.classList.toggle('is-selected', hit);
            c.classList.toggle('is-multi-selected', hit);
            if (hit) sel.add(`${ti}:${ci}`);
        });
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (box) box.remove();
        const keys = [...sel];
        if (keys.length) {
            const [ti, ci] = keys[0].split(':').map(Number);
            state.selectedClip = { trackIdx: ti, clipIdx: ci };
            state.selectedClips = keys.length > 1 ? new Set(keys) : new Set();
        } else {
            state.selectedClip = null;
            state.selectedClips = new Set();
        }
        renderTimelineTracks();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function startRangeSelection(startEvent, eventToTime) {
    const timeline = document.querySelector('.timeline');
    const startTime = eventToTime(startEvent);
    // La plage reste sur la piste où on a commencé ; on l'étend à d'autres pistes seulement en tirant dessus.
    // Depuis la règle : toutes les pistes.
    const fromRuler = !!(startEvent.target.closest && startEvent.target.closest('.timeline-ruler'));
    const t0 = trackIdxAtY(startEvent.clientY);
    // Une plage choisie remplace la région choisie avant (sinon Suppr effacerait l'ancienne région, pas la plage)
    if (state.selectedClip || state.selectedClips.size) {
        state.selectedClip = null; state.selectedClips.clear();
        renderTimelineTracks();
    }
    state.selection = { start: startTime, end: startTime };
    if (!fromRuler) state.selection.tracks = [t0, t0];

    // Overlay visuel
    const overlay = document.createElement('div');
    overlay.className = 'range-selection';
    timeline.querySelector('.timeline-tracks').appendChild(overlay);
    updateRangeOverlay(overlay);

    const onMove = (ev) => {
        if (!state.selection) return; // Échap pendant le geste : la plage a été annulée
        state.selection.end = eventToTime(ev);
        if (!fromRuler) { const t1 = trackIdxAtY(ev.clientY); state.selection.tracks = [Math.min(t0, t1), Math.max(t0, t1)]; }
        updateRangeOverlay(overlay);
        // Loop preview en temps réel pendant le drag
        const a = Math.min(state.selection.start, state.selection.end);
        const b = Math.max(state.selection.start, state.selection.end);
        if (b - a > 0.05) {
            state.loop = { start: a, end: b };
            renderLoopOverlay();
        }
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!state.selection) { renderLoopOverlay(); updateLoopButton(); return; }
        // Synchro finale sélection → loop
        const a = Math.min(state.selection.start, state.selection.end);
        const b = Math.max(state.selection.start, state.selection.end);
        if (b - a > 0.1) {
            state.loop = { start: a, end: b };
            state.looping = true;
            // Placer le curseur au début de la sélection
            state.playhead = a;
            updatePlayhead();
            updateChrono();
            // Les régions touchées par la plage sont aussi choisies : on peut les déplacer ensemble, changer leur volume (clic droit)
            // Suppr, lui, efface la plage elle-même (les bords des régions sont coupés)
            const tr = state.selection.tracks;
            state.selectedClips.clear();
            state.project.tracks.forEach((tk, ti) => {
                if (tr && (ti < tr[0] || ti > tr[1])) return;
                (tk.clips || []).forEach((c, ci) => { if (!c.recording && c.start < b && c.start + c.duration > a) state.selectedClips.add(`${ti}:${ci}`); });
            });
            if (state.selectedClips.size < 2) state.selectedClips.clear();
            renderTimelineTracks();
        } else {
            // Sélection trop petite → pas de loop
            clearRangeSelection();
        }
        renderLoopOverlay();
        updateLoopButton();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    startEvent.preventDefault();
}

function updateRangeOverlay(overlay) {
    const { start, end } = state.selection;
    const a = Math.min(start, end);
    const b = Math.max(start, end);
    overlay.style.left = (a * state.pxPerSecond) + 'px';
    overlay.style.width = ((b - a) * state.pxPerSecond) + 'px';
    // Verticalement : seulement les pistes concernées
    const tr = state.selection.tracks;
    const rows = [...document.querySelectorAll('.timeline-tracks .timeline-track')];
    const first = tr && rows.find(r => parseInt(r.dataset.i) === tr[0]);
    const last = tr && rows.find(r => parseInt(r.dataset.i) === tr[1]);
    if (first && last) {
        overlay.style.top = first.offsetTop + 'px';
        overlay.style.height = (last.offsetTop + last.offsetHeight - first.offsetTop) + 'px';
        overlay.style.bottom = 'auto';
    } else {
        overlay.style.top = ''; overlay.style.height = ''; overlay.style.bottom = '';
    }
}

function clearRangeSelection() {
    document.querySelectorAll('.range-selection').forEach(el => el.remove());
    state.selection = null;
    state.loop = null;
    state.looping = false;
    renderLoopOverlay();
    updateLoopButton();
}

// Supprimer la plage sélectionnée (seulement sur les pistes de la sélection ; toutes si elle vient de la règle)
function deleteSelection() {
    if (state.recording) { flash('Une prise est en cours : arrête-la (Espace) avant de supprimer'); return; }
    if (!state.selection) return;
    pushUndo();
    const a = Math.min(state.selection.start, state.selection.end);
    const b = Math.max(state.selection.start, state.selection.end);
    let count = 0;
    const range = state.selection.tracks;

    state.project.tracks.forEach((t, ti) => {
        if (range && (ti < range[0] || ti > range[1])) return;
        t.clips = (t.clips || []).flatMap(c => {
            const cStart = c.start, cEnd = c.start + c.duration;
            if (cEnd <= a || cStart >= b) return [c]; // hors plage
            count++;
            // Clip entièrement dans la plage → supprimer
            if (cStart >= a && cEnd <= b) return [];
            // Clip chevauche à gauche → tronquer droite
            if (cStart < a && cEnd <= b) return [{ ...c, duration: a - cStart, loopEnd: undefined, fadeOut: 0 }];
            // Clip chevauche à droite → avancer début
            if (cStart >= a && cEnd > b) return [{ ...c, start: b, duration: cEnd - b, offset: (c.offset || 0) + (b - cStart), fadeIn: 0 }];
            // Clip englobe la plage → splitter en 2
            return [
                { ...c, duration: a - cStart, loopEnd: undefined, fadeOut: 0 },
                { ...c, start: b, duration: cEnd - b, offset: (c.offset || 0) + (b - cStart), fadeIn: 0, name: (c.name || 'Clip') + '*' }
            ];
        });
    });

    clearRangeSelection();
    renderTimelineTracks();
    saveProject();
    flash(count > 0 ? `✂︎ Plage supprimée (${count} clip${count>1?'s':''})` : 'Rien dans la plage');
}

// === Aimant (Logic-style) ===
// Trois modes : Libre (rien ne se cale), Intelligent (un petit aimant près des temps, libre ailleurs),
// Temps (tout se cale sur la grille). `state.gridRes` = finesse de la grille : auto (suit le zoom), bar, beat, division.
const SNAP_KEY = 'pulse_snap';
const SNAP_RES_LABEL = { auto: 'Auto', bar: 'Mesure', beat: '1/4', division: '1/8' };
const SNAP_MAGNET_PX = 8; // portée de l'aimant intelligent
function snapSpec() {
    const s = state.snap;
    if (s === 'off' || s === 'magnet' || s === 'grid') return { mode: s, res: state.gridRes || 'auto' };
    if (s === 'smart') return { mode: 'grid', res: 'auto' };       // ancien nom du mode Temps
    return { mode: 'grid', res: s };                              // 'bar' | 'beat' | 'division' (anciens réglages)
}
function getEffectiveSnap() {
    const { mode, res } = snapSpec();
    if (mode === 'off') return 'off';
    if (res !== 'auto') return res;
    // Auto : finesse selon le zoom (comme Logic)
    const beatPx = state.pxPerSecond * (60 / bpmAtSec(state.playhead || 0));
    if (beatPx >= 480) return 'fine';     // 1/32 de temps : édition à la milliseconde
    if (beatPx >= 120) return 'division'; // 1/8 note
    if (beatPx >= 40)  return 'beat';
    return 'bar';
}

// free : ⌘ tenu = placement libre le temps du geste
// L'aimant agit aussi sur le curseur : il se colle au début / à la fin d'une région proche (Shift = libre)
function snapPlayheadToEdges(t, free) {
    if (free || snapSpec().mode === 'off') return t;
    const tol = SNAP_MAGNET_PX / state.pxPerSecond;
    let best = t, bd = tol;
    state.project.tracks.forEach(tr => (tr.clips || []).forEach(c => {
        if (c.recording) return;
        for (const e of [c.start, c.start + c.duration]) { const d = Math.abs(e - t); if (d <= bd) { bd = d; best = e; } }
    }));
    return best;
}
function snapTime(t, free) {
    const { mode } = snapSpec();
    if (mode === 'off' || free) return Math.max(0, t);
    const nearest = snapToGrid(t, getEffectiveSnap());
    if (mode === 'magnet' && Math.abs(t - nearest) > SNAP_MAGNET_PX / state.pxPerSecond) return Math.max(0, t);
    return Math.max(0, nearest);
}

function saveSnap() {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify({ mode: snapSpec().mode, res: state.gridRes || 'auto', last: _snapLast })); } catch {}
}
let _snapLast = 'magnet';
function renderSnapControl() {
    const { mode, res } = snapSpec();
    document.querySelectorAll('.snap-btn').forEach(b => b.classList.toggle('active', b.dataset.snap === mode));
    const chip = document.getElementById('snapRes');
    if (chip) {
        chip.hidden = mode === 'off';
        chip.textContent = SNAP_RES_LABEL[res] || 'Auto';
    }
}
function setSnapMode(mode, quiet) {
    state.snap = mode;
    if (mode !== 'off') _snapLast = mode;
    saveSnap(); renderSnapControl();
    if (!quiet) flash(mode === 'off' ? 'Aimant : libre (⌘G pour l\'intelligent)'
        : mode === 'magnet' ? 'Aimant intelligent : tu es libre, mais il te colle sur le temps quand tu en es tout près'
        : 'Aimant sur les temps : tout se cale sur la grille');
}
function initSnapControl() {
    state.gridRes = 'auto';
    state.snap = 'off';   // par défaut : libre, on édite tranquille
    try {
        const v = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
        if (v) { state.snap = ['off', 'magnet', 'grid'].includes(v.mode) ? v.mode : 'off'; state.gridRes = SNAP_RES_LABEL[v.res] ? v.res : 'auto'; if (v.last) _snapLast = v.last; }
    } catch {}
    document.querySelectorAll('.snap-btn').forEach(b => b.addEventListener('click', () => setSnapMode(b.dataset.snap)));
    const chip = document.getElementById('snapRes');
    if (chip) chip.addEventListener('click', () => {
        const order = ['auto', 'bar', 'beat', 'division'];
        state.gridRes = order[(order.indexOf(state.gridRes || 'auto') + 1) % order.length];
        saveSnap(); renderSnapControl();
        flash(`Grille : ${state.gridRes === 'auto' ? 'automatique (suit le zoom)' : SNAP_RES_LABEL[state.gridRes]}`);
    });
    renderSnapControl();
}

// === Hauteur d'une piste : tirer le bord bas (comme Logic) ===
// Alt = toutes les pistes ; double-clic = taille normale.
function bindTrackResize() {
    document.querySelectorAll('.track-resize').forEach(h => {
        const i = parseInt(h.dataset.i);
        h.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const t = state.project.tracks[i]; if (!t) return;
            pushUndo(); delete t.height; saveProject(); renderAll();
            flash('Piste à la taille normale');
        });
        h.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const t = state.project.tracks[i]; if (!t) return;
            const all = e.altKey, startY = e.clientY, startH = trackH(t);
            let moved = false;
            document.body.classList.add('resizing-row');
            const apply = (ev) => {
                const hgt = Math.max(TRACK_H_MIN, Math.min(TRACK_H_MAX, Math.round(startH + ev.clientY - startY)));
                if (!moved) { pushUndo(); moved = true; }
                if (all) {
                    state.project.tracks.forEach(x => { delete x.height; });
                    state.trackHeight = hgt;
                    document.documentElement.style.setProperty('--track-h', hgt + 'px');
                } else {
                    t.height = hgt;
                    document.querySelectorAll(`.track-item[data-i="${i}"], .timeline-track[data-i="${i}"]`)
                        .forEach(el => el.style.setProperty('--track-h', hgt + 'px'));
                }
            };
            const up = () => {
                document.removeEventListener('mousemove', apply);
                document.removeEventListener('mouseup', up);
                document.body.classList.remove('resizing-row');
                if (moved) { saveProject(); saveViewState(); renderAll(); }
            };
            document.addEventListener('mousemove', apply);
            document.addEventListener('mouseup', up);
        });
    });
}

// === Hauteur d'un groupe / bus : tirer son bord bas (comme une piste) ===
const GROUP_H_MIN = 22, GROUP_H_MAX = 140;
function bindGroupResize() {
    document.querySelectorAll('.group-resize').forEach(h => {
        const find = () => (state.project.buses || []).find(b => b.id === h.dataset.bus);
        h.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const b = find(); if (!b) return;
            pushUndo(); delete b.height; saveProject(); renderAll();
            flash('Groupe à la taille normale');
        });
        h.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const b = find(); if (!b) return;
            const all = e.altKey, startY = e.clientY, startH = b.height || 36;
            let moved = false;
            document.body.classList.add('resizing-row');
            const apply = (ev) => {
                const hgt = Math.max(GROUP_H_MIN, Math.min(GROUP_H_MAX, Math.round(startH + ev.clientY - startY)));
                if (!moved) { pushUndo(); moved = true; }
                const targets = all ? (state.project.buses || []) : [b];
                targets.forEach(x => { x.height = hgt; });
                targets.forEach(x => document.querySelectorAll(`[data-bus="${CSS.escape(x.id)}"].group-header, [data-bus="${CSS.escape(x.id)}"].timeline-group-row`)
                    .forEach(el => el.style.setProperty('--grp-h', hgt + 'px')));
            };
            const up = () => {
                document.removeEventListener('mousemove', apply);
                document.removeEventListener('mouseup', up);
                document.body.classList.remove('resizing-row');
                if (moved) { saveProject(); renderAll(); }
            };
            document.addEventListener('mousemove', apply);
            document.addEventListener('mouseup', up);
        });
    });
}

// === Largeur du bloc de faders à gauche (inspecteur) : tirer son bord ===
const INSP_W_KEY = 'pulse_insp_w', INSP_W_DEFAULT = 208, INSP_W_MIN = 130, INSP_W_MAX = 420;
function setInspectorWidth(px, persist = true) {
    const w = Math.max(INSP_W_MIN, Math.min(INSP_W_MAX, Math.round(px)));
    document.documentElement.style.setProperty('--insp-w', w + 'px');
    if (persist) { try { localStorage.setItem(INSP_W_KEY, String(w)); } catch {} }
    return w;
}
function initInspectorResizer() {
    const ws = document.querySelector('.workspace'), insp = document.getElementById('inspector');
    if (!ws || !insp || document.getElementById('inspResizer')) return;
    try { const v = parseFloat(localStorage.getItem(INSP_W_KEY)); if (v) setInspectorWidth(v, false); } catch {}
    const bar = document.createElement('div');
    bar.id = 'inspResizer'; bar.className = 'panel-resizer';
    bar.setAttribute('data-tooltip', 'Tire pour élargir ou rétrécir le bloc de faders (double-clic = taille normale)');
    ws.appendChild(bar);
    const place = () => {
        const on = !insp.hidden && insp.offsetWidth > 0;
        bar.style.display = on ? '' : 'none';
        if (on) bar.style.left = (insp.offsetLeft + insp.offsetWidth - 3) + 'px';
    };
    place();
    if (window.ResizeObserver) new ResizeObserver(place).observe(insp);
    new MutationObserver(place).observe(insp, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', place);
    bar.addEventListener('dblclick', () => { setInspectorWidth(INSP_W_DEFAULT); place(); renderTimelineTracks(); flash('Bloc de faders à la largeur normale'); });
    bar.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX, startW = insp.offsetWidth;
        document.body.classList.add('resizing-col');
        const move = (ev) => { setInspectorWidth(startW + ev.clientX - startX, false); place(); };
        const up = (ev) => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.classList.remove('resizing-col');
            setInspectorWidth(startW + ev.clientX - startX, true); place();
            renderTimelineTracks();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

// === Largeur du panneau des pistes : tirer le bord entre les pistes et la timeline ===
const TRACKS_W_KEY = 'pulse_tracks_w', TRACKS_W_DEFAULT = 240, TRACKS_W_MIN = 200, TRACKS_W_MAX = 520;
function setTracksWidth(px, persist = true) {
    const w = Math.max(TRACKS_W_MIN, Math.min(TRACKS_W_MAX, Math.round(px)));
    document.documentElement.style.setProperty('--tracks-w', w + 'px');
    if (persist) { try { localStorage.setItem(TRACKS_W_KEY, String(w)); } catch {} }
    return w;
}
function initPanelResizer() {
    const ws = document.querySelector('.workspace'), panel = document.querySelector('.tracks-panel');
    if (!ws || !panel || document.getElementById('panelResizer')) return;
    try { const v = parseFloat(localStorage.getItem(TRACKS_W_KEY)); if (v) setTracksWidth(v, false); } catch {}
    const bar = document.createElement('div');
    bar.id = 'panelResizer'; bar.className = 'panel-resizer';
    bar.setAttribute('data-tooltip', 'Tire pour élargir ou rétrécir la liste des pistes (double-clic = taille normale)');
    ws.appendChild(bar);
    const place = () => { bar.style.left = (panel.offsetLeft + panel.offsetWidth - 3) + 'px'; };
    place();
    if (window.ResizeObserver) new ResizeObserver(place).observe(panel);
    window.addEventListener('resize', place);
    bar.addEventListener('dblclick', () => { setTracksWidth(TRACKS_W_DEFAULT); flash('Liste des pistes à la largeur normale'); });
    bar.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX, startW = panel.offsetWidth;
        document.body.classList.add('resizing-col');
        const move = (ev) => { setTracksWidth(startW + ev.clientX - startX, false); place(); };
        const up = (ev) => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.classList.remove('resizing-col');
            setTracksWidth(startW + ev.clientX - startX, true); place();
            renderTimelineTracks();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
}

// Tirer dans le studio ne sélectionne jamais de texte et ne lance pas de glisser-déposer natif
// (sinon lâcher le logo ou du texte sur la page la recharge)
document.addEventListener('dragstart', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
});
document.addEventListener('selectstart', (e) => {
    const t = e.target.nodeType === 3 ? e.target.parentElement : e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable="true"], .selectable')) return;
    e.preventDefault();
});

// === Réglages : ⌘ + clic = valeur d'origine (comme Logic) · double-clic = on écrit la valeur ===
// Sur un petit écran un curseur ne permet pas d'être précis : le double-clic ouvre une case où l'on tape le chiffre
// (dB pour un volume, -15 / 15 pour gauche / droite, 0 à 100 pour le reste).
function resetRange(el) {
    el.value = el.dataset.default;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}
document.addEventListener('mousedown', (e) => {
    if (!(e.metaKey || e.ctrlKey || e.altKey) || e.button !== 0) return;
    const el = e.target && e.target.closest ? e.target.closest('input[type="range"][data-default]') : null;
    if (!el || el.disabled) return;
    e.preventDefault(); e.stopPropagation();
    resetRange(el);
}, true);
function openValueEntry(el) {
    document.querySelectorAll('.value-entry').forEach(x => x.remove());
    const isDb = el.matches('.fader, .t-vol, .group-vol');
    const mapped = el.matches('[data-vmap], .t-vol, .group-vol');
    const isPan = el.matches('.insp-pan-input, .bus-pan, [class*="pan"]');
    const r = el.getBoundingClientRect();
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'value-entry db-edit'; inp.inputMode = 'decimal';
    inp.setAttribute('aria-label', isDb ? 'Niveau en dB' : isPan ? 'Gauche / droite' : 'Valeur');
    inp.style.cssText = `position:fixed;z-index:400;left:${Math.max(4, Math.min(window.innerWidth - 84, r.left + r.width / 2 - 38))}px;top:${Math.max(4, r.top + r.height / 2 - 12)}px;width:76px;height:24px;text-align:center`;
    const cur = parseFloat(el.value);
    inp.value = isDb
        ? (cur <= 0 ? '-inf' : (20 * Math.log10((mapped ? posToVol(cur) : cur) / 100)).toFixed(1))
        : String(Math.round(cur * 10) / 10);
    inp.placeholder = isDb ? 'dB' : isPan ? '-15 / 15' : '0-100';
    document.body.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (apply) => {
        if (done) return; done = true;
        const raw = inp.value.trim().toLowerCase().replace(',', '.').replace('−', '-');
        inp.remove();
        if (!apply || !raw) return;
        let v;
        if (isDb) {
            if (/^-?\s*(inf|∞|infini)/.test(raw) || raw === '-') v = 0;
            else {
                let db = parseFloat(raw);
                if (!Number.isFinite(db)) { flash('Écris un niveau en dB, par exemple -6'); return; }
                const maxDb = mapped ? 6 : 0;
                if (db > maxDb) { db = maxDb; flash(mapped ? 'Le fader monte jusqu\'à +6 dB' : 'Le fader monte jusqu\'à 0 dB : au-delà, le son saturerait'); }
                const vol = Math.max(0, Math.min(mapped ? VOL_MAX : 100, Math.round(100 * Math.pow(10, db / 20))));
                v = mapped ? volToPos(vol) : vol;
            }
        } else {
            // gauche / droite : « g15 » ou « -15 » = 15 à gauche, « d15 » ou « 15 » = 15 à droite
            let txt = raw, sign = 1;
            if (isPan) { if (/^(g|l)/.test(txt)) { sign = -1; txt = txt.replace(/^[gl]\s*/, ''); } else if (/^(d|r)/.test(txt)) txt = txt.replace(/^[dr]\s*/, ''); }
            v = parseFloat(txt) * sign;
            if (!Number.isFinite(v)) { flash(isPan ? 'Écris un chiffre : -15 pour 15 à gauche, 15 pour 15 à droite' : 'Écris un chiffre entre ' + el.min + ' et ' + el.max); return; }
            v = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), v));
        }
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    inp.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('mousedown', (ev) => ev.stopPropagation());
}
document.addEventListener('dblclick', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('input[type="range"][data-default]') : null;
    if (!el || el.disabled || e.metaKey || e.ctrlKey) return;
    openValueEntry(el);
});

// === Zoom vertical (hauteur des pistes) ===
// scaleAll : tout grossit ensemble (Option + molette, comme Logic) — les pistes et groupes qu'on avait réglés à la main suivent aussi
// Option + molette au-dessus d'une piste (ou d'un groupe) : seule celle-là grandit / rétrécit (comme Premiere) ;
// ailleurs (règle, vide), toutes les pistes suivent.
function wheelHeightTarget(e) {
    const el = e.target && e.target.closest && e.target.closest('.track-item[data-i], .group-header[data-bus]');
    if (!el) return null;
    if (el.dataset.bus) return { kind: 'bus', id: el.dataset.bus };
    const i = parseInt(el.dataset.i);
    return Number.isFinite(i) ? { kind: 'track', id: i } : null;
}
// Option + molette : la cible est choisie au PREMIER cran et reste la même tant qu'Option est tenue
// (sinon, en rétrécissant, la souris glisse sur la piste voisine et la cible change).
//  - au-dessus d'une piste ou d'un groupe de la LISTE de gauche : celui-là seulement ; si plusieurs pistes sont choisies et que celle-ci en fait partie : les pistes choisies
//  - ailleurs (timeline, règle, vide) : toutes les pistes
let _hLock = null;
function heightWheel(e) {
    // Une vraie pause (plus d'1,2 s) = nouveau geste, même si Option est restée enfoncée
    if (_hLock && performance.now() - _hLock.t > 1200) endHeightLock();
    if (!_hLock) {
        const tg = wheelHeightTarget(e);
        const items = [];
        let all = false;
        if (!tg) {
            all = true;
            state.project.tracks.forEach((t, i) => { if (t.height) items.push({ kind: 'track', id: i, h0: t.height }); });
            (state.project.buses || []).forEach(b => { if (b.height) items.push({ kind: 'bus', id: b.id, h0: b.height }); });
        } else if (tg.kind === 'track') {
            const sel = selectedTrackIdxs();
            const ids = sel.length > 1 && sel.includes(tg.id) ? sel : [tg.id];
            ids.forEach(i => { const t = state.project.tracks[i]; if (t) items.push({ kind: 'track', id: i, h0: trackH(t) }); });
        } else {
            const b = busById(tg.id);
            if (b) items.push({ kind: 'bus', id: tg.id, h0: b.height || 36 });
        }
        _hLock = { all, items, th0: state.trackHeight, F: 1, raf: 0, t: performance.now() };
    }
    // Pas continu et doux : un trackpad donne des petits pas fluides, une molette crantée environ 6 % par cran
    _hLock.t = performance.now();
    _hLock.F *= Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0012);
    if (!_hLock.raf) _hLock.raf = requestAnimationFrame(() => {
        if (!_hLock) return;
        _hLock.raf = 0;
        applyHeightLock();
    });
}
// Redimensionne d'un coup une piste ou un groupe (utilisé aussi par les tests)
function resizeOneHeight(tg, factor) {
    if (tg.kind === 'bus') { const b = busById(tg.id); if (b) b.height = Math.max(GROUP_H_MIN, Math.min(GROUP_H_MAX, Math.round((b.height || 36) * factor))); }
    else { const t = state.project.tracks[tg.id]; if (t) t.height = Math.max(TRACK_H_MIN, Math.min(TRACK_H_MAX, Math.round(trackH(t) * factor))); }
    renderTracksPanel(); bindTrackEvents(); renderTimelineTracks();
    saveProject();
}
function applyHeightLock() {
    const L = _hLock; if (!L) return;
    L.items.forEach(it => {
        if (it.kind === 'bus') {
            const b = busById(it.id); if (b) b.height = Math.max(GROUP_H_MIN, Math.min(GROUP_H_MAX, Math.round(it.h0 * L.F)));
        } else {
            const t = state.project.tracks[it.id]; if (t) t.height = Math.max(TRACK_H_MIN, Math.min(TRACK_H_MAX, Math.round(it.h0 * L.F)));
        }
    });
    if (L.all) {
        state.trackHeight = Math.max(44, Math.min(200, Math.round(L.th0 * L.F)));
        document.documentElement.style.setProperty('--track-h', state.trackHeight + 'px');
    }
    renderTracksPanel(); bindTrackEvents(); renderTimelineTracks();
    L.dirty = true;
}
function endHeightLock() {
    if (!_hLock) return;
    if (_hLock.raf) cancelAnimationFrame(_hLock.raf);
    if (_hLock.F !== 1) { applyHeightLock(); saveProject(); saveViewState(); }
    _hLock = null;
}
document.addEventListener('keyup', (e) => { if (e.key === 'Alt') endHeightLock(); });
window.addEventListener('blur', endHeightLock);
function setTrackHeight(px, scaleAll = false) {
    const old = state.trackHeight;
    state.trackHeight = Math.max(44, Math.min(200, Math.round(px)));
    document.documentElement.style.setProperty('--track-h', state.trackHeight + 'px');
    if (scaleAll && old > 0 && state.trackHeight !== old) {
        const r = state.trackHeight / old;
        state.project.tracks.forEach(t => { if (t.height) t.height = Math.max(TRACK_H_MIN, Math.min(TRACK_H_MAX, Math.round(t.height * r))); });
        (state.project.buses || []).forEach(b => { if (b.height) b.height = Math.max(GROUP_H_MIN, Math.min(GROUP_H_MAX, Math.round(b.height * r))); });
        renderTracksPanel(); bindTrackEvents();
        saveProject();
    }
    renderTimelineTracks();
    saveViewState();
}

// === Outil ciseau : couper un clip en deux au point de clic ===
function splitClipAt(trackIdx, clipIdx, atSec) {
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip || clip.recording) return;
    // Comme Logic : couper une région choisie parmi d'autres coupe toutes les régions choisies au même endroit
    if (state.selectedClips && state.selectedClips.size > 1 && state.selectedClips.has(`${trackIdx}:${clipIdx}`)) {
        splitClipsAt([...state.selectedClips].map(k => k.split(':').map(Number)), atSec);
        return;
    }
    if (clip.loopEnd && clip.loopEnd > clip.start + clip.duration + 1e-6) { flash('Cette région est répétée : supprime sa répétition (clic droit) avant de la scinder'); return; }
    if (atSec <= clip.start || atSec >= clip.start + clip.duration) return;
    pushUndo();
    const left  = { ...clip, duration: atSec - clip.start, loopEnd: undefined, fadeOut: 0 };
    const right = { ...clip, start: atSec, duration: clip.start + clip.duration - atSec,
                    offset: (clip.offset || 0) + (atSec - clip.start), fadeIn: 0,
                    name: (clip.name || 'Clip') + '\'' };
    t.clips.splice(clipIdx, 1, left, right);
    renderTimelineTracks();
    saveProject();
    flash('✂ Région scindée en deux — ⌘Z pour annuler');
}

// Coupe plusieurs régions au même instant (une seule annulation). pairs = [[piste, région], …]
// Les régions que l'instant ne traverse pas sont laissées telles quelles. Après la coupe, les morceaux de droite sont choisis.
function splitClipsAt(pairs, atSec) {
    const byTrack = new Map();
    for (const [ti, ci] of pairs) {
        const c = state.project.tracks[ti]?.clips?.[ci];
        if (!c || c.recording || clipIsLocked(c)) continue;
        if (c.loopEnd && c.loopEnd > c.start + c.duration + 1e-6) continue;
        if (atSec <= c.start + 1e-4 || atSec >= c.start + c.duration - 1e-4) continue;
        if (!byTrack.has(ti)) byTrack.set(ti, []);
        byTrack.get(ti).push(ci);
    }
    if (!byTrack.size) { flash('Aucune région choisie ne passe à cet endroit'); return 0; }
    pushUndo();
    const picked = new Set(); let n = 0;
    for (const [ti, cis] of byTrack) {
        const t = state.project.tracks[ti];
        // on garde les objets (pas les numéros) : les numéros changent à chaque coupe
        const objs = cis.map(ci => t.clips[ci]);
        const rights = [];
        for (const clip of objs) {
            const ci = t.clips.indexOf(clip);
            const left  = { ...clip, duration: atSec - clip.start, loopEnd: undefined, fadeOut: 0 };
            const right = { ...clip, start: atSec, duration: clip.start + clip.duration - atSec,
                            offset: (clip.offset || 0) + (atSec - clip.start), fadeIn: 0, name: (clip.name || 'Clip') + '\'' };
            t.clips.splice(ci, 1, left, right);
            rights.push(right);
            n++;
        }
        for (const r of rights) picked.add(`${ti}:${t.clips.indexOf(r)}`);
    }
    state.selectedClips = picked;
    const first = [...picked][0];
    state.selectedClip = first ? { trackIdx: +first.split(':')[0], clipIdx: +first.split(':')[1] } : null;
    renderTimelineTracks();
    saveProject();
    flash(`✂ ${n} région${n > 1 ? 's' : ''} scindée${n > 1 ? 's' : ''} au même endroit — ⌘Z pour annuler`);
    return n;
}

// ⌘T (comme Logic) : couper à la tête de lecture les régions choisies ; sans sélection, celles de la piste choisie
function splitAtPlayhead() {
    const at = state.playhead;
    let pairs = [];
    if (state.selectedClips && state.selectedClips.size) pairs = [...state.selectedClips].map(k => k.split(':').map(Number));
    else if (state.selectedClip) pairs = [[state.selectedClip.trackIdx, state.selectedClip.clipIdx]];
    else { const ti = state.selectedTrack ?? 0; (state.project.tracks[ti]?.clips || []).forEach((_, ci) => pairs.push([ti, ci])); }
    splitClipsAt(pairs, at);
}

// === ⌘G : bascule entre Libre et le dernier aimant choisi (Intelligent au départ) ===
function toggleSmartMode() {
    setSnapMode(snapSpec().mode !== 'off' ? 'off' : (_snapLast || 'magnet'));
}

// === Fade in/out (style Pro Tools — grande zone de prise) ===
function startFadeDrag(startEvent, fadeDir, trackIdx, clipIdx) {
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip) return;
    if (clipIsLocked(clip)) return;
    pushUndo(); // snapshot avant modification
    const startX = startEvent.clientX;
    const originalFade = fadeDir === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0);
    const o0 = { start: clip.start, duration: clip.duration, offset: clip.offset || 0 };

    // Fondu enchaîné (comme Logic) : on tire la poignée dans l'autre sens, au-delà du bord de la région.
    // Si une autre région touche ce bord, la région s'étend sous elle et les deux se mélangent sur la zone commune.
    const SNAP_NEAR = 0.3;   // une région « collée » : à moins de 0,3 s du bord
    const clipEndSec = (c) => (c.loopEnd && c.loopEnd > c.start + c.duration) ? c.loopEnd : c.start + c.duration;
    const prev = fadeDir === 'in'
        ? t.clips.filter(c => c !== clip && !c.recording && !c.muted && c.start < o0.start && clipEndSec(c) > o0.start - SNAP_NEAR).sort((a, b2) => clipEndSec(b2) - clipEndSec(a))[0]
        : null;
    const next = fadeDir === 'out'
        ? t.clips.filter(c => c !== clip && !c.recording && !c.muted && c.start > o0.start && c.start < o0.start + o0.duration + SNAP_NEAR).sort((a, b2) => a.start - b2.start)[0]
        : null;
    const srcDur = (clip.id && PulseAudio.getBufferDuration && PulseAudio.getBufferDuration(clip.id)) || (o0.offset + o0.duration);
    let crossed = 0;

    const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dt = dx / state.pxPerSecond;
        const delta = fadeDir === 'in' ? dt : -dt;          // > 0 : le fondu s'allonge (sens normal)
        const inverse = Math.max(0, -delta - originalFade);  // > 0 : on a tout rétréci et on continue dans l'autre sens
        // Tire dans le sens normal : le fondu classique
        // et dans l'autre sens il le raccourcit d'abord (jusqu'à 0), puis seulement ensuite le fondu enchaîné s'étend
        const newFade = Math.max(0, Math.min(clip.duration * 0.9, originalFade + delta));
        if (fadeDir === 'in') clip.fadeIn = newFade; else clip.fadeOut = newFade;
        // Tire dans le sens inverse : fondu enchaîné avec la région voisine
        let ext = 0;
        if (inverse > 0 && (fadeDir === 'in' ? prev : next)) {
            if (fadeDir === 'in') ext = Math.min(inverse, o0.offset, o0.duration * 0.9);      // du son à récupérer avant le début
            else ext = Math.min(inverse, Math.max(0, srcDur - (o0.offset + o0.duration)), o0.duration * 0.9);  // du son après la fin
        }
        if (fadeDir === 'in') {
            clip.start = o0.start - ext; clip.offset = o0.offset - ext; clip.duration = o0.duration + ext;
        } else {
            clip.duration = o0.duration + ext;
        }
        crossed = ext;
        if (inverse > 0 && !(fadeDir === 'in' ? prev : next)) {
            if (!onMove._warned) { onMove._warned = true; flash('Pour un fondu enchaîné, colle d\'abord cette région à une autre sur la même piste'); }
        }
        const clipEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (clipEl) {
            clipEl.style.left = (clip.start * state.pxPerSecond) + 'px';
            clipEl.style.width = (clip.duration * state.pxPerSecond) + 'px';
            updateClipFadeVisual(clipEl, clip, fadeDir);
        }
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging');
        renderTimelineTracks();
        saveProject();
        refreshPlaybackSoon();
        if (crossed > 0.01) flash(`✓ Fondu enchaîné de ${Math.round(crossed * 1000)} ms entre les deux régions — tire dans l'autre sens pour le réduire`);
    };

    document.body.classList.add('is-dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    startEvent.preventDefault();
    startEvent.stopPropagation();
}

function startFadeCurveDrag(startEvent, fadeDir, trackIdx, clipIdx) {
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;
    const key = fadeDir === 'in' ? 'fadeInCurve' : 'fadeOutCurve';
    const clipEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
    const H = Math.max(30, clipEl ? clipEl.getBoundingClientRect().height : 60);
    const startY = startEvent.clientY, g0 = Math.pow(0.5, fadeK(clip, fadeDir));
    let moved = false;
    document.body.classList.add('resizing-row');
    const onMove = (ev) => {
        if (!moved) { pushUndo(); moved = true; }
        // Niveau du fondu à mi-chemin : plus la poignée monte, plus le fondu est rapide au début
        const g = Math.max(0.06, Math.min(0.94, g0 - (ev.clientY - startY) / (H * 1.5)));
        let k = Math.log(g) / Math.log(0.5);
        k = Math.max(FADE_K_MIN, Math.min(FADE_K_MAX, k));
        if (Math.abs(k - 1) < 0.04) delete clip[key]; else clip[key] = Math.round(k * 100) / 100;
        const el = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (el) updateClipFadeVisual(el, clip);
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('resizing-row');
        if (moved) { saveProject(); refreshPlaybackSoon(); }
        renderTimelineTracks();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    startEvent.preventDefault(); startEvent.stopPropagation();
}

function updateClipFadeVisual(clipEl, clip, activeDir) {
    const widthPx = parseFloat(clipEl.style.width) || 0;
    ['in', 'out'].forEach(dir => {
        const fadeSec = dir === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0);
        const fadePx  = Math.min(fadeSec * state.pxPerSecond, widthPx * 0.9);
        const k = fadeK(clip, dir);
        let el = clipEl.querySelector(`.clip-fade-overlay.${dir}`);
        let hd = clipEl.querySelector(`.fade-curve-handle.${dir}`);
        if (fadePx > 0) {
            if (!el) {
                el = document.createElement('div');
                el.className = `clip-fade-overlay ${dir}`;
                clipEl.appendChild(el);
            }
            if (!hd) {
                hd = document.createElement('div');
                hd.className = `fade-curve-handle ${dir}`;
                hd.dataset.fade = dir;
                hd.dataset.tooltip = 'Tire vers le haut ou le bas pour arrondir le fondu (double-clic = droit)';
                clipEl.appendChild(hd);
            }
            el.style.width = fadePx + 'px';
            el.innerHTML = fadeLine(dir, k);
            hd.style.cssText = fadeHandleStyle(dir, fadePx, k);
        } else {
            if (el) el.remove();
            if (hd) hd.remove();
        }
    });
    // Le spectre est redessiné avec le fondu
    const wave = clipEl.querySelector('.clip-wave-svg:not(.loop-wave)');
    const origW = parseFloat(clipEl.style.getPropertyValue('--orig-w'));
    if (wave && origW > 0) wave.outerHTML = renderClipWaveform(clip, origW);
    // Durée exacte pendant qu'on tire
    if (activeDir) {
        let badge = clipEl.querySelector('.fade-badge');
        if (!badge) { badge = document.createElement('div'); badge.className = 'fade-badge'; clipEl.appendChild(badge); }
        const sec = activeDir === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0);
        badge.textContent = sec < 1 ? `${Math.round(sec * 1000)} ms` : `${sec.toFixed(2)} s`;
        badge.className = `fade-badge ${activeDir}`;
    }
}

// === Basculer l'outil actif (pointer / scissors) ===
function setActiveTool(name) {
    if (typeof setMouseTool === 'function') { setMouseTool('left', name === 'scissors' ? 'cut' : 'pointer', true); }
    state.tool = name;
    document.body.classList.toggle('tool-scissors', name === 'scissors');
    const btn = document.getElementById('btnScissors');
    if (btn) btn.classList.toggle('active', name === 'scissors');
    if (name === 'scissors') flash('Outil ciseau — clique sur un clip pour couper · B pour quitter');
}

function applyI18n(root = document) {
    if (!window.PulseI18n) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const txt = PulseI18n.t(key);
        if (typeof txt === 'string') el.textContent = txt;
    });
}

// Vérifie si un autosave plus récent existe et propose de le restaurer
function checkAutosaveRecovery() {
    try {
        const autoData = localStorage.getItem('pulse_autosave');
        if (!autoData) return;
        const autoParsed = JSON.parse(autoData);
        // Une copie de secours appartient à un projet précis : jamais proposée sur un autre
        if (!autoParsed.id || !state.project || autoParsed.id !== state.project.id) return;
        // Si l'autosave a plus de contenu que le projet actuel, proposer
        const autoClips = (autoParsed.tracks || []).flatMap(t => t.clips || []).length;
        const currClips = state.project.tracks.flatMap(t => t.clips || []).length;
        if (autoClips > currClips && autoClips > 0) {
            // Flash non-intrusif avec possibilité de restaurer
            const banner = document.createElement('div');
            banner.style.cssText = `position:fixed;top:52px;left:50%;transform:translateX(-50%);
                background:var(--bg-2);border:1px solid var(--border);border-radius:10px;
                padding:12px 20px;z-index:2000;font-size:13px;color:var(--text-1);
                box-shadow:0 8px 32px rgba(0,0,0,0.5);display:flex;gap:12px;align-items:center`;
            banner.innerHTML = `<span>Une sauvegarde plus récente de ce projet existe (${autoClips} clip${autoClips>1?'s':''})</span>
                <button class="btn-primary" id="autosaveRestore" style="font-size:12px;padding:4px 12px">La reprendre</button>
                <button class="btn-ghost" id="autosaveDismiss" style="font-size:12px;padding:4px 12px">Ignorer</button>`;
            document.body.appendChild(banner);
            document.getElementById('autosaveRestore').addEventListener('click', () => {
                pushUndo();
                state.project = autoParsed;
                localStorage.setItem('pulse_current_project', autoData);
                migrateProject();
                renderAll();
                banner.remove();
                flash('✓ Sauvegarde reprise — ⌘Z pour revenir à l\'autre version');
            });
            document.getElementById('autosaveDismiss').addEventListener('click', () => {
                banner.remove();
                localStorage.removeItem('pulse_autosave');
            });
        }
    } catch {}
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    if (window.PulseI18n) {
        await PulseI18n.load();
        applyI18n();
        if (PulseI18n.startAuto) await PulseI18n.startAuto();   // anglais : traduit les textes affichés
    }
    initProjectName();
    await PulseAudio.init();
    restoreViewState();
    await restoreBuffersFromDisk();
    renderAll();
    await importPendingInstru();
    cleanupOrphanAudio();
    bindTimelineClick();
    bindGlobalDragDrop();
    startVuMeterLoop();

    // Onboarding uniquement au premier lancement
    setTimeout(() => startOnboarding(), 400);
    // Vérifier autosave après 1s (éviter conflit avec l'onboarding)
    setTimeout(() => checkAutosaveRecovery(), 1200);

    // Chrono : clic pour basculer entre TC et barres:beats
    document.getElementById('chrono').addEventListener('click', () => {
        _chronoMode = _chronoMode === 'tc' ? 'bars' : 'tc';
        _chronoLast = '';
        updateChrono();
    });
    document.getElementById('chrono').style.cursor = 'pointer';

    document.getElementById('btnPlay').addEventListener('click', togglePlay);
    document.getElementById('btnRec').addEventListener('click', toggleRec);
    document.getElementById('btnBack').addEventListener('click', rewind);
    document.getElementById('btnMixer').addEventListener('click', toggleMixer);
    document.getElementById('btnMixerClose').addEventListener('click', toggleMixer);
    document.getElementById('btnAddTrack').addEventListener('click', (e) => addTrack(null, e.currentTarget));
    document.getElementById('btnLoop').addEventListener('click', () => {
        if (!state.loop) {
            flash('Pour répéter un passage : maintiens Maj et glisse sur la timeline pour le choisir');
            return;
        }
        state.looping = !state.looping;
        updateLoopButton();
        renderLoopOverlay();
    });
    document.getElementById('btnMetronome').addEventListener('click', () => {
        state.metronome = !state.metronome;
        document.getElementById('btnMetronome').style.color = state.metronome ? 'var(--violet-3)' : '';
        document.getElementById('btnMetronome').classList.toggle('active', state.metronome);
        flash(state.metronome ? 'Métronome allumé : un clic au rythme du morceau' : 'Métronome éteint');
        if (state.metronome) {
            PulseAudio.setMetronome(true, state.project.bpm);
            if (state.playing) PulseAudio.startMetronome(state.project.bpm, state.playhead, state.project);
        } else {
            PulseAudio.setMetronome(false);
        }
    });

    // Count-in toggle (persisté dans localStorage)
    const COUNTIN_KEY = 'pulse_countin';
    const btnCountIn = document.getElementById('btnCountIn');
    const savedCountIn = localStorage.getItem(COUNTIN_KEY);
    const initialCountIn = savedCountIn === null ? true : savedCountIn === '1';
    PulseAudio.setCountIn(initialCountIn);
    btnCountIn.classList.toggle('active', initialCountIn);
    btnCountIn.addEventListener('click', () => {
        const next = !PulseAudio.isCountInEnabled();
        PulseAudio.setCountIn(next);
        btnCountIn.classList.toggle('active', next);
        localStorage.setItem(COUNTIN_KEY, next ? '1' : '0');
        flash(next ? 'Count-in activé (4 beats avant rec)' : 'Count-in désactivé — rec immédiat');
    });
    document.getElementById('btnMic').addEventListener('click', (e) => openMicMenu(e.currentTarget));
    document.getElementById('btnSettings').addEventListener('click', openSettings);
    migrateProject();
    initLyrics();
    initInspector();
    document.getElementById('btnSave').addEventListener('click', () => saveProjectFolder(false));

    initSnapControl();

    document.getElementById('bpmInput').addEventListener('change', e => {
        const v = parseInt(e.target.value);
        if (!(v >= 40 && v <= 240)) {
            e.target.value = state.project.bpm;
            flash('Le tempo va de 40 à 240 BPM');
            e.target.blur();
            return;
        }
        if (tempoVaries()) {
            // tempo qui change en cours de morceau : on règle le palier où se trouve la tête de lecture (comme Logic)
            e.target.blur();
            const segs = PulseTempo.tempoSegments(state.project), t = Math.max(0, state.playhead);
            let seg = segs[0]; segs.forEach(x => { if (x.sec <= t + 1e-9) seg = x; });
            if (Math.abs(seg.bpm - v) < 1e-6) { syncBpmField(); return; }
            pushUndo();
            setTempoAtBeat(seg.beat, v);
            tempoMapChanged();
            const bar = PulseTempo.beatsToBar(state.project, seg.beat).bar + 1;
            flash(seg.beat < 1e-6 ? `Le morceau commence à ${roundBpm(v)} BPM` : `À partir de la mesure ${bar} : ${roundBpm(v)} BPM`);
            return;
        }
        {
            if (v !== state.project.bpm) pushUndo();
            e.target.blur();
            state.project.bpm = v; refreshPlaybackSoon(); // les échos calés sur le rythme suivent le nouveau tempo
            if (window.PulseAudio) PulseAudio.setMetronomeBpm(v);
            if ((state.project.tempos || state.project.signatures) && typeof tempoMapChanged === 'function') tempoMapChanged();   // premier palier de la carte
            else {
                renderRuler();
                renderTimelineGrid(document.getElementById('timelineTracks'));
                saveProject();
            }
        }
    });

    // Zoom vertical depuis le panneau pistes (Option+scroll)
    document.getElementById('tracksList').addEventListener('wheel', (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        heightWheel(e);
    }, { passive: false });

    // Initialiser la hauteur des pistes
    setTrackHeight(state.trackHeight);

    document.getElementById('btnScissors').addEventListener('click', () => setActiveTool(state.tool === 'scissors' ? 'pointer' : 'scissors'));
    // Menus d'outils façon Logic (outil du clic gardé d'une séance à l'autre)
    renderToolMenus();
    document.body.dataset.leftTool = mouseTool('left');
    if (mouseTool('left') === 'cut') { state.tool = 'scissors'; document.body.classList.add('tool-scissors'); document.getElementById('btnScissors').classList.add('active'); }
    document.getElementById('btnTap').addEventListener('click', toggleTapMode);
    document.getElementById('btnExport').addEventListener('click', exportProject);
    document.getElementById('btnHelp').addEventListener('click', openCheatSheet);
    document.getElementById('btnBpmHalf').addEventListener('click', () => adjustBpm(0.5));
    document.getElementById('btnBpmDouble').addEventListener('click', () => adjustBpm(2));

    // Fader master (mixer footer)
    const masterFader = document.querySelector('.mixer-master .fader');
    const masterDbEl  = document.querySelector('.mixer-master .strip-db');
    if (masterFader) {
        masterFader.addEventListener('input', () => {
            const v = posToVol(parseFloat(masterFader.value));
            if (window.PulseAudio) PulseAudio.setMasterVolume(v);
            state.project.masterVolume = v;
            if (masterDbEl) masterDbEl.textContent = `${volumeToDb(v)} dB`;
        });
        masterFader.addEventListener('change', () => saveProject());
    }

    // Raccourcis clavier — philosophie : main gauche en priorité, zéro déplacement
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

        const mod = e.metaKey || e.ctrlKey;
        const shift = e.shiftKey;
        const k = e.key.toLowerCase();

        // Modifiers d'abord
        if (mod && shift && k === 's') { e.preventDefault(); clearAllSolos(); return; }
        if (mod && shift && k === 't') { e.preventDefault(); _doAddTrack('audio'); return; }
        if (mod && !shift && !e.altKey && k === 't') { e.preventDefault(); splitAtPlayhead(); return; }
        if (mod && e.altKey && e.code === 'KeyS') { e.preventDefault(); saveProjectFolder(true); return; }   // ⌘⌥S = Enregistrer sous… (choisir un autre dossier)
        if (mod && k === 's')          { e.preventDefault(); saveProjectFolder(false); return; }
        if (mod && k === 'z' && !shift){ e.preventDefault(); undoAction(); return; }
        if (mod && k === 'z' && shift) { e.preventDefault(); redoAction(); return; }
        if (mod && e.key === 'Enter') {
            e.preventDefault();
            // Cmd+Enter : joue depuis le début de la boucle / sélection
            if (state.loop) {
                const ls = Math.min(state.loop.start, state.loop.end);
                state.playhead = ls;
                updatePlayhead(); updateChrono();
            }
            if (!state.playing) togglePlay();
            return;
        }
        if (mod && k === 'e')          { e.preventDefault(); exportProject(); return; }
        if (mod && k === 'n')          { e.preventDefault(); window.location.href = 'index.html'; return; }
        if (mod && k === 'a')          { e.preventDefault(); if (e.altKey) selectAllClipsOnTrack(); else selectAllClips(); return; }
        if (mod && shift && k === 'f') { e.preventDefault(); zoomToFit(); return; }
        if (mod && k === 'd')          { e.preventDefault(); duplicateTrack(state.selectedTrack); return; }
        if (mod && k === 'g')          { e.preventDefault(); toggleSmartMode(); return; }
        if (mod && k === 'c')          { e.preventDefault(); copySelectedClip(); return; }
        if (mod && k === 'r' && !shift && !e.altKey) { e.preventDefault(); repeatSelectedClip(); return; }
        if (mod && k === 'v')          { e.preventDefault(); pasteClip(); return; }

        // Transport (Espace est détourné en mode tap)
        const onButton = e.target && e.target.closest && e.target.closest('button, [role="button"], select, a[href]');
        // Un bouton atteint au clavier (Tab) reçoit Espace / Entrée ; après un simple clic souris, Espace reste « lecture »
        let kbFocus = false; try { kbFocus = !!onButton && onButton.matches(':focus-visible'); } catch {}
        if (kbFocus && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return;
        if (e.code === 'Space') {
            e.preventDefault();
            if (state.tapMode) tapOnce();
            else togglePlay();
            return;
        }
        if (e.code === 'Enter' || e.code === 'NumpadEnter')  { e.preventDefault(); rewind(); return; }
        if (k === 'r') { toggleRec(); return; }

        // Édition (coupes rapides) : D efface ce qui est à gauche du curseur de base, F ce qui est à droite (Z / E = zoom : tout reste près de R)
        if (k === 'd' && !shift && !mod && !e.altKey) { e.preventDefault(); trimLeft(); return; }
        if (k === 'f' && !shift && !mod && !e.altKey) { e.preventDefault(); trimRight(); return; }
        // ⌘X / Ctrl+X : couper la région (la copier et l'effacer d'un coup), main droite restée sur la souris
        // Une plage glissée part comme avec Suppr (les bords des régions sont coupés, sur toutes les pistes de la plage)
        if (mod && k === 'x' && !shift) { e.preventDefault(); if (!state.selectedClip && state.selection) deleteSelection(); else cutSelectedClip(); return; }
        // ⌘Q / Ctrl+Q : quitter le logiciel
        if (mod && k === 'q') { e.preventDefault(); quitApp(); return; }

        // Piste sélectionnée
        if (k === 's' && !mod && !e.altKey) { e.preventDefault(); selectedTrackIdxs().forEach(i => toggleSolo(i)); return; }   // S = solo / désolo de la piste choisie (M = mute)
        if (e.altKey && e.code === 'KeyC' && !mod) { e.preventDefault(); openColorPanel(); return; }   // ⌥C = panneau de couleurs (⌥+C donne « ç » sur Mac)
        if (e.altKey && e.code === 'KeyS' && !mod) { e.preventDefault(); selectedTrackIdxs().forEach(i => toggleSolo(i)); return; }  // ⌥S = solo (⌥+S donne « ß » sur Mac)
        if (k === 'm') { selectedTrackIdxs().forEach(i => toggleMute(i)); return; }

        // Transport secondaires
        if (k === 'u' && !mod && !shift && !e.altKey) { e.preventDefault(); loopFromSelection(); return; }
        if (k === 'l' || (k === 'c' && !mod && !shift && !e.altKey)) { document.getElementById('btnLoop').click(); return; }   // C = boucle (cycle) comme dans Logic
        if (k === 'k') { document.getElementById('btnMetronome').click(); return; }  // K = click/métronome (comme Logic)
        if (k === 't') { e.preventDefault(); toggleTapMode(); return; }
        if (k === 'y' && !mod) { e.preventDefault(); openToolMenu('left', _lastMouse.x, _lastMouse.y); return; }   // Y = menu des outils, là où est la souris (T de Logic ; ici T = tap tempo)              // T = toggle mode tap (puis Espace tape)

        // Zoom (Pro Tools style, adapté : E = zoom in, Z = zoom out)
        // E / Z : zoom calé sur la souris si elle est sur la timeline, sinon sur le curseur de base ; le défilement auto se met en pause
        if (k === 'e') { e.preventDefault(); suspendFollow(); const zt = zoomTarget(); setZoom(state.pxPerSecond * 1.25, zt.sec, zt.center); return; }
        if (k === 'z' && !mod) { e.preventDefault(); suspendFollow(); const zt = zoomTarget(); setZoom(state.pxPerSecond / 1.25, zt.sec, zt.center); return; }

        // Mode automation
        if (k === 'a' && !mod) { e.preventDefault(); toggleAutomationMode(); return; }

        // Outil ciseau
        if (k === 'b') { e.preventDefault(); setActiveTool(state.tool === 'scissors' ? 'pointer' : 'scissors'); return; }

        // Flèches : elles déplacent le curseur (façon Pro Tools, tout se fait sans souris).
        // ← / → = un temps (Shift = une mesure) · ↑ / ↓ = changer de piste · Tab = bord de clip suivant
        // ⌘← / ⌘→ = nudger le clip sélectionné (sans clip : début / fin du morceau)
        if (!e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
            e.preventDefault();
            const dir = e.code === 'ArrowLeft' ? -1 : +1;
            if (mod) {
                if (state.selectedClip) nudgeSelectedClip(dir, shift);
                else seekPlayhead(dir < 0 ? 0 : computeProjectEndSec());
            } else if (state.playing && state.playOrigin != null && returnOnStop() && !state.recording) stepPlayOrigin(dir, shift ? 'bar' : 'beat');
            else stepPlayhead(dir, shift ? 'bar' : 'beat');
            return;
        }
        if (!e.altKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
            e.preventDefault();
            // On saute les pistes cachées dans un groupe replié
            const dir = e.code === 'ArrowUp' ? -1 : 1, tl = state.project.tracks;
            let nx = state.selectedTrack + dir;
            while (tl[nx] && isTrackFolded(tl[nx])) nx += dir;
            if (tl[nx]) selectTrack(nx);
            return;
        }
        // Tab / Maj+Tab : bord de clip suivant / précédent (façon Pro Tools)
        if (e.code === 'Tab' && !mod && !e.altKey) { e.preventDefault(); jumpToClipEdge(shift ? -1 : +1); return; }
        if (e.code === 'Home' && !mod) { e.preventDefault(); seekPlayhead(0); return; }
        if (e.code === 'End'  && !mod) { e.preventDefault(); seekPlayhead(computeProjectEndSec()); return; }

        // Mixer
        if (k === 'x' && !mod) { e.preventDefault(); toggleMixer(); return; }

        // Marqueurs (Alt+M = poser, Alt+← = marqueur précédent, Alt+→ = suivant)
        if (e.altKey && k === 'm') { e.preventDefault(); addMarker(state.playhead); return; }
        if (e.altKey && e.code === 'ArrowLeft'  && !mod) { e.preventDefault(); navigateMarker(-1); return; }
        if (e.altKey && e.code === 'ArrowRight' && !mod) { e.preventDefault(); navigateMarker(+1); return; }

        // ⇧F = Zoom sur le clip sélectionné (F seul = couper à droite)
        if (k === 'f' && shift && !mod) {
            e.preventDefault();
            if (state.selectedClip) {
                const { trackIdx, clipIdx } = state.selectedClip;
                const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
                if (clip) {
                    const tl = document.querySelector('.timeline');
                    const dur = clip.duration;
                    const availW = tl ? tl.clientWidth - 60 : 600;
                    const newPx = Math.max(ZOOM_MIN, Math.min(zoomMax(), (availW * 0.8) / dur));
                    setZoom(newPx, clip.start + dur / 2);
                    flash('Zoom : clip sélectionné');
                } else {
                    zoomToFit();
                }
            } else {
                zoomToFit();
            }
            return;
        }

        // ? ou H ouvre la cheat sheet raccourcis
        if (k === '?' || k === 'h' || (e.key === '/' && shift)) {
            e.preventDefault();
            openCheatSheet();
            return;
        }

        // Suppr / Backspace → efface le clip sélectionné, sinon la plage
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (mod) { e.preventDefault(); deleteSelectedTrack(); return; }
            if (state.selectedClip) { e.preventDefault(); deleteSelectedClip(); return; }
            if (state.selection) { e.preventDefault(); deleteSelection(); return; }
        }

        // Échap → ferme cheat sheet, remet le pointeur, puis annule sélection
        if (e.key === 'Escape') {
            if (document.getElementById('cheatModal')) { closeCheatSheet(); return; }
            if (state.tool !== 'pointer') { setActiveTool('pointer'); return; }
            if (state.selectedClip || state.selectedClips.size > 0) {
                state.selectedClip = null; state.selectedClips.clear(); renderTimelineTracks(); return;
            }
            if (state.selection || state.loop) { clearRangeSelection(); return; }
        }
    });

    updateChrono();
    updateUndoBtn();
    updateDocTitle();

    initPanelResizer();
    initInspectorResizer();
    watchWarpTempo();

    // Câbler le bouton Undo de la topbar
    document.getElementById('btnUndo').addEventListener('click', undoAction);

    // Synchroniser le scroll vertical entre le panneau pistes et la timeline
    const tracksPanel = document.querySelector('.tracks-panel');
    const timeline    = document.querySelector('.timeline');
    timeline.addEventListener('scroll', refreshFineWaves, { passive: true });
    timeline.addEventListener('scroll', () => timeline.style.setProperty('--tl-sl', timeline.scrollLeft + 'px'), { passive: true });   // la pastille d'automation reste visible à gauche
    // Une seule zone de défilement pour l'œil : la molette / le trackpad au-dessus des pistes OU de la timeline
    // fait bouger les deux dans la même image (sinon la colonne des pistes suivait avec un léger retard)
    const wheelBoth = (e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;   // zoom / hauteur : gérés ailleurs
        if (e.target.closest && e.target.closest('input, select, textarea, .t-knob, .insp-knob, .tool-menu, .track-ctx-menu')) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? timeline.clientHeight : 1;
        let dx = e.deltaX * unit, dy = e.deltaY * unit;
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }     // Shift + molette = défilement horizontal
        e.preventDefault();
        if (dx) { timeline.scrollLeft += dx; suspendFollow(); }
        if (dy) {
            const top = Math.max(0, Math.min(timeline.scrollHeight - timeline.clientHeight, timeline.scrollTop + dy));
            _echoTL = top; timeline.scrollTop = top;
            _echoTP = top; tracksPanel.scrollTop = top;
        }
    };
    timeline.addEventListener('wheel', wheelBoth, { passive: false });
    tracksPanel.addEventListener('wheel', wheelBoth, { passive: false });
    // Le dernier défilement imposé à l'autre côté est ignoré quand il revient (sinon les deux se renvoient la balle)
    let _echoTL = null, _echoTP = null;
    tracksPanel.addEventListener('scroll', () => {
        if (_echoTP !== null && Math.abs(tracksPanel.scrollTop - _echoTP) < 1) { _echoTP = null; return; }
        if (Math.abs(timeline.scrollTop - tracksPanel.scrollTop) < 1) return;
        _echoTL = tracksPanel.scrollTop; timeline.scrollTop = tracksPanel.scrollTop;
        if (Math.abs(timeline.scrollTop - _echoTL) >= 1) _echoTL = timeline.scrollTop;   // l'autre côté a plafonné
    }, { passive: true });
    timeline.addEventListener('scroll', () => {
        if (_echoTL !== null && Math.abs(timeline.scrollTop - _echoTL) < 1) { _echoTL = null; return; }
        if (Math.abs(tracksPanel.scrollTop - timeline.scrollTop) < 1) return;
        _echoTP = timeline.scrollTop; tracksPanel.scrollTop = timeline.scrollTop;
        if (Math.abs(tracksPanel.scrollTop - _echoTP) >= 1) _echoTP = tracksPanel.scrollTop;
    }, { passive: true });

    // Avertissement avant fermeture si non-sauvegardé
    window.addEventListener('beforeunload', (e) => {
        const hasContent = state.project.tracks.some(t => (t.clips || []).length > 0);
        if (!hasContent || _skipUnloadGuard) return;
        if (JSON.stringify(state.project) !== _lastSavedSnapshot) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
});

// Rechargement inattendu (fenêtre de l'appli relancée par le système, souvent faute de mémoire) : on le repère et on le dit,
// pour comprendre le « flash blanc » (journal : localStorage pulse_reload_log)
(() => {
    try {
        // pulse_alive est rafraîchi toutes les 3 s : un plantage recharge la page dans la foulée (battement récent),
        // alors qu'après un ⌘Q (où pagehide n'arrive pas toujours) l'appli est relancée bien plus tard → pas d'alerte.
        const alive = localStorage.getItem('pulse_alive'), clean = localStorage.getItem('pulse_clean_exit');
        if (alive && !clean && Date.now() - +alive < 12000) {
            const log = JSON.parse(localStorage.getItem('pulse_reload_log') || '[]');
            log.push({ at: new Date().toISOString(), alive: +alive });
            localStorage.setItem('pulse_reload_log', JSON.stringify(log.slice(-20)));
            setTimeout(() => flash('Pulse vient d\'être relancé par le système (ton projet est gardé). Si tu as vu un flash blanc, c\'était ça : dis-le à Claude.'), 1500);
        }
        localStorage.removeItem('pulse_clean_exit');
        localStorage.setItem('pulse_alive', String(Date.now()));
        setInterval(() => { try { localStorage.setItem('pulse_alive', String(Date.now())); } catch {} }, 3000);
        window.addEventListener('pagehide', () => { try { localStorage.setItem('pulse_clean_exit', '1'); } catch {} });
    } catch {}
})();
// Avertissement laissé par l'ouverture d'un projet (la page vient d'être rechargée)
(() => { try { const w = sessionStorage.getItem('pulse_open_warn'); if (w) { sessionStorage.removeItem('pulse_open_warn'); setTimeout(() => flash(w), 1800); } } catch {} })();
function flash(msg) {
    let el = document.getElementById('flash');
    if (!el) {
        el = document.createElement('div');
        el.id = 'flash';
        el.style.cssText = `
            position: fixed; left: 50%; transform: translateX(-50%) translateY(0);
            background: var(--bg-3); color: var(--text-1); padding: 8px 18px;
            border-radius: 10px; font-size: 12.5px; z-index: 1500;
            box-shadow: 0 8px 32px rgba(0,0,0,0.45); opacity: 0;
            transition: opacity 0.18s, transform 0.25s;
            border: 1px solid var(--border); white-space: normal; text-align: center; line-height: 1.35;
            pointer-events: none; max-width: min(80vw, 720px);
        `;
        document.body.appendChild(el);
    }
    // Se positionne au-dessus du transport (footer)
    const transport = document.querySelector('.transport');
    const transportTop = transport ? transport.getBoundingClientRect().top : window.innerHeight;
    el.style.bottom = (window.innerHeight - transportTop + 12) + 'px';
    el.style.top = '';
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._to);
    el._to = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-6px)';
    }, Math.min(7000, 1800 + Math.max(0, String(msg).length - 45) * 55));   // un long message reste le temps de le lire
}

// === Raccourcis affichés selon l'ordinateur ===
// Les raccourcis marchent déjà avec Ctrl sur Windows (⌘ ou Ctrl comptent pareil) ; ici on change seulement ce qu'on LIT :
// sur Windows / Linux, « ⌘ » devient « Ctrl », « ⌥ » devient « Alt », « ⇧ » devient « Maj » (infobulles, aide, messages).
(function platformKeys() {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent || '');
    if (isMac) return;
    const SYM = /[⌘⌥⇧]/;
    const names = { '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Maj' };
    const fix = (s) => s
        .replace(/([⌘⌥⇧])(?=[⌘⌥⇧A-Za-z0-9←→↑↓,.\/\[\]-])/g, (m) => names[m] + '+')   // ⌘S → Ctrl+S, ⌘⌥S → Ctrl+Alt+S
        .replace(/[⌘⌥⇧]/g, (m) => names[m]);                                          // ⌘ + clic → Ctrl + clic
    const fixNode = (n) => {
        if (n.nodeType === 3) { if (SYM.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue); return; }
        if (n.nodeType !== 1) return;
        const els = [n, ...n.querySelectorAll('[data-tooltip],[title],[aria-label],[placeholder]')];
        els.forEach(el => ['data-tooltip', 'title', 'aria-label', 'placeholder'].forEach(a => { const v = el.getAttribute && el.getAttribute(a); if (v && SYM.test(v)) el.setAttribute(a, fix(v)); }));
        const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
        let t; while ((t = tw.nextNode())) if (SYM.test(t.nodeValue)) t.nodeValue = fix(t.nodeValue);
    };
    const start = () => {
        fixNode(document.body);
        // les changements sont regroupés : un seul passage après une rafale de mises à jour (pas de calcul à chaque dessin)
        let pending = new Set(), timer = 0;
        const flushPending = () => { timer = 0; const list = pending; pending = new Set(); list.forEach(n => { if (n.isConnected) fixNode(n); }); };
        new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'childList') m.addedNodes.forEach(n => pending.add(n));
                else pending.add(m.target);
            }
            if (!timer) timer = setTimeout(flushPending, 60);
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-tooltip', 'title', 'aria-label'] });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();


// === Graduation en dB à côté des faders (mixeur et panneau de gauche), comme sur une console ===
const FADER_DB_TICKS = [6, 0, -6, -12, -24];
function addFaderScales(root) {
    (root || document).querySelectorAll('input.fader[data-vmap]').forEach(f => {
        const host = f.parentElement;
        if (!host || host.querySelector(':scope > .fader-scale')) return;
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        const H = f.offsetHeight || 160, thumb = 14;
        const sc = document.createElement('div');
        sc.className = 'fader-scale'; sc.setAttribute('aria-hidden', 'true');
        sc.style.cssText = `left:${f.offsetLeft + f.offsetWidth + 1}px;top:${f.offsetTop}px;height:${H}px`;
        sc.innerHTML = FADER_DB_TICKS.map(db => {
            const pos = volToPos(Math.round(100 * Math.pow(10, db / 20)));
            return `<i style="bottom:${(thumb / 2 + pos / 100 * (H - thumb)).toFixed(1)}px"><b></b>${db > 0 ? '+' + db : db}</i>`;
        }).join('');
        host.appendChild(sc);
    });
}
['renderMixer', 'renderInspector'].forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
        const r = orig.apply(this, arguments);
        try { addFaderScales(name === 'renderMixer' ? document.getElementById('mixerStrips') : document.getElementById('inspector')); } catch (e) { console.warn('graduation fader', e); }
        return r;
    };
});
