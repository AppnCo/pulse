// Transfert unique des projets : de l'ancienne version (page en ligne, https://appnco.app) vers la nouvelle,
// qui tourne depuis l'ordinateur (pulse://localhost). Chaque adresse a son propre stockage : la page en ligne
// écrit tout dans le dossier de transfert de l'appli, puis la page locale le relit. Rien n'est effacé de l'ancien
// stockage (secours). Rien n'est écrasé dans le nouveau (on n'ajoute que ce qui manque).
(function () {
    const inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    const $ = (id) => document.getElementById(id);
    const say = (t) => { $('m').textContent = t; };
    const detail = (t) => { $('d').textContent = t; };
    const bar = (f) => { $('b').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };
    const LOCAL = /Windows/.test(navigator.userAgent) ? 'http://pulse.localhost/' : 'pulse://localhost/';   // Pulse sur l'ordinateur
    const DB = 'pulse', DBV = 2;

    function openDB(create) {
        return new Promise((resolve, reject) => {
            const q = indexedDB.open(DB, DBV);
            q.onupgradeneeded = () => {
                if (!create) { q.transaction.abort(); return; }
                const db = q.result;
                if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
            };
            q.onsuccess = () => resolve(q.result);
            q.onerror = () => (create ? reject(q.error) : resolve(null));
        });
    }
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const store = (db, name, mode) => db.transaction(name, mode).objectStore(name);

    function toB64(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    }
    // page en ligne : envoi par morceaux (le canal rapide y est refusé)
    async function put(name, bytes) {
        const CHUNK = 4 << 20;
        const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        for (let i = 0, first = true; first || i < bytes.length; i += CHUNK, first = false) {
            await inv('stage_put', { id, first, data: toB64(bytes.subarray(i, i + CHUNK)) });
        }
        return inv('migration_put', { name, id });
    }
    const json = (o) => new TextEncoder().encode(JSON.stringify(o));

    // === 1. Ancienne version (page en ligne) : tout écrire dans le dossier de transfert ===
    async function exportAll() {
        say('Transfert de tes projets vers la nouvelle version de Pulse…');
        const ls = {};
        // sans les marqueurs de session (la nouvelle version croirait à un redémarrage forcé)
        const SKIP = new Set(['pulse_session', 'pulse_alive', 'pulse_clean_exit']);
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!SKIP.has(k)) ls[k] = localStorage.getItem(k); }
        await put('localstorage.json', json(ls));
        const db = await openDB(false);
        let projects = [], keys = [];
        if (db && db.objectStoreNames.contains('projects')) projects = await req(store(db, 'projects', 'readonly').getAll());
        if (db && db.objectStoreNames.contains('clips')) keys = await req(store(db, 'clips', 'readonly').getAllKeys());
        await put('projects.json', json(projects));
        const metas = [];
        let done = 0;
        for (let n = 0; n < keys.length; n++) {
            const rec = await req(store(db, 'clips', 'readonly').get(keys[n]));
            if (!rec) continue;
            const meta = Object.assign({}, rec); delete meta.blob;
            if (rec.blob instanceof Blob) {
                const file = 'clip-' + n + '.bin';
                const bytes = new Uint8Array(await rec.blob.arrayBuffer());
                await put(file, bytes);
                meta.__file = file; meta.__type = rec.blob.type || rec.mime || '';
                done += bytes.length;
            }
            metas.push(meta);
            bar((n + 1) / keys.length);
            detail(`Sons : ${n + 1} / ${keys.length} (${Math.round(done / 1048576)} Mo)`);
        }
        await put('clips.json', json(metas));
        await put('export-ok', json({ at: Date.now(), projects: projects.length, clips: metas.length }));
        location.replace(LOCAL + 'migrate.html');
    }

    // === 2. Nouvelle version (pulse://) : relire et ranger ce qui manque ===
    async function read(name) { return new Uint8Array(await inv('migration_read', { name })); }
    const parse = (u8) => JSON.parse(new TextDecoder().decode(u8));
    async function importAll() {
        say('Rangement de tes projets dans la nouvelle version…');
        let ok = null;
        try { ok = parse(await read('export-ok')); } catch {}
        if (!ok) { location.replace('studio.html'); return; }   // export incomplet : on réessaiera au prochain lancement
        const ls = parse(await read('localstorage.json'));
        for (const [k, v] of Object.entries(ls)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
        const db = await openDB(true);
        for (const p of parse(await read('projects.json'))) {
            if (p && p.id != null && !(await req(store(db, 'projects', 'readonly').get(p.id)))) await req(store(db, 'projects', 'readwrite').put(p));
        }
        const metas = parse(await read('clips.json'));
        for (let n = 0; n < metas.length; n++) {
            const m = metas[n];
            if (m && m.id != null && !(await req(store(db, 'clips', 'readonly').get(m.id)))) {
                const rec = Object.assign({}, m); delete rec.__file; delete rec.__type;
                if (m.__file) rec.blob = new Blob([await read(m.__file)], { type: m.__type || m.mime || '' });
                await req(store(db, 'clips', 'readwrite').put(rec));
            }
            bar((n + 1) / metas.length);
            detail(`Sons : ${n + 1} / ${metas.length}`);
        }
        localStorage.setItem('pulse_migrated_v1', String(Date.now()));
        await inv('migration_done');
        location.replace('studio.html#transfert-fait');
    }

    async function run() {
        if (!inv) { say('Cette page ne sert que dans l\'appli Pulse.'); return; }
        try {
            if (location.hostname === 'appnco.app') await exportAll(); else await importAll();
        } catch (err) {
            console.error(err);
            say('Le transfert a buté : tes projets restent dans l\'ancienne version, rien n\'est perdu.');
            detail(String((err && err.message) || err));
            try { await inv('diag_write', { kind: 'transfert', detail: String((err && err.message) || err) }); } catch {}
            setTimeout(() => location.replace(location.hostname === 'appnco.app' ? LOCAL + 'studio.html#transfert-en-attente' : 'studio.html#transfert-en-attente'), 4000);
        }
    }
    if (window.__PULSE_MIGRATE_MANUAL__) window.PulseMigrate = { exportAll, importAll }; else run();
})();
