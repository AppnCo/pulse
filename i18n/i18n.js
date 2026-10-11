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
