// Pont vers le moteur audio Rust quand Pulse tourne dans l'appli de bureau (Tauri).
// Dans un navigateur, window.__TAURI__ n'existe pas : PulseNative.available === false et rien ne change.
window.PulseNative = (function () {
    const core = () => window.__TAURI__ && window.__TAURI__.core;
    const isAvailable = () => !!(core() && core().invoke);
    async function play(project, from = 0) {
        if (!isAvailable()) throw new Error('moteur natif absent');
        const { blob } = await PulseFile.pack(project);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return core().invoke('native_play', bytes, { headers: { from: String(from) } });
    }
    const stop = () => isAvailable() ? core().invoke('native_stop') : Promise.resolve();
    const info = () => isAvailable() ? core().invoke('native_info') : Promise.resolve(null);
    // Réglage « lire avec le moteur natif » (désactivé par défaut)
    const KEY = 'pulse_native_play';
    const isEnabled = () => { try { return isAvailable() && localStorage.getItem(KEY) === '1'; } catch { return false; } };
    const setEnabled = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} };
    return { get available() { return isAvailable(); }, play, stop, info, isEnabled, setEnabled, onError: null };
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
