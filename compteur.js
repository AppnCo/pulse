// Compteur d'installations : un identifiant anonyme (tiré au hasard, sans lien avec toi) + version + système, envoyé à l'ouverture.
// Aucune donnée personnelle, aucun contenu de projet. Désactivable dans Réglages. Inactif tant que COMPTEUR_URL est vide.
(function () {
    const COMPTEUR_URL = '';          // adresse du script de comptage (voir outils/compteur-installs.gs)
    const PULSE_BUILD = '2026-10-20';
    const KEY_ID = 'pulse_install_id', KEY_OFF = 'pulse_compteur_off';
    const ls = {
        get(k) { try { return localStorage.getItem(k); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch {} }
    };
    const isApp = !!(window.__TAURI__ && window.__TAURI__.core);
    const enabled = () => ls.get(KEY_OFF) !== '1';
    function installId() {
        let id = ls.get(KEY_ID);
        if (!id) {
            id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
                : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
            ls.set(KEY_ID, id);
        }
        return id;
    }
    function ping() {
        if (!COMPTEUR_URL || !enabled()) return;
        if (!isApp && !/(^|\.)appnco\.app$/.test(location.hostname)) return;   // pas de comptage en test local
        const ua = navigator.userAgent || '';
        const os = /Windows/i.test(ua) ? 'win' : /Mac/i.test(ua) ? 'mac' : /Linux/i.test(ua) ? 'linux' : 'autre';
        const q = new URLSearchParams({ id: installId(), k: isApp ? 'app' : 'web', os, v: PULSE_BUILD, lg: (navigator.language || '').slice(0, 2) });
        try { fetch(COMPTEUR_URL + '?' + q, { mode: 'no-cors', keepalive: true }).catch(() => {}); } catch {}
    }
    window.PulseCompteur = { configured: !!COMPTEUR_URL, enabled, setEnabled(on) { ls.set(KEY_OFF, on ? '0' : '1'); } };
    setTimeout(ping, 4000);
})();
