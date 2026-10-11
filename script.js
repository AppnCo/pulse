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
                <button class="recent-item" data-id="${p.id}">
                    <div class="recent-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18V5l12-2v13"></path>
                            <circle cx="6" cy="18" r="3"></circle>
                            <circle cx="18" cy="16" r="3"></circle>
                        </svg>
                    </div>
                    <div class="recent-item-info">
                        <div class="recent-item-name">${p.name}</div>
                        <div class="recent-item-date">${timeAgo(p.lastOpen)}</div>
                    </div>
                </button>
            `).join('')}
        </div>
    `;
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
        desc: 'Template complète Ridwane : Capture Lane, Lead, doublages, backs, ad-libs, instru, bus All Vocal + Mix Bus. Le son Red Records out of the box.',
        icon: 'star',
        bpm: 90,
        tracks: [
            { name: 'Capture',    type: 'audio', isCapture: true, armed: true, output: 'allvocal', color: '#F472B6' },
            { name: 'Lead Vocal', type: 'audio', preset: 'voix-lead',     output: 'allvocal', color: '#A855F7', effects: ['eq', 'comp'] },
            { name: 'Doublage L', type: 'audio', preset: 'voix-doublage', pan: -50, output: 'allvocal', color: '#C084FC', effects: ['eq', 'comp'] },
            { name: 'Doublage R', type: 'audio', preset: 'voix-doublage', pan:  50, output: 'allvocal', color: '#C084FC', effects: ['eq', 'comp'] },
            { name: 'Back L',     type: 'audio', preset: 'voix-back',     pan: -80, output: 'allvocal', color: '#DDD6FE', effects: ['eq', 'comp'] },
            { name: 'Back R',     type: 'audio', preset: 'voix-back',     pan:  80, output: 'allvocal', color: '#DDD6FE', effects: ['eq', 'comp'] },
            { name: 'Ad-libs',    type: 'audio', preset: 'voix-lead',     output: 'allvocal', color: '#F472B6', effects: ['eq', 'comp'] },
            { name: 'Instru',     type: 'audio', preset: 'instru',        output: 'mixbus1',  color: '#60A5FA' }
        ],
        buses: [
            { id: 'allvocal', name: 'All Vocal', preset: 'bus-allvocal', output: 'mixbus1', color: '#A855F7' },
            { id: 'mixbus1',  name: 'Mix Bus 1', preset: 'bus-mix1',     output: 'mixbus2', color: '#7C3AED' },
            { id: 'mixbus2',  name: 'Mix Bus 2', preset: 'bus-safety',   output: 'master', locked: true, color: '#DC2626' }
        ]
    },
    {
        id: 'voix-instru',
        name: 'Voix + Instru',
        desc: 'Version simple : 1 voix + 1 instru. Idéale pour un premier morceau rapide.',
        icon: 'mic',
        bpm: 90,
        tracks: [
            { name: 'Voix',   type: 'audio', preset: 'voix-lead', color: '#A855F7', effects: ['eq', 'comp', 'reverb'], output: 'master' },
            { name: 'Instru', type: 'audio', preset: 'instru',    color: '#60A5FA', output: 'master' }
        ]
    },
    {
        id: 'podcast',
        name: 'Podcast',
        desc: '2 micros, préset voix propre. Pour une interview ou un dialogue.',
        icon: 'headphones',
        bpm: 100,
        tracks: [
            { name: 'Micro 1', type: 'audio', preset: 'voix-lead', color: '#A855F7', effects: ['eq', 'comp'] },
            { name: 'Micro 2', type: 'audio', preset: 'voix-lead', color: '#C084FC', effects: ['eq', 'comp'] }
        ]
    },
    {
        id: 'beat-simple',
        name: 'Beat simple',
        desc: '4 pistes rythmiques : kick, snare, hihat, bass. Pour poser une base.',
        icon: 'grid',
        bpm: 90,
        tracks: [
            { name: 'Kick',  type: 'audio', color: '#7C3AED' },
            { name: 'Snare', type: 'audio', color: '#A855F7' },
            { name: 'Hihat', type: 'audio', color: '#C084FC' },
            { name: 'Bass',  type: 'audio', color: '#DDD6FE' }
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
            <h2 class="modal-title">Choisis un template</h2>
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
        bpm: tpl.bpm || 90,
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
        bpm: 90,
        createdAt: Date.now(),
        lastOpen: Date.now()
    };
    saveAndOpenProject(project);
}

function saveAndOpenProject(project) {
    const recents = loadRecent();
    recents.unshift(project);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, 20)));
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
    renderRecent();

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
