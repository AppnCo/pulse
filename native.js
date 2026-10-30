// Pont vers le moteur audio Rust quand Pulse tourne dans l'appli de bureau (Tauri).
// Dans un navigateur, window.__TAURI__ n'existe pas : PulseNative.available === false et rien ne change.
window.PulseNative = (function () {
    const core = () => window.__TAURI__ && window.__TAURI__.core;
    const isAvailable = () => !!(core() && core().invoke);
    // Les sons restent en mémoire dans le moteur : on n'envoie d'abord que le projet (rapide, même avec de gros WAV).
    // Si un son lui manque (nouvelle prise, import…), on envoie tout le .pulse, sons compris.
    // loop = { a, b } (secondes) : le moteur boucle lui-même, sans trou
    async function play(project, from = 0, loop = null) {
        const lp = loop && loop.b - loop.a >= 0.05 ? [loop.a, loop.b] : null;
        if (!isAvailable()) throw new Error('moteur natif absent');
        try {
            const sizes = {};
            for (const id of new Set(PulsePersist.mediaIds(project, false))) {
                const b = await PulsePersist.loadBlob(id);
                if (b) sizes[id] = b.size;
            }
            return await core().invoke('native_play_project', { json: JSON.stringify(project), sizes, from, lp });
        } catch (err) {
            if (!/sons manquants/.test(String((err && err.message) || err))) throw err;
        }
        const { blob } = await PulseFile.pack(project);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const headers = { from: String(from) };
        if (lp) headers.loop = lp[0] + ',' + lp[1];
        return sendBytes(bytes, 'native_play', headers, 'native_play_staged', { from, lp });
    }
    // Envoi d'octets à l'appli. Depuis la page en ligne, macOS refuse le canal rapide : Tauri passe par un canal
    // de secours qui ne prend que du texte (« octets bruts » refusés). On envoie alors en base64, par morceaux
    // de 4 Mo recollés côté Rust (stage_put), puis la commande « _staged » utilise le fichier recollé.
    // Le canal rapide marche-t-il ? Testé une fois : save_file vérifie le corps avant tout, un envoi vide suffit (rien n'est écrit)
    let rawOk = null;
    async function rawWorks() {
        if (window.__pulseForceChunks) return false;   // tests : simuler la page en ligne
        if (rawOk === null) {
            try { await core().invoke('save_file', new Uint8Array(0), { headers: { dir: '', path: '' } }); rawOk = true; }
            catch (err) { rawOk = !/octets bruts/.test(String((err && err.message) || err)); }
        }
        return rawOk;
    }
    const CHUNK = 4 << 20;
    function toB64(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function fromB64(str, out, at) {
        const bin = atob(str);
        for (let i = 0; i < bin.length; i++) out[at + i] = bin.charCodeAt(i);
        return bin.length;
    }
    async function sendBytes(bytes, rawCmd, headers, stagedCmd, stagedArgs) {
        if (await rawWorks()) return core().invoke(rawCmd, bytes, { headers });
        const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        for (let i = 0, first = true; first || i < bytes.length; i += CHUNK, first = false) {
            await core().invoke('stage_put', { id, first, data: toB64(bytes.subarray(i, i + CHUNK)) });
        }
        return core().invoke(stagedCmd, Object.assign({ id }, stagedArgs));
    }
    // Lecture d'un fichier par l'appli (kind « pulse » ou « import ») ; renvoie un ArrayBuffer
    async function readBytes(kind, rawCmd, path) {
        if (await rawWorks()) return core().invoke(rawCmd, { path });
        let out = null, size = 0, at = 0;
        do {
            const part = await core().invoke('read_file_part', { kind, path, offset: at, len: CHUNK });
            if (!out) { size = part.size; out = new Uint8Array(size); }
            const n = fromB64(part.data, out, at);
            at += n;
            if (!n) break;
        } while (at < size);
        return out.buffer;
    }
    // Projet changé pendant la lecture (effet, réglage de plugin, région…) : le moteur passe au nouveau mix
    // en fondu enchaîné de 20 ms, sans s'arrêter. Échoue (« sons manquants », « pas en lecture ») → relancer avec play().
    async function swap(project) {
        if (!isAvailable()) throw new Error('moteur natif absent');
        const sizes = {};
        for (const id of new Set(PulsePersist.mediaIds(project, false))) {
            const b = await PulsePersist.loadBlob(id);
            if (b) sizes[id] = b.size;
        }
        return core().invoke('native_swap', { json: JSON.stringify(project), sizes });
    }
    const stop = () => isAvailable() ? core().invoke('native_stop') : Promise.resolve();
    // volumes, pan, mute / solo… changés pendant la lecture : le moteur les prend en direct, sans relancer
    const mix = (project) => isAvailable() ? core().invoke('native_mix', { json: JSON.stringify(project) }) : Promise.resolve();
    // Boucle posée / changée / enlevée pendant la lecture
    const loop = (l) => isAvailable() ? core().invoke('native_loop', { lp: l ? [l.a, l.b] : null }) : Promise.resolve();
    // Position dans le morceau, niveaux pour les vumètres, boucle tenue par le moteur
    const live = () => isAvailable() ? core().invoke('native_live') : Promise.resolve(null);
    // Spectre d'une fenêtre de plugin : [groupe ?, indice] ou null
    const scope = (target) => isAvailable() ? core().invoke('native_scope', { target: target || null }) : Promise.resolve();
    const info = () => isAvailable() ? core().invoke('native_info') : Promise.resolve(null);
    // Réglage « lire avec le moteur natif » : activé par défaut dans l'appli depuis le 30/10/2026 (2 h d'endurance sans un trou) ;
    // décoché dans les Réglages = retour au moteur du navigateur
    const KEY = 'pulse_native_play_v2';   // nouvelle clé : tout le monde repart sur le moteur natif
    // Page en ligne (canal rapide refusé) : le moteur natif reste coupé. Il lui faudrait recevoir tous les sons
    // en morceaux à chaque session (≈1 Go pour 16 pistes de 5 min = la page figée de longues secondes).
    const isEnabled = () => { if (rawOk === false) return false; try { return isAvailable() && localStorage.getItem(KEY) !== '0'; } catch { return isAvailable(); } };
    const setEnabled = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} };
    // Retour casque direct par le moteur natif (activé par défaut dans l'appli ; coupé = retour par le moteur web)
    const MKEY = 'pulse_native_monitor';
    const monitor = {
        isEnabled: () => { try { return isAvailable() && localStorage.getItem(MKEY) !== '0'; } catch { return false; } },
        setEnabled: (on) => { try { localStorage.setItem(MKEY, on ? '1' : '0'); } catch {} },
        start: (device, channel, buffer) => core().invoke('monitor_start', { device: device || '', channel: channel || 0, buffer }),
        stop: () => isAvailable() ? core().invoke('monitor_stop') : Promise.resolve(),
        gain: (g) => isAvailable() ? core().invoke('monitor_gain', { gain: g }) : Promise.resolve(),
        track: (json) => isAvailable() ? core().invoke('monitor_track', { json: json || '' }) : Promise.resolve(),
        info: () => isAvailable() ? core().invoke('monitor_info') : Promise.resolve(null),
    };
    // le canal est testé dès le chargement (quelques ms), avant la première lecture
    if (isAvailable()) setTimeout(() => { rawWorks().catch(() => {}); }, 0);
    return { get available() { return isAvailable(); }, get chunked() { return rawOk === false; }, play, swap, scope, stop, mix, loop, live, info, isEnabled, setEnabled, monitor, sendBytes, readBytes, onError: null };
})();

// Claviers MIDI dans l'appli : la fenêtre n'a pas « Web MIDI », on lui prête la même interface avec CoreMIDI (Rust).
// Le reste de Pulse (piano roll, « Jouer en direct ») ne voit aucune différence.
(function () {
    const T = window.__TAURI__;
    if (!T || !T.core || navigator.requestMIDIAccess) return;
    let access = null;
    const makePort = (id, name) => ({ id: String(id), name, manufacturer: '', type: 'input', state: 'connected', connection: 'open', onmidimessage: null });
    navigator.requestMIDIAccess = async function () {
        if (access) return access;
        access = { inputs: new Map(), outputs: new Map(), sysexEnabled: false, onstatechange: null };
        let names = [];
        const apply = (list) => {
            names = list;
            const old = access.inputs;
            access.inputs = new Map();
            list.forEach((n, i) => {
                const prev = old.get(String(i));
                const p = prev && prev.name === n ? prev : makePort(i, n);
                access.inputs.set(String(i), p);
            });
        };
        apply(await T.core.invoke('midi_start'));
        if (T.event && T.event.listen) {
            T.event.listen('pulse-midi', (e) => {
                const m = e.payload || {};
                const p = access.inputs.get(String(m.port));
                if (p && typeof p.onmidimessage === 'function') p.onmidimessage({ data: new Uint8Array(m.data || []), timeStamp: performance.now(), target: p });
            });
        }
        // Un clavier branché ou débranché : on rouvre les ports et on prévient (comme onstatechange)
        setInterval(async () => {
            try {
                const now = await T.core.invoke('midi_ports');
                if (JSON.stringify(now) === JSON.stringify(names)) return;
                const had = access.inputs;
                const list = await T.core.invoke('midi_start');
                apply(list);
                // les écouteurs posés sur les anciens ports passent aux nouveaux
                access.inputs.forEach((p, k) => { const o = had.get(k); if (o && o.onmidimessage && !p.onmidimessage) p.onmidimessage = o.onmidimessage; });
                if (typeof access.onstatechange === 'function') access.onstatechange({ port: null });
            } catch {}
        }, 2000);
        return access;
    };
    // Dans l'appli le MIDI est toujours autorisé : le clavier répond dès l'ouverture du piano roll
    if (navigator.permissions && navigator.permissions.query) {
        const q = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (d) => (d && d.name === 'midi') ? Promise.resolve({ state: 'granted', onchange: null }) : q(d);
    }
})();
