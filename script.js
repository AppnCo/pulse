// === Pulse — Start screen interactions ===

const RECENT_KEY = 'pulse_recent_projects';

// Charger les projets récents depuis localStorage
function loadRecent() {
    try {
        const data = localStorage.getItem(RECENT_KEY);
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function renderRecent() {
    const list = loadRecent();
    const container = document.getElementById('recentList');
    if (list.length === 0) return; // garde le placeholder par défaut

    container.innerHTML = `
        <h3>Récents</h3>
        <div class="recent-items">
            ${list.slice(0, 6).map(p => `
                <button class="recent-item" data-id="${escHtml(p.id)}">
                    <div class="recent-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18V5l12-2v13"></path>
                            <circle cx="6" cy="18" r="3"></circle>
                            <circle cx="18" cy="16" r="3"></circle>
                        </svg>
                    </div>
                    <div class="recent-item-info">
                        <div class="recent-item-name">${escHtml(p.name)}</div>
                        <div class="recent-item-date">${timeAgo(p.lastOpen)}</div>
                    </div>
                </button>
            `).join('')}
        </div>
    `;
    container.querySelectorAll('.recent-item').forEach(btn => {
        btn.addEventListener('click', () => openRecent(btn.dataset.id));
    });
}

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Petit message en bas d'écran (même esprit que flash() du studio)
function toast(msg) {
    let el = document.getElementById('homeToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'homeToast';
        el.className = 'home-toast';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('visible'), 4000);
}

// La liste des récents ne garde que l'essentiel ; le projet complet vit dans IndexedDB
function recentMeta(p) {
    return { id: p.id, name: p.name, lastOpen: p.lastOpen || Date.now() };
}

function touchRecent(project) {
    const recents = loadRecent().filter(r => r.id !== project.id);
    recents.unshift(recentMeta(project));
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, 20)));
}

async function openRecent(id) {
    try {
        let project = await PulsePersist.loadProjectDoc(id);
        // Anciennes versions : le projet était stocké directement dans la liste
        if (!project) project = loadRecent().find(r => r.id === id && Array.isArray(r.tracks)) || null;
        if (!project) { toast('Ce projet est introuvable sur cet ordinateur — s\'il a été exporté en .pulse, ouvre le fichier'); return; }
        project.lastOpen = Date.now();
        await PulsePersist.saveProjectDoc(project);
        touchRecent(project);
        localStorage.setItem('pulse_current_project', JSON.stringify(project));
        window.location.href = 'studio.html';
    } catch (err) {
        console.error(err);
        toast('Impossible d\'ouvrir ce projet — réessaie, ou ouvre son fichier .pulse');
    }
}

async function openPulseFile(file) {
    if (!file) return;
    toast(`Ouverture de ${file.name}…`);
    try {
        const project = await PulseFile.unpack(file);
        await PulsePersist.saveProjectDoc(project);
        touchRecent(project);
        localStorage.setItem('pulse_current_project', JSON.stringify(project));
        window.location.href = 'studio.html';
    } catch (err) {
        console.error(err);
        toast('Ce fichier n\'est pas un projet Pulse valide — choisis un fichier qui finit par .pulse');
    }
}

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff)$/i;
function isAudioFile(f) { return !!f && ((f.type || '').startsWith('audio/') || AUDIO_EXT.test(f.name)); }

// Raccourci débutant : une instru → un projet Voix + Instru, l'instru déjà en place
async function startFromInstru(file) {
    if (!isAudioFile(file)) { toast('Ce fichier n\'est pas un son — choisis un MP3, WAV, M4A ou FLAC'); return; }
    toast(`Préparation de ${file.name}…`);
    try {
        const id = Date.now().toString(36);
        const key = `pending_${id}`;
        await PulsePersist.saveBlob(key, file, { kind: 'pending-instru', originalName: file.name });
        const project = {
            id,
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Mon morceau',
            bpm: 120,
            buses: [],
            tracks: [
                { name: 'Voix', type: 'audio', armed: true, color: '#A855F7', output: 'master',
                  effects: ['eq', 'comp'], sound: { preset: 'lead', tone: 0, hold: 35, drive: 0 } },
                { name: 'Instru', type: 'audio', preset: 'instru', color: '#60A5FA', output: 'master' }
            ],
            pendingInstru: { key, name: file.name, type: file.type || 'audio/mpeg' },
            createdAt: Date.now(),
            lastOpen: Date.now()
        };
        await saveAndOpenProject(project);
    } catch (err) {
        console.error(err);
        toast('Impossible de préparer cette instru — vérifie qu\'il reste de la place sur ton disque et réessaie');
    }
}

// Le projet en cours d'une ancienne version n'était enregistré nulle part ailleurs : on le met à l'abri
async function migrateCurrentProject() {
    try {
        const raw = localStorage.getItem('pulse_current_project');
        if (!raw) return;
        const cur = JSON.parse(raw);
        if (!cur || !Array.isArray(cur.tracks)) return;
        if (!cur.id) cur.id = Date.now().toString(36);
        if (await PulsePersist.loadProjectDoc(cur.id)) return;
        await PulsePersist.saveProjectDoc(cur);
        localStorage.setItem('pulse_current_project', JSON.stringify(cur));
        if (!loadRecent().some(r => r.id === cur.id)) touchRecent(cur);
    } catch (err) { console.warn('Migration projet courant', err); }
}

function timeAgo(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'à l\'instant';
    if (diff < 3600) return `il y a ${Math.floor(diff/60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff/3600)} h`;
    return `il y a ${Math.floor(diff/86400)} j`;
}

// === Modal Template ===
// L'ordre d'affichage est intentionnel : Rap Studio en 1er (template signature).
const TEMPLATES = [
    {
        id: 'rap-studio',
        name: 'Rap Studio',
        desc: 'Le modèle de base : ton instru en haut, une piste pour enregistrer, puis tes voix rangées par groupe (voix principale, backs, ambiance). Tu ajoutes ou retires ce que tu veux.',
        icon: 'star',
        bpm: 120,
        // Instru tout en haut. La piste Rec sert à enregistrer ; une prise validée se range ensuite dans son groupe.
        // Les réglages de son sont sur les groupes, pas sur les pistes.
        tracks: [
            { name: 'Instru',   type: 'audio', preset: 'instru', output: 'mixbus1', color: '#60A5FA' },
            { name: 'Rec',      type: 'audio', isCapture: true, armed: true, output: 'allvocal', color: '#F472B6' },
            { name: 'Lead',     type: 'audio', output: 'vocal1',   color: '#A855F7' },
            { name: 'Back',     type: 'audio', output: 'back',     color: '#C084FC', sends: { revlong: 20 } },
            { name: 'Ambiance', type: 'audio', output: 'ambiance', color: '#F0ABFC', sends: { revlong: 25 } }
        ],
        buses: [
            { id: 'vocal1',   name: 'Vocal 1',   isGroup: true, output: 'allvocal', color: '#A855F7', sound: { preset: 'lead', tone: 0, hold: 35, drive: 0, space: 0, deess: 30 } },
            { id: 'back',     name: 'Back',      isGroup: true, output: 'allvocal', color: '#C084FC', sound: { preset: 'back', tone: 0, hold: 55, drive: 0, space: 0, deess: 40 } },
            { id: 'ambiance', name: 'Ambiance',  isGroup: true, output: 'allvocal', color: '#F0ABFC', sound: { preset: 'adlib', tone: 0, hold: 50, drive: 15, space: 0, deess: 30 } },
            { id: 'allvocal', name: 'All Vocal', isGroup: true, preset: 'bus-allvocal', output: 'mixbus1', color: '#7C3AED', sound: { preset: 'glue', tone: 0, hold: 25, drive: 0, space: 0, deess: 0 } },
            // Mix Bus 1 : le premaster, affiché comme une ligne sous les pistes, avec le réglage « Finition »
            { id: 'mixbus1',  name: 'Mix Bus 1', preset: 'bus-mix1',   output: 'mixbus2', noFolder: true, row: true, premaster: true, color: '#7C3AED' },
            // Chemin : Instru + All Vocal → Mix Bus 1 (finition) → Mix Bus 2 (limiteur de sécurité) → sortie.
            // Mix Bus 2 est caché : il est là par sécurité, on le voit avec « Tout afficher ».
            { id: 'mixbus2',  name: 'Mix Bus 2', preset: 'bus-safety', output: 'master', locked: true, hidden: true, effects: ['limit'], color: '#DC2626' }
        ]
    },
    {
        id: 'voix-instru',
        name: 'Voix + Instru',
        desc: 'Version simple : 1 voix + 1 instru. Idéale pour un premier morceau rapide.',
        icon: 'mic',
        bpm: 120,
        tracks: [
            { name: 'Voix',   type: 'audio', preset: 'voix-lead', color: '#A855F7', effects: ['eq', 'comp', 'reverb'], output: 'master' },
            { name: 'Instru', type: 'audio', preset: 'instru',    color: '#60A5FA', output: 'master' }
        ]
    },
    {
        id: 'podcast',
        name: 'Podcast',
        desc: '2 micros, réglage de voix propre. Pour une interview ou un dialogue.',
        icon: 'headphones',
        bpm: 120,
        tracks: [
            { name: 'Micro 1', type: 'audio', preset: 'voix-lead', color: '#A855F7', effects: ['eq', 'comp'] },
            { name: 'Micro 2', type: 'audio', preset: 'voix-lead', color: '#C084FC', effects: ['eq', 'comp'] }
        ]
    },
    {
        id: 'beat-simple',
        name: 'Beat simple',
        desc: 'Une batterie à pas et une basse au clavier. Pour poser une base sans rien jouer.',
        icon: 'grid',
        bpm: 120,
        tracks: [
            { name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#7C3AED' },
            { name: 'Basse',    type: 'keys',  midiInst: 'bass',  color: '#DDD6FE' }
        ]
    }
];

const ICONS = {
    mic:        '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line>',
    headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>',
    grid:       '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>',
    star:       '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>'
};

function openTemplatePicker() {
    const existing = document.getElementById('templateModal');
    if (existing) return;

    const modal = document.createElement('div');
    modal.id = 'templateModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal">
            <button class="modal-close" aria-label="Fermer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <h2 class="modal-title">Choisis un modèle</h2>
            <p class="modal-sub">Un point de départ pour aller plus vite.</p>
            <div class="template-list">
                ${TEMPLATES.map(t => `
                    <button class="template-item" data-template="${t.id}">
                        <div class="template-icon">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                ${ICONS[t.icon] || ''}
                            </svg>
                        </div>
                        <div class="template-text">
                            <div class="template-name">${t.name}</div>
                            <div class="template-desc">${t.desc}</div>
                        </div>
                        <div class="template-arrow">→</div>
                    </button>
                `).join('')}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    requestAnimationFrame(() => modal.classList.add('visible'));

    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('.modal-close')) {
            closeTemplatePicker();
        }
        const item = e.target.closest('.template-item');
        if (item) {
            const id = item.dataset.template;
            createProjectFromTemplate(id);
        }
    });
}

function closeTemplatePicker() {
    const modal = document.getElementById('templateModal');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 240);
}

function createProjectFromTemplate(id) {
    const tpl = TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    const project = {
        id: Date.now().toString(36),
        name: tpl.name,
        templateId: tpl.id,
        tracks: tpl.tracks.map(t => ({ ...t, clips: [] })),
        buses: (tpl.buses || []).map(b => ({ ...b })),
        bpm: tpl.bpm || 120,
        createdAt: Date.now(),
        lastOpen: Date.now()
    };
    saveAndOpenProject(project);
}

function createEmptyProject() {
    const project = {
        id: Date.now().toString(36),
        name: 'Projet sans titre',
        tracks: [
            { name: 'Piste 1', type: 'audio', color: '#A855F7' }
        ],
        bpm: 120,
        createdAt: Date.now(),
        lastOpen: Date.now()
    };
    saveAndOpenProject(project);
}

async function saveAndOpenProject(project) {
    try { await PulsePersist.saveProjectDoc(project); } catch (err) { console.warn('Save doc', err); }
    touchRecent(project);
    localStorage.setItem('pulse_current_project', JSON.stringify(project));
    window.location.href = 'studio.html';
}

// === i18n : applique les textes [data-i18n] aux éléments statiques ===
function applyI18n(root = document) {
    if (!window.PulseI18n) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const txt = PulseI18n.t(key);
        if (typeof txt === 'string') el.textContent = txt;
    });
}

// === Bind actions ===
document.addEventListener('DOMContentLoaded', async () => {
    if (window.PulseI18n) {
        await PulseI18n.load();
        applyI18n();
        // Appliquer aussi les labels dynamiques des templates
        TEMPLATES.forEach(t => {
            const tr = PulseI18n.t(`templates.${t.id}`);
            if (tr && typeof tr === 'object') {
                if (tr.name) t.name = tr.name;
                if (tr.desc) t.desc = tr.desc;
            }
        });
    }
    await migrateCurrentProject();
    renderRecent();

    const openBtn = document.getElementById('btnOpenFile');
    const openInput = document.getElementById('openFileInput');
    if (openBtn && openInput) {
        openBtn.addEventListener('click', () => openInput.click());
        openInput.addEventListener('change', () => { openPulseFile(openInput.files[0]); openInput.value = ''; });
    }
    const instruBtn = document.getElementById('instruStart');
    const instruInput = document.getElementById('instruStartInput');
    if (instruBtn && instruInput) {
        instruBtn.addEventListener('click', () => instruInput.click());
        instruInput.addEventListener('change', () => { startFromInstru(instruInput.files[0]); instruInput.value = ''; });
        ['dragenter', 'dragover'].forEach(ev => instruBtn.addEventListener(ev, () => instruBtn.classList.add('dragging')));
        ['dragleave', 'drop'].forEach(ev => instruBtn.addEventListener(ev, () => instruBtn.classList.remove('dragging')));
    }
    // Glisser une instru ou un .pulse n'importe où sur l'accueil
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files[0];
        if (!f) return;
        if (/\.pulse$/i.test(f.name)) openPulseFile(f);
        else if (isAudioFile(f)) startFromInstru(f);
        else toast('Dépose une instru (MP3, WAV…) ou un projet .pulse');
    });

    document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
            const action = card.dataset.action;
            if (action === 'new')      createEmptyProject();
            if (action === 'template') openTemplatePicker();
            if (action === 'recent')   document.querySelector('.recent-list').scrollIntoView({ behavior: 'smooth' });
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTemplatePicker();
    });
});
