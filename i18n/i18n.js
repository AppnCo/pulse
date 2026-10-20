// Pulse — i18n loader minimal
// Chargement d'une seule langue au boot, fallback silencieux sur FR si clé manquante.
window.PulseI18n = (function() {
    const SUPPORTED = ['fr', 'en'];
    const DEFAULT = 'fr';
    let bundle = null;
    let fallback = null;

    function detectLang() {
        const stored = localStorage.getItem('pulse_lang');
        if (stored && SUPPORTED.includes(stored)) return stored;
        const nav = (navigator.language || '').slice(0, 2).toLowerCase();
        return SUPPORTED.includes(nav) ? nav : DEFAULT;
    }

    async function load(lang) {
        const chosen = (lang && SUPPORTED.includes(lang)) ? lang : detectLang();
        const res = await fetch(`i18n/${chosen}.json`);
        bundle = await res.json();
        if (chosen !== DEFAULT) {
            const resFb = await fetch(`i18n/${DEFAULT}.json`);
            fallback = await resFb.json();
        } else {
            fallback = bundle;
        }
        localStorage.setItem('pulse_lang', chosen);
        return bundle;
    }

    // t('studio.flash.saved') ou t('studio.flash.range_deleted', {count: 3, s: 's'})
    function t(path, vars) {
        const value = pick(bundle, path) ?? pick(fallback, path) ?? path;
        if (typeof value !== 'string' || !vars) return value;
        return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
    }

    function pick(obj, path) {
        if (!obj) return undefined;
        return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
    }

    function setLang(lang) {
        return load(lang).then(() => {
            document.dispatchEvent(new CustomEvent('pulse:lang-changed', { detail: { lang } }));
        });
    }

    function current() { return bundle && bundle.lang; }
    function supported() { return SUPPORTED.slice(); }

    return { load, t, setLang, current, supported };
})();

// === Traduction à l'affichage (anglais) — 18/10/2026 ===
// Le code de Pulse reste écrit en français. En anglais seulement, un dictionnaire « texte français → texte anglais »
// (i18n/en-texts.json) est appliqué aux textes affichés, infobulles et messages, au fil des changements de la page.
// Jamais sur ce que l'utilisateur a nommé (pistes, régions, groupes, projet, texte de chanson).
(function () {
    const I = window.PulseI18n;
    let texts = null, compiled = [], observer = null;
    const missing = new Set();
    const SKIP = '[contenteditable="true"], input, textarea, select, script, style, .no-tx, .track-name, .clip-name, .group-name, .send-name, .strip-name, .me-title, .marker-label, .t-name, .project-name, #projectName, .lyrics, #lyrics';
    const ATTRS = ['data-tooltip', 'placeholder', 'title', 'aria-label'];

    async function loadTexts() {
        if (I.current() !== 'en') { texts = null; return; }
        try { texts = await (await fetch('i18n/en-texts.json')).json(); } catch { texts = { exact: {}, patterns: [] }; }
        compiled = (texts.patterns || []).map(([re, rep]) => [new RegExp('^' + re + '$', 's'), rep]);
    }
    function tx(s) {
        if (!texts || typeof s !== 'string') return s;
        const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const core = m[2];
        if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return s;
        const hit = texts.exact[core];
        if (hit !== undefined) return m[1] + hit + m[3];
        for (const [re, rep] of compiled) if (re.test(core)) return m[1] + core.replace(re, rep) + m[3];
        missing.add(core);
        return s;
    }
    // Le nom de la tranche de sortie (« Sortie stéréo ») est un texte de Pulse, pas un nom donné par l'utilisateur
    function skip(el) {
        if (!el || !el.closest) return true;
        if (el.closest('.strip-name') && el.closest('[data-kind="master"]')) return false;
        return !!el.closest(SKIP);
    }
    // Un texte déjà traduit par nous est marqué : quand la page nous signale ce changement, on ne le repasse pas
    // Lettres du réglage gauche / droite (G / D) : seulement dans ce réglage (ailleurs « D » est une touche de raccourci)
    const PAN = { G: 'L', D: 'R' };
    function doText(n) {
        if (n.__pulseTx === n.nodeValue || skip(n.parentElement)) return;
        const pan = texts && n.parentElement && n.parentElement.closest('.insp-pan') && PAN[n.nodeValue.trim()];
        const v = pan || tx(n.nodeValue);
        if (v !== n.nodeValue) n.nodeValue = v;
        n.__pulseTx = v;
    }
    function doAttrs(el) {
        if (!el.getAttribute || (el.closest && el.closest('.no-tx'))) return;
        const seen = el.__pulseTxA || (el.__pulseTxA = {});
        for (const a of ATTRS) {
            const v = el.getAttribute(a);
            if (!v || seen[a] === v) continue;
            const t = tx(v);
            if (t !== v) el.setAttribute(a, t);
            seen[a] = t;
        }
    }
    function walk(root) {
        if (root.nodeType === 3) return doText(root);
        if (root.nodeType !== 1) return;
        doAttrs(root);
        const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = it.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
    }
    async function startAuto() {
        await loadTexts();
        if (!texts || observer) return;
        walk(document.body);
        observer = new MutationObserver((muts) => {
            for (const mu of muts) {
                if (mu.type === 'characterData') doText(mu.target);
                else if (mu.type === 'attributes') doAttrs(mu.target);
                else mu.addedNodes.forEach(walk);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    I.tx = tx;
    I.startAuto = startAuto;
    I.missing = () => [...missing].sort();
})();
