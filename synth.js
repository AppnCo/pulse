// === Pulse — Synthé maison (instruments + batterie pour le piano roll et le séquenceur de pas) ===
// DSP pur (Float32Array), sans échantillons ni dépendance : tourne dans le navigateur comme dans Node (tests).
// Une région MIDI = { inst, beats, notes: [{ s, d, p, v }] } (s et d en temps, p = note MIDI, v = 1–127).
// On la « bounce » en audio : tout le reste de Pulse (effets, export, moteur Rust) la traite comme une prise.

(function(root) {
    const INSTRUMENTS = {
        piano:  { label: 'Piano',     kind: 'keys' },
        keys:   { label: 'Clavier',   kind: 'keys' },
        bass808:{ label: '808',       kind: 'keys' },
        bass:   { label: 'Basse',     kind: 'keys' },
        lead:   { label: 'Lead',      kind: 'keys' },
        pluck:  { label: 'Pizzicato', kind: 'keys' },
        drums:  { label: 'Batterie',  kind: 'drums' }
    };
    // Pistes de la batterie (numéros GM) : l'ordre est celui du séquenceur de pas
    const DRUM_LANES = [
        { p: 36, name: 'Kick' },   { p: 38, name: 'Snare' },    { p: 39, name: 'Clap' },
        { p: 37, name: 'Rim' },    { p: 42, name: 'Hi-hat' },   { p: 46, name: 'Hi-hat ouvert' },
        { p: 41, name: 'Tom bas' },{ p: 45, name: 'Tom' },      { p: 49, name: 'Crash' }
    ];
    const MAX_NOTES = 4000;

    // Bruit reproductible : le même motif donne toujours exactement le même son
    function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; }; }
    const hz = (p) => 440 * Math.pow(2, (p - 69) / 12);
    const TAU = Math.PI * 2;

    // Chaque voix ajoute son signal dans (L, R) à partir de l'échantillon i0, avec un gain g et un placement pan (-1…1)
    function put(L, R, i0, n, pan, fn) {
        const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
        const end = Math.min(L.length, i0 + n);
        for (let i = i0; i < end; i++) { const v = fn(i - i0); L[i] += v * gl * 1.4142; R[i] += v * gr * 1.4142; }
    }

    // Enveloppe de note : attaque courte, tenue, relâchement exponentiel
    const rel = (k, on, r, sr) => (k <= on ? 1 : Math.exp(-(k - on) / (r * sr)));

    function keysVoice(L, R, inst, sr, i0, dur, p, vel) {
        const f = hz(p), on = Math.round(dur * sr), amp = Math.pow(vel / 127, 1.3);
        const att = Math.max(1, Math.round(0.003 * sr));
        if (inst === 'piano') {
            const tau = Math.max(0.25, 2.6 - (p - 36) * 0.03) * sr, r = 0.18;
            const n = Math.min(L.length - i0, on + Math.round(r * sr * 6));
            if (n <= 0) return;
            // partiels par oscillateurs récursifs (rotation) : pas de sin() à chaque échantillon
            const P = [];
            for (let k = 1; k <= 7 && f * k < sr / 2.2; k++) {
                const w = TAU * f * k * (1 + 0.0004 * k * k) / sr;
                P.push({ c: 1, s: 0, cw: Math.cos(w), sw: Math.sin(w), a: 0.28 / Math.pow(k, 1.15), dec: Math.exp(-(1 + (k - 1) * 0.55) / tau), e: 1 });
            }
            const pan = Math.max(-1, Math.min(1, (p - 60) / 60));
            const gl = Math.cos((pan + 1) * Math.PI / 4) * 1.4142, gr = Math.sin((pan + 1) * Math.PI / 4) * 1.4142;
            const rr = Math.exp(-1 / (r * sr));
            let relE = 1;
            for (let k = 0; k < n; k++) {
                let sum = 0;
                for (let q = 0; q < P.length; q++) {
                    const o = P[q];
                    sum += o.s * o.a * o.e;
                    const c = o.c * o.cw - o.s * o.sw; o.s = o.s * o.cw + o.c * o.sw; o.c = c; o.e *= o.dec;
                }
                if (k > on) relE *= rr;
                if (k % 4096 === 4095) for (const o of P) { const m = Math.hypot(o.c, o.s); o.c /= m; o.s /= m; }
                const v = sum * amp * Math.min(1, k / att) * relE;
                L[i0 + k] += v * gl; R[i0 + k] += v * gr;
            }
        } else if (inst === 'keys') {
            // piano électrique : petite modulation de fréquence qui s'éteint
            const w = TAU * f / sr, tau = 1.4 * sr, r = 0.22, n = on + Math.round(r * sr * 6);
            put(L, R, i0, n, (p - 60) / 80, (k) => {
                const e = Math.exp(-k / tau), m = 1.6 * Math.exp(-k / (0.35 * sr));
                return (Math.sin(w * k + m * Math.sin(w * k * 2)) * 0.3 + Math.sin(w * k) * 0.1) * e * amp * Math.min(1, k / att) * rel(k, on, r, sr);
            });
        } else if (inst === 'bass808') {
            // sinus qui retombe sur la note, tenue, saturation douce : le 808 de la trap
            const r = 0.3, n = on + Math.round(r * sr * 5);
            let ph = 0;
            put(L, R, i0, n, 0, (k) => {
                const t = k / sr, fr = f * (1 + 1.6 * Math.exp(-t / 0.035));
                ph += TAU * fr / sr;
                const e = Math.min(1, k / (0.002 * sr)) * Math.exp(-t / 1.6) * rel(k, on, r, sr);
                return Math.tanh(Math.sin(ph) * 1.9 * amp) * 0.55 * e;
            });
        } else if (inst === 'bass') {
            const w = TAU * f / sr, r = 0.08, n = on + Math.round(r * sr * 6);
            let lp = 0;
            put(L, R, i0, n, 0, (k) => {
                const saw = 2 * ((f * k / sr) % 1) - 1, sq = Math.sin(w * k) * 0.9;
                const cut = 0.04 + 0.2 * Math.exp(-k / (0.15 * sr)); lp += (saw - lp) * cut;
                return (lp * 0.45 + sq * 0.35) * amp * Math.min(1, k / att) * rel(k, on, r, sr);
            });
        } else if (inst === 'lead') {
            const r = 0.12, n = on + Math.round(r * sr * 6), nh = Math.max(1, Math.min(14, Math.floor(sr / 2.2 / f)));
            const w1 = TAU * f * 0.997 / sr, w2 = TAU * f * 1.003 / sr;
            put(L, R, i0, n, 0, (k) => {
                let s = 0;
                for (let h = 1; h <= nh; h++) s += (Math.sin(w1 * k * h) + Math.sin(w2 * k * h)) / h;
                return s * 0.1 * amp * Math.min(1, k / (0.006 * sr)) * rel(k, on, r, sr);
            });
        } else if (inst === 'pluck') {
            // corde pincée (Karplus-Strong)
            const len = Math.max(2, Math.round(sr / f)), buf = new Float32Array(len), nz = rng(p * 7919 + 13);
            for (let i = 0; i < len; i++) buf[i] = nz();
            const n = Math.min(Math.round(sr * 3), on + Math.round(0.4 * sr));
            let j = 0;
            put(L, R, i0, n, (p - 60) / 70, (k) => {
                const nx = (j + 1) % len, v = buf[j];
                buf[j] = (buf[j] + buf[nx]) * 0.4985;
                j = nx;
                return v * 0.5 * amp * rel(k, on, 0.25, sr);
            });
        }
    }

    function drumVoice(L, R, sr, i0, p, vel) {
        const amp = Math.pow(vel / 127, 1.2), nz = rng(p * 104729 + i0);
        const exp = (t, tau) => Math.exp(-t / tau);
        if (p === 36 || p === 35) {                       // kick : sinus qui tombe + petit clic
            let ph = 0;
            put(L, R, i0, Math.round(0.6 * sr), 0, (k) => {
                const t = k / sr; ph += TAU * (46 + 120 * exp(t, 0.028)) / sr;
                return (Math.sin(ph) * exp(t, 0.22) * 0.95 + (k < 40 ? nz() * 0.25 * (1 - k / 40) : 0)) * amp * Math.min(1, k / 8);
            });
        } else if (p === 38 || p === 40) {                // snare : corps + bruit
            let hp = 0, prev = 0;
            put(L, R, i0, Math.round(0.35 * sr), 0, (k) => {
                const t = k / sr, x = nz(); hp = 0.82 * (hp + x - prev); prev = x;
                return (Math.sin(TAU * 185 * t) * exp(t, 0.06) * 0.5 + hp * exp(t, 0.09) * 0.55) * amp;
            });
        } else if (p === 39) {                            // clap : trois frappes rapprochées puis la queue
            let hp = 0, prev = 0;
            put(L, R, i0, Math.round(0.3 * sr), 0.1, (k) => {
                const t = k / sr, x = nz(); hp = 0.7 * (hp + x - prev); prev = x;
                const burst = [0, 0.011, 0.022].reduce((a, b) => a + (t >= b ? exp(t - b, 0.006) : 0), 0);
                return hp * (burst * 0.35 + exp(Math.max(0, t - 0.03), 0.07) * (t > 0.03 ? 0.5 : 0)) * amp;
            });
        } else if (p === 37) {                            // rim
            put(L, R, i0, Math.round(0.08 * sr), -0.15, (k) => {
                const t = k / sr; return (Math.sin(TAU * 1700 * t) * 0.5 + nz() * 0.25) * exp(t, 0.012) * amp;
            });
        } else if (p === 42 || p === 44 || p === 46) {    // hi-hat fermé / ouvert
            const tau = p === 46 ? 0.16 : 0.03, len = p === 46 ? 0.8 : 0.2;
            let a = 0, b = 0, pa = 0, pb = 0;
            put(L, R, i0, Math.round(len * sr), 0.25, (k) => {
                const t = k / sr, x = nz(); a = 0.9 * (a + x - pa); pa = x; b = 0.9 * (b + a - pb); pb = a;
                return b * exp(t, tau) * 0.55 * amp;
            });
        } else if (p === 41 || p === 43 || p === 45 || p === 47) {  // toms
            const base = p === 41 ? 85 : p === 43 ? 105 : p === 45 ? 130 : 160;
            let ph = 0;
            put(L, R, i0, Math.round(0.45 * sr), p < 45 ? -0.3 : 0.3, (k) => {
                const t = k / sr; ph += TAU * (base + 60 * exp(t, 0.05)) / sr;
                return Math.sin(ph) * exp(t, 0.16) * 0.8 * amp;
            });
        } else if (p === 49 || p === 51 || p === 57) {    // crash
            let a = 0, pa = 0;
            put(L, R, i0, Math.round(1.6 * sr), -0.2, (k) => {
                const t = k / sr, x = nz(); a = 0.85 * (a + x - pa); pa = x;
                return a * exp(t, 0.55) * 0.4 * amp;
            });
        }
    }

    // Région MIDI → audio stéréo. `seconds` (optionnel) : durée à produire, sinon la longueur du motif
    function render(midi, bpm, sr = 44100, seconds) {
        const spb = 60 / bpm;
        const total = Math.max(0.05, seconds || Math.max(0.0001, (midi.beats || 4) * spb));
        const n = Math.max(1, Math.ceil(total * sr));
        const L = new Float32Array(n), R = new Float32Array(n);
        const inst = INSTRUMENTS[midi.inst] ? midi.inst : 'piano';
        const notes = (midi.notes || []).slice(0, MAX_NOTES);
        const swing = Math.max(0, Math.min(1, midi.swing || 0));
        for (const nt of notes) {
            // Swing : un seizième sur deux glisse vers le triolet (100 % = triolet complet)
            let st = nt.s;
            if (swing > 0) { const k = Math.round(st * 4); if (k % 2 === 1 && Math.abs(st * 4 - k) < 0.02) st += swing * (1 / 12); }
            const i0 = Math.round(st * spb * sr);
            if (!(i0 >= 0) || i0 >= n) continue;
            const vel = Math.max(1, Math.min(127, nt.v || 100));
            if (inst === 'drums') drumVoice(L, R, sr, i0, nt.p, vel);
            else keysVoice(L, R, inst, sr, i0, Math.max(0.02, nt.d * spb), nt.p, vel);
        }
        // Soft-clip : jamais de saturation dure quand beaucoup de notes se superposent
        for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 0.9); R[i] = Math.tanh(R[i] * 0.9); }
        return { channels: [L, R], length: n, sampleRate: sr, duration: n / sr };
    }

    // Une note seule, pour l'écouter quand on clique sur le clavier
    function preview(inst, p, vel = 100, sr = 44100) {
        const isDrums = inst === 'drums';
        return render({ inst, beats: isDrums ? 2 : 2.5, notes: [{ s: 0, d: isDrums ? 0.25 : 1, p, v: vel }] }, 120, sr);
    }

    // Boucle un motif sur plusieurs mesures : renvoie les notes répétées jusqu'à `beats`
    function loopNotes(notes, patternBeats, beats) {
        const out = [];
        if (!(patternBeats > 0)) return out;
        for (let o = 0; o < beats - 1e-6; o += patternBeats) {
            for (const n of notes) if (o + n.s < beats - 1e-6) out.push({ ...n, s: o + n.s });
        }
        return out;
    }

    root.PulseSynth = { INSTRUMENTS, DRUM_LANES, render, preview, loopNotes, hz, MAX_NOTES };
})(typeof window !== 'undefined' ? window : globalThis);
