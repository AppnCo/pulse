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
// Une couleur par famille de piste : voix = violet, piano = turquoise, batterie = orange, instru/beat = rose
const TYPE_COLORS = { audio: '#A855F7', keys: '#22D3EE', drums: '#F59E0B', inst: '#F472B6', beat: '#F472B6' };

// Piste d'instru : modèle (preset), ancien type « instru » ou piste créée par le menu + (« inst »)
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
            // Capture Lane est TOUJOURS armée au chargement
            armed: t.isCapture ? true : (t.armed || false)
        }));
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
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
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
function setAsideRange(t, s, e, except) {
    t.takes = t.takes || [];
    let n = 0;
    const out = [];
    for (const c of (t.clips || [])) {
        if (c === except || c.recording) { out.push(c); continue; }
        const r = carveClip(c, s, e);
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
            ${t.takes.map((c, pi) => (c.take || 0) === n ? piece(c, '', `data-ti="${i}" data-pi="${pi}"`, `Prise ${takeLetter(n)} — clique pour la remettre devant`) : '').join('')}
        </div>`).join('')}
    </div>`;
}
function bindTakePieces() {
    document.querySelectorAll('.take-piece[data-pi]').forEach(el => {
        const ti = parseInt(el.dataset.ti), pi = parseInt(el.dataset.pi);
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => { e.stopPropagation(); promoteTake(ti, pi); });
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
    <div class="group-header ${isRow ? 'is-row' : ''} ${bus.collapsed ? 'is-collapsed' : ''} ${bus.muted ? 'is-muted' : ''} ${isGroupFolded(bus) ? 'is-group-collapsed' : ''}" data-bus="${esc(bus.id)}" style="--group-color: ${groupColor(bus)}; --depth: ${depth}${bus.height ? `; --grp-h: ${bus.height}px` : ''}">
        <div class="group-resize" data-bus="${esc(bus.id)}" data-tooltip="Tire pour agrandir ou rétrécir ce groupe (Alt = tous les groupes, double-clic = taille normale)"></div>
        <button class="group-toggle" data-tooltip="${bus.collapsed ? 'Déplier le groupe' : 'Replier le groupe'}" aria-label="Replier ou déplier le groupe">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="group-name" contenteditable="true" spellcheck="false">${esc(bus.name)}</div>
        <button class="g-mini g-son ${(bus.effects || []).length ? 'active' : ''}" data-tooltip="${bus.premaster ? 'Finition : le réglage final de tout le morceau' : 'Son du groupe : un réglage pour toutes ses pistes'}">♪</button>
        <button class="g-mini g-m ${bus.muted ? 'active' : ''}" data-tooltip="Couper tout le groupe">M</button>
        <button class="g-mini g-s ${allSolo ? 'active' : ''}" data-tooltip="Écouter seulement ce groupe">S</button>
        <input type="range" class="group-vol" min="0" max="100" step="0.5" data-default="${volToPos(100)}" value="${volToPos(bus.volume ?? 100)}" data-tooltip="Volume du groupe">
    </div>`;
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
            i === state.selectedTrack || state.selectedTracks.has(i) ? 'selected' : '',
            t.isCapture ? 'is-capture' : '',
            t.armed ? 'is-armed' : '',
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
                    <button class="t-mini m-r ${t.armed?'active':''} ${t.isCapture?'locked':''}" data-flag="rec" data-i="${i}" data-tooltip="${t.isCapture ? 'Toujours prête à enregistrer' : 'Prête à enregistrer (la prochaine prise ira ici)'}">R</button>
                    <button class="t-mini m-i ${trackMonitored(t)?'active':''}" data-flag="mon" data-i="${i}" data-tooltip="${trackMonitored(t) ? 'Retour casque : tu t\'entends (clic pour couper)' : 'Retour casque coupé (clic pour t\'entendre)'}">i</button>
                    ${trackTakeNumbers(t).length ? `<button class="takes-toggle ${t.takesOpen ? 'active' : ''}" data-takes="${i}" data-tooltip="${t.takesOpen ? 'Cacher les prises' : 'Voir les prises mises de côté'}"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>${trackTakeNumbers(t).length}</button>` : ''}
                    <div class="t-knob" data-i="${i}" data-pan="${t.pan || 0}" tabindex="0" role="slider" aria-label="Gauche / droite" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${t.pan || 0}" data-tooltip="${panTip(t.pan || 0)}">${panKnobSvg(t.pan || 0)}</div>
                    <input type="range" class="t-vol" data-i="${i}" min="0" max="100" step="0.5" data-default="${volToPos(100)}" value="${volToPos(t.volume ?? 80)}" data-tooltip="Volume : ${volumeToDb(t.volume ?? 80)} dB (double-clic = 0 dB)" aria-label="Volume de la piste">
                    <div class="vu-mini"><span></span></div>
                    ${t.isCapture ? '' : `<button class="t-mini m-del" data-del="${i}" data-tooltip="Supprimer la piste">×</button>`}
                </div>
            </div>
        </div>${renderTakesPanel(t, i)}`;
    }).join('') + rowBuses().map(renderGroupHeader).join('');
    bindGroupEvents();
    bindTakeToggles();
    renderInspector();
    observeTrackHeights();
}

// Le bouton gauche / droite (grand rond) disparaît quand la piste est trop basse, et revient quand il y a la place (comme Logic)
const PAN_KNOB_MIN_H = 60;
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
    const captureIdx = state.project.tracks.findIndex(t => t.isCapture);
    const recTargetIdx = captureIdx >= 0 ? captureIdx : state.project.tracks.findIndex(t => t.armed);

    el.innerHTML = state.project.tracks.map((t, i) => {
        const clips = t.clips || [];
        const isInstru = isInstruTrack(t);
        const needsDropzone = isInstru && clips.length === 0;
        const showRecHint = i === recTargetIdx && clips.length === 0 && !needsDropzone;

        return `${groupsStartingAt(i).map(g => renderGroupTimelineRow(g, timelineWidthPx)).join('')}
        <div class="timeline-track ${isInstru ? 'is-instru' : ''} ${isTrackFolded(t) ? 'is-group-collapsed' : ''}" data-i="${i}" style="width: ${timelineWidthPx}px${t.height ? `; --track-h: ${t.height}px` : ''}">
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
function renderTimelineGrid(el) {
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
    <div class="clip ${c.recording ? 'is-recording' : ''} ${c.pending ? 'is-pending' : ''} ${stale ? 'is-stale' : ''} ${selected || multiSelected ? 'is-selected' : ''} ${multiSelected ? 'is-multi-selected' : ''} ${c.muted ? 'is-muted-clip' : ''} ${loopWidthPx > 0 ? 'has-loop' : ''} ${overlap ? 'has-overlap' : ''}"
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
                ${window.PULSE_URL_IMPORT ? `                <button class="dz-tab" data-tab="url">
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
                <div class="dz-url-note">
                    💡 L'import d'URL fonctionne dans l'app desktop Pulse (via yt-dlp intégré).
                    Pour l'instant, télécharge le fichier et dépose-le ici.
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
            if (window.pulse && window.pulse.isElectron) {
                // Hook futur Tauri/Electron pour yt-dlp
                flash('Téléchargement de ton instru en cours…');
            } else {
                flash('Les liens ne marchent pas encore ici — télécharge ton instru, puis dépose le fichier dans Pulse');
            }
        });
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); urlBtn.click(); }
            e.stopPropagation();
        });

        // Stopper les clics sur la dropzone pour qu'ils ne placent pas le playhead
        dz.addEventListener('mousedown', (e) => e.stopPropagation());
    });
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
        if (!t.clips.length && !t.armed && !t.isCapture && (!t.type || t.type === 'audio') && !inGroup
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

    let html = '';
    for (let bar = 0; bar <= bars; bar += step) {
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
    // Overlay loop (re-injectée après innerHTML)
    renderLoopOverlay();
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
    const beatSec = 60 / state.project.bpm;
    const barIdx = Math.floor(time / (beatSec * bpb())) + 1;
    state.project.markers.push({ time, name: `M${barIdx}` });
    state.project.markers.sort((a, b) => a.time - b.time);
    saveProject();
    renderMarkers();
    flash(`Marqueur posé`);
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
    if (mf) { mf.value = mv; const d = document.querySelector('.mixer-master .strip-db'); if (d) d.textContent = `${volumeToDb(mv)} dB`; }
    applyShowAll();
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
const FX_NAMES = { eq: 'EQ', sat: 'Saturation', deess: 'De-esser', comp: 'Compresseur', master: 'Finition', limit: 'Limiteur', delay: 'Écho', reverb: 'Reverb' };
const FX_ORDER = ['eq', 'sat', 'deess', 'comp', 'master', 'limit', 'delay', 'reverb'];
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
function inspectorStrip(kind, x, idx) {
    // kind : 'track' | 'bus' | 'master'
    const isMaster = kind === 'master';
    const name = isMaster ? 'Sortie stéréo' : x.name;
    const color = isMaster ? 'var(--violet-3)' : (x.color || 'var(--violet-2)');
    const vol = isMaster ? Math.round(PulseAudio.getMasterVolume ? PulseAudio.getMasterVolume() : 80) : (x.volume ?? (kind === 'track' ? 80 : 100));
    const chain = isMaster ? [] : chainOf(x);
    const sends = (kind === 'track' || (kind === 'bus' && !x.premaster && !x.locked)) ? projectSends() : [];
    const soundLabel = isMaster ? '' : x.premaster ? 'Finition' : (x.sound && presetsFor(x)[x.sound.preset] ? presetsFor(x)[x.sound.preset].label : 'Son');
    return `
    <div class="strip insp-strip" data-kind="${kind}" data-id="${isMaster ? 'master' : kind === 'track' ? idx : esc(x.id)}" style="--track-color: ${color}">
        <div class="strip-name">${esc(name)}</div>
        ${isMaster ? '<div class="insp-note">Tout le morceau sort ici</div>' : `<button class="strip-sound insp-sound" data-tooltip="${x.premaster ? 'Le réglage final de tout le morceau' : 'Choisir le son'}">${esc(soundLabel)} ▾</button>`}
        ${isMaster ? '' : `<div class="insp-fx">
            <div class="strip-sends-title">Effets</div>
            ${chain.length ? chain.map((n, k) => `
            <div class="insp-fx-row" data-fx="${n}" data-tooltip="Clic pour régler">
                <span>${FX_NAMES[n] || n}</span>
                ${x.premaster || n === 'limit' || n === 'master' ? '' : `<em class="insp-move"><b data-move="-1" class="${k === 0 ? 'off' : ''}" data-tooltip="Avant">▲</b><b data-move="1" class="${k === chain.length - 1 ? 'off' : ''}" data-tooltip="Après">▼</b></em>`}
            </div>`).join('') : '<div class="insp-empty">Aucun</div>'}
        </div>`}
        ${sends.length ? `<div class="strip-sends">
            <div class="strip-sends-title">Envois</div>
            ${sends.map(sd => `
            <label class="strip-send-row ${(x.sends || {})[sd.id] > 0 ? 'on' : ''}" data-send="${esc(sd.id)}">
                <span>${esc(sd.name)}</span>
                <input type="range" class="insp-send" min="0" max="100" data-default="0" value="${(x.sends || {})[sd.id] || 0}">
            </label>`).join('')}
        </div>` : ''}
        ${(kind === 'track' || (kind === 'bus' && !x.premaster && !x.locked)) ? `<label class="insp-pan"><span>G</span><input type="range" class="insp-pan-input" min="-100" max="100" step="1" data-default="0" value="${x.pan || 0}" data-tooltip="Gauche / droite (double-clic = centre)"><span>D</span></label>` : ''}
        <div class="strip-fader-wrap">
            <input type="range" class="fader insp-fader" min="0" max="100" ${isMaster ? '' : `step="0.5" data-vmap="1"`} data-default="${isMaster ? 100 : volToPos(kind === 'track' ? 80 : 100)}" value="${isMaster ? vol : volToPos(vol)}" ${x && x.locked && !showAll() ? 'disabled' : ''}>
            <div class="strip-db">${volumeToDb(vol)} dB</div>
        </div>
        <div class="strip-output">${isMaster ? '' : '→ ' + busLabel(x.output)}</div>
    </div>`;
}
// Le volume ou le pan changé à un endroit (piste, fader de gauche, mixeur) se voit aussitôt partout
function syncInspectorVolume(idx) {
    const t = state.project.tracks[idx]; if (!t) return;
    const f = document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-fader');
    if (f && state.selectedTrack === idx) {
        f.value = volToPos(t.volume ?? 80);
        const d = f.closest('.insp-strip').querySelector('.strip-db'); if (d) d.textContent = `${volumeToDb(t.volume ?? 80)} dB`;
    }
    const v = document.querySelector(`.t-vol[data-i="${idx}"]`);
    if (v && document.activeElement !== v) v.value = volToPos(t.volume ?? 80);
}
function syncTrackPan(idx) {
    const t = state.project.tracks[idx]; if (!t) return;
    const k = document.querySelector(`.t-knob[data-i="${idx}"]`);
    if (k) { k.dataset.pan = t.pan || 0; k.setAttribute('aria-valuenow', t.pan || 0); k.innerHTML = panKnobSvg(t.pan || 0); k.dataset.tooltip = panTip(t.pan || 0); }
    const p = document.querySelector('#inspector .insp-strip[data-kind="track"] .insp-pan-input');
    if (p && state.selectedTrack === idx && document.activeElement !== p) p.value = t.pan || 0;
}
function renderInspector() {
    const el = document.getElementById('inspector');
    if (!el || el.hidden) return;
    const idx = state.selectedTrack;
    const t = state.project.tracks[idx];
    if (!t) { el.innerHTML = '<div class="insp-hint">Clique sur une piste pour voir ses réglages ici</div>'; return; }
    const dest = busById(t.output);
    el.innerHTML = inspectorStrip('track', t, idx) + (dest ? inspectorStrip('bus', dest) : inspectorStrip('master'));
    el.querySelectorAll('.insp-strip').forEach(strip => {
        const kind = strip.dataset.kind;
        const x = kind === 'track' ? t : kind === 'bus' ? dest : null;
        const fader = strip.querySelector('.insp-fader');
        let faderUndo = false;
        fader.addEventListener('change', () => { faderUndo = false; });
        fader.addEventListener('input', () => {
            if (!faderUndo && kind !== 'master') { pushUndo(); faderUndo = true; }   // un mouvement de fader = une étape d'annulation
            const v = kind === 'master' ? parseInt(fader.value) : posToVol(parseFloat(fader.value));
            if (kind === 'track') { t.volume = v; PulseAudio.updateTrackVolume(idx, v); syncInspectorVolume(idx); }
            else if (kind === 'bus') { dest.volume = v; PulseAudio.updateBusVolume(dest.id, dest.muted ? 0 : v); }
            else { PulseAudio.setMasterVolume(v); state.project.masterVolume = v; }
            strip.querySelector('.strip-db').textContent = `${volumeToDb(v)} dB`;
        });
        fader.addEventListener('change', () => { saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
        const snd = strip.querySelector('.insp-sound');
        if (snd) snd.addEventListener('click', () => {
            if (kind === 'bus' && x.premaster) openMasterPanel(x, snd); else openSoundPanel(kind === 'track' ? idx : x, snd);
        });
        strip.querySelectorAll('.insp-fx-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.insp-move')) return;
                const n = row.dataset.fx;
                if (kind === 'bus' && x.premaster) openMasterPanel(x, row);
                else if (n === 'eq' || n === 'comp') openEffectPanel(kind === 'track' ? idx : x, n, row);
                else openSoundPanel(kind === 'track' ? idx : x, row);
            });
            row.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (b.classList.contains('off')) return;
                moveEffect(x, row.dataset.fx, parseInt(b.dataset.move));
            }));
        });
        strip.querySelectorAll('.insp-send').forEach(sl => {
            const id = sl.closest('.strip-send-row').dataset.send;
            let undoPushed = false;
            sl.addEventListener('input', () => {
                if (!undoPushed) { pushUndo(); undoPushed = true; }
                const o = x || t;   // la piste, ou le groupe de cette tranche
                o.sends = o.sends || {};
                const v = parseInt(sl.value);
                if (v > 0) o.sends[id] = v; else delete o.sends[id];
                const sends = projectSends(), key = id === sends.find(s => s.type === 'reverb')?.id ? 'space' : id === sends.find(s => s.type === 'delay')?.id ? 'echo' : null;
                if (key && o.sound) o.sound[key] = v;
                sl.closest('.strip-send-row').classList.toggle('on', v > 0);
                refreshPlaybackSoon();
            });
            sl.addEventListener('change', () => { undoPushed = false; saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
        });
        const pan = strip.querySelector('.insp-pan-input');
        if (pan) {
            let panUndo = false;
            pan.addEventListener('change', () => { panUndo = false; });
            pan.addEventListener('input', () => {
                if (!panUndo) { pushUndo(); panUndo = true; }
                if (kind === 'bus') { x.pan = parseInt(pan.value); refreshPlaybackSoon(); return; }
                t.pan = parseInt(pan.value); PulseAudio.updateTrackPan(idx, t.pan); syncTrackPan(idx);
            });
            pan.addEventListener('change', () => { saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
            pan.addEventListener('dblclick', () => {
                pan.value = 0;
                if (kind === 'bus') { x.pan = 0; refreshPlaybackSoon(); saveProject(); return; }
                t.pan = 0; PulseAudio.updateTrackPan(idx, 0); syncTrackPan(idx); saveProject();
            });
        }
    });
}
// Change la place d'un effet dans la chaîne (dir : -1 = plus tôt, +1 = plus tard)
function moveEffect(x, name, dir) {
    const chain = chainOf(x);
    const i = chain.indexOf(name), j = i + dir;
    if (i < 0 || j < 0 || j >= chain.length) return;
    pushUndo();
    [chain[i], chain[j]] = [chain[j], chain[i]];
    // On garde l'ordre complet : les effets éteints reprennent leur place habituelle autour
    x.fxOrder = [...chain, ...FX_ORDER.filter(n => !chain.includes(n))];
    renderInspector(); refreshPlaybackSoon(); saveProject();
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
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
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
const DEFAULT_SENDS = () => [
    { id: 'revlong', name: 'Rev Long', type: 'reverb', size: 3.2, pre: 0, volume: 100 },
    { id: 'del14', name: 'Del 1/4', type: 'delay', beats: 1, feedback: 35, volume: 100 }
];
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
        <div class="strip ${t.isCapture?'strip-capture':''}" style="--track-color: ${t.color}" data-kind="track" data-i="${i}">
            <div class="strip-name">${esc(t.name)}</div>
            <button class="strip-sound" data-tooltip="Choisir le son de la piste">${t.sound && SOUND_PRESETS[t.sound.preset] ? esc(SOUND_PRESETS[t.sound.preset].label) : 'Son'} ▾</button>
            <div class="strip-fx">
                <div class="strip-fx-slot ${(t.effects||[]).includes('eq') ? 'active' : ''}" data-fx="eq">EQ</div>
                <div class="strip-fx-slot ${(t.effects||[]).includes('comp') ? 'active' : ''}" data-fx="comp">Comp</div>
                ${(t.type === 'audio' || !t.type) && !t.isCapture && !isInstruTrack(t) ? `<div class="strip-fx-slot ${t.autotune && t.autotune.on ? 'active' : ''}" data-fx="tune" data-tooltip="Auto-Tune : corrige les notes de la voix de cette piste">Tune</div>` : ''}
            </div>
            <div class="strip-sends">
                <div class="strip-sends-title">Envois</div>
                ${sends.map(sd => `
                <label class="strip-send-row" data-send="${esc(sd.id)}" data-tooltip="Dose de « ${esc(sd.name)} » sur cette piste">
                    <span>${esc(sd.name)}</span>
                    <input type="range" class="send-level" min="0" max="100" data-default="0" value="${(t.sends || {})[sd.id] || 0}">
                </label>`).join('')}
            </div>
            <div class="strip-pan">
                <div class="strip-pan-knob" style="transform: rotate(${panDeg}deg)" data-tooltip="Gauche / droite : glisse pour placer le son (${t.pan ? (t.pan > 0 ? 'à droite' : 'à gauche') : 'au centre'})"></div>
            </div>
            <div class="strip-fader-wrap">
                <div class="fader-row">
                    <div class="vu-rail"><div class="vu-bar"></div></div>
                    <input type="range" class="fader" min="0" max="100" step="0.5" data-vmap="1" data-default="${volToPos(80)}" value="${volToPos(t.volume ?? 80)}">
                </div>
                <div class="strip-db">${volumeToDb(t.volume ?? 80)} dB</div>
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
                <button class="strip-sound" data-tooltip="Choisir le son du groupe">${b.sound && presetsFor(b)[b.sound.preset] ? esc(presetsFor(b)[b.sound.preset].label) : 'Son'} ▾</button>
                <div class="strip-fx">
                    <div class="strip-fx-slot ${(b.effects||[]).includes('eq') ? 'active' : ''}" data-fx="eq">EQ</div>
                    <div class="strip-fx-slot ${(b.effects||[]).includes('comp') ? 'active' : ''}" data-fx="comp">Comp</div>
                </div>
                <div class="strip-sends">
                    <div class="strip-sends-title">Envois</div>
                    ${sends.map(sd => `
                    <label class="strip-send-row" data-send="${esc(sd.id)}" data-tooltip="Dose de « ${esc(sd.name)} » sur ce groupe">
                        <span>${esc(sd.name)}</span>
                        <input type="range" class="send-level" min="0" max="100" data-default="0" value="${(b.sends || {})[sd.id] || 0}">
                    </label>`).join('')}
                </div>
                <label class="insp-pan strip-bus-pan"><span>G</span><input type="range" class="bus-pan" min="-100" max="100" step="1" data-default="0" value="${b.pan || 0}" data-tooltip="Gauche / droite du groupe (double-clic = centre)"><span>D</span></label>`}
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
            <div class="strip strip-return ${sd.muted ? 'is-muted' : ''}" data-kind="send" data-send="${esc(sd.id)}" style="--track-color: ${sd.type === 'delay' ? '#38BDF8' : '#34D399'}">
                <div class="strip-name">${esc(sd.name)}</div>
                <button class="return-edit" data-tooltip="Régler cet envoi">${sd.type === 'delay' ? 'Écho' : 'Reverb'} ▾</button>
                <div class="return-note">100 % effet</div>
                <div class="strip-fader-wrap">
                    <input type="range" class="fader return-fader" min="0" max="100" data-default="100" value="${sd.volume ?? 100}">
                    <div class="strip-db">${volumeToDb(sd.volume ?? 100)} dB</div>
                </div>
                <div class="strip-output">→ MASTER</div>
            </div>`).join('')}
        <button class="strip-add-send" data-tooltip="Ajouter un envoi (reverb ou écho)">+<span>Envoi</span></button>`;

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
    renderMixer(); bindMixerEvents(); saveProject();
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
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
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
        const collect = (p) => (p?.tracks || []).forEach(t => [...(t.clips || []), ...(t.takes || [])].forEach(c => { if (c.id) keep.push(c.id); if (c.tune && c.tune.src) keep.push(c.tune.src); if (c.warp && c.warp.src) keep.push(c.warp.src); if (c.rev && c.rev.src) keep.push(c.rev.src); }));
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

// Sauvegarde complète du projet dans un fichier .pulse (projet + tout l'audio)
async function exportPulseFile() {
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

// Ouvre un .pulse déposé dans le studio (le projet en cours reste disponible dans les récents)
async function openPulseFileInStudio(file) {
    flash(`Ouverture de ${file.name}…`);
    try {
        flushProjectDocSave();
        const project = await PulseFile.unpack(file);
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
            if (state.playhead < ls || state.playhead >= le) {
                state.playhead = ls;
                updatePlayhead(); updateChrono();
            }
        } else {
            // Curseur à la fin du projet → retour au début (Logic behavior)
            const projEnd = computeProjectEndSec();
            if (projEnd > 0 && state.playhead >= projEnd - 0.05) {
                state.playhead = 0;
                updatePlayhead(); updateChrono();
            }
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
        if (!fromRec) state.playOrigin = state.playhead;   // le curseur revient ici à l'arrêt (comme Logic)
        try { await PulseAudio.play(state.project, state.playhead); } catch (err) { console.error(err); }
        // Le mixage natif prend un instant : on recale le curseur sur le vrai départ du son
        if (PulseAudio.isNative()) state.startTime = performance.now() - from0 * 1000;
        if (state.metronome) PulseAudio.startMetronome(state.project.bpm, state.playhead);
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
                <select id="setToolCmd" class="set-select">${['mute', 'gain', 'cut', 'none'].map(k => `<option value="${k}" ${mouseTool('cmd') === k ? 'selected' : ''}>${MOUSE_TOOL_LABELS[k]}</option>`).join('')}</select>
            </div>
            <div class="set-row">
                <span>Clic droit <em>(un clic sans bouger ouvre le menu)</em></span>
                <select id="setToolRight" class="set-select">${['gain', 'menu', 'mute', 'cut', 'none'].map(k => `<option value="${k}" ${mouseTool('right') === k ? 'selected' : ''}>${MOUSE_TOOL_LABELS[k]}</option>`).join('')}</select>
            </div>

            <h4 class="set-title">Retour casque</h4>
            ${toggle('setMonitor', PulseAudio.isMonitorOn(), 'M\'entendre dans le casque par Pulse', 'Coché : ta voix revient dans ton casque en passant par Pulse. Décoché : tu t\'entends par le retour direct de ta carte son, s\'il y en a un (pas de double retour). Mets un casque : sur des enceintes, ça siffle. Le bouton « i » de chaque piste choisit quelle voix tu entends.')}
            ${toggle('setLowLat', PulseAudio.isLowLatency(), 'Faible latence', 'Pulse demande à ton ordi le plus petit délai possible pour ton micro. À garder coché, sauf si ça craque.')}
            <div class="set-row">
                <span>Retard entre ta voix et ce que tu entends <em id="setLatNote"></em></span>
                <span id="setLatValue" class="set-mic">…</span>
            </div>

            <h4 class="set-title">Sortie</h4>
            <div class="set-row">
                <span>Volume maximum de sortie <em>(rien ne dépasse ce niveau, même à l'export)</em></span>
                <span><input type="number" id="setCeiling" class="set-num" step="0.1" min="-6" max="0" value="${(state.project.ceilingDb ?? -0.3).toFixed(1)}"> dB</span>
            </div>
            ${toggle('setReturn', returnOnStop(), 'Espace : pause, puis relance depuis le départ', 'Un premier Espace met en pause là où tu en es, le deuxième relance depuis l\'endroit où tu avais posé le curseur (la petite marque pointillée). Décoché : Espace reprend toujours là où le son s\'est arrêté.')}
            ${toggle('setShowAll', showAll(), 'Afficher les réglages avancés de la sortie', 'Montre aussi les bus de sortie, pour les régler ou dessiner leur volume. Pas besoin pour enregistrer.')}

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
        renderRuler(); renderTimelineTracks(); updateChrono(); saveProject();
        flash(`Mesure à ${bpb()} temps : la grille, le métronome et l'aimant suivent`);
    });
    modal.querySelector('#setCountIn').addEventListener('change', (e) => {
        if (PulseAudio.isCountInEnabled() !== e.target.checked) document.getElementById('btnCountIn').click();
    });
    modal.querySelector('#setBg').addEventListener('change', (e) => {
        localStorage.setItem('pulse_bg_capture', e.target.checked ? '1' : '0');
        flash(e.target.checked ? 'Le micro captera dès la lecture' : 'Le micro ne captera qu\'à partir de R');
    });
    modal.querySelector('#setReturn').addEventListener('change', (e) => {
        try { localStorage.setItem('pulse_return_on_stop', e.target.checked ? '1' : '0'); } catch {}
        flash(e.target.checked ? 'Espace : pause là où tu en es, puis relance depuis le départ' : 'Espace reprend toujours là où le son s\'est arrêté');
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
        v.textContent = `${ms} ms`;
        n.textContent = ms <= 12 ? '(excellent : tu ne sens rien)'
            : ms <= 25 ? '(correct pour chanter)'
            : '(trop long : branche une carte son, ferme les autres applis, ou utilise le retour direct de ta carte son avec « M\'entendre dans le casque par Pulse » coupé)';
    };
    showLatency();
    modal.querySelector('#setLowLat').addEventListener('change', (e) => {
        const reopened = PulseAudio.setLowLatency(e.target.checked);
        flash(e.target.checked ? '⚡ Faible latence activée' + (reopened ? '' : ' : prise en compte à la prochaine prise') : 'Faible latence coupée');
        setTimeout(showLatency, 400);
    });
    const saveTool = (which, value) => {
        let v = {}; try { v = JSON.parse(localStorage.getItem(MOUSE_TOOLS_KEY) || '{}') || {}; } catch {}
        v[which] = value;
        try { localStorage.setItem(MOUSE_TOOLS_KEY, JSON.stringify(v)); } catch {}
        flash(`${which === 'cmd' ? '⌘ + clic' : 'Clic droit'} : ${MOUSE_TOOL_LABELS[value]}`);
    };
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
        const ok = (i) => { const t = tracks[i]; return t && !t.isCapture && (!t.type || t.type === 'audio') && t.preset !== 'instru' && !(t.clips || []).some(c => !c.recording); };
        let pick = ok(state.selectedTrack) ? state.selectedTrack : tracks.findIndex((t, i) => ok(i));
        if (pick < 0) {
            pushUndo();
            tracks.push({ name: 'Voix', type: 'audio', color: TYPE_COLORS.audio, clips: [], volume: 80, output: 'master' });
            pick = tracks.length - 1;
        }
        tracks[pick].armed = true;
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
function recTargetIdx() {
    const captureIdx = state.project.tracks.findIndex(t => t.isCapture);
    return captureIdx >= 0 ? captureIdx : state.project.tracks.findIndex(t => t.armed && !t.isCapture);
}

async function beginCapture(targetIdx, startSec) {
    state._cap = { id: `rec_${Date.now().toString(36)}`, trackIdx: targetIdx, regions: [] };
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

function punchIn(inSec, zoneEnd = null) {
    const cap = state._cap;
    const t = state.project.tracks[cap.trackIdx];
    const livingClip = { id: cap.id, name: '●REC', start: inSec, duration: 0.05, recording: true };
    t.clips = t.clips || [];
    t.clips.push(livingClip);
    cap.regions.push({ clip: livingClip, in: inSec, out: null });
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
    lc.duration = Math.max(0.01, out - region.in);
    lc.pending = true;
    lc.name = 'Prise posée';
    return region;
}

// R pendant le rec : on sort de la prise, la lecture continue
function punchOut() {
    const region = closeOpenRegion();
    PulseAudio.refreshAudibility(state.project);
    renderTimelineTracks();
    if (region) flash('✓ Prise posée, la lecture continue — elle sera prête dès que tu mets pause (Espace)');
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
        const pre = Math.min(a, (60 / state.project.bpm) * 8);
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
        const ok = await PulseAudio.playCountIn(state.project.bpm, bpb());
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

// Fin du passage (pause, fin du projet…) : la capture devient de vrais clips
async function finalizeCapture() {
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
        const a = Math.max(r.in, capStart), b = Math.min(r.out, capEnd);
        if (b - a < 0.05) { t.clips = t.clips.filter(c => c !== clip); continue; }
        clip.start = a;
        clip.offset = a - capStart;   // tout ce qui précède reste récupérable en étirant le bord gauche
        clip.duration = b - a;
        clip.peaks = peaks;
        delete clip.recording; delete clip.pending;
        ensureTakeNumbers(t, clip);
        clip.take = ++t.takeSeq;
        clip.name = `Prise ${takeLetter(clip.take)}`;
        if (recMode() === 'takes') {
            const n = setAsideRange(t, a, b, clip);
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
    if (aside > 0) flash(`✓ ${name} — l'ancienne est rangée juste dessous, clique dessus pour la reprendre`);
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
    if (state.looping && state.loop && !state.recording) {
        const loopEnd = Math.max(state.loop.start, state.loop.end);
        const loopStart = Math.min(state.loop.start, state.loop.end);
        if (state.playhead >= loopEnd) {
            state.playhead = loopStart;
            state.startTime = performance.now() - loopStart * 1000;
            if (state._cap) finalizeCapture();
            PulseAudio.stopAll();
            PulseAudio.play(state.project, loopStart);
            if (state.metronome) PulseAudio.startMetronome(state.project.bpm, loopStart);
            updatePlayhead();
            updateChrono();
            requestAnimationFrame(tick);
            return;
        }
    } else if (!state.recording && !(state._cap && state._cap.regions.length)) {
        // Stop auto si on dépasse la fin de tous les clips (+ 0.5s de queue)
        // (pas pendant un passage où des prises ont été posées : c'est Espace qui décide de la fin)
        const end = computeProjectEndSec();
        if (end > 0 && state.playhead > end + 0.5) {
            togglePlay();
            state.playhead = end;
            updatePlayhead();
            updateChrono();
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
    const t = Math.max(0, state.playhead);
    let txt;
    if (_chronoMode === 'bars') {
        const beatSec = 60 / state.project.bpm;
        const totalBeats = t / beatSec;
        const bar  = Math.floor(totalBeats / bpb()) + 1;
        const beat = Math.floor(totalBeats % bpb()) + 1;
        const tick = Math.floor((totalBeats % 1) * 96); // 96 ticks/beat
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
let _seekTimer = null;
function seekPlayhead(sec) {
    if (state.recording) { flash('Arrête l\'enregistrement avant de déplacer le curseur'); return; }
    state.playhead = Math.max(0, sec);
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
                await PulseAudio.play(state.project, state.playhead);
                state.startTime = performance.now() - state.playhead * 1000;
            }
            state._seekPending = false;
        }, 90);
    }
}
// Un temps (ou une mesure) plus loin, calé sur la grille
function stepPlayhead(dir, unit) {
    const beat = 60 / state.project.bpm;
    const u = unit === 'bar' ? beat * bpb() : beat;
    const r = state.playhead / u;
    const n = dir > 0 ? Math.floor(r + 1e-4) + 1 : Math.ceil(r - 1e-4) - 1;
    seekPlayhead(Math.max(0, n * u));
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

function trimAtPlayhead(side) {
    const t = state.project.tracks[state.selectedTrack];
    if (!t) return;
    const ph = state.playhead;
    const clips = t.clips || [];
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
function selectedTrackIdxs() {
    const n = state.project.tracks.length;
    const set = new Set([...state.selectedTracks].filter(i => i >= 0 && i < n));
    set.add(state.selectedTrack);
    return [...set].sort((a, b) => a - b);
}

// Choisir une autre piste : un clip choisi sur une piste différente n'est plus « choisi » (sinon Suppr l'efface sans qu'on le voie)
function dropStaleClipSelection() {
    const sc = state.selectedClip;
    if (sc && sc.trackIdx !== state.selectedTrack) state.selectedClip = null;
    [...state.selectedClips].forEach(k => {
        if (parseInt(k) !== state.selectedTrack) state.selectedClips.delete(k);
    });
}

function selectTrack(idx) {
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
            ['Espace', 'Écouter · 1re fois = pause là où tu es · 2e fois = repart du point de départ'],
            ['R', 'Enregistrer — R à nouveau : sortir de la prise, la lecture continue'],
            ['Espace pendant l\'enregistrement', 'Tout arrêter'],
            ['Shift + glisser puis R', 'Enregistrer seulement dans la zone choisie'],
            ['Entrée', 'Retour au début'],
            ['L', 'Répéter un passage en boucle (oui / non)'],
            ['⌘↵', 'Jouer depuis le début de la boucle'],
            ['K', 'Métronome'],
            ['T', 'Trouver le tempo en tapant le rythme (puis Espace)'],
            ['⌥M', 'Poser un marqueur au curseur'],
            ['⌥← / ⌥→', 'Marqueur précédent / suivant'],
            ['← / →', 'Curseur : un temps en arrière / en avant'],
            ['Shift + ← / →', 'Curseur : une mesure'],
            ['Tab / Maj + Tab', 'Curseur : bord de clip suivant / précédent'],
            ['Début / Fin', 'Curseur au début / à la fin du morceau']
        ]
    },
    {
        title: 'Édition rapide',
        items: [
            ['Q', 'Couper la région à gauche du curseur'],
            ['S', 'Couper la région à droite du curseur'],
            ['B', 'Ciseaux : couper une région là où tu cliques'],
            ['⌘C', 'Copier la région choisie'],
            ['⌘V', 'Coller à la position du curseur'],
            ['⌘Z / ⌘⇧Z', 'Annuler / Rétablir (30 niveaux) — marche aussi sur une prise ratée'],
            ['Tirer le bord d\'une prise', 'Récupérer ce qui a été dit avant ou après'],
            ['⌘ + clic sur une région', 'La muter / la démuter (réglable)'],
            ['Clic droit + glisser sur une région', 'Volume de la région : vers le haut = plus fort (⌥ + clic droit : remet 0 dB ; un clic sans bouger = menu)'],
            ['⌘← / ⌘→', 'Décaler la région choisie d\'un cran'],
            ['⌘⇧← / ⌘⇧→', 'Décaler la région très finement'],
            ['Shift (en tenant un clip)', 'Revenir à la position d\'origine et la figer : tu changes seulement de piste · Shift de nouveau = libère'],
            ['⌘G', 'Aimant : Libre ↔ Intelligent (les régions se calent sur le rythme)'],
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
            ['Shift + S', 'N\'écouter que la piste choisie'],
            ['⌘⇧S', 'Tout réécouter (annule les « seulement celle-ci »)'],
            ['⌘⇧T', 'Nouvelle piste audio'],
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
            ['⌥ + scroll', 'Au-dessus d\'une piste : seule cette piste grandit / rétrécit · ailleurs : toutes les pistes'],
                        ['E / Z', 'Zoomer / dézoomer au clavier'],
            ['F', 'Zoom sur le clip sélectionné (ou tout le projet)'],
            ['⌘⇧F', 'Voir tout le morceau'],
            ['⌘A', 'Sélectionner tous les clips de la piste'],
            ['X', 'Ouvrir / fermer le mixeur']
        ]
    },
    {
        title: 'Fichier',
        items: [
            ['⌘S', 'Sauvegarder'],
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
        if (pulseFile) { openPulseFileInStudio(pulseFile); return; }
        const midis = Array.from(e.dataTransfer.files).filter(f => /\.midi?$/i.test(f.name));
        if (midis.length) {
            for (const f of midis) await importMidiFile(f, state.selectedTrack, state.playhead);
            return;
        }
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i.test(f.name));
        if (!files.length) { flash('Ce fichier n\'est pas un son — dépose un MP3, WAV, M4A ou FLAC'); return; }

        for (const f of files) {
            // Crée une nouvelle piste pour chaque fichier droppé en global
            const newTrackIdx = state.project.tracks.length;
            pushUndo();
            state.project.tracks.push({
                name: f.name.replace(/\.[^.]+$/, '').slice(0, 24),
                type: 'audio',
                color: COLORS[newTrackIdx % COLORS.length],
                clips: [],
                output: 'master',
                volume: 80
            });
            renderAll();
            const ok = await importAudioFile(f, newTrackIdx, state.playhead, { noUndo: true });
            if (!ok) {
                // Fichier illisible : on ne laisse pas une piste vide à son nom
                const tt = state.project.tracks[newTrackIdx];
                if (tt && !(tt.clips || []).length) { state.project.tracks.splice(newTrackIdx, 1); _undoStack.pop(); updateUndoBtn(); renderAll(); }
            }
        }
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
        text: '<kbd>Espace</kbd> pour lire, <kbd>Espace</kbd> pour mettre en pause, et encore pour repartir du début de ton passage. Clique dans la timeline pour choisir d\'où ça part.',
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

        const url = URL.createObjectURL(outBlob);
        const a = document.createElement('a');
        a.href = url;
        const suffix = loopOnly ? '_selection' : '';
        a.download = (state.project.name || 'pulse-export').replace(/[^\p{L}\p{N}_\-]+/gu, '_') + suffix + '.' + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        flash(`✓ Export ${fmt.toUpperCase()}${rangeLabel} téléchargé`);
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
    let done = 0;
    for (let i = 0; i < state.project.tracks.length; i++) {
        const t = state.project.tracks[i];
        if (!(t.clips || []).length) continue;
        try {
            const wavBlob = await PulseAudio.exportTrackWav(state.project, i);
            if (!wavBlob) continue;
            const trackName = (t.name || `piste-${i + 1}`).replace(/[^\p{L}\p{N}_\-]+/gu, '_');
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseName}_stem_${String(i + 1).padStart(2, '0')}_${trackName}.wav`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            done++;
            flash(`Export ${done}/${tracks.length} — ${t.name}…`);
            // Petite pause entre chaque téléchargement pour éviter le blocage du navigateur
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            console.error(`Stem export failed for track ${i}`, err);
        }
    }
    flash(`✓ ${done} piste${done > 1 ? 's' : ''} exportée${done > 1 ? 's' : ''} séparément — regarde dans tes Téléchargements`);
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
        ? '🎚 Courbes de volume — clique sur une piste pour poser un point, glisse-le, double-clic pour l\'enlever (A pour quitter)'
        : 'Courbes de volume masquées');
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

// « La mineur (Am) » : nom français + lettre, comme sur les autres Auto-Tune
const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function scaleLabel(tonic, minor) {
    return `${PulseTune.NOTE_NAMES[tonic]} ${minor ? 'mineur' : 'majeur'} (${NOTE_LETTERS[tonic]}${minor ? 'm' : ''})`;
}
// Les 7 notes d'une gamme majeure ou mineure
const scaleMask = (tonic, minor) => PulseTune.toMask(minor ? (tonic + 3) % 12 : tonic);

// Petite note de piano, pour comparer à l'oreille avec la prod
function playKeyNote(pc) {
    const ctx = PulseAudio.getContext();
    if (!ctx) return;
    const t = ctx.currentTime, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    g.connect(ctx.destination);
    [1, 2].forEach((h, i) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 261.63 * Math.pow(2, pc / 12) * h;
        const og = ctx.createGain(); og.gain.value = i ? 0.3 : 1;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 1);
    });
}

function openTunePanel(trackIdx, clipIdx, x, y, trackMode = false) {
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
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
    const panel = document.createElement('div');
    panel.className = 'fx-panel sound-panel tune-panel';
    panel.innerHTML = `
        <div class="fx-panel-header"><span>🎤 Auto-Tune — ${trackMode ? 'piste ' : ''}${esc(clip.name || 'Clip')}</span><button class="fx-panel-close">×</button></div>
        <div class="fx-panel-body">
            <div class="sound-row">
                <div class="sound-ends"><span>Gamme du morceau</span><span class="tune-status"></span></div>
                <div class="tune-scale">
                    <select class="tune-tonic">${NOTE_LETTERS.map((l, i) => `<option value="${i}">${l} · ${PulseTune.NOTE_NAMES[i]}</option>`).join('')}</select>
                    <div class="tune-mode"><button data-minor="1">Mineur</button><button data-minor="0">Majeur</button></div>
                </div>
                <div class="tune-keys">
                    ${WHITE.map(pc => `<button class="tune-key-btn white" data-pc="${pc}"><em>${PulseTune.NOTE_NAMES[pc]}</em></button>`).join('')}
                    ${BLACK.map(pc => `<button class="tune-key-btn black" data-pc="${pc}" style="left: calc(${blackLeft[pc]} * 100% / 7)"></button>`).join('')}
                </div>
                <div class="tune-hint">Une note sonne faux sur la prod ? Clique dessus pour l'éteindre.</div>
                <div class="tune-quick">
                    <button data-q="instru">Lire sur l'instru</button>
                    <button data-q="all">Toutes les notes</button>
                </div>
            </div>
            <div class="sound-row">
                <div class="sound-ends"><span>Naturel</span><span>Robot</span></div>
                <input type="range" class="fx-slider tune-strength" min="0" max="100" step="1" data-default="85" value="${Math.round((cur.strength ?? 0.85) * 100)}">
            </div>
        </div>
        <div class="fx-panel-footer tune-actions">
            ${trackMode ? '<div class="tune-note">S\'applique à toutes les prises de la piste, et aux prochaines.</div>' : ''}
            ${clip.tune ? '<button class="tune-remove">Retirer</button>' : ''}
            <button class="tune-apply">${clip.tune ? 'Réappliquer' : (trackMode ? 'Activer sur la piste' : 'Appliquer')}</button>
        </div>`;
    document.body.appendChild(panel);
    panel.style.left = Math.max(8, Math.min(window.innerWidth - 300, x)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, y)) + 'px';
    const status = panel.querySelector('.tune-status');
    const paint = () => {
        panel.querySelectorAll('.tune-key-btn').forEach(k => k.classList.toggle('on', !!(mask && mask[+k.dataset.pc])));
        const named = source === 'instru' || source === 'gamme';
        status.textContent = !mask ? '' : source === 'instru' ? 'Lue sur l\'instru' : source === 'gamme' ? '' : mask.every(Boolean) ? 'Toutes les notes' : 'Manuel';
        panel.querySelector('.tune-tonic').value = String(tonic);
        panel.querySelector('.tune-scale').classList.toggle('is-manual', !!mask && !named);
        panel.querySelectorAll('.tune-mode button').forEach(b => b.classList.toggle('active', (b.dataset.minor === '1') === minor));
    };
    const pickScale = () => { mask = scaleMask(tonic, minor); source = 'gamme'; paint(); };
    panel.querySelector('.tune-tonic').addEventListener('change', (e) => { tonic = parseInt(e.target.value); e.target.blur(); playKeyNote(tonic); pickScale(); });
    panel.querySelectorAll('.tune-mode button').forEach(b => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { minor = b.dataset.minor === '1'; pickScale(); });
    });
    const readInstru = async (quiet) => {
        status.textContent = 'Je lis la gamme sur l\'instru…';
        const k = await detectProjectKey(trackIdx);
        if (!document.body.contains(panel)) return;
        if (k.notes) { mask = k.notes.slice(); tonic = k.tonic; minor = k.minor; source = 'instru'; paint(); if (!quiet) flash(`Gamme lue sur l'instru : ${k.label} — si ce n'est pas la bonne, change-la ou éteins des notes au clavier`); return; }
        paint();
        if (!mask) status.textContent = 'Sera devinée sur ta voix';
        if (!quiet) flash(k.reason === 'no-instru'
            ? 'Je ne trouve pas d\'instru dans le projet — dépose ta prod sur une piste, ou choisis les notes au clavier'
            : 'Je n\'arrive pas à lire la gamme sur cette instru (pas assez de notes) — choisis les notes au clavier');
    };
    paint();
    if (!mask) readInstru(true);
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.querySelectorAll('.tune-key-btn').forEach(k => {
        k.addEventListener('mousedown', (e) => e.preventDefault()); // pas de focus : Espace reste la lecture
        k.addEventListener('click', () => {
            const pc = +k.dataset.pc;
            if (!mask) mask = new Array(12).fill(true);
            mask[pc] = !mask[pc];
            source = 'clavier';
            playKeyNote(pc);
            paint();
        });
    });
    panel.querySelectorAll('.tune-quick button').forEach(b => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
            if (b.dataset.q === 'all') { mask = new Array(12).fill(true); source = 'clavier'; paint(); }
            else readInstru(false);
        });
    });
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.tune-apply').addEventListener('click', () => {
        const strength = parseInt(panel.querySelector('.tune-strength').value) / 100;
        if (mask && !mask.some(Boolean)) { flash('Toutes les notes sont éteintes — rallume au moins une note au clavier'); return; }
        panel.remove();
        // Le choix vaut pour tout le morceau : les prochains clips repartiront de ces notes
        if (mask) {
            const named = source === 'instru' || source === 'gamme';
            state.project.key = { notes: mask.slice(), tonic, minor, label: named ? scaleLabel(tonic, minor) : '', source };
            if (trackMode) { pushUndo(); trk.autotune = { on: true, notes: mask.slice(), source, strength, tonic, minor }; saveProject(); tuneWholeTrack(trackIdx, null, true); }
            else applyTune(clip, { notes: mask.slice(), source, strength, tonic, minor });
        } else if (trackMode) { pushUndo(); trk.autotune = { on: true, root: 'auto', strength }; saveProject(); tuneWholeTrack(trackIdx, null, true); }
        else applyTune(clip, { root: 'auto', strength });
    });
    const rm = panel.querySelector('.tune-remove');
    if (rm) rm.addEventListener('click', () => { panel.remove(); if (trackMode) untuneWholeTrack(trackIdx); else removeTune(clip); });
    setTimeout(() => {
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
    const bpm = state.project.bpm, bar = 4 * 60 / bpm;
    const start = Math.max(0, Math.floor((atSec + 1e-6) / bar) * bar);
    if (t.clips.some(c => !c.recording && c.start < start + bar - 1e-3 && c.start + c.duration > start + 1e-3)) {
        flash('Il y a déjà une région ici — double-clique dans un espace vide, ou ouvre celle-ci avec un double-clic');
        return;
    }
    if (!noUndo) pushUndo();
    const inst = t.midiInst || (t.type === 'drums' ? 'drums' : 'piano');
    const n = t.clips.filter(c => c.midi).length + 1;
    const clip = { start, duration: bar, offset: 0, name: `${MIDI_INSTS()[inst].label} ${n}`, color: t.color };
    await bakeMidiClip(clip, { inst, beats: 4, notes: [] }, bpm);
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
        key: state.project.key, flash,
        ghost: t.clips.filter(c => c !== clip && c.midi && !(clip.midi.pid && c.midi.pid === clip.midi.pid)).map(c => c.midi.notes),
        view: clip.midi.inst === 'drums' ? 'steps' : 'roll',
        onPreview: playMidiPreview,
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
    const bpm = state.project.bpm, spb = 60 / bpm;
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
    const bytes = PulseMidiFile.encode([{ name: c.name || t.name, drums: c.midi.inst === 'drums', notes: c.midi.notes }], state.project.bpm);
    triggerDownload(new Blob([bytes], { type: 'audio/midi' }), `${safeName(c.name || t.name)}.mid`);
    flash('✓ Fichier .mid enregistré — tu peux l\'ouvrir dans FL Studio, Logic, Ableton…');
}
function exportMidiTrack(trackIdx) {
    const t = state.project.tracks[trackIdx];
    const regs = (t && t.clips || []).filter(c => c.midi && !c.muted);
    if (!regs.length) { flash('Il n\'y a pas encore de région MIDI sur cette piste'); return; }
    const spb = 60 / state.project.bpm;
    const notes = [];
    regs.forEach(c => {
        const cs = c.start / spb, beats = c.midi.beats, total = ((c.loopEnd ? c.loopEnd - c.start : c.duration) / spb);
        PulseSynth.loopNotes(c.midi.notes, beats, Math.max(beats, total)).forEach(n => {
            if (n.s < total - 1e-6) notes.push({ s: n.s + cs, d: Math.min(n.d, total - n.s), p: n.p, v: n.v });
        });
    });
    const bytes = PulseMidiFile.encode([{ name: t.name, drums: t.type === 'drums', notes }], state.project.bpm);
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
        state.project.tracks.push({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 24), type, midiInst: type === 'drums' ? 'drums' : 'piano', color: COLORS[i % COLORS.length], clips: [], volume: 80 });
        trackIdx = i; t = state.project.tracks[i];
    } else pushUndo();
    const inst = t.midiInst || (t.type === 'drums' ? 'drums' : 'piano');
    const bpm = state.project.bpm, spb = 60 / bpm, bar = 4 * spb;
    let start = Math.max(0, Math.round((atSec || 0) / bar) * bar);
    const dur = r.beats * spb;
    while (t.clips.some(c => !c.recording && c.start < start + dur - 1e-3 && c.start + c.duration > start + 1e-3)) {
        const o = t.clips.find(c => !c.recording && c.start < start + dur - 1e-3 && c.start + c.duration > start + 1e-3);
        start = o.start + o.duration;
    }
    const kept = r.notes.slice(0, PulseSynth.MAX_NOTES);
    let drumsSkipped = 0;
    if (inst === 'drums') { const lanes = PulseSynth.DRUM_LANES.map(l => l.p); drumsSkipped = kept.filter(n => !lanes.includes(n.p)).length; }
    const clip = { start, duration: dur, offset: 0, name: file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'MIDI', color: t.color };
    await bakeMidiClip(clip, { inst, beats: r.beats, notes: kept }, bpm);
    t.clips.push(clip); t.clips.sort((a, b) => a.start - b.start);
    state.selectedTrack = trackIdx;
    state.selectedClip = { trackIdx, clipIdx: t.clips.indexOf(clip) };
    renderAll(); saveProject(); refreshPlaybackSoon();
    const bits = [`✓ « ${file.name} » importé (${kept.length} note${kept.length > 1 ? 's' : ''}, ${r.beats / 4} mesure${r.beats > 4 ? 's' : ''})`];
    if (r.bpm && Math.abs(r.bpm - bpm) > 0.5) bits.push(`le fichier est à ${r.bpm} BPM, le projet à ${bpm} : les notes suivent le tempo du projet`);
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

// Le tempo change : les régions MIDI sont recalculées à la volée (et gardent leur place sur les temps)
function rerenderMidiForTempo(bpm) {
    // Première passe : on note l'ancien tempo de chaque région avant de toucher à quoi que ce soit
    // (deux moitiés d'une région coupée peuvent partager le même objet « midi »)
    const todo = [];
    state.project.tracks.forEach(t => (t.clips || []).forEach(c => {
        if (!c.midi || !c.midi.bpm || Math.abs(c.midi.bpm - bpm) < 1e-6) return;
        todo.push({ c, f: c.midi.bpm / bpm });
    }));
    const bufs = new Map();   // un seul rendu par motif
    todo.forEach(({ c, f }) => {
        const key = c.midi;
        if (!bufs.has(key)) {
            const buf = renderMidiBuffer(c.midi, bpm);
            const id = `mid_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            PulseAudio.registerBuffer(id, buf);
            PulsePersist.saveBlob(id, PulseAudio.audioBufferToWav(buf), { kind: 'midi' }).catch(() => {});
            bufs.set(key, { buf, id, peaks: makePeaks(buf) });
        }
        const r = bufs.get(key);
        const oldStart = c.start;
        c.start = oldStart * f;                       // la région reste sur la même mesure
        c.offset = (c.offset || 0) * f; c.duration *= f;
        if (c.fadeIn) c.fadeIn *= f; if (c.fadeOut) c.fadeOut *= f;
        if (c.loopEnd) c.loopEnd = c.start + (c.loopEnd - oldStart) * f;
        c.id = r.id; c.peaks = r.peaks;
    });
    todo.forEach(({ c }) => { c.midi.bpm = bpm; });
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

// Le tempo du projet change : les clips calés suivent (pas pendant l'enregistrement)
let _warpWatchBpm = null, _warpWatchTimer = null;
function watchWarpTempo() {
    _warpWatchBpm = state.project.bpm;
    clearInterval(_warpWatchTimer);
    _warpWatchTimer = setInterval(async () => {
        const bpm = state.project.bpm;
        if (bpm === _warpWatchBpm || _warpBusy || state.recording) return;
        _warpWatchBpm = bpm;
        if (window.PulseSynth && rerenderMidiForTempo(bpm) > 0) { renderTimelineTracks(); saveProject(); refreshPlaybackSoon(); }
        const todo = [];
        state.project.tracks.forEach(t => (t.clips || []).forEach(c => { if (c.warp && c.warp.bpm !== bpm && !c.tune) todo.push(c); }));
        for (const c of todo) await applyWarp(c, c.warp.srcBpm, bpm);
    }, 700);
}

function openWarpPanel(trackIdx, clipIdx, x, y) {
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
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
            <div class="fx-row"><label class="fx-label">Tempo du projet</label><span class="warp-proj"><b>${Math.round(state.project.bpm * 10) / 10}</b> BPM</span></div>
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
        const chk = Number.isFinite(v) ? PulseWarp.checkRatio(v, state.project.bpm) : { ok: false };
        panel.querySelector('.warp-apply').disabled = !chk.ok;
        note.textContent = !Number.isFinite(v) ? 'Écris le tempo du son (je le cherche tout seul si possible).'
            : !chk.ok ? 'Écart trop grand : essaie ÷2 ou ×2.'
            : Math.abs(v - state.project.bpm) < 0.05 ? 'Déjà au bon tempo : rien à caler.'
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
        if (Math.abs(v - state.project.bpm) < 0.05) { flash('Déjà au bon tempo'); return; }
        await applyWarp(clip, v, state.project.bpm);
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
    return a.notes ? { notes: a.notes.slice(), source: a.source, strength: a.strength, tonic: a.tonic, minor: a.minor } : { root: 'auto', strength: a.strength };
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

// === Son de la piste : presets Ridwane + 3 curseurs simples (PRESETS.md) ===
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
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
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
            ${slider('space', 'Sec', 'Avec de l\'espace', 0, cur.space ?? curP.space ?? 0)}
            ${slider('echo', 'Sans écho', 'Beaucoup d\'écho', 0, cur.echo || 0)}
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
        const pos = state.playhead / barSec;                      // en mesures depuis le début
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
        PulseAudio.play(state.project, PulseAudio.getPlaybackPosition());
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
// Vue « analogique » du compresseur : un vumètre de réduction (0 dB à droite, 20 dB à gauche)
function compAnalogSvg(gr = 0) {
    const cx = 108, cy = 124, R = 88, a = (g) => (45 - Math.max(0, Math.min(20, g)) / 20 * 90) * Math.PI / 180;
    const pt = (r, ang) => [cx + r * Math.sin(ang), cy - r * Math.cos(ang)];
    const ticks = [0, 1, 2, 3, 5, 7, 10, 15, 20].map(g => {
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
    const pathC = `M${xy(LO)},${yy(LO)}L${xy(th)},${yy(th)}L${xy(0)},${yy(out0)}`;
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
const EQ_TYPES = { bell: 'Cloche', lowshelf: 'Étagère basse', highshelf: 'Étagère haute', hpf: 'Coupe-bas', lpf: 'Coupe-haut' };
const EQ_COLORS = ['#F87171', '#FBBF24', '#34D399', '#22D3EE', '#A855F7', '#F472B6', '#60A5FA', '#A3E635'];
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
function eqBandDb(b, f) {
    if (b.on === false) return 0;
    const q = b.q > 0 ? b.q : 1;
    if (b.type === 'hpf') return biquadDb('highpass', b.freq, 0, 20 * Math.log10(q), f);
    if (b.type === 'lpf') return biquadDb('lowpass', b.freq, 0, 20 * Math.log10(q), f);
    if (b.type === 'lowshelf' || b.type === 'highshelf') return biquadDb(b.type, b.freq, b.gain || 0, 1, f);
    return biquadDb('peaking', b.freq, b.gain || 0, q, f);
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
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
    // trackIdx : numéro de piste, ou directement un groupe
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    t.effectParams = t.effectParams || {};
    const W = 420, H = 200, DB = 18, FMIN = 20, FMAX = 20000;
    const fx = (f) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * W;
    const xf = (x) => FMIN * Math.pow(FMAX / FMIN, Math.max(0, Math.min(1, x / W)));
    const dy = (d) => H / 2 - Math.max(-DB, Math.min(DB, d)) / DB * (H / 2 - 8);
    const yd = (y) => (H / 2 - y) / (H / 2 - 8) * DB;
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
        t.eqBands = arr;                       // retenu à part : un preset de Son ne l'écrase plus
        t.effectParams.eq = { bands: arr };
        t.effects = t.effects || [];
        if (!t.effects.includes('eq')) t.effects.push('eq');
        refreshPlaybackSoon(); saveProject();
    };
    const fmtF = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kHz' : Math.round(f) + ' Hz';

    const panel = document.createElement('div');
    panel.className = 'fx-panel eq-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <span>EQ — ${esc(t.name || '')}</span>
            <label class="fx-bypass-label"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('eq') ? 'checked' : ''}> Actif</label>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="eq-graph"></div>
        <div class="eq-hint">Double-clic pour poser un point · tire pour régler · molette = largeur (Q) · double-clic sur un point = le retirer</div>
        <div class="eq-detail"></div>
        <div class="fx-panel-footer"><select class="eq-preset" data-tooltip="Un point de départ : tu peux ensuite tout bouger"><option value="">Modèles…</option>${Object.entries(EQ_PRESETS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select><button class="eq-add">+ Ajouter un point</button><button class="fx-reset">Réinitialiser</button></div>`;
    document.body.appendChild(panel);
    const graph = panel.querySelector('.eq-graph'), detail = panel.querySelector('.eq-detail');
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
        let line = '';
        for (let i = 0; i <= 160; i++) { const f = FMIN * Math.pow(FMAX / FMIN, i / 160); line += `${i ? 'L' : 'M'}${(i / 160 * W).toFixed(1)},${dy(total(f)).toFixed(1)}`; }
        const grid = [50, 100, 200, 500, 1000, 2000, 5000, 10000].map(f => `<line x1="${fx(f).toFixed(1)}" y1="0" x2="${fx(f).toFixed(1)}" y2="${H}" class="viz-grid"/><text x="${(fx(f) + 3).toFixed(1)}" y="${H - 4}" class="viz-txt">${f >= 1000 ? f / 1000 + 'k' : f}</text>`).join('');
        const dbl = [-12, -6, 6, 12].map(d => `<line x1="0" y1="${dy(d)}" x2="${W}" y2="${dy(d)}" class="viz-grid"/><text x="3" y="${dy(d) - 2}" class="viz-txt">${d > 0 ? '+' : ''}${d}</text>`).join('');
        const pts = arr.map((b, i) => {
            const flat = b.type === 'hpf' || b.type === 'lpf';
            const y = flat ? dy(total(b.freq)) : dy((b.gain || 0));
            return `<circle cx="${fx(b.freq).toFixed(1)}" cy="${y.toFixed(1)}" r="${i === sel ? 8 : (multi.has(i) ? 7.5 : 6.5)}" class="eq-pt ${isSel(i) ? 'sel' : ''} ${b.on === false ? 'off' : ''}" data-i="${i}" fill="${EQ_COLORS[i % EQ_COLORS.length]}"/>`;
        }).join('');
        graph.innerHTML = `<svg class="eq-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}${dbl}
            <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="viz-zero"/>
            <path d="${line}L${W},${H / 2}L0,${H / 2}Z" class="viz-fill"/><path d="${line}" class="viz-line"/>${pts}</svg>`;
        const b = arr[sel];
        detail.innerHTML = b ? `
            <span class="eq-dot" style="background:${EQ_COLORS[sel % EQ_COLORS.length]}"></span>
            <select class="eq-type">${Object.entries(EQ_TYPES).map(([k, v]) => `<option value="${k}" ${b.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <label>Fréquence <input class="eq-num eq-f" type="text" value="${Math.round(b.freq)}"> Hz</label>
            <label>Gain <input class="eq-num eq-g" type="text" value="${(b.gain || 0).toFixed(1)}" ${b.type === 'hpf' || b.type === 'lpf' ? 'disabled' : ''}> dB</label>
            <label>Q <input class="eq-num eq-q" type="text" value="${(b.q || 1).toFixed(2)}" ${b.type === 'lowshelf' || b.type === 'highshelf' ? 'disabled' : ''}></label>
            <button class="eq-onoff" data-tooltip="Met ce point en pause sans le supprimer">${b.on === false ? 'Réactiver' : 'Désactiver'}</button>
            <button class="eq-del">Retirer</button>` : '<span class="eq-empty">Aucun point : double-clic sur la courbe pour en poser un.</span>';
    };
    const update = (i, patch) => {
        const arr = bands().map(b => ({ ...b }));
        if (!arr[i]) return;
        Object.assign(arr[i], patch);
        arr[i].freq = Math.max(FMIN, Math.min(FMAX, arr[i].freq));
        arr[i].gain = Math.max(-24, Math.min(24, arr[i].gain || 0));
        arr[i].q = Math.max(0.1, Math.min(18, arr[i].q || 1));
        commit(arr); draw();
    };
    const addBand = (freq, gain) => {
        const arr = bands().map(b => ({ ...b }));
        if (arr.length >= EQ_MAX_BANDS) { flash('24 points au maximum'); return; }
        arr.push({ type: 'bell', freq, gain, q: 1 });
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
                rect.style.cssText = `left:${20 + l}px;top:${10 + tp}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`;
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
                    const flat = b.type === 'hpf' || b.type === 'lpf';
                    const cx = fx(b.freq), cy = flat ? dy(total(b.freq)) : dy(b.gain || 0);
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
        const move = (ev) => {
            const { x, y } = pos(ev), b0 = start[i]; if (!b0) return;
            if (group) {
                // Tous les points choisis suivent : même décalage de fréquence (en rapport) et de gain
                const ratio = xf(Math.max(0, Math.min(W, fx(b0.freq) + (x - p0.x)))) / b0.freq;
                const dg = Math.round((yd(y) - yd(p0.y)) * 2) / 2;
                const arr = start.map((b, k) => {
                    if (!group.includes(k)) return { ...b };
                    const flat = b.type === 'hpf' || b.type === 'lpf';
                    return { ...b, freq: Math.max(FMIN, Math.min(FMAX, b.freq * ratio)), gain: flat ? 0 : Math.max(-24, Math.min(24, (b.gain || 0) + dg)) };
                });
                commit(arr); draw();
                return;
            }
            const patch = { freq: xf(x) };
            if (b0.type !== 'hpf' && b0.type !== 'lpf') patch.gain = Math.round(yd(y) * 2) / 2;
            update(i, patch);
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    graph.addEventListener('dblclick', (e) => {
        const pt = e.target.closest && e.target.closest('.eq-pt');
        if (pt) { removeBand(parseInt(pt.dataset.i)); return; }
        const { x, y } = pos(e);
        addBand(Math.round(xf(x)), Math.round(yd(y) * 2) / 2);
    });
    graph.addEventListener('wheel', (e) => {
        const pt = e.target.closest && e.target.closest('.eq-pt');
        const i = pt ? parseInt(pt.dataset.i) : sel;
        const b = bands()[i]; if (!b || b.type === 'lowshelf' || b.type === 'highshelf') return;
        e.preventDefault();
        sel = i;
        update(i, { q: (b.q || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12) });
    }, { passive: false });

    // Détail du point choisi : on peut aussi écrire les valeurs
    const parseNum = (v) => parseFloat(String(v).replace(',', '.'));
    detail.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
    detail.addEventListener('change', (e) => {
        const el = e.target;
        if (el.classList.contains('eq-type')) {
            const type = el.value, patch = { type };
            if (type === 'hpf' || type === 'lpf') { patch.gain = 0; patch.q = 1.0839; }
            update(sel, patch);
        } else {
            const v = parseNum(el.value);
            if (!Number.isFinite(v)) { flash('Écris un nombre'); draw(); return; }
            if (el.classList.contains('eq-f')) update(sel, { freq: v });
            else if (el.classList.contains('eq-g')) update(sel, { gain: v });
            else if (el.classList.contains('eq-q')) update(sel, { q: v });
        }
    });
    detail.addEventListener('click', (e) => {
        if (e.target.classList.contains('eq-del')) removeBand(sel);
        if (e.target.classList.contains('eq-onoff')) { const b = bands()[sel]; update(sel, { on: b.on === false ? true : false }); }
    });
    // Suppr / ⌫ : retire les points choisis (et n'efface pas une région derrière)
    const eqKeys = (ev) => {
        if (!panel.isConnected) { document.removeEventListener('keydown', eqKeys, true); return; }
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
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
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
        graph.appendChild(cv);
        const g2 = cv.getContext('2d');
        let bins = null;
        const loop = () => {
            if (!panel.isConnected) return;
            if (!cv.isConnected) graph.appendChild(cv);        // draw() refait le contenu du cadre
            const sv = graph.querySelector('svg'); if (sv) { cv.style.width = sv.clientWidth + 'px'; cv.style.height = sv.clientHeight + 'px'; }
            g2.clearRect(0, 0, W, H);
            const an = state.playing || state.recording ? specOf() : null;
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
                    for (let k = k0; k <= k1; k++) if (Number.isFinite(bins[k]) && bins[k] > db) db = bins[k];
                    const y = H - Math.max(0, Math.min(1, (db + 100) / 80)) * (H - 10);
                    g2.lineTo(x, y);
                }
                g2.lineTo(W, H); g2.closePath();
                g2.fillStyle = 'rgba(56, 189, 248, 0.22)'; g2.fill();
                g2.strokeStyle = 'rgba(56, 189, 248, 0.7)'; g2.lineWidth = 1; g2.stroke();
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    const rect = anchorEl.getBoundingClientRect(), pw = 460;
    let left = rect.right + 8;
    if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    setTimeout(() => {
        document.addEventListener('mousedown', function closeEq(ev) {
            if (!panel.isConnected) { document.removeEventListener('mousedown', closeEq); return; }
            // composedPath : la cible a pu être redessinée pendant le clic (les points se refont à chaque mouvement)
            if (!ev.composedPath().includes(panel) && ev.target !== anchorEl) { panel.remove(); document.removeEventListener('mousedown', closeEq); }
        });
    }, 100);
}

function openEffectPanel(trackIdx, fxName, anchorEl) {
    if (fxName === 'eq') return openEqPanel(trackIdx, anchorEl);
    // Fermer un éventuel panneau déjà ouvert
    document.querySelectorAll('.fx-panel').forEach(p => p.remove());
    // trackIdx : numéro de piste, ou directement un groupe
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    t.effectParams = t.effectParams || {};

    const DEFS = {
        eq: [
            { key: 'hpf',      label: 'Passe-Haut',  unit: 'Hz', min: 20,  max: 500, def: 80,  step: 1 },
            { key: 'midGain',  label: 'Médiums',      unit: 'dB', min: -12, max: 12,  def: -2,  step: 0.5 },
            { key: 'presence', label: 'Présence 4k',  unit: 'dB', min: -12, max: 12,  def: 2,   step: 0.5 },
            { key: 'air',      label: 'Air 10k',      unit: 'dB', min: -8,  max: 8,   def: 1,   step: 0.5 }
        ],
        comp: [
            { key: 'threshold', label: 'Seuil',    unit: 'dB', min: -40, max: 0,  def: -22, step: 1 },
            { key: 'ratio',     label: 'Ratio',     unit: ':1', min: 1,   max: 20, def: 3,   step: 0.5 },
            { key: 'attack',    label: 'Attaque',   unit: 'ms', min: 1,   max: 100, def: 10, step: 1 },
            { key: 'release',   label: 'Relâchement',   unit: 'ms', min: 10,  max: 500, def: 50, step: 5 },
            { key: 'mix',       label: 'Mélange',   unit: '%',  min: 0,   max: 100, def: 100, step: 1 }
        ],
        reverb: [
            { key: 'wet',   label: 'Quantité',    unit: '%',  min: 0,   max: 100, def: 18, step: 1 },
            { key: 'size',  label: 'Taille',     unit: 's',  min: 0.3, max: 5,   def: 1.8, step: 0.1 },
            { key: 'decay', label: 'Déclin',     unit: '',   min: 0.5, max: 5,   def: 2.5, step: 0.1 }
        ]
    };
    const defs = DEFS[fxName];
    if (!defs) return;
    const params = t.effectParams[fxName] || {};

    const panel = document.createElement('div');
    panel.className = 'fx-panel';
    const FX_LABELS = { eq: 'EQ 4 bandes', comp: 'Compresseur', reverb: 'Réverbération' };
    panel.innerHTML = `
        <div class="fx-panel-header">
            <span>${FX_LABELS[fxName] || fxName.toUpperCase()}</span>
            ${fxName === 'comp' ? '<button class="fx-view" data-tooltip="Changer l\'affichage : courbe ou vumètre analogique">Analogique</button>' : ''}
            <label class="fx-bypass-label">
                <input type="checkbox" class="fx-bypass" ${t.effects?.includes(fxName) ? 'checked' : ''}> Actif
            </label>
            <button class="fx-panel-close">×</button>
        </div>
        ${fxName === 'comp' ? '<div class="fx-viz"></div>' : ''}
        <div class="fx-panel-body">
            ${defs.map(d => {
                const val = params[d.key] !== undefined ? params[d.key] : d.def;
                return `
                <div class="fx-row">
                    <label class="fx-label">${d.label}</label>
                    <input type="range" class="fx-slider" data-key="${d.key}" data-default="${d.def}"
                        min="${d.min}" max="${d.max}" step="${d.step}" value="${val}">
                    <span class="fx-val" data-key="${d.key}">${val}${d.unit}</span>
                </div>`;
            }).join('')}
        </div>
        <div class="fx-panel-footer">
            <button class="fx-reset">Réinitialiser</button>
        </div>`;

    document.body.appendChild(panel);

    // Positionner près du slot
    const rect = anchorEl.getBoundingClientRect();
    const pw = 220;
    let left = rect.right + 8;
    if (left + pw > window.innerWidth) left = rect.left - pw - 8;
    panel.style.left = left + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';

    // Interface graphique : la courbe suit les curseurs, et les points se tirent à la souris
    const viz = panel.querySelector('.fx-viz');
    const curP = () => { const o = {}; defs.forEach(d => { const v = (t.effectParams[fxName] || {})[d.key]; o[d.key] = v !== undefined ? v : d.def; }); return o; };
    let analog = false;
    try { analog = localStorage.getItem('pulse_comp_view') === 'analog'; } catch {}
    let needle = 0;
    const viewBtn = panel.querySelector('.fx-view');
    const drawViz = () => { if (viz) viz.innerHTML = analog ? compAnalogSvg(needle) : compVizSvg(curP()); if (viewBtn) viewBtn.textContent = analog ? 'Courbe' : 'Analogique'; };
    const setParam = (key, val) => {
        const sl = panel.querySelector(`.fx-slider[data-key="${key}"]`); if (!sl) return;
        const d = defs.find(x => x.key === key);
        val = Math.round(Math.max(d.min, Math.min(d.max, val)) / d.step) * d.step;
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
                const x = ev.clientX - r.left - gx, y = ev.clientY - r.top;
                const S = 132, toDb = (v) => -48 + (v - 7) / (S - 14) * 48;
                if (key === 'threshold') setParam('threshold', toDb(x));
                else { const th = curP().threshold, out0 = toDb(S - y); if (th < -1) setParam('ratio', -th / Math.max(0.05, out0 - th)); }
            };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        });
        panel.addEventListener('input', () => { if (!analog) drawViz(); });
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
                const an = (state.playing || state.recording) ? (typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null)) : null;
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
                if (nd) nd.setAttribute('transform', `rotate(${(45 - Math.min(20, needle) / 20 * 90).toFixed(1)} 108 124)`);
                const vv = viz.querySelector('.vu-val'); if (vv) vv.textContent = needle.toFixed(1) + ' dB';
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // Events
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => {
        t.effects = t.effects || [];
        if (e.target.checked) { if (!t.effects.includes(fxName)) t.effects.push(fxName); }
        else { const i = t.effects.indexOf(fxName); if (i >= 0) t.effects.splice(i, 1); }
        anchorEl.classList.toggle('active', !!e.target.checked);
        refreshPlaybackSoon();
        saveProject();
    });
    panel.querySelectorAll('.fx-slider').forEach(sl => {
        sl.addEventListener('change', () => { sl._undone = false; });
        sl.addEventListener('input', () => {
            const key = sl.dataset.key;
            const val = parseFloat(sl.value);
            const def = defs.find(d => d.key === key);
            if (!sl._undone) { pushUndo(); sl._undone = true; }
            t.effectParams[fxName] = t.effectParams[fxName] || {};
            t.effectParams[fxName][key] = val;
            (t.proKeep = t.proKeep || {})[fxName] = true;   // réglé à la main : le curseur « Son » n'y touche plus
            panel.querySelector(`.fx-val[data-key="${key}"]`).textContent = val + (def?.unit || '');
            refreshPlaybackSoon();
            saveProject();
        });
    });
    panel.querySelector('.fx-reset').addEventListener('click', () => {
        pushUndo();
        delete t.effectParams[fxName];
        if (t.proKeep) delete t.proKeep[fxName];
        refreshPlaybackSoon();
        saveProject();
        panel.remove();
        flash(`${FX_LABELS[fxName]} réinitialisé`);
    });

    // Fermer si clic ailleurs
    setTimeout(() => {
        document.addEventListener('mousedown', function closeFx(ev) {
            if (!panel.contains(ev.target) && ev.target !== anchorEl) {
                panel.remove();
                document.removeEventListener('mousedown', closeFx);
            }
        });
    }, 100);
}

// Seul le volume s'automatise pour l'instant (les effets viendront avec le moteur natif)
function openAutomationFor(trackIdx, param) {
    flash('Pour l\'instant c\'est le volume qui se dessine : clique directement sur la piste dans la timeline');
}

// === Courbe de volume d'une piste (automation) ===
// points = [{ t (secondes), v (0 = silence … 1 = niveau du fader) }]
const VOL_PAD = 7;
function volPoints(t) {
    t.automation = t.automation || {};
    t.automation.volume = t.automation.volume || { points: [] };
    return t.automation.volume.points;
}
// Hauteur de la ligne qui porte la courbe : une piste ou un groupe
function ownerH(o) { return (state.project.buses || []).includes(o) ? (o.height || 36) : trackH(o); }
function volY(v, h = state.trackHeight) { return VOL_PAD + (1 - v) * (h - 2 * VOL_PAD); }
function volFromY(y, h = state.trackHeight) { return Math.max(0, Math.min(1, 1 - (y - VOL_PAD) / (h - 2 * VOL_PAD))); }
function volCurveInner(t, widthPx) {
    const H = ownerH(t);
    const pts = ((t.automation && t.automation.volume && t.automation.volume.points) || []).slice().sort((a, b) => a.t - b.t);
    const first = pts.length ? pts[0].v : 1, last = pts.length ? pts[pts.length - 1].v : 1;
    const line = [`0,${volY(first, H)}`, ...pts.map(p => `${(p.t * state.pxPerSecond).toFixed(1)},${volY(p.v, H).toFixed(1)}`), `${widthPx},${volY(last, H)}`].join(' ');
    return `<polygon class="vol-fill" points="0,${H} ${line} ${widthPx},${H}"/>
        <polyline class="vol-line" points="${line}"/>
        ${pts.map(p => `<circle class="vol-pt" cx="${(p.t * state.pxPerSecond).toFixed(1)}" cy="${volY(p.v, H).toFixed(1)}" r="5" data-t="${p.t}"><title>${Math.round(p.v * 100)} %</title></circle>`).join('')}`;
}
function renderVolumeCurve(t, i, widthPx) {
    return `<svg class="vol-curve" data-i="${i}" width="${widthPx}" height="${trackH(t)}">${volCurveInner(t, widthPx)}</svg>`;
}
function renderBusCurve(bus, widthPx) {
    return `<svg class="vol-curve" data-bus="${esc(bus.id)}" width="${widthPx}" height="${ownerH(bus)}">${volCurveInner(bus, widthPx)}</svg>`;
}
function bindVolumeCurves() {
    document.querySelectorAll('.vol-curve').forEach(svg => {
        const track = svg.dataset.bus
            ? (state.project.buses || []).find(b => b.id === svg.dataset.bus)
            : state.project.tracks[parseInt(svg.dataset.i)];
        if (!track) return;
        const width = parseFloat(svg.getAttribute('width'));
        const redraw = () => { svg.innerHTML = volCurveInner(track, width); };
        svg.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            // Le point le plus proche du clic (le dessin est refait entre les deux clics, on ne peut pas se fier à la cible)
            const rect = svg.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            const pts = volPoints(track);
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
            const pts = volPoints(track);
            // Point existant sous la souris ? (recherche par distance, plus fiable que la cible du clic)
            let pt = null, best = 9;
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            pts.forEach(p => { const d = Math.hypot(p.t * state.pxPerSecond - mx, volY(p.v, ownerH(track)) - my); if (d < best) { best = d; pt = p; } });
            // On ne touche au dessin que s'il y a un vrai changement : sinon le double-clic (suppression) ne passerait pas
            let changed = false;
            if (!pt) {
                pushUndo();
                const at = pos(e);
                // Premier point posé : on ancre aussi le niveau normal au tout début, sinon toute la piste baisserait
                if (!pts.length && at.t > 0.05) pts.push({ t: 0, v: 1 });
                pt = { t: at.t, v: Math.round(at.v * 100) / 100 };
                pts.push(pt);
                changed = true;
                redraw();
            }
            const onMove = (ev) => {
                if (!changed) { pushUndo(); changed = true; }
                const at = pos(ev);
                pt.t = at.t; pt.v = Math.round(at.v * 100) / 100;
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
    const beatSec = 60 / state.project.bpm;
    const snapUnit = fine
        ? beatSec / 48   // ~1 frame à 30fps
        : (() => {
            const eff = getEffectiveSnap();
            return eff === 'bar'      ? beatSec * bpb()
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

// Zoom to fit : tout le projet visible d'un coup (Cmd+Shift+F)
function zoomToFit() {
    const end = computeProjectEndSec();
    const timeline = document.querySelector('.timeline');
    if (!timeline) return;
    const availWidth = timeline.clientWidth - 60;
    const totalSec = Math.max(end + 4, 10);
    const newPx = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, availWidth / totalSec));
    setZoom(newPx, 0);
    timeline.scrollLeft = 0;
    flash('Zoom : tout le projet');
}

// Persister zoom + scroll position dans localStorage
const ZOOM_KEY = 'pulse_zoom_v1';
// Zoom : de la séance entière (1 px = 1 s) jusqu'à la milliseconde (1 px ≈ 0,4 ms)
const ZOOM_MIN = 1, ZOOM_MAX = 2400;
function saveViewState() {
    const timeline = document.querySelector('.timeline');
    localStorage.setItem(ZOOM_KEY, JSON.stringify({
        pxPerSecond: state.pxPerSecond,
        trackHeight: state.trackHeight,
        scrollLeft: timeline ? timeline.scrollLeft : 0
    }));
}
function restoreViewState() {
    try {
        const s = JSON.parse(localStorage.getItem(ZOOM_KEY) || 'null');
        if (!s) return;
        if (s.pxPerSecond) { state.pxPerSecond = s.pxPerSecond; }
        if (s.trackHeight) { state.trackHeight = s.trackHeight; }
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
    return state.playhead;
}
// Pendant une lecture ou une prise : si tu zoomes ou défiles toi-même, la timeline arrête de suivre le curseur
function suspendFollow() {
    if ((state.playing || state.recording) && !state.followOff) {
        state.followOff = true;
        flash('Le défilement automatique est en pause pour que tu travailles où tu veux — il revient au prochain Espace');
    }
}
function setZoom(px, anchorSec) {
    const timeline = document.querySelector('.timeline');
    const oldPx = state.pxPerSecond;
    const newPx = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, px));
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
    timeline.scrollLeft = anchorPxAfter - screenOffset;
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
    ['effectParams', 'sends', 'sound', 'automation', 'autotune'].forEach(k => {
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
function deleteSelectedTrack() {
    if (state.recording) { flash('Une prise est en cours : arrête-la (Espace) avant de supprimer'); return; }
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
        volume: 80,
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
    const bpmEl = document.getElementById('bpmInput');
    if (bpmEl && document.activeElement !== bpmEl) bpmEl.value = state.project.bpm;
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
        menu.innerHTML = '<div class="ctx-item" data-type="reverb">Ajouter une reverb</div><div class="ctx-item" data-type="delay">Ajouter un écho</div>';
        menu.querySelectorAll('.ctx-item').forEach(it => it.addEventListener('mousedown', (ev) => { ev.stopPropagation(); closeAllMenus(); addSend(it.dataset.type); }));
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('mousedown', closeAllMenus, { once: true }), 10);
    });

    document.querySelectorAll('.mixer-strips .strip').forEach(strip => {
        const kind = strip.dataset.kind;
        if (kind === 'send') return;
        const i = parseInt(strip.dataset.i);

        // Clics sur slots FX
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
                    t.volume = v;
                    if (window.PulseAudio) PulseAudio.updateTrackVolume(i, v);
                    syncInspectorVolume(i);
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
function openClipGainPanel(trackIdx, clipIdx) {
    document.querySelectorAll('.clip-gain-panel').forEach(p => p.remove());
    const t = state.project.tracks[trackIdx];
    const clip = t?.clips[clipIdx];
    if (!clip) return;

    const currentGain = clip.gain !== undefined ? clip.gain : 1.0;
    const currentDb = currentGain > 0 ? 20 * Math.log10(currentGain) : -60;

    const panel = document.createElement('div');
    panel.className = 'fx-panel clip-gain-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <span>Gain du clip</span>
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
        clip.gain = Math.round(gain * 1000) / 1000;
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
        pushUndo(); delete clip.gain; renderTimelineTracks(); saveProject(); panel.remove();
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
        { label: 'Couper à gauche du curseur (Q)', action: () => { state.playhead = atSec; updatePlayhead(); trimLeft(); }},
        { label: 'Couper à droite du curseur (S)', action: () => { state.playhead = atSec; updatePlayhead(); trimRight(); }},
        { sep: true },
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

function closeAllMenus() {
    document.querySelectorAll('.track-ctx-menu').forEach(m => m.remove());
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
        t.isCapture ? null : { label: t.armed ? 'Ne plus enregistrer ici': 'Enregistrer sur cette piste', action: () => {
            if (t.type === 'keys' || t.type === 'drums') { flash('Cette piste joue des notes : pour enregistrer ta voix, ajoute une piste « Ma voix » avec le bouton +'); return; }
            t.armed = !t.armed;
            syncMonitor();
            renderTracksPanel(); bindTrackEvents(); saveProject();
        }},
        { sep: true },
        ...(state.project.buses || []).filter(b => isVisibleGroup(b) && b.id !== t.output)
            .map(b => ({ label: `Ranger dans le groupe « ${b.name} »`, action: () => moveTrackToGroup(state.project.tracks.indexOf(t), b.id) })),
        (t.takes || []).length ? { label: 'Supprimer les prises mises de côté', action: () => clearTrackTakes(state.project.tracks.indexOf(t)) } : null,
        { label: 'Nouveau groupe avec cette piste', action: () => createGroupWithTrack(state.project.tracks.indexOf(t)) },
        trackGroup(t) ? { label: `Sortir du groupe « ${trackGroup(t).name} »`, action: () => removeTrackFromGroup(state.project.tracks.indexOf(t)) } : null,
        { sep: true },
        (t.clips || []).filter(c => !c.recording).length > 1
            ? { label: 'Fusionner tous les clips de la piste en un seul', action: () => bounceTrack(idx) }
            : null,
        { label: 'Son de la piste (Voix lead, Doublage, Back…)', action: () => { const el = document.querySelector(`.track-item[data-i="${state.project.tracks.indexOf(t)}"]`); if (el) openSoundPanel(state.project.tracks.indexOf(t), el); } },
        (t.type === 'audio' || !t.type) && !t.isCapture && !isInstruTrack(t)
            ? { label: t.autotune && t.autotune.on ? 'Auto-Tune de la piste (modifier ou retirer)…' : 'Auto-Tune de la piste…', action: () => { const ti = state.project.tracks.indexOf(t); const el = document.querySelector(`.track-item[data-i="${ti}"]`); const r = el ? el.getBoundingClientRect() : { right: 300, top: 120 }; openTunePanel(ti, -1, r.right + 8, r.top, true); } }
            : null,
        { label: 'Changer la couleur', submenu: COLORS.map(c => ({ color: c, action: () => { pushUndo(); t.color = c; renderAll(); saveProject(); } })) }
    ].filter(Boolean);

    items.forEach(item => {
        if (item.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; menu.appendChild(d); return; }
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

// --- Menu contextuel sur un clip ---
function openClipContextMenu(x, y, trackIdx, clipIdx) {
    closeAllMenus();
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;

    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu clip-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200;`;

    const items = [
        clip.midi ? { label: clip.midi.inst === 'drums' ? '🥁 Ouvrir le séquenceur de pas' : '🎹 Ouvrir le piano roll', action: () => openMidiEditor(trackIdx, clipIdx) } : null,
        clip.midi ? { label: '🔗 Dupliquer en lien (les deux restent identiques)', action: () => linkDuplicateMidi(trackIdx, clipIdx) } : null,
        clip.midi ? { label: '⬇ Exporter en fichier .mid', action: () => exportMidiClip(trackIdx, clipIdx) } : null,
        clip.midi && clip.midi.pid ? { label: 'Rendre cette région indépendante', action: () => { pushUndo(); delete clip.midi.pid; renderTimelineTracks(); saveProject(); flash('Cette région n\'est plus liée aux autres'); } } : null,
        { label: 'Renommer',        action: () => startClipRename(trackIdx, clipIdx) },
        { label: 'Dupliquer',       action: () => {
            pushUndo();
            const copy = { ...JSON.parse(JSON.stringify(clip)), start: clip.start + clip.duration };
            state.project.tracks[trackIdx].clips.push(copy);
            state.project.tracks[trackIdx].clips.sort((a, b) => a.start - b.start);
            state.selectedClip = { trackIdx, clipIdx: state.project.tracks[trackIdx].clips.indexOf(copy) };
            renderTimelineTracks(); saveProject();
        }},
        { label: 'Couper ici', action: () => splitClipAt(trackIdx, clipIdx, state.playhead) },
        // Auto-Tune : plus proposé en clic droit (sa place est sur la piste) ; reste là seulement pour retirer/régler un clip déjà corrigé
        clip.midi || !clip.tune ? null : { label: '🎤 Auto-Tune (modifier ou retirer)…', action: () => openTunePanel(trackIdx, clipIdx, x, y) },
        { sep: true },
        { label: clip.muted ? 'Désactiver Mute clip' : 'Mute clip', action: () => {
            pushUndo(); clip.muted = !clip.muted; renderTimelineTracks(); saveProject();
        }},
        clip.midi ? null : { label: clip.rev ? '⏪ Remettre à l\'endroit' : '⏪ Inverser le son (reverse)', action: () => toggleReverse(clip) },
        clip.midi ? null : { label: clip.warp ? '⏱ Warp (modifier ou retirer)…' : '⏱ Caler sur le tempo du projet (Warp)…', action: () => openWarpPanel(trackIdx, clipIdx, x, y) },
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
        { label: 'Remettre le volume d\'origine', action: () => {
            pushUndo(); delete clip.gain; renderTimelineTracks(); saveProject(); flash('Volume du clip remis comme à l\'origine');
        }},
        clip.loopEnd ? { label: 'Supprimer la répétition', action: () => {
            pushUndo(); delete clip.loopEnd; renderTimelineTracks(); saveProject();
        }} : null,
        { sep: true },
        { label: 'Supprimer',       action: () => {
            state.selectedClip = { trackIdx, clipIdx };
            deleteSelectedClip();
        }, danger: true },
        { sep: true },
        { label: 'Couleur du clip', submenu: COLORS.map(c => ({
            color: c, action: () => { pushUndo(); clip.color = c; renderTimelineTracks(); saveProject(); }
        }))}
    ].filter(Boolean);

    items.forEach(item => {
        if (item.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; menu.appendChild(d); return; }
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
            if (e.target.closest('.t-mini, .t-knob, .t-vol')) return;
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
        ['mousedown', 'click', 'dblclick'].forEach(n => sl.addEventListener(n, (e) => e.stopPropagation()));
        sl.addEventListener('input', () => {
            const t = state.project.tracks[i]; if (!t) return;
            if (!undoPushed) { pushUndo(); undoPushed = true; }
            const v = posToVol(parseFloat(sl.value));
            t.volume = v;
            PulseAudio.updateTrackVolume(i, v);
            sl.dataset.tooltip = `Volume : ${volumeToDb(v)} dB (double-clic = 0 dB)`;
            syncInspectorVolume(i);
        });
        sl.addEventListener('change', () => { undoPushed = false; saveProject(); if (state.mixerOpen) { renderMixer(); bindMixerEvents(); } });
        sl.addEventListener('dblclick', () => {
            const t = state.project.tracks[i]; if (!t) return;
            pushUndo(); t.volume = 100; sl.value = volToPos(100);
            PulseAudio.updateTrackVolume(i, 100); syncInspectorVolume(i); saveProject();
            if (state.mixerOpen) { renderMixer(); bindMixerEvents(); }
            flash('Volume remis à 0 dB');
        });
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

            // Capture Lane : son R est verrouillé armé
            if (flag === 'rec' && t.isCapture) {
                flash('Cette piste est toujours prête à enregistrer');
                return;
            }
            if (flag === 'rec' && (t.type === 'keys' || t.type === 'drums')) {
                flash('Cette piste joue des notes : pour enregistrer ta voix, ajoute une piste « Ma voix » avec le bouton +');
                return;
            }

            if (flag === 'mute') { t.muted = !t.muted; PulseAudio.refreshAudibility(state.project); }
            if (flag === 'solo') { toggleSolo(i, e.metaKey || e.ctrlKey); return; }
            if (flag === 'rec')  { t.armed = !t.armed; }
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

    const setPlayheadFromEvent = (e) => {
        // Le curseur se cale sur la grille comme les clips (Shift = placement libre)
        state.playhead = snapTime(eventToTime(e), e.shiftKey);
        if (state.playing) {
            state.playOrigin = state.playhead;
            state.startTime = performance.now() - state.playhead * 1000;
        }
        updatePlayhead();
        updateChrono();
    };

    let _zoomAcc = { h: 1, v: 1, sec: 0, raf: 0 };
    // --- Zoom Cmd+scroll / Option+scroll / Opt+Cmd+scroll (style Logic) ---
    const handleZoomWheel = (e) => {
        const hZoom = e.metaKey || e.ctrlKey;
        const vZoom = e.altKey;
        if (!hZoom && !vZoom) return;
        e.preventDefault();
        suspendFollow();
        // Un trackpad envoie des dizaines d'événements par seconde : on les cumule et on ne dessine qu'une fois par image
        // (une molette crantée = un pas de 15 % ; un trackpad = des petits pas fluides)
        const factor = Math.pow(1.15, Math.max(-1, Math.min(1, -e.deltaY / 100)));
        if (hZoom) {
            const rect = timeline.getBoundingClientRect();
            _zoomAcc.sec = Math.max(0, (e.clientX - rect.left + timeline.scrollLeft) / state.pxPerSecond);
            _zoomAcc.h *= factor;
        }
        if (vZoom) {
            const tg = !hZoom ? wheelHeightTarget(e) : null;   // Option seule au-dessus d'une piste : cette piste seulement
            if (tg) {
                const same = _zoomAcc.one && _zoomAcc.one.kind === tg.kind && _zoomAcc.one.id === tg.id;
                _zoomAcc.one = { ...tg, f: (same ? _zoomAcc.one.f : 1) * factor };
            } else _zoomAcc.v *= factor;
        }
        if (!_zoomAcc.raf) _zoomAcc.raf = requestAnimationFrame(() => {
            const a = _zoomAcc; _zoomAcc = { h: 1, v: 1, sec: 0, raf: 0 };
            if (a.h !== 1) setZoom(state.pxPerSecond * a.h, a.sec);
            if (a.one && a.one.f !== 1) resizeOneHeight(a.one, a.one.f);
            else if (a.v !== 1) setTrackHeight(state.trackHeight * a.v, true);
        });
    };
    timeline.addEventListener('wheel', handleZoomWheel, { passive: false });
    timeline.addEventListener('wheel', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (Math.abs(e.deltaX) > 0 || e.shiftKey) suspendFollow();
    }, { passive: true });

    // --- Ruler : clic/drag place le playhead ---
    ruler.addEventListener('mousedown', (e) => {
        e.preventDefault(); // empêche la sélection de texte sur les labels
        if (e.altKey) return startLoopSelection(e, eventToTime);
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
        const edgeZone = 8;
        // Zone fade = top 45% du clip, 30% de la largeur ou 36px min
        const fadeZone = Math.max(36, rect.width * 0.3);
        const inTopHalf = relY < rect.height * 0.45;

        // Coin bas-droit → handle de loop
        const inBottomHalf = relY > rect.height * 0.6;
        if (inBottomHalf && relX > rect.width - 16)         { clipEl.style.cursor = 'e-resize'; clipEl.title = 'Répéter le clip'; }
        else if (inTopHalf && relX < fadeZone)               { clipEl.style.cursor = 'w-resize'; }
        else if (inTopHalf && relX > rect.width - fadeZone)  { clipEl.style.cursor = 'e-resize'; }
        else if (relX < edgeZone || relX > rect.width - edgeZone){ clipEl.style.cursor = 'ew-resize'; }
        else { clipEl.style.cursor = ''; clipEl.title = ''; }
    });
    tracks.addEventListener('mouseleave', (e) => {
        const clipEl = e.target.closest('.clip');
        if (clipEl) clipEl.style.cursor = '';
    });

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
        startClipRename(trackIdx, clipIdx);
    });

    // Clic droit sur un clip → menu contextuel
    tracks.addEventListener('contextmenu', (e) => {
        const clipEl = e.target.closest('.clip');
        e.preventDefault();
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

            if (clipEl) {
                const _ci = parseInt(clipEl.dataset.ci);
                const _clip = state.project.tracks[trackIdx]?.clips[_ci];
                // Clip en cours d'enregistrement → ne pas interagir, laisser placer le curseur
                if (_clip && !_clip.recording) {
                    // ⌘ + clic : l'outil choisi dans Réglages (muter la région par défaut)
                    const cmdTool = mouseTool('cmd');
                    if (e.metaKey && !e.shiftKey && cmdTool !== 'none' && !e.target.closest('.clip-fade-zone, .fade-curve-handle, [data-loop-handle]')) {
                        e.preventDefault();
                        runClipTool(cmdTool, e, trackIdx, _ci, eventToTime, false);
                        return;
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
                    if (!e.shiftKey) state.selectedClips.clear();
                    // Outil ciseau
                    if (state.tool === 'scissors') {
                        splitClipAt(trackIdx, _ci, eventToTime(e));
                        return;
                    }
                    // Poignée d'arrondi du fondu
                    const curveHandle = e.target.closest('.fade-curve-handle');
                    if (curveHandle) return startFadeCurveDrag(e, curveHandle.dataset.fade, trackIdx, _ci);
                    // Fade drag (zone haute du clip)
                    const fadeZoneEl = e.target.closest('.clip-fade-zone');
                    if (fadeZoneEl) {
                        return startFadeDrag(e, fadeZoneEl.dataset.fade, trackIdx, _ci);
                    }
                    // Smart Tool : détecte la zone même sans l'élément explicite
                    const rect = clipEl.getBoundingClientRect();
                    const relX = e.clientX - rect.left;
                    const relY = e.clientY - rect.top;
                    const fadeZone = Math.max(36, rect.width * 0.3);
                    const inTopHalf = relY < rect.height * 0.45;
                    if (inTopHalf && relX < fadeZone) return startFadeDrag(e, 'in',  trackIdx, _ci);
                    if (inTopHalf && relX > rect.width - fadeZone) return startFadeDrag(e, 'out', trackIdx, _ci);
                    // Handle de loop (coin bas-droit)
                    if (e.target.closest('[data-loop-handle]') || (relY > rect.height * 0.6 && relX > rect.width - 16)) {
                        return startLoopDrag(e, clipEl, trackIdx, _ci);
                    }
                    // Place le curseur au point de clic (Logic behavior)
                    setPlayheadFromEvent(e);
                    return startClipDrag(e, clipEl, trackIdx);
                }
            }
            if (e.shiftKey) {
                return startRangeSelection(e, eventToTime);
            }
        }

        // Clic sur zone vide → place le curseur + efface la sélection ;
        // clic enfoncé et glissé → on choisit une plage (visible seulement sur les pistes survolées), Suppr l'efface
        if (state.selection) clearRangeSelection();
        setPlayheadFromEvent(e);
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
const MOUSE_TOOL_DEFAULT = { cmd: 'mute', right: 'gain' };
const MOUSE_TOOL_LABELS = {
    mute: 'Muter / démuter la région',
    gain: 'Volume de la région (glisser)',
    cut: 'Couper la région à cet endroit',
    menu: 'Menu des actions',
    none: 'Rien'
};
function mouseTool(which) {
    try { const v = JSON.parse(localStorage.getItem(MOUSE_TOOLS_KEY) || '{}'); if (MOUSE_TOOL_LABELS[v[which]]) return v[which]; } catch {}
    return MOUSE_TOOL_DEFAULT[which];
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
    }
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

// === Déplacer un clip (drag) ou le sélectionner si simple click ===
function startClipDrag(startEvent, clipEl, trackIdx) {
    const clipIdx = parseInt(clipEl.dataset.ci);
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip || clip.recording) return;

    // Détection trim handles : si on clique sur bord gauche/droit → mode trim
    const rect = clipEl.getBoundingClientRect();
    const relX = startEvent.clientX - rect.left;
    const edgeZone = 7; // px
    if (relX < edgeZone) return startClipTrim(startEvent, clipEl, trackIdx, clipIdx, 'left');
    if (relX > rect.width - edgeZone) return startClipTrim(startEvent, clipEl, trackIdx, clipIdx, 'right');

    const duplicate = startEvent.altKey;
    let working = clip;
    if (duplicate) {
        working = { ...clip, peaks: clip.peaks ? clip.peaks.slice() : undefined };
        t.clips.push(working);
        if (clip.id && window.PulseAudio && PulseAudio.hasBuffer(clip.id)) {
            working.id = clip.id; // partage le buffer
        }
        renderTimelineTracks();
    }

    let startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let originalStart = working.start;
    let dragged = false;
    let undoPushed = false;
    let targetTrackIdx = trackIdx;
    // Un appui sur Shift pendant qu'on tient le clip fige sa position dans le temps (on ne change que de piste) ;
    // un second appui le libère.
    // La position figée est celle d'où la région est partie (pas l'endroit où elle se trouve au moment de l'appui)
    const gestureStart = working.start;
    let locked = false, lockedStart = gestureStart, lastX = startEvent.clientX;
    const onShift = (ke) => {
        if (ke.key !== 'Shift' || ke.repeat) return;
        locked = !locked;
        if (locked) lockedStart = gestureStart;
        else { originalStart = working.start; startX = lastX; }   // on repart d'ici, sans saut
        document.body.classList.toggle('axis-locked', locked);
        flash(locked ? '🔒 Retour à la position d\'origine, figée : tu changes seulement de piste (Shift pour libérer)' : '🔓 Déplacement libre');
    };
    document.addEventListener('keydown', onShift);

    const snapLine = getSnapLine();

    // Trouver la piste survolée à partir des coordonnées Y
    const getHoveredTrackIdx = (clientY) => {
        let best = trackIdx;
        document.querySelectorAll('.timeline-track').forEach(el => {
            const r = el.getBoundingClientRect();
            if (clientY >= r.top && clientY < r.bottom) best = parseInt(el.dataset.i);
        });
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

        // ⌘ tenu = placement libre le temps du geste (sinon : mode intelligent, ⌘G pour le couper)
        const dt = dx / state.pxPerSecond;
        const raw = locked ? lockedStart : originalStart + dt;
        const newStart = locked ? lockedStart : snapTime(raw, ev.metaKey || ev.ctrlKey);
        working.start = newStart;

        // Cible de la piste (drag vertical cross-track)
        const newTarget = getHoveredTrackIdx(ev.clientY);
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

        if (snapSpec().mode !== 'off' && !locked && !(ev.metaKey || ev.ctrlKey) && Math.abs(newStart - raw) > 0.001) {
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
            renderTimelineTracks();
        } else {
            if (targetTrackIdx !== trackIdx) {
                // Déplacer le clip vers la piste cible
                const srcIdx = t.clips.indexOf(working);
                if (srcIdx >= 0) t.clips.splice(srcIdx, 1);
                const dstT = state.project.tracks[targetTrackIdx];
                dstT.clips.push(working);
                dstT.clips.sort((a, b) => a.start - b.start);
                state.selectedClip = { trackIdx: targetTrackIdx, clipIdx: dstT.clips.indexOf(working) };
            }
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
    targetTrack.clips.push(pasted);
    targetTrack.clips.sort((a, b) => a.start - b.start);
    const newIdx = targetTrack.clips.indexOf(pasted);
    state.selectedTrack = trackIdx;
    state.selectedClip = { trackIdx, clipIdx: newIdx };
    renderAll();
    saveProject();
    flash('Clip collé à ' + secondsToDuration(start));
}

// === Loop region (Alt+drag dans le ruler, Logic style) ===
function startLoopSelection(startEvent, eventToTime) {
    const start = eventToTime(startEvent);
    state.loop = { start, end: start };
    renderLoopOverlay();
    const onMove = (ev) => {
        state.loop.end = eventToTime(ev);
        renderLoopOverlay();
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (Math.abs(state.loop.end - state.loop.start) < 0.1) state.loop = null;
        else state.looping = true;
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
        } else {
            const raw = originalDuration + dt;
            let d = Math.max(0.05, snapTime(clip.start + raw, ev.shiftKey) - clip.start);
            // Butée : fin du fichier source
            if (d > maxDuration) { d = maxDuration; hitLimit(); }
            clip.duration = d;
            if (clip.loopEnd && clip.loopEnd <= clip.start + clip.duration) delete clip.loopEnd;
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
    const beatPx = state.pxPerSecond * (60 / state.project.bpm);
    if (beatPx >= 480) return 'fine';     // 1/32 de temps : édition à la milliseconde
    if (beatPx >= 120) return 'division'; // 1/8 note
    if (beatPx >= 40)  return 'beat';
    return 'bar';
}

// free : ⌘ tenu = placement libre le temps du geste
function snapTime(t, free) {
    const { mode } = snapSpec();
    if (mode === 'off' || free) return Math.max(0, t);
    const eff = getEffectiveSnap();
    const beatSec = 60 / state.project.bpm;
    const unit = eff === 'bar'      ? beatSec * bpb()
               : eff === 'fine'     ? beatSec / 8
               : eff === 'division' ? beatSec / 4
               : beatSec;
    const nearest = Math.round(t / unit) * unit;
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

// === Double-clic sur un réglage = retour à sa valeur d'origine (comme dans Logic) ===
document.addEventListener('dblclick', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('input[type="range"][data-default]') : null;
    if (!el || el.disabled) return;
    el.value = el.dataset.default;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
});

// === Zoom vertical (hauteur des pistes) ===
// scaleAll : tout grossit ensemble (Option + molette, comme Logic) — les pistes et groupes qu'on avait réglés à la main suivent aussi
// Option + molette au-dessus d'une piste (ou d'un groupe) : seule celle-là grandit / rétrécit (comme Premiere) ;
// ailleurs (règle, vide), toutes les pistes suivent.
function wheelHeightTarget(e) {
    const el = e.target && e.target.closest && e.target.closest('.timeline-track[data-i], .track-item[data-i], .timeline-group-row[data-bus], .group-header[data-bus]');
    if (!el) return null;
    if (el.dataset.bus) return { kind: 'bus', id: el.dataset.bus };
    const i = parseInt(el.dataset.i);
    return Number.isFinite(i) ? { kind: 'track', id: i } : null;
}
function resizeOneHeight(tg, factor) {
    if (tg.kind === 'bus') {
        const b = busById(tg.id); if (!b) return;
        b.height = Math.max(GROUP_H_MIN, Math.min(GROUP_H_MAX, Math.round((b.height || 36) * factor)));
    } else {
        const t = state.project.tracks[tg.id]; if (!t) return;
        t.height = Math.max(TRACK_H_MIN, Math.min(TRACK_H_MAX, Math.round(trackH(t) * factor)));
    }
    renderTracksPanel(); bindTrackEvents(); renderTimelineTracks();
    saveProject();
}
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
    if (atSec <= clip.start || atSec >= clip.start + clip.duration) return;
    pushUndo();
    const left  = { ...clip, duration: atSec - clip.start, loopEnd: undefined, fadeOut: 0 };
    const right = { ...clip, start: atSec, duration: clip.start + clip.duration - atSec,
                    offset: (clip.offset || 0) + (atSec - clip.start), fadeIn: 0,
                    name: (clip.name || 'Clip') + '\'' };
    t.clips.splice(clipIdx, 1, left, right);
    renderTimelineTracks();
    saveProject();
    flash('✂ Clip coupé');
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
    pushUndo(); // snapshot avant modification
    const startX = startEvent.clientX;
    const originalFade = fadeDir === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0);

    const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dt = dx / state.pxPerSecond;
        const delta = fadeDir === 'in' ? dt : -dt;
        const newFade = Math.max(0, Math.min(clip.duration * 0.9, originalFade + delta));
        if (fadeDir === 'in') clip.fadeIn = newFade; else clip.fadeOut = newFade;
        const clipEl = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (clipEl) updateClipFadeVisual(clipEl, clip, fadeDir);
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging');
        renderTimelineTracks();
        saveProject();
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
            if (state.playing) PulseAudio.startMetronome(state.project.bpm, state.playhead);
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
    document.getElementById('btnSave').addEventListener('click', () => {
        saveProject();
        flash('Projet sauvegardé');
    });

    initSnapControl();

    document.getElementById('bpmInput').addEventListener('change', e => {
        const v = parseInt(e.target.value);
        if (!(v >= 40 && v <= 240)) {
            e.target.value = state.project.bpm;
            flash('Le tempo va de 40 à 240 BPM');
            e.target.blur();
            return;
        }
        {
            if (v !== state.project.bpm) pushUndo();
            e.target.blur();
            state.project.bpm = v; refreshPlaybackSoon(); // les échos calés sur le rythme suivent le nouveau tempo
            if (window.PulseAudio) PulseAudio.setMetronomeBpm(v);
            renderRuler();
            renderTimelineGrid(document.getElementById('timelineTracks'));
            saveProject();
        }
    });

    // Zoom vertical depuis le panneau pistes (Option+scroll)
    document.getElementById('tracksList').addEventListener('wheel', (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
        const tg = wheelHeightTarget(e);
        if (tg) resizeOneHeight(tg, factor);
        else setTrackHeight(state.trackHeight * factor, true);
    }, { passive: false });

    // Initialiser la hauteur des pistes
    setTrackHeight(state.trackHeight);

    document.getElementById('btnScissors').addEventListener('click', () => setActiveTool(state.tool === 'scissors' ? 'pointer' : 'scissors'));
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
            const v = parseInt(masterFader.value);
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
        if (mod && k === 's')          { e.preventDefault(); saveProject(); flash('Projet sauvegardé'); return; }
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
        if (mod && k === 'a')          { e.preventDefault(); selectAllClipsOnTrack(); return; }
        if (mod && shift && k === 'f') { e.preventDefault(); zoomToFit(); return; }
        if (mod && k === 'd')          { e.preventDefault(); duplicateTrack(state.selectedTrack); return; }
        if (mod && k === 'g')          { e.preventDefault(); toggleSmartMode(); return; }
        if (mod && k === 'c')          { e.preventDefault(); copySelectedClip(); return; }
        if (mod && k === 'v')          { e.preventDefault(); pasteClip(); return; }

        // Transport (Espace est détourné en mode tap)
        const onButton = e.target && e.target.closest && e.target.closest('button, [role="button"], select, a[href]');
        // Un bouton atteint au clavier (Tab) reçoit Espace / Entrée ; après un simple clic souris, Espace reste « lecture »
        let kbFocus = false; try { kbFocus = !!onButton && onButton.matches(':focus-visible'); } catch {}
        if (kbFocus && (e.code === 'Space' || e.code === 'Enter')) return;
        if (e.code === 'Space') {
            e.preventDefault();
            if (state.tapMode) tapOnce();
            else togglePlay();
            return;
        }
        if (e.code === 'Enter')  { e.preventDefault(); rewind(); return; }
        if (k === 'r') { toggleRec(); return; }

        // Édition (coupes rapides)
        if (k === 'q') { e.preventDefault(); trimLeft();  return; }
        if (k === 's' && !shift && !mod) { e.preventDefault(); trimRight(); return; }

        // Piste sélectionnée
        if (k === 's' && shift && !mod) { e.preventDefault(); selectedTrackIdxs().forEach(i => toggleSolo(i)); return; }
        if (e.altKey && e.code === 'KeyS' && !mod) { e.preventDefault(); selectedTrackIdxs().forEach(i => toggleSolo(i)); return; }  // ⌥S = solo (⌥+S donne « ß » sur Mac)
        if (k === 'm') { selectedTrackIdxs().forEach(i => toggleMute(i)); return; }

        // Transport secondaires
        if (k === 'l') { document.getElementById('btnLoop').click(); return; }
        if (k === 'k') { document.getElementById('btnMetronome').click(); return; }  // K = click/métronome (comme Logic)
        if (k === 't') { e.preventDefault(); toggleTapMode(); return; }              // T = toggle mode tap (puis Espace tape)

        // Zoom (Pro Tools style, adapté : E = zoom in, Z = zoom out)
        if (k === 'e') { e.preventDefault(); setZoom(state.pxPerSecond * 1.25); return; }
        if (k === 'z' && !mod) { e.preventDefault(); setZoom(state.pxPerSecond / 1.25); return; }

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
            } else stepPlayhead(dir, shift ? 'bar' : 'beat');
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
        if (k === 'x') { e.preventDefault(); toggleMixer(); return; }

        // Marqueurs (Alt+M = poser, Alt+← = marqueur précédent, Alt+→ = suivant)
        if (e.altKey && k === 'm') { e.preventDefault(); addMarker(state.playhead); return; }
        if (e.altKey && e.code === 'ArrowLeft'  && !mod) { e.preventDefault(); navigateMarker(-1); return; }
        if (e.altKey && e.code === 'ArrowRight' && !mod) { e.preventDefault(); navigateMarker(+1); return; }

        // F = Zoom sur le clip sélectionné (Logic style)
        if (k === 'f' && !mod) {
            e.preventDefault();
            if (state.selectedClip) {
                const { trackIdx, clipIdx } = state.selectedClip;
                const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
                if (clip) {
                    const tl = document.querySelector('.timeline');
                    const dur = clip.duration;
                    const availW = tl ? tl.clientWidth - 60 : 600;
                    const newPx = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (availW * 0.8) / dur));
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
