// === Pulse — Studio logic (proto UI) ===
// Pas de moteur audio pour l'instant — on monte l'interface d'abord.

const TRACK_ICONS = {
    audio: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line>',
    beat:  '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>',
    inst:  '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>'
};

const COLORS = ['#A855F7', '#7C3AED', '#C084FC', '#F472B6', '#60A5FA', '#34D399'];

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
                bpm: 90
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
        return p;
    } catch {
        return { name: 'Projet sans titre', tracks: [], buses: [], bpm: 90 };
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
    selectedClip: null,   // { trackIdx, clipIdx }
    startTime: 0,
    loop: null,           // { start, end } en secondes, ou null
    tool: 'pointer',      // 'pointer' | 'scissors'
    trackHeight: 72,      // hauteur des pistes en px (zoom vertical)
    snap: 'smart',        // 'smart' | 'bar' | 'beat' | 'division' | 'off'
    clipboard: null       // { clip, trackIdx } pour copy/paste
};

// === Undo (snapshots JSON du projet, max 30 niveaux) ===
const _undoStack = [];
const _MAX_UNDO = 30;
function pushUndo() {
    _undoStack.push(JSON.stringify(state.project));
    if (_undoStack.length > _MAX_UNDO) _undoStack.shift();
}
function undoAction() {
    if (!_undoStack.length) { flash('Rien à annuler'); return; }
    state.project = JSON.parse(_undoStack.pop());
    renderAll();
    saveProject();
    flash('✓ Annulé');
}

// --- Rendu : panneau pistes ---
function renderTracksPanel() {
    const list = document.getElementById('tracksList');
    // Les Capture Lanes remontent toujours en haut (pinned)
    const tracks = state.project.tracks;
    list.innerHTML = tracks.map((t, i) => {
        const classes = [
            'track-item',
            i === state.selectedTrack ? 'selected' : '',
            t.isCapture ? 'is-capture' : '',
            t.armed ? 'is-armed' : '',
            t.muted ? 'is-muted' : '',
            t.solo ? 'is-solo' : ''
        ].filter(Boolean).join(' ');
        return `
        <div class="${classes}" style="--track-color: ${t.color}" data-i="${i}">
            ${t.isCapture ? '' : '<div class="track-drag-handle" data-tooltip="Réordonner"><svg viewBox="0 0 10 16" width="10" height="14" fill="currentColor" opacity="0.4"><circle cx="3" cy="2.5" r="1.5"/><circle cx="7" cy="2.5" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/><circle cx="3" cy="13.5" r="1.5"/><circle cx="7" cy="13.5" r="1.5"/></svg></div>'}
            <div class="track-icon">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${TRACK_ICONS[t.type] || TRACK_ICONS.audio}
                </svg>
            </div>
            <div class="track-info">
                <div class="track-name" contenteditable="${!t.isCapture}" data-i="${i}">${esc(t.name)}${t.isCapture ? '<span class="chip" contenteditable="false"> LIVE</span>' : ''}</div>
                <div class="track-buttons">
                    <button class="t-mini m-m ${t.muted?'active':''}" data-flag="mute" data-i="${i}" data-tooltip="Mute (M)">M</button>
                    <button class="t-mini m-s ${t.solo?'active':''}" data-flag="solo" data-i="${i}" data-tooltip="Solo (Shift+S)">S</button>
                    <button class="t-mini m-r ${t.armed?'active':''} ${t.isCapture?'locked':''}" data-flag="rec" data-i="${i}" data-tooltip="${t.isCapture ? 'Toujours armée (Capture Lane)' : 'Armer la piste'}">R</button>
                    <div class="vu-mini"><span></span></div>
                    ${t.isCapture ? '' : `<button class="t-mini m-del" data-del="${i}" data-tooltip="Supprimer la piste">×</button>`}
                </div>
            </div>
        </div>`;
    }).join('');
}

// --- Rendu : timeline tracks (zones vides) ---
function renderTimelineTracks() {
    const el = document.getElementById('timelineTracks');
    const timelineWidthSec = Math.max(180, computeProjectEndSec() + 60);
    const timelineWidthPx = state.pxPerSecond * timelineWidthSec;

    el.innerHTML = state.project.tracks.map((t, i) => {
        const clips = t.clips || [];
        const isInstru = t.preset === 'instru' || t.type === 'instru';
        const needsDropzone = isInstru && clips.length === 0;

        return `
        <div class="timeline-track ${isInstru ? 'is-instru' : ''}" data-i="${i}" style="width: ${timelineWidthPx}px">
            ${clips.map((c, ci) => renderClip(t, c, ci)).join('')}
            ${needsDropzone ? renderInstruDropzone(i) : ''}
        </div>`;
    }).join('');

    if (state.selection) {
        const overlay = document.createElement('div');
        overlay.className = 'range-selection';
        el.appendChild(overlay);
        updateRangeOverlay(overlay);
    }
    bindDropzones();
}

function renderClip(t, c, ci) {
    const hasBuffer = c.id && (window.PulseAudio ? PulseAudio.hasBuffer(c.id) : false);
    const widthPx = c.duration * state.pxPerSecond;
    const leftPx = c.start * state.pxPerSecond;
    const posTC = secondsToTC(c.start);
    const durTC = secondsToDuration(c.duration);
    const tooltip = `${c.name || 'Clip'} — ${durTC} @ ${posTC}`;
    const stale = !hasBuffer && !c.recording && c.id;
    const trackIdx = state.project.tracks.indexOf(t);
    const selected = state.selectedClip && state.selectedClip.trackIdx === trackIdx && state.selectedClip.clipIdx === ci;

    const fadeInPx  = c.fadeIn  ? Math.min(c.fadeIn  * state.pxPerSecond, widthPx * 0.9) : 0;
    const fadeOutPx = c.fadeOut ? Math.min(c.fadeOut * state.pxPerSecond, widthPx * 0.9) : 0;

    return `
    <div class="clip ${c.recording ? 'is-recording' : ''} ${stale ? 'is-stale' : ''} ${selected ? 'is-selected' : ''} ${c.muted ? 'is-muted-clip' : ''}"
         data-ci="${ci}"
         data-tooltip="${esc(tooltip)}"
         style="--clip-color: ${c.color || t.color}; left: ${leftPx}px; width: ${widthPx}px">
        <div class="clip-trim-handle left"></div>
        <div class="clip-trim-handle right"></div>
        <div class="clip-fade-zone in"  data-fade="in"></div>
        <div class="clip-fade-zone out" data-fade="out"></div>
        ${fadeInPx  > 0 ? `<div class="clip-fade-overlay in"  style="width:${fadeInPx}px"></div>`  : ''}
        ${fadeOutPx > 0 ? `<div class="clip-fade-overlay out" style="width:${fadeOutPx}px"></div>` : ''}
        ${renderClipWaveform(c, widthPx)}
        <div class="clip-name" data-ci="${ci}">${esc(c.name || 'Clip')}${stale ? ' <span class="clip-stale-tag">⚠ audio perdu</span>' : ''}${c.gain && c.gain !== 1 ? ` <span class="clip-gain-tag">${(20*Math.log10(c.gain)).toFixed(1)}dB</span>` : ''}</div>
    </div>`;
}

function renderClipWaveform(c, widthPx) {
    const peaks = c.peaks;
    if (!peaks || !peaks.length || widthPx < 10) {
        return '<div class="clip-wave"></div>';
    }
    const targetBars = Math.max(2, Math.floor(widthPx / 2));
    const step = peaks.length / targetBars;
    const h = Math.max(20, state.trackHeight - 28);
    const barWidth = widthPx / targetBars;
    const cy = h / 2;

    // Style Logic Pro : barres miroir depuis le centre (haut + bas)
    let path = '';
    for (let i = 0; i < targetBars; i++) {
        const idx = Math.floor(i * step);
        const v = peaks[idx] || 0;
        const halfH = Math.max(0.5, (v * h) * 0.48); // 48% pour laisser une légère marge
        const x = i * barWidth;
        const bw = Math.max(0.5, barWidth - 0.5);
        path += `<rect x="${x.toFixed(1)}" y="${(cy - halfH).toFixed(1)}" width="${bw.toFixed(1)}" height="${(halfH * 2).toFixed(1)}" />`;
    }
    return `<svg class="clip-wave-svg" viewBox="0 0 ${widthPx} ${h}" preserveAspectRatio="none">${path}</svg>`;
}

function computeProjectEndSec() {
    let max = 0;
    state.project.tracks.forEach(t => (t.clips || []).forEach(c => {
        const end = c.start + c.duration;
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
                <button class="dz-tab" data-tab="url">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Lien YouTube / SoundCloud
                </button>
            </div>
            <div class="dz-panel dz-panel-file active" data-panel="file">
                <div class="dz-big">
                    <div class="dz-icon">🎵</div>
                    <div class="dz-title">Dépose ton instru ici</div>
                    <div class="dz-sub">MP3, WAV, FLAC, M4A — ou clique pour choisir</div>
                    <input type="file" class="dz-input" accept="audio/*">
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
            if (f && f.type.startsWith('audio/')) importAudioFile(f, trackIdx);
            else flash('Seuls les fichiers audio sont acceptés');
        });

        // URL field
        const urlBtn = dz.querySelector('.dz-url-btn');
        const urlInput = dz.querySelector('.dz-url-input');
        urlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = urlInput.value.trim();
            if (!url) { flash('Colle une URL d\'abord'); return; }
            if (window.pulse && window.pulse.isElectron) {
                // Hook futur Tauri/Electron pour yt-dlp
                flash('Téléchargement démarré (desktop)…');
            } else {
                flash('Import d\'URL : disponible dans Pulse desktop');
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
async function importAudioFile(file, trackIdx, atTime = null) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    flash(`Import de ${file.name}…`);
    try {
        await PulseAudio.init();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await PulseAudio.getContext().decodeAudioData(arrayBuffer.slice(0)); // slice: copy pour éviter détachement
        const duration = audioBuffer.duration;

        const clipId = `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        PulseAudio.registerBuffer(clipId, audioBuffer);
        const peaks = Array.from(PulseAudio.computePeaks(audioBuffer, 400));

        // Persistance : encode en WAV et stocke en IndexedDB (lossless, portable)
        try {
            const wavBlob = PulseAudio.audioBufferToWav(audioBuffer);
            await PulsePersist.saveBlob(clipId, wavBlob, { originalName: file.name });
        } catch (persErr) { console.warn('Persist failed', persErr); }

        t.clips = t.clips || [];
        t.clips.push({
            id: clipId,
            name: file.name.replace(/\.[^.]+$/, ''),
            start: atTime !== null ? atTime : 0,
            duration,
            peaks,
            fileName: file.name,
            fileSize: file.size
        });

        const estimatedBpm = detectBpmStub(audioBuffer);
        if (estimatedBpm) {
            state.project.bpm = estimatedBpm;
            document.getElementById('bpmInput').value = estimatedBpm;
            renderRuler();
            flash(`${file.name} importé · BPM estimé : ${estimatedBpm}`);
        } else {
            flash(`${file.name} importé`);
        }

        renderTimelineTracks();
        saveProject();
    } catch (err) {
        console.error(err);
        flash('Impossible de lire ce fichier audio');
    }
}

// Stub de détection BPM — à remplacer par aubio-rs côté Rust en v0.2
// Pour le proto : on fait une estimation ultra-naïve basée sur la détection de pics d'énergie
function detectBpmStub(audioBuffer) {
    try {
        const data = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        // Downsample pour la vitesse
        const windowSize = Math.floor(sampleRate / 60); // 60 "frames" par seconde
        const frames = [];
        for (let i = 0; i < data.length; i += windowSize) {
            let sum = 0;
            for (let j = 0; j < windowSize && i + j < data.length; j++) {
                sum += Math.abs(data[i + j]);
            }
            frames.push(sum / windowSize);
        }
        // Pics > seuil
        const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
        const threshold = avg * 1.5;
        const peaks = [];
        for (let i = 1; i < frames.length - 1; i++) {
            if (frames[i] > threshold && frames[i] > frames[i-1] && frames[i] > frames[i+1]) {
                peaks.push(i);
            }
        }
        if (peaks.length < 4) return null;
        // Intervalles moyens entre pics (en frames)
        const intervals = [];
        for (let i = 1; i < peaks.length; i++) {
            intervals.push(peaks[i] - peaks[i-1]);
        }
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        if (!medianInterval) return null;
        // Convertir en BPM
        const framesPerSecond = 60;
        const beatsPerSecond = framesPerSecond / medianInterval;
        let bpm = Math.round(beatsPerSecond * 60);
        // Rabattre dans la plage [70, 180]
        while (bpm < 70)  bpm *= 2;
        while (bpm > 180) bpm /= 2;
        return Math.round(bpm);
    } catch {
        return null;
    }
}

// --- Rendu : règle temporelle ---
function renderRuler() {
    const ruler = document.getElementById('timelineRuler');
    const beatSec = 60 / state.project.bpm;
    const beatPx = state.pxPerSecond * beatSec;
    const totalSec = Math.max(180, computeProjectEndSec() + 60);
    const bars = Math.ceil(totalSec / (beatSec * 4));
    const showBeats = beatPx >= 24; // affiche les numéros de beat si assez de place

    let html = '';
    for (let bar = 0; bar <= bars; bar++) {
        const x = bar * beatPx * 4;
        html += `<div class="ruler-tick major" style="left:${x.toFixed(1)}px"></div>`;
        html += `<div class="ruler-label major" style="left:${x.toFixed(1)}px">${bar + 1}</div>`;
        for (let beat = 1; beat < 4; beat++) {
            const bx = x + beat * beatPx;
            html += `<div class="ruler-tick minor" style="left:${bx.toFixed(1)}px"></div>`;
            if (showBeats) {
                html += `<div class="ruler-label minor" style="left:${bx.toFixed(1)}px">${beat + 1}</div>`;
            }
        }
    }
    ruler.innerHTML = html;
}

// --- Rendu : mixer strips (tracks + buses) ---
function renderMixer() {
    const strips = document.getElementById('mixerStrips');

    // Pistes d'abord
    const trackStrips = state.project.tracks.map((t, i) => {
        const panDeg = ((t.pan || 0) / 100) * 135;
        const panLabel = t.pan === undefined || t.pan === 0 ? 'C' : (t.pan > 0 ? `R${Math.abs(t.pan)}` : `L${Math.abs(t.pan)}`);
        return `
        <div class="strip ${t.isCapture?'strip-capture':''}" style="--track-color: ${t.color}" data-kind="track" data-i="${i}">
            <div class="strip-name">${t.name}</div>
            <div class="strip-fx">
                <div class="strip-fx-slot ${(t.effects||[]).includes('eq') ? 'active' : ''}" data-fx="eq">EQ</div>
                <div class="strip-fx-slot ${(t.effects||[]).includes('comp') ? 'active' : ''}" data-fx="comp">Comp</div>
                <div class="strip-fx-slot ${(t.effects||[]).includes('reverb') ? 'active' : ''}" data-fx="reverb">Rev</div>
            </div>
            <div class="strip-pan">
                <div class="strip-pan-knob" style="transform: rotate(${panDeg}deg)" data-tooltip="Pan ${panLabel} (drag horizontal)"></div>
            </div>
            <div class="strip-fader-wrap">
                <div class="fader-row">
                    <div class="vu-rail"><div class="vu-bar"></div></div>
                    <input type="range" class="fader" min="0" max="100" value="${t.volume ?? 80}">
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
                <div class="strip-name">${b.name}${b.locked ? ' <span class="chip chip-red">LOCK</span>' : ''}</div>
                <div class="strip-fx">
                    <div class="strip-fx-slot active" data-fx="preset">${b.preset || 'bus'}</div>
                </div>
                <div class="strip-fader-wrap">
                    <input type="range" class="fader" min="0" max="100" value="${b.volume ?? 85}" ${b.locked?'disabled':''}>
                    <div class="strip-db">${volumeToDb(b.volume ?? 85)} dB</div>
                </div>
                <div class="strip-output">→ ${busLabel(b.output)}</div>
            </div>
        `).join('')}
    ` : '';

    strips.innerHTML = trackStrips + busStrips;
}

function busLabel(id) {
    if (!id || id === 'master') return 'Master';
    const b = (state.project.buses || []).find(x => x.id === id);
    return b ? b.name : id;
}

function volumeToDb(v) {
    if (v === 0) return '-∞';
    const db = 20 * Math.log10(v / 100);
    return db.toFixed(1);
}

// --- Projet name édition ---
function initProjectName() {
    const el = document.getElementById('projectName');
    el.textContent = state.project.name;
    el.addEventListener('blur', () => {
        state.project.name = el.textContent.trim() || 'Projet sans titre';
        saveProject();
    });
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
}

let _lastSaveTs = 0;
let _saveTickTimer = null;
function saveProject() {
    localStorage.setItem('pulse_current_project', JSON.stringify(state.project));
    _lastSaveTs = Date.now();
    updateSaveIndicator();
    if (!_saveTickTimer) {
        _saveTickTimer = setInterval(updateSaveIndicator, 5000);
    }
}

function updateSaveIndicator() {
    const el = document.getElementById('saveIndicator');
    if (!el) return;
    if (!_lastSaveTs) { el.textContent = '—'; el.classList.remove('saved'); return; }
    const diff = Math.floor((Date.now() - _lastSaveTs) / 1000);
    el.classList.add('saved');
    if (diff < 3) el.textContent = 'Enregistré';
    else if (diff < 60) el.textContent = `Enregistré il y a ${diff}s`;
    else if (diff < 3600) el.textContent = `Enregistré il y a ${Math.floor(diff/60)}min`;
    else el.textContent = 'Enregistré';
}

// --- Transport ---
async function togglePlay() {
    // Logic : Space pendant rec = stop rec + stop play
    if (state.recording) {
        await stopActualRecording();
        state.playing = false;
        const btn = document.getElementById('btnPlay');
        btn.querySelector('.icon-play').style.display = 'block';
        btn.querySelector('.icon-pause').style.display = 'none';
        PulseAudio.stopAll();
        PulseAudio.stopMetronome();
        return;
    }

    state.playing = !state.playing;
    const btn = document.getElementById('btnPlay');
    btn.querySelector('.icon-play').style.display = state.playing ? 'none' : 'block';
    btn.querySelector('.icon-pause').style.display = state.playing ? 'block' : 'none';

    if (state.playing) {
        state.startTime = performance.now() - state.playhead * 1000;
        try { await PulseAudio.play(state.project, state.playhead); } catch (err) { console.error(err); }
        if (state.metronome) PulseAudio.startMetronome(state.project.bpm, state.playhead);
        requestAnimationFrame(tick);
    } else {
        PulseAudio.stopAll();
        PulseAudio.stopMetronome();
    }
}

async function toggleRec() {
    // Si on est déjà en train d'enregistrer → stop
    if (state.recording) {
        await stopActualRecording();
        return;
    }

    // Trouver la piste cible : d'abord Capture Lane, sinon première armée
    const captureIdx = state.project.tracks.findIndex(t => t.isCapture);
    const armedIdx = state.project.tracks.findIndex(t => t.armed && !t.isCapture);
    const targetIdx = captureIdx >= 0 ? captureIdx : armedIdx;

    if (targetIdx < 0) {
        flash('Aucune piste armée. Clique R sur une piste ou utilise la Capture Lane');
        return;
    }

    try {
        await startActualRecording(targetIdx);
    } catch (err) {
        console.error(err);
        flash('Micro refusé ou indisponible');
        state.recording = false;
        document.getElementById('btnRec').classList.remove('active');
    }
}

async function startActualRecording(targetIdx) {
    const t = state.project.tracks[targetIdx];
    let startSec = state.playhead;

    // Count-in : UNIQUEMENT si on n'est pas déjà en lecture (R depuis stop)
    // Si on est en playback, R lance direct le rec sans count-in.
    if (PulseAudio.isCountInEnabled() && !state.playing) {
        flash('Count-in : 4 beats…');
        await PulseAudio.playCountIn(state.project.bpm, 4);
        // Le count-in ne doit pas déplacer le playhead ; on repart du même point
        startSec = state.playhead;
    }

    const clipId = `rec_${Date.now().toString(36)}`;
    const livingClip = {
        id: clipId,
        name: '●REC',
        start: startSec,
        duration: 0.1,
        recording: true
    };
    t.clips = t.clips || [];
    t.clips.push(livingClip);
    state._livingClip = { trackIdx: targetIdx, clip: livingClip };

    renderTimelineTracks();

    await PulseAudio.startRecording(targetIdx, startSec, {
        onProgress: (elapsed) => {
            livingClip.duration = elapsed;
            const clipEl = document.querySelector(`.timeline-track[data-i="${targetIdx}"] .clip[data-ci="${t.clips.length - 1}"]`);
            if (clipEl) clipEl.style.width = (elapsed * state.pxPerSecond) + 'px';
        }
    });

    state.recording = true;
    document.getElementById('btnRec').classList.add('active');
    if (!state.playing) await togglePlay();
    flash(`🔴 Rec sur « ${t.name} »`);
}

async function stopActualRecording() {
    const result = await PulseAudio.stopRecording();
    state.recording = false;
    document.getElementById('btnRec').classList.remove('active');

    if (!result || !result.audioBuffer) {
        flash('Enregistrement raté');
        return;
    }

    const { audioBuffer, duration, startSec, targetTrackIdx } = result;
    const t = state.project.tracks[targetTrackIdx];
    const living = state._livingClip && state._livingClip.clip;

    const peaks = Array.from(PulseAudio.computePeaks(audioBuffer, 400));

    if (living) {
        // Finaliser le clip "living"
        PulseAudio.registerBuffer(living.id, audioBuffer);
        living.duration = duration;
        living.recording = false;
        living.peaks = peaks;
        living.name = `Prise ${(t.clips || []).filter(c => !c.recording).length}`;
        // Persistance
        try {
            const wavBlob = PulseAudio.audioBufferToWav(audioBuffer);
            await PulsePersist.saveBlob(living.id, wavBlob, { kind: 'rec' });
        } catch (e) { console.warn('Persist rec failed', e); }
        state._livingClip = null;
    } else {
        // Fallback
        const clipId = `rec_${Date.now().toString(36)}`;
        PulseAudio.registerBuffer(clipId, audioBuffer);
        t.clips.push({ id: clipId, name: 'Prise', start: startSec, duration, peaks });
        try {
            const wavBlob = PulseAudio.audioBufferToWav(audioBuffer);
            await PulsePersist.saveBlob(clipId, wavBlob, { kind: 'rec' });
        } catch (e) {}
    }

    renderTimelineTracks();
    saveProject();
    flash(`✓ Prise de ${duration.toFixed(1)}s enregistrée`);

    // On continue la lecture
}

function tick() {
    if (!state.playing) return;
    const audioPos = window.PulseAudio ? PulseAudio.getPlaybackPosition() : null;
    state.playhead = (audioPos !== null && audioPos > 0)
        ? audioPos
        : (performance.now() - state.startTime) / 1000;

    // Loop region : si on dépasse end, on revient à start sans arrêter le flow visuel
    if (state.looping && state.loop) {
        const loopEnd = Math.max(state.loop.start, state.loop.end);
        const loopStart = Math.min(state.loop.start, state.loop.end);
        if (state.playhead >= loopEnd) {
            state.playhead = loopStart;
            PulseAudio.stopAll();
            PulseAudio.play(state.project, loopStart);
            updatePlayhead();
            updateChrono();
            requestAnimationFrame(tick);
            return;
        }
    } else {
        // Stop auto si on dépasse la fin de tous les clips (+ 0.5s de queue)
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
    requestAnimationFrame(tick);
}

function updatePlayhead() {
    const ph = document.getElementById('playhead');
    const x = state.playhead * state.pxPerSecond;
    ph.style.left = `${x}px`;
    ph.style.transform = '';
    // Auto-scroll : le curseur reste visible pendant lecture et rec
    if (state.playing || state.recording) {
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
        const bar  = Math.floor(totalBeats / 4) + 1;
        const beat = Math.floor(totalBeats % 4) + 1;
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

    pushUndo();
    t.clips = clips.flatMap(c => {
        const start = c.start;
        const end   = c.start + c.duration;
        // Playhead en dehors du clip → inchangé
        if (ph <= start || ph >= end) return [c];
        touched++;
        if (side === 'left') {
            // On garde la partie droite : nouveau start = playhead
            return [{ ...c, start: ph, duration: end - ph }];
        } else {
            // On garde la partie gauche : nouvelle duration = playhead - start
            return [{ ...c, duration: ph - start }];
        }
    });

    if (touched > 0) {
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
    saveProject();
}

function toggleSolo(trackIdx) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    t.solo = !t.solo;
    const btn = document.querySelector(`.track-item[data-i="${trackIdx}"] .m-s`);
    if (btn) btn.classList.toggle('active', t.solo);
    saveProject();
}

function clearAllSolos() {
    state.project.tracks.forEach(t => t.solo = false);
    document.querySelectorAll('.track-item .m-s').forEach(btn => btn.classList.remove('active'));
    saveProject();
    flash('Solos effacés');
}

// === Sélection de piste ===
function selectTrack(idx) {
    const max = state.project.tracks.length - 1;
    state.selectedTrack = Math.max(0, Math.min(max, idx));
    renderTracksPanel();
    bindTrackEvents();
}

// === Cheat sheet raccourcis (? ou bouton help) ===
const SHORTCUT_GROUPS = [
    {
        title: 'Transport',
        items: [
            ['Espace', 'Play / Pause'],
            ['R', 'Enregistrer / Stop'],
            ['Entrée', 'Retour au début'],
            ['L', 'Loop on/off'],
            ['K', 'Métronome'],
            ['T', 'Mode tap tempo (puis Espace)']
        ]
    },
    {
        title: 'Édition rapide',
        items: [
            ['Q', 'Couper à gauche du curseur'],
            ['S', 'Couper à droite du curseur'],
            ['B', 'Outil ciseau — couper un clip au clic'],
            ['⌘C', 'Copier le clip sélectionné'],
            ['⌘V', 'Coller à la position du curseur'],
            ['⌘Z', 'Annuler (30 niveaux)'],
            ['← / →', 'Nudger le clip sélectionné (1 snap)'],
            ['Shift + ← / →', 'Nudger le clip finement (1/48 beat ≈ 1 frame)'],
            ['Shift + drag clip', 'Désactiver le snap temporairement'],
            ['Shift + drag', 'Sélectionner une plage'],
            ['Suppr / ⌫', 'Effacer le clip ou la plage sélectionnée'],
            ['Alt + drag clip', 'Dupliquer le clip']
        ]
    },
    {
        title: 'Pistes',
        items: [
            ['M', 'Mute piste sélectionnée'],
            ['Shift + S', 'Solo piste sélectionnée'],
            ['⌘⇧S', 'Clear tous les solos'],
            ['⌘D', 'Dupliquer la piste (sans clips)'],
            ['⌘⌫', 'Supprimer la piste sélectionnée'],
            ['↑ / ↓', 'Changer de piste'],
            ['A', 'Mode automation']
        ]
    },
    {
        title: 'Vue',
        items: [
            ['⌘ + scroll', 'Zoom horizontal (ancré sur la souris)'],
            ['⌥ + scroll', 'Zoom vertical (hauteur des pistes)'],
            ['⌘⌥ + scroll', 'Zoom horizontal + vertical'],
            ['E / Z', 'Zoom in / out (clavier)'],
            ['⌘⇧F', 'Zoom to fit — tout le projet'],
            ['⌘A', 'Sélectionner tous les clips de la piste'],
            ['X', 'Ouvrir / Fermer le mixer'],
            ['D', '(dev) Poser un clip démo']
        ]
    },
    {
        title: 'Fichier',
        items: [
            ['⌘S', 'Sauvegarder'],
            ['⌘E', 'Exporter WAV'],
            ['⌘N', 'Nouveau projet'],
            ['⌘Z / ⌘⇧Z', 'Annuler / Rétablir']
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
            <p class="modal-sub">Philosophie : main gauche en priorité, zéro déplacement.</p>
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
        for (const c of (t.clips || [])) {
            if (!c.id || c.recording) continue;
            if (PulseAudio.hasBuffer(c.id)) continue;
            try {
                const blob = await PulsePersist.loadBlob(c.id);
                if (!blob) { missing++; continue; }
                const arrBuf = await blob.arrayBuffer();
                const audioBuf = await PulseAudio.getContext().decodeAudioData(arrBuf);
                PulseAudio.registerBuffer(c.id, audioBuf);
                if (!c.peaks || !c.peaks.length) {
                    c.peaks = Array.from(PulseAudio.computePeaks(audioBuf, 400));
                }
                restored++;
            } catch (err) {
                console.warn('Restore failed for', c.id, err);
                missing++;
            }
        }
    }
    if (restored > 0) flash(`✓ ${restored} clip${restored>1?'s':''} rechargé${restored>1?'s':''}`);
    if (missing > 0) setTimeout(() => flash(`⚠ ${missing} clip${missing>1?'s':''} introuvable${missing>1?'s':''} sur disque`), 1200);
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

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
        if (!files.length) { flash('Fichier audio uniquement'); return; }

        for (const f of files) {
            // Crée une nouvelle piste pour chaque fichier droppé en global
            const newTrackIdx = state.project.tracks.length;
            state.project.tracks.push({
                name: f.name.replace(/\.[^.]+$/, '').slice(0, 24),
                type: 'audio',
                color: COLORS[newTrackIdx % COLORS.length],
                clips: [],
                output: 'master',
                volume: 80
            });
            renderAll();
            await importAudioFile(f, newTrackIdx, state.playhead);
        }
    });

    function hasFiles(e) {
        return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    }
}

// === VU-mètres par piste + master (boucle d'affichage) ===
let vuRafId = null;
let vuTempArray = new Uint8Array(128);
function startVuMeterLoop() {
    if (vuRafId) return;
    const loop = () => {
        updateAllVuMeters();
        vuRafId = requestAnimationFrame(loop);
    };
    vuRafId = requestAnimationFrame(loop);
}

function updateAllVuMeters() {
    // Pistes
    state.project.tracks.forEach((_, i) => {
        const an = PulseAudio.getTrackAnalyser(i);
        if (!an) return;
        if (vuTempArray.length !== an.frequencyBinCount) vuTempArray = new Uint8Array(an.frequencyBinCount);
        an.getByteTimeDomainData(vuTempArray);
        const level = computeRms(vuTempArray);
        // Mixer strip
        const strip = document.querySelector(`.mixer-strips .strip[data-kind="track"][data-i="${i}"] .vu-bar`);
        if (strip) strip.style.setProperty('--lvl', (level * 100).toFixed(1) + '%');
        // Track panel
        const panel = document.querySelector(`.tracks-panel .track-item[data-i="${i}"] .vu-mini`);
        if (panel) panel.style.setProperty('--lvl', (level * 100).toFixed(1) + '%');
    });
    // Master
    const ma = PulseAudio.getMasterAnalyser();
    if (ma) {
        if (vuTempArray.length !== ma.frequencyBinCount) vuTempArray = new Uint8Array(ma.frequencyBinCount);
        ma.getByteTimeDomainData(vuTempArray);
        const level = computeRms(vuTempArray);
        const el = document.getElementById('masterMeter');
        if (el) el.style.setProperty('--lvl', (level * 100).toFixed(1) + '%');
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
        target: '#btnPlay',
        placement: 'top',
        title: 'Transport',
        text: 'Appuie sur <kbd>Espace</kbd> pour jouer. <kbd>R</kbd> pour enregistrer. <kbd>Entrée</kbd> pour revenir au début.',
    },
    {
        target: '.tracks-panel .track-item',
        placement: 'right',
        title: 'Tes pistes',
        text: 'Clique sur <strong>R</strong> pour armer une piste. Si tu as une <span style="color:#DC2626">Capture Lane</span> (rouge), elle est déjà armée — tu peux rec direct.',
    },
    {
        target: '.timeline',
        placement: 'top',
        title: 'La timeline',
        text: 'Clique n\'importe où pour placer le curseur. <kbd>Q</kbd> coupe à gauche, <kbd>S</kbd> coupe à droite. <kbd>T</kbd> active le tap tempo.',
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
    const target = document.querySelector(step.target);
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
    const modal = document.createElement('div');
    modal.id = 'exportModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal">
            <button class="modal-close" id="exportClose" aria-label="Fermer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h2 class="modal-title">Exporter</h2>
            <p class="modal-sub">Le projet est mixé selon les volumes/pans/effets actuels.</p>
            <div class="export-options">
                <button class="export-opt" data-fmt="wav">
                    <div class="export-opt-tag">WAV</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">WAV lossless</div>
                        <div class="export-opt-desc">Qualité studio, pour l'édition et le mastering. Fichier lourd.</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="mp3" data-bitrate="320">
                    <div class="export-opt-tag">MP3 320</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">MP3 haute qualité</div>
                        <div class="export-opt-desc">320 kbps — pour partager en gardant la qualité (streaming, mail).</div>
                    </div>
                </button>
                <button class="export-opt" data-fmt="mp3" data-bitrate="192">
                    <div class="export-opt-tag">MP3 192</div>
                    <div class="export-opt-info">
                        <div class="export-opt-title">MP3 standard</div>
                        <div class="export-opt-desc">192 kbps — fichier léger, qualité correcte (démo, SMS).</div>
                    </div>
                </button>
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
        closeExportModal();
        await doExport(fmt, bitrate);
    });
}

function closeExportModal() {
    const m = document.getElementById('exportModal');
    if (!m) return;
    m.classList.remove('visible');
    setTimeout(() => m.remove(), 240);
}

async function doExport(fmt, bitrate = 320) {
    flash(`Export ${fmt.toUpperCase()} en cours…`);
    try {
        const wavBlob = await PulseAudio.exportWav(state.project);
        if (!wavBlob) { flash('Aucun son à exporter'); return; }

        let outBlob = wavBlob;
        let ext = 'wav';
        if (fmt === 'mp3') {
            if (!window.lamejs) { flash('Encodeur MP3 non chargé'); return; }
            outBlob = await encodeToMp3(wavBlob, bitrate);
            ext = 'mp3';
        }

        const url = URL.createObjectURL(outBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (state.project.name || 'pulse-export').replace(/[^\w\-]+/g, '_') + '.' + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        flash(`✓ Export ${fmt.toUpperCase()} téléchargé`);
    } catch (err) {
        console.error(err);
        flash('Export impossible');
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
    const left = toInt16(audioBuf.getChannelData(0));
    const right = channels > 1 ? toInt16(audioBuf.getChannelData(1)) : left;

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

function toInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
}

// Legacy alias
async function exportProject() { openExportModal(); }

// === Mode automation ===
// Toggle. En mode A, cliquer sur un effet (slot EQ/Comp/Rev du mixer, ou sur une piste)
// ouvre la courbe d'automation de ce paramètre sur la timeline, comme Logic.
function toggleAutomationMode() {
    state.automationMode = !state.automationMode;
    document.body.classList.toggle('automation-mode', state.automationMode);
    flash(state.automationMode ? '🎚 Mode automation ON — clique un effet' : 'Mode automation OFF');
    if (!state.automationMode) closeAutomationLane();
}

function openAutomationFor(trackIdx, param) {
    const t = state.project.tracks[trackIdx];
    if (!t) return;
    t.automation = t.automation || {};
    t.automation[param] = t.automation[param] || { points: [{ t: 0, v: 0.5 }] };

    // Ajouter / afficher la lane d'automation sous la timeline-track
    const lane = ensureAutomationLane(trackIdx);
    lane.dataset.param = param;
    lane.innerHTML = renderAutomationLane(t.automation[param]);
    lane.classList.add('visible');
    flash(`Automation : ${param} sur ${t.name}`);
}

function ensureAutomationLane(trackIdx) {
    const timelineTrack = document.querySelector(`.timeline-track[data-i="${trackIdx}"]`);
    if (!timelineTrack) return null;
    let lane = timelineTrack.querySelector('.automation-lane');
    if (!lane) {
        lane = document.createElement('div');
        lane.className = 'automation-lane';
        timelineTrack.appendChild(lane);
    }
    return lane;
}

function renderAutomationLane(auto) {
    const w = state.pxPerSecond * 180;
    const points = auto.points.map(p => `${p.t * state.pxPerSecond},${(1 - p.v) * 56 + 4}`).join(' ');
    return `
        <svg viewBox="0 0 ${w} 64" width="${w}" height="64" preserveAspectRatio="none">
            <polyline points="${points}" stroke="#C084FC" stroke-width="2" fill="none" vector-effect="non-scaling-stroke"/>
            ${auto.points.map(p => `
                <circle cx="${p.t * state.pxPerSecond}" cy="${(1 - p.v) * 56 + 4}" r="4" fill="#A855F7" stroke="#F3EEFF" stroke-width="1.5"/>
            `).join('')}
        </svg>
    `;
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
        flash('Mode tap tempo ON — tape sur Espace au rythme');
    } else {
        btn.textContent = 'TAP';
        btn.classList.remove('active');
        clearTimeout(tap.timeoutId);
        if (tap.times.length >= 2) {
            saveProject();
            flash(`Tempo verrouillé : ${state.project.bpm} BPM`);
        } else {
            flash('Mode tap tempo OFF');
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
        renderRuler();
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
    state.project.bpm = bpm;
    document.getElementById('bpmInput').value = bpm;
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
            return eff === 'bar'      ? beatSec * 4
                 : eff === 'division' ? beatSec / 4
                 : beatSec;
        })();
    clip.start = Math.max(0, clip.start + dir * snapUnit);
    renderTimelineTracks();
    saveProject();
}

// Sélectionner tous les clips de la piste active (Cmd+A)
function selectAllClipsOnTrack() {
    const t = state.project.tracks[state.selectedTrack];
    if (!t || !t.clips.length) { flash('Aucun clip sur cette piste'); return; }
    // On sélectionne le dernier clip — future: multi-sélection
    state.selectedClip = { trackIdx: state.selectedTrack, clipIdx: t.clips.length - 1 };
    // Sélection de plage couvrant tous les clips
    const starts = t.clips.map(c => c.start);
    const ends   = t.clips.map(c => c.start + c.duration);
    state.selection = { start: Math.min(...starts), end: Math.max(...ends) };
    renderTimelineTracks();
    flash(`${t.clips.length} clip${t.clips.length > 1 ? 's' : ''} sélectionné${t.clips.length > 1 ? 's' : ''}`);
}

// Zoom to fit : tout le projet visible d'un coup (Cmd+Shift+F)
function zoomToFit() {
    const end = computeProjectEndSec();
    const timeline = document.querySelector('.timeline');
    if (!timeline) return;
    const availWidth = timeline.clientWidth - 60;
    const totalSec = Math.max(end + 4, 10);
    const newPx = Math.max(16, Math.min(400, availWidth / totalSec));
    setZoom(newPx, 0);
    timeline.scrollLeft = 0;
    flash('Zoom : tout le projet');
}

// Persister zoom + scroll position dans localStorage
const ZOOM_KEY = 'pulse_zoom_v1';
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
function setZoom(px, anchorSec) {
    const timeline = document.querySelector('.timeline');
    const oldPx = state.pxPerSecond;
    const newPx = Math.max(16, Math.min(400, px));
    if (newPx === oldPx) return;

    const anchor = (anchorSec !== undefined) ? anchorSec : state.playhead;
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
        isCapture: false,    // la copie n'est jamais Capture Lane
        armed: false
    };
    if (src.effects) copy.effects = [...src.effects];
    state.project.tracks.splice(idx + 1, 0, copy);
    state.selectedTrack = idx + 1;
    renderAll();
    saveProject();
    flash(`Piste dupliquée : « ${copy.name} »`);
}

// --- Supprimer la piste sélectionnée (⌘⌫) ---
function deleteSelectedTrack() {
    const idx = state.selectedTrack;
    const t = state.project.tracks[idx];
    if (!t) return;
    if (t.isCapture) { flash('La Capture Lane ne peut pas être supprimée'); return; }
    pushUndo();
    // Nettoyer les blobs orphelins
    (t.clips || []).forEach(c => {
        if (!c.id) return;
        const shared = state.project.tracks.flatMap(tr => tr.clips || []).filter(cl => cl.id === c.id).length;
        if (shared <= 1 && window.PulsePersist) PulsePersist.deleteBlob(c.id).catch(() => {});
    });
    state.project.tracks.splice(idx, 1);
    state.selectedTrack = Math.min(idx, state.project.tracks.length - 1);
    state.selectedClip = null;
    renderAll();
    saveProject();
    flash(`Piste « ${t.name} » supprimée`);
}

// --- Ajouter une piste ---
function addTrack() {
    pushUndo();
    const i = state.project.tracks.length;
    state.project.tracks.push({
        name: `Piste ${i + 1}`,
        type: 'audio',
        color: COLORS[i % COLORS.length],
        clips: [],
        volume: 80
    });
    renderAll();
    saveProject();
}

// --- Rendu complet ---
function renderAll() {
    renderTracksPanel();
    renderTimelineTracks();
    renderRuler();
    renderMixer();
    bindTrackEvents();
    bindMixerEvents();
}

// --- Events mixer : automation + faders live + pan ---
function bindMixerEvents() {
    document.querySelectorAll('.mixer-strips .strip').forEach(strip => {
        const kind = strip.dataset.kind;
        const i = parseInt(strip.dataset.i);

        // Clics sur slots FX
        strip.querySelectorAll('.strip-fx-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                if (kind !== 'track') return;
                const param = slot.dataset.fx;
                if (state.automationMode) {
                    openAutomationFor(i, param);
                } else {
                    const t = state.project.tracks[i];
                    t.effects = t.effects || [];
                    const idx = t.effects.indexOf(param);
                    if (idx >= 0) t.effects.splice(idx, 1);
                    else t.effects.push(param);
                    slot.classList.toggle('active');
                    saveProject();
                }
            });
        });

        // Fader de volume : update live + persist
        const fader = strip.querySelector('.fader');
        if (fader) {
            fader.addEventListener('input', (e) => {
                const v = parseInt(e.target.value);
                if (kind === 'track') {
                    const t = state.project.tracks[i];
                    t.volume = v;
                    if (window.PulseAudio) PulseAudio.updateTrackVolume(i, v);
                }
                // Mise à jour visuelle du dB
                const dbEl = strip.querySelector('.strip-db');
                if (dbEl) dbEl.textContent = `${volumeToDb(v)} dB`;
            });
            fader.addEventListener('change', () => saveProject());
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

    const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const pan = Math.max(-100, Math.min(100, startPan + dx));
        t.pan = pan;
        updatePanKnobVisual(knob, pan);
        if (window.PulseAudio) PulseAudio.updateTrackPan(trackIdx, pan);
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

// --- Menu contextuel sur une piste ---
function openTrackContextMenu(x, y, idx, t) {
    document.querySelector('.track-ctx-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200;`;
    const items = [
        { label: 'Renommer',          action: () => { const el = document.querySelector(`.track-name[data-i="${idx}"]`); if (el) { el.focus(); document.execCommand('selectAll'); } } },
        { label: 'Dupliquer (sans clips)', action: () => duplicateTrack(idx) },
        t.isCapture ? null : { label: 'Supprimer la piste', action: () => { state.selectedTrack = idx; deleteSelectedTrack(); }, danger: true },
        { sep: true },
        { label: t.muted ? 'Désactiver Mute'  : 'Mute',  action: () => toggleMute(idx) },
        { label: t.solo  ? 'Désactiver Solo'  : 'Solo',  action: () => toggleSolo(idx) },
        { label: t.armed ? 'Désarmer la piste': 'Armer', action: () => {
            if (t.isCapture) return;
            t.armed = !t.armed;
            renderTracksPanel(); bindTrackEvents(); saveProject();
        }},
        { sep: true },
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
    document.querySelector('.clip-ctx-menu')?.remove();
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;

    const menu = document.createElement('div');
    menu.className = 'track-ctx-menu clip-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200;`;

    const items = [
        { label: 'Renommer',        action: () => startClipRename(trackIdx, clipIdx) },
        { label: 'Dupliquer',       action: () => {
            pushUndo();
            const copy = { ...JSON.parse(JSON.stringify(clip)), start: clip.start + clip.duration };
            state.project.tracks[trackIdx].clips.push(copy);
            state.project.tracks[trackIdx].clips.sort((a, b) => a.start - b.start);
            state.selectedClip = { trackIdx, clipIdx: state.project.tracks[trackIdx].clips.indexOf(copy) };
            renderTimelineTracks(); saveProject();
        }},
        { label: 'Couper ici (Split)', action: () => splitClipAt(trackIdx, clipIdx, state.playhead) },
        { sep: true },
        { label: clip.muted ? 'Désactiver Mute clip' : 'Mute clip', action: () => {
            pushUndo(); clip.muted = !clip.muted; renderTimelineTracks(); saveProject();
        }},
        { label: 'Normaliser (−0.5 dBFS)', action: () => {
            if (!clip.id) { flash('Pas de buffer audio pour ce clip'); return; }
            const gain = PulseAudio.computeNormalizeGain(clip.id);
            if (gain === null) { flash('Impossible de normaliser'); return; }
            pushUndo();
            clip.gain = Math.round(gain * 1000) / 1000;
            renderTimelineTracks(); saveProject();
            flash(`Normalisé : gain ${gain > 1 ? '+' : ''}${(20 * Math.log10(gain)).toFixed(1)} dB`);
        }},
        { label: 'Réinitialiser le gain', action: () => {
            pushUndo(); delete clip.gain; renderTimelineTracks(); saveProject(); flash('Gain réinitialisé');
        }},
        { sep: true },
        { label: 'Supprimer',       action: () => {
            state.selectedClip = { trackIdx, clipIdx };
            deleteSelectedClip();
        }, danger: true },
        { sep: true },
        { label: 'Couleur du clip', submenu: COLORS.map(c => ({
            color: c, action: () => { pushUndo(); clip.color = c; renderTimelineTracks(); saveProject(); }
        }))}
    ];

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

// --- Events pistes ---
function bindTrackEvents() {
    // Drag depuis n'importe où sur la piste + clic pour sélectionner
    document.querySelectorAll('.track-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.t-mini')) return;
            if (e.target.closest('.track-name[contenteditable="true"]')) return;

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
                        const tracks = state.project.tracks;
                        const moved = tracks.splice(fromIdx, 1)[0];
                        const insertAt = insertBefore > fromIdx ? insertBefore - 1 : insertBefore;
                        tracks.splice(insertAt, 0, moved);
                        if (state.selectedTrack === fromIdx) state.selectedTrack = insertAt;
                        renderAll();
                        saveProject();
                    }
                } else {
                    state.selectedTrack = fromIdx;
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
        el.addEventListener('blur', () => {
            const i = parseInt(el.dataset.i);
            // On ne prend que les nodes de texte directs (le chip LIVE est dans un span contenteditable=false)
            let txt = '';
            el.childNodes.forEach(n => {
                if (n.nodeType === Node.TEXT_NODE) txt += n.textContent;
            });
            txt = txt.replace(/\s+LIVE\s*$/i, '').trim();
            state.project.tracks[i].name = txt || `Piste ${i + 1}`;
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

    document.querySelectorAll('.t-mini').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const i = parseInt(el.dataset.i);
            const flag = el.dataset.flag;
            const t = state.project.tracks[i];
            if (!t) return;

            // Capture Lane : son R est verrouillé armé
            if (flag === 'rec' && t.isCapture) {
                flash('La Capture Lane est toujours armée');
                return;
            }

            if (flag === 'mute') { t.muted = !t.muted; }
            if (flag === 'solo') { t.solo = !t.solo; }
            if (flag === 'rec')  { t.armed = !t.armed; }

            el.classList.toggle('active');
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
        state.playhead = eventToTime(e);
        if (state.playing) {
            state.startTime = performance.now() - state.playhead * 1000;
        }
        updatePlayhead();
        updateChrono();
    };

    // --- Zoom Cmd+scroll / Option+scroll / Opt+Cmd+scroll (style Logic) ---
    const handleZoomWheel = (e) => {
        const hZoom = e.metaKey || e.ctrlKey;
        const vZoom = e.altKey;
        if (!hZoom && !vZoom) return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
        if (hZoom) {
            const rect = timeline.getBoundingClientRect();
            const cursorSec = Math.max(0, (e.clientX - rect.left + timeline.scrollLeft) / state.pxPerSecond);
            setZoom(state.pxPerSecond * factor, cursorSec);
        }
        if (vZoom) {
            setTrackHeight(state.trackHeight * factor);
        }
    };
    timeline.addEventListener('wheel', handleZoomWheel, { passive: false });

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

        if (inTopHalf && relX < fadeZone)                  { clipEl.style.cursor = 'w-resize'; }
        else if (inTopHalf && relX > rect.width - fadeZone){ clipEl.style.cursor = 'e-resize'; }
        else if (relX < edgeZone || relX > rect.width - edgeZone){ clipEl.style.cursor = 'ew-resize'; }
        else { clipEl.style.cursor = ''; }
    });
    tracks.addEventListener('mouseleave', (e) => {
        const clipEl = e.target.closest('.clip');
        if (clipEl) clipEl.style.cursor = '';
    });

    // Double-click sur un clip → rename inline
    tracks.addEventListener('dblclick', (e) => {
        const clipEl = e.target.closest('.clip');
        if (!clipEl) return;
        const trackEl = e.target.closest('.timeline-track');
        if (!trackEl) return;
        const trackIdx = parseInt(trackEl.dataset.i);
        const clipIdx = parseInt(clipEl.dataset.ci);
        startClipRename(trackIdx, clipIdx);
    });

    // Clic droit sur un clip → menu contextuel
    tracks.addEventListener('contextmenu', (e) => {
        const clipEl = e.target.closest('.clip');
        if (!clipEl) return;
        e.preventDefault();
        const trackEl = e.target.closest('.timeline-track');
        if (!trackEl) return;
        const trackIdx = parseInt(trackEl.dataset.i);
        const clipIdx = parseInt(clipEl.dataset.ci);
        const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
        if (!clip || clip.recording) return;
        openClipContextMenu(e.clientX, e.clientY, trackIdx, clipIdx);
    });

    // --- Tracks area : 3 comportements ---
    tracks.addEventListener('mousedown', (e) => {
        const clipEl = e.target.closest('.clip');
        const trackEl = e.target.closest('.timeline-track');

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
                    // Outil ciseau
                    if (state.tool === 'scissors') {
                        splitClipAt(trackIdx, _ci, eventToTime(e));
                        return;
                    }
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
                    return startClipDrag(e, clipEl, trackIdx);
                }
            }
            if (e.shiftKey) {
                return startRangeSelection(e, eventToTime);
            }
        }

        // Clic sur zone vide → place le curseur + efface la sélection
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

    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const originalStart = working.start;
    let dragged = false;
    let undoPushed = false;
    let targetTrackIdx = trackIdx;

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
        const dx = ev.clientX - startX;
        if (!dragged && Math.abs(dx) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        if (!dragged) {
            if (!undoPushed) { pushUndo(); undoPushed = true; } // snapshot avant la 1ère modif
            dragged = true;
            document.body.classList.add('is-dragging');
        }

        const dt = dx / state.pxPerSecond;
        const raw = originalStart + dt;
        const newStart = snapTime(raw, ev.shiftKey);
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

        if (state.snap !== 'off' && !ev.shiftKey && Math.abs(newStart - raw) > 0.001) {
            snapLine.style.left = (newStart * state.pxPerSecond) + 'px';
            snapLine.style.display = 'block';
        } else {
            snapLine.style.display = 'none';
        }
    };

    const onUp = () => {
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
    if (!state.selectedClip) return;
    const { trackIdx, clipIdx } = state.selectedClip;
    const t = state.project.tracks[trackIdx];
    if (!t || !t.clips[clipIdx]) return;
    pushUndo();
    const clip = t.clips[clipIdx];
    // Ne supprimer le blob que si aucun autre clip ne partage cet id (copies collées)
    const sharedCount = state.project.tracks.flatMap(tr => tr.clips || []).filter(c => c.id === clip.id).length;
    if (sharedCount <= 1 && clip.id && window.PulsePersist) PulsePersist.deleteBlob(clip.id).catch(() => {});
    t.clips.splice(clipIdx, 1);
    state.selectedClip = null;
    renderTimelineTracks();
    saveProject();
    flash('Clip supprimé');
}

function copySelectedClip() {
    if (!state.selectedClip) { flash('Aucun clip sélectionné'); return; }
    const { trackIdx, clipIdx } = state.selectedClip;
    const clip = state.project.tracks[trackIdx]?.clips[clipIdx];
    if (!clip) return;
    state.clipboard = { clip: JSON.parse(JSON.stringify(clip)), trackIdx };
    flash('Clip copié');
}

function pasteClip() {
    if (!state.clipboard) { flash('Presse-papier vide'); return; }
    pushUndo();
    const { clip, trackIdx } = state.clipboard;
    const targetTrack = state.project.tracks[trackIdx];
    if (!targetTrack) return;
    // On garde le même `id` pour partager le buffer audio — un clip copié joue le même audio
    const pasted = { ...JSON.parse(JSON.stringify(clip)), start: state.playhead };
    targetTrack.clips.push(pasted);
    targetTrack.clips.sort((a, b) => a.start - b.start);
    const newIdx = targetTrack.clips.indexOf(pasted);
    state.selectedTrack = trackIdx;
    state.selectedClip = { trackIdx, clipIdx: newIdx };
    renderAll();
    saveProject();
    flash('Clip collé à ' + secondsToDuration(state.playhead));
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
    let overlay = ruler.querySelector('.loop-region');
    if (!state.loop) { if (overlay) overlay.remove(); return; }
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'loop-region';
        ruler.appendChild(overlay);
    }
    const a = Math.min(state.loop.start, state.loop.end);
    const b = Math.max(state.loop.start, state.loop.end);
    overlay.style.left = (a * state.pxPerSecond) + 'px';
    overlay.style.width = ((b - a) * state.pxPerSecond) + 'px';
    overlay.classList.toggle('active', !!state.looping);
}

function updateLoopButton() {
    const btn = document.getElementById('btnLoop');
    if (btn) btn.style.color = state.looping ? 'var(--violet-3)' : '';
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

    // Indicateur de durée pendant le trim
    let trimIndicator = document.getElementById('trimIndicator');
    if (!trimIndicator) {
        trimIndicator = document.createElement('div');
        trimIndicator.id = 'trimIndicator';
        trimIndicator.style.cssText = 'position:fixed;background:var(--bg-2);color:var(--text-1);border:1px solid var(--border);padding:4px 10px;border-radius:8px;font-size:12px;font-family:ui-monospace,monospace;z-index:300;pointer-events:none;display:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        document.body.appendChild(trimIndicator);
    }

    const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dt = dx / state.pxPerSecond;
        if (side === 'left') {
            const raw = originalStart + dt;
            const snapped = snapTime(Math.min(originalStart + originalDuration - 0.1, raw), ev.shiftKey);
            const diff = snapped - originalStart;
            clip.start = snapped;
            clip.duration = originalDuration - diff;
        } else {
            const raw = originalDuration + dt;
            clip.duration = Math.max(0.1, snapTime(clip.start + raw, ev.shiftKey) - clip.start);
        }
        // Mise à jour directe de l'élément (pas de re-render complet)
        const el = document.querySelector(`.timeline-track[data-i="${trackIdx}"] .clip[data-ci="${clipIdx}"]`);
        if (el) {
            el.style.left  = (clip.start    * state.pxPerSecond) + 'px';
            el.style.width = (clip.duration * state.pxPerSecond) + 'px';
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
function startRangeSelection(startEvent, eventToTime) {
    const timeline = document.querySelector('.timeline');
    const startTime = eventToTime(startEvent);
    state.selection = { start: startTime, end: startTime };

    // Overlay visuel
    const overlay = document.createElement('div');
    overlay.className = 'range-selection';
    timeline.querySelector('.timeline-tracks').appendChild(overlay);
    updateRangeOverlay(overlay);

    const onMove = (ev) => {
        state.selection.end = eventToTime(ev);
        updateRangeOverlay(overlay);
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // On garde la sélection active, pas d'effacement de l'overlay
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
}

function clearRangeSelection() {
    document.querySelectorAll('.range-selection').forEach(el => el.remove());
    state.selection = null;
}

// Supprimer la plage sélectionnée (coupe le son dans la plage sur toutes les pistes)
function deleteSelection() {
    if (!state.selection) return;
    pushUndo();
    const a = Math.min(state.selection.start, state.selection.end);
    const b = Math.max(state.selection.start, state.selection.end);
    let count = 0;

    state.project.tracks.forEach(t => {
        t.clips = (t.clips || []).flatMap(c => {
            const cStart = c.start, cEnd = c.start + c.duration;
            if (cEnd <= a || cStart >= b) return [c]; // hors plage
            count++;
            // Clip entièrement dans la plage → supprimer
            if (cStart >= a && cEnd <= b) return [];
            // Clip chevauche à gauche → tronquer droite
            if (cStart < a && cEnd <= b) return [{ ...c, duration: a - cStart }];
            // Clip chevauche à droite → avancer début
            if (cStart >= a && cEnd > b) return [{ ...c, start: b, duration: cEnd - b }];
            // Clip englobe la plage → splitter en 2
            return [
                { ...c, duration: a - cStart },
                { ...c, start: b, duration: cEnd - b, name: (c.name || 'Clip') + '*' }
            ];
        });
    });

    clearRangeSelection();
    renderTimelineTracks();
    saveProject();
    flash(count > 0 ? `✂︎ Plage supprimée (${count} clip${count>1?'s':''})` : 'Rien dans la plage');
}

// === Snap (Logic-style) ===
function getEffectiveSnap() {
    if (state.snap !== 'smart') return state.snap;
    // Smart : résolution basée sur le zoom (comme Logic)
    const beatPx = state.pxPerSecond * (60 / state.project.bpm);
    if (beatPx >= 120) return 'division'; // 1/8 note
    if (beatPx >= 40)  return 'beat';
    return 'bar';
}

// shiftOverride : Shift tenu = snap libre temporairement
function snapTime(t, shiftOverride) {
    const snap = getEffectiveSnap();
    if (snap === 'off' || shiftOverride) return Math.max(0, t);
    const beatSec = 60 / state.project.bpm;
    const unit = snap === 'bar'      ? beatSec * 4
               : snap === 'division' ? beatSec / 4
               : beatSec;
    return Math.max(0, Math.round(t / unit) * unit);
}

// === Zoom vertical (hauteur des pistes) ===
function setTrackHeight(px) {
    state.trackHeight = Math.max(36, Math.min(200, Math.round(px)));
    document.documentElement.style.setProperty('--track-h', state.trackHeight + 'px');
    renderTimelineTracks();
    saveViewState();
}

// === Outil ciseau : couper un clip en deux au point de clic ===
function splitClipAt(trackIdx, clipIdx, atSec) {
    const t = state.project.tracks[trackIdx];
    const clip = t.clips[clipIdx];
    if (!clip || clip.recording) return;
    pushUndo();
    if (atSec <= clip.start || atSec >= clip.start + clip.duration) return;
    const left  = { ...clip, duration: atSec - clip.start };
    const right = { ...clip, start: atSec, duration: clip.start + clip.duration - atSec,
                    name: (clip.name || 'Clip') + '\'' };
    t.clips.splice(clipIdx, 1, left, right);
    renderTimelineTracks();
    saveProject();
    flash('✂ Clip coupé');
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
        if (clipEl) updateClipFadeVisual(clipEl, clip);
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

function updateClipFadeVisual(clipEl, clip) {
    const widthPx = parseFloat(clipEl.style.width) || 0;
    ['in', 'out'].forEach(dir => {
        const fadeSec = dir === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0);
        const fadePx  = Math.min(fadeSec * state.pxPerSecond, widthPx * 0.9);
        let el = clipEl.querySelector(`.clip-fade-overlay.${dir}`);
        if (fadePx > 0) {
            if (!el) {
                el = document.createElement('div');
                el.className = `clip-fade-overlay ${dir}`;
                clipEl.appendChild(el);
            }
            el.style.width = fadePx + 'px';
        } else if (el) {
            el.remove();
        }
    });
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
    bindTimelineClick();
    bindGlobalDragDrop();
    startVuMeterLoop();

    // Onboarding uniquement au premier lancement
    setTimeout(() => startOnboarding(), 400);

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
    document.getElementById('btnAddTrack').addEventListener('click', addTrack);
    document.getElementById('btnLoop').addEventListener('click', () => {
        if (!state.loop) {
            flash('Alt + drag dans la règle pour définir une zone de loop');
            return;
        }
        state.looping = !state.looping;
        updateLoopButton();
        renderLoopOverlay();
    });
    document.getElementById('btnMetronome').addEventListener('click', () => {
        state.metronome = !state.metronome;
        document.getElementById('btnMetronome').style.color = state.metronome ? 'var(--violet-3)' : '';
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
    document.getElementById('btnSave').addEventListener('click', () => {
        saveProject();
        flash('Projet sauvegardé');
    });

    document.getElementById('snapSelect').addEventListener('change', e => {
        state.snap = e.target.value;
    });

    document.getElementById('bpmInput').addEventListener('change', e => {
        const v = parseInt(e.target.value);
        if (v >= 40 && v <= 240) {
            state.project.bpm = v;
            if (window.PulseAudio) PulseAudio.setMetronomeBpm(v);
            renderRuler();
            saveProject();
        }
    });

    // Zoom vertical depuis le panneau pistes (Option+scroll)
    document.getElementById('tracksList').addEventListener('wheel', (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
        setTrackHeight(state.trackHeight * factor);
    }, { passive: false });

    // Initialiser la hauteur des pistes
    setTrackHeight(state.trackHeight);

    document.getElementById('btnScissors').addEventListener('click', () => setActiveTool(state.tool === 'scissors' ? 'pointer' : 'scissors'));
    document.getElementById('btnTap').addEventListener('click', toggleTapMode);
    document.getElementById('btnExport').addEventListener('click', exportProject);
    document.getElementById('btnHelp').addEventListener('click', openCheatSheet);
    document.getElementById('btnBpmHalf').addEventListener('click', () => adjustBpm(0.5));
    document.getElementById('btnBpmDouble').addEventListener('click', () => adjustBpm(2));

    // Raccourcis clavier — philosophie : main gauche en priorité, zéro déplacement
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.isContentEditable) return;

        const mod = e.metaKey || e.ctrlKey;
        const shift = e.shiftKey;
        const k = e.key.toLowerCase();

        // Modifiers d'abord
        if (mod && shift && k === 's') { e.preventDefault(); clearAllSolos(); return; }
        if (mod && k === 's')          { e.preventDefault(); saveProject(); flash('Projet sauvegardé'); return; }
        if (mod && k === 'z' && !shift){ e.preventDefault(); undoAction(); return; }
        if (mod && k === 'z' && shift) { e.preventDefault(); flash('Redo (à venir)'); return; }
        if (mod && k === 'e')          { e.preventDefault(); exportProject(); return; }
        if (mod && k === 'n')          { e.preventDefault(); window.location.href = 'index.html'; return; }
        if (mod && k === 'a')          { e.preventDefault(); selectAllClipsOnTrack(); return; }
        if (mod && shift && k === 'f') { e.preventDefault(); zoomToFit(); return; }
        if (mod && k === 'd')          { e.preventDefault(); duplicateTrack(state.selectedTrack); return; }
        if (mod && k === 'c')          { e.preventDefault(); copySelectedClip(); return; }
        if (mod && k === 'v')          { e.preventDefault(); pasteClip(); return; }

        // Transport (Espace est détourné en mode tap)
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
        if (k === 's' && shift && !mod) { e.preventDefault(); toggleSolo(state.selectedTrack); return; }
        if (k === 'm') { toggleMute(state.selectedTrack); return; }

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

        // Navigation pistes + nudge clip
        if (e.code === 'ArrowDown' && !state.selectedClip) { e.preventDefault(); selectTrack(state.selectedTrack + 1); return; }
        if (e.code === 'ArrowUp'   && !state.selectedClip) { e.preventDefault(); selectTrack(state.selectedTrack - 1); return; }
        // Nudge clip sélectionné (flèche gauche/droite, shift = 1 frame, sinon 1 snap unit)
        if (e.code === 'ArrowLeft'  && state.selectedClip) { e.preventDefault(); nudgeSelectedClip(-1, e.shiftKey); return; }
        if (e.code === 'ArrowRight' && state.selectedClip) { e.preventDefault(); nudgeSelectedClip(+1, e.shiftKey); return; }

        // Mixer
        if (k === 'x') { e.preventDefault(); toggleMixer(); return; }

        // Dev-only : D = pose un clip de démo au playhead sur la piste sélectionnée
        // (le temps que le moteur audio arrive, ça permet de tester Q/S)
        if (k === 'd') { e.preventDefault(); addDemoClip(); return; }

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
            if (state.selectedClip) { state.selectedClip = null; renderTimelineTracks(); return; }
            if (state.selection) { clearRangeSelection(); return; }
            if (state.loop) { state.loop = null; state.looping = false; renderLoopOverlay(); updateLoopButton(); return; }
        }
    });

    updateChrono();
});

function flash(msg) {
    let el = document.getElementById('flash');
    if (!el) {
        el = document.createElement('div');
        el.id = 'flash';
        el.style.cssText = `
            position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
            background: var(--bg-3); color: var(--text-1); padding: 10px 20px;
            border-radius: 10px; font-size: 13px; z-index: 1000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4); opacity: 0;
            transition: opacity 0.2s, transform 0.3s;
            border: 1px solid var(--border);
        `;
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._to);
    el._to = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-8px)';
    }, 1600);
}
