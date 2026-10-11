// === Pulse — Persistence IndexedDB ===
// Stocke les buffers audio (encodés en WAV) sur disque par clip ID.
// Au boot, on recharge tout ce qui est présent → les clips reviennent intacts.

window.PulsePersist = (function() {
    const DB_NAME = 'pulse';
    const DB_VERSION = 1;
    const STORE_CLIPS = 'clips';
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

    return { saveBlob, loadBlob, deleteBlob, listIds, clearAll, gc };
})();
