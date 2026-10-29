// === Pulse — Fichier projet .pulse ===
// Un .pulse est un ZIP standard (sans compression) : project.json + media/<clipId>.wav
// Ouvert, lisible par n'importe quel outil ZIP : ta musique t'appartient.

window.PulseFile = (function() {
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // entries : [{ name, bytes: Uint8Array }] → Blob ZIP (méthode "store")
    function zipStore(entries) {
        const enc = new TextEncoder();
        const parts = [];
        const central = [];
        let offset = 0;
        for (const e of entries) {
            const name = enc.encode(e.name);
            const crc = crc32(e.bytes);
            const size = e.bytes.length;
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);       // version
            local.setUint16(6, 0x0800, true);   // noms en UTF-8
            local.setUint16(8, 0, true);        // store
            local.setUint32(14, crc, true);
            local.setUint32(18, size, true);
            local.setUint32(22, size, true);
            local.setUint16(26, name.length, true);
            parts.push(local.buffer, name, e.bytes);

            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true);
            cd.setUint16(4, 20, true);
            cd.setUint16(6, 20, true);
            cd.setUint16(8, 0x0800, true);
            cd.setUint16(10, 0, true);
            cd.setUint32(16, crc, true);
            cd.setUint32(20, size, true);
            cd.setUint32(24, size, true);
            cd.setUint16(28, name.length, true);
            cd.setUint32(42, offset, true);
            central.push(cd.buffer, name);
            offset += 30 + name.length + size;
        }
        const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, entries.length, true);
        end.setUint16(10, entries.length, true);
        end.setUint32(12, cdSize, true);
        end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
    }

    // ArrayBuffer ZIP → Map(name → Uint8Array). Ne lit que les entrées non compressées.
    function unzipStore(buffer) {
        const view = new DataView(buffer);
        const dec = new TextDecoder();
        let eocd = -1;
        for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('not-a-zip');
        const count = view.getUint16(eocd + 10, true);
        let p = view.getUint32(eocd + 16, true);
        const files = new Map();
        for (let n = 0; n < count; n++) {
            if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad-central');
            const method = view.getUint16(p + 10, true);
            const size = view.getUint32(p + 24, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const localOff = view.getUint32(p + 42, true);
            const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
            if (method !== 0) throw new Error('compressed');
            const dataOff = localOff + 30 + view.getUint16(localOff + 26, true) + view.getUint16(localOff + 28, true);
            files.set(name, new Uint8Array(buffer, dataOff, size));
            p += 46 + nameLen + extraLen + commentLen;
        }
        return files;
    }

    // Projet + tous ses fichiers audio (lus dans IndexedDB) → Blob .pulse
    async function pack(project) {
        const entries = [];
        const doc = { format: 'pulse', version: 1, savedAt: new Date().toISOString(), project };
        entries.push({ name: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(doc)) });
        const ids = new Set(PulsePersist.mediaIds(project, false));
        let missing = 0;
        for (const id of ids) {
            const blob = await PulsePersist.loadBlob(id);
            if (!blob) { missing++; continue; }
            entries.push({ name: `media/${id}.wav`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        return { blob: zipStore(entries), clips: ids.size - missing, missing };
    }

    // Fichier .pulse → audio rangé dans IndexedDB, retourne le projet prêt à ouvrir
    async function unpack(file, partFiles = []) {
        const files = unzipStore(await file.arrayBuffer());
        for (const pf of partFiles) {
            for (const [name, bytes] of unzipStore(await pf.arrayBuffer())) if (/^media\//.test(name)) files.set(name, bytes);
        }
        const json = files.get('project.json');
        if (!json) throw new Error('no-project');
        const doc = JSON.parse(new TextDecoder().decode(json));
        const project = doc.project;
        if (!project || !Array.isArray(project.tracks)) throw new Error('no-project');
        for (const [name, bytes] of files) {
            const m = name.match(/^media\/(.+)\.wav$/);
            if (!m) continue;
            await PulsePersist.saveBlob(m[1], new Blob([bytes.slice()], { type: 'audio/wav' }), { kind: 'import' });
        }
        if (!project.id) project.id = Date.now().toString(36);
        project.lastOpen = Date.now();
        return project;
    }

    // Gros projet (dossier de l'appli) : les sons sont répartis dans des fichiers « morceaux » de taille raisonnable,
    // rangés dans Sons/ à côté du .pulse principal (un seul gros bloc ne passe pas d'un coup vers le disque).
    // Le .pulse principal garde la liste des morceaux : on l'ouvre comme d'habitude.
    async function packSplit(project, baseName, maxBytes = 96 * 1048576) {
        const ids = new Set(PulsePersist.mediaIds(project, false));
        let missing = 0;
        const groups = []; let cur = [], curSize = 0;
        for (const id of ids) {
            const blob = await PulsePersist.loadBlob(id);
            if (!blob) { missing++; continue; }
            if (cur.length && curSize + blob.size > maxBytes) { groups.push(cur); cur = []; curSize = 0; }
            cur.push({ id, blob }); curSize += blob.size;
        }
        if (cur.length) groups.push(cur);
        const parts = [];
        for (let i = 0; i < groups.length; i++) {
            const entries = [];
            for (const { id, blob } of groups[i]) entries.push({ name: `media/${id}.wav`, bytes: new Uint8Array(await blob.arrayBuffer()) });
            parts.push({ name: `Sons/${baseName} - sons ${i + 1}.pulse`, blob: zipStore(entries) });
        }
        const doc = { format: 'pulse', version: 1, savedAt: new Date().toISOString(), project, parts: parts.map(p => p.name) };
        const main = zipStore([{ name: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(doc)) }]);
        return { main, parts, clips: ids.size - missing, missing };
    }

    // Les morceaux annoncés par un .pulse principal (liste vide si tout est dedans)
    async function partNames(file) {
        const files = unzipStore(await file.arrayBuffer());
        const json = files.get('project.json');
        if (!json) return [];
        try { return JSON.parse(new TextDecoder().decode(json)).parts || []; } catch { return []; }
    }

    return { pack, packSplit, partNames, unpack, zipStore, unzipStore };
})();
