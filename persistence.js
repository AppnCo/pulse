// === Pulse — Persistence IndexedDB ===
// Stocke les buffers audio (encodés en WAV) sur disque par clip ID.
// Au boot, on recharge tout ce qui est présent → les clips reviennent intacts.

window.PulsePersist = (function() {
    const DB_NAME = 'pulse';
    const DB_VERSION = 2;
    const STORE_CLIPS = 'clips';
    const STORE_PROJECTS = 'projects';
    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_CLIPS)) {
                    db.createObjectStore(STORE_CLIPS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
                    db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function saveBlob(clipId, blob, meta = {}) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CLIPS, 'readwrite');
            const store = tx.objectStore(STORE_CLIPS);
            store.put({ id: clipId, blob, mime: blob.type, savedAt: Date.now(), ...meta });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadBlob(clipId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CLIPS, 'readonly');
            const req = tx.objectStore(STORE_CLIPS).get(clipId);
            req.onsuccess = () => resolve(req.result ? req.result.blob : null);
            req.onerror = () => reject(req.error);
        });
    }

    async function deleteBlob(clipId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CLIPS, 'readwrite');
            tx.objectStore(STORE_CLIPS).delete(clipId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function listIds() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CLIPS, 'readonly');
            const req = tx.objectStore(STORE_CLIPS).getAllKeys();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function clearAll() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CLIPS, 'readwrite');
            tx.objectStore(STORE_CLIPS).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Nettoyage : supprime les blobs qui ne sont plus référencés par aucun clip du projet
    async function gc(projectClipIds) {
        const stored = await listIds();
        const refSet = new Set(projectClipIds);
        const orphans = stored.filter(id => !refSet.has(id));
        for (const id of orphans) await deleteBlob(id);
        return orphans.length;
    }

    // === Projets complets (un document par projet, clé = project.id) ===
    async function saveProjectDoc(project) {
        if (!project || !project.id) return;
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_PROJECTS, 'readwrite');
            tx.objectStore(STORE_PROJECTS).put(project);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadProjectDoc(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function listProjectDocs() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const req = db.transaction(STORE_PROJECTS, 'readonly').objectStore(STORE_PROJECTS).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function deleteProjectDoc(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_PROJECTS, 'readwrite');
            tx.objectStore(STORE_PROJECTS).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Tous les sons dont un projet a besoin : régions, prises, originaux (Auto-Tune, warp, inversion), rendu des pistes gelées
    // `rec` : garder aussi une prise en cours (le nettoyage ne doit pas l'effacer ; le fichier .pulse, lui, l'ignore)
    function mediaIds(project, rec = true) {
        const ids = new Set();
        (project?.tracks || []).forEach(t => {
            [...(t.clips || []), ...(t.takes || [])].forEach(c => { if (c.id && (rec || !c.recording)) ids.add(c.id); if (c.tune && c.tune.src) ids.add(c.tune.src); if (c.warp && c.warp.src) ids.add(c.warp.src); if (c.rev && c.rev.src) ids.add(c.rev.src); });
            if (t.frozen && t.frozen.id) ids.add(t.frozen.id);
        });
        return [...ids];
    }

    // Nettoyage global : garde l'audio référencé par N'IMPORTE QUEL projet enregistré (+ extraIds)
    async function gcAll(extraIds = []) {
        const keep = [...extraIds];
        (await listProjectDocs()).forEach(p => keep.push(...mediaIds(p)));
        return gc(keep);
    }

    return { saveBlob, loadBlob, deleteBlob, listIds, clearAll, gc, gcAll, mediaIds,
             saveProjectDoc, loadProjectDoc, listProjectDocs, deleteProjectDoc };
})();
