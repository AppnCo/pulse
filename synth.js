// === Pulse — Synthé maison (instruments + batterie pour le piano roll et le séquenceur de pas) ===
// DSP pur (Float32Array), sans échantillons ni dépendance : tourne dans le navigateur comme dans Node (tests).
// Une région MIDI = { inst, beats, notes: [{ s, d, p, v }] } (s et d en temps, p = note MIDI, v = 1–127).
// On la « bounce » en audio : tout le reste de Pulse (effets, export, moteur Rust) la traite comme une prise.

(function(root) {
    const INSTRUMENTS = {
        grand:  { label: 'Piano à queue', kind: 'keys', bank: 'grand' },
        piano:  { label: 'Piano',     kind: 'keys' },
        keys:   { label: 'Clavier',   kind: 'keys' },
        bass808:{ label: '808',       kind: 'keys' },
        rhodes: { label: 'Rhodes',    kind: 'keys' },
        pad:    { label: 'Pad',       kind: 'keys' },
        cordes: { label: 'Cordes',    kind: 'keys', bank: 'cordes', fb: 'pad' },
        choeur: { label: 'Chœur',     kind: 'keys' },
        harpe:  { label: 'Harpe',     kind: 'keys', bank: 'harpe', fb: 'pluck' },
        cloches:{ label: 'Cloches',   kind: 'keys', bank: 'cloches', fb: 'kalimba' },
        glock:  { label: 'Glockenspiel', kind: 'keys', bank: 'glock', fb: 'kalimba' },
        kalimba:{ label: 'Kalimba',   kind: 'keys' },
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
    // Banques d'échantillons (piano à queue…) : chargées par la page (studio.js, ensureBank) puis données ici.
    // banque = { sr, zones: [{ p: note MIDI, layers: [{ v: vélocité 1-127, ch: [L, R] }] }] }. Pas encore chargée : son de synthèse de secours.
    const BANKS = {};
    function setBank(name, bank) { BANKS[name] = bank; }
    function hasBank(name) { return !!BANKS[name]; }
    // banque = { sr, rel (s, relâchement), zones: [{ p, layers: [{ v, ch, ls?, le? }] }] } ; ls/le (échantillons) = boucle de tenue (cordes)
    function sampleVoice(L, R, bank, sr, i0, dur, p, vel) {
        let z = bank.zones[0];
        for (const q of bank.zones) if (Math.abs(q.p - p) < Math.abs(z.p - p)) z = q;
        // deux couches de frappe voisines, mélangées selon la vélocité (pas de saut de timbre d'une vélocité à l'autre)
        const ls = z.layers;
        let a = ls[0], b = ls[0], w = 0;
        if (vel <= ls[0].v) { a = b = ls[0]; } else if (vel >= ls[ls.length - 1].v) { a = b = ls[ls.length - 1]; }
        else for (let j = 0; j + 1 < ls.length; j++) if (vel >= ls[j].v && vel <= ls[j + 1].v) { a = ls[j]; b = ls[j + 1]; w = (vel - a.v) / (b.v - a.v); break; }
        const ratio = Math.pow(2, (p - z.p) / 12) * bank.sr / sr, on = Math.round(dur * sr), rr = Math.exp(-1 / ((bank.rel || 0.12) * sr));
        const g = 0.9 * (0.7 + 0.3 * vel / 127), X = Math.round(0.25 * bank.sr);
        // lecture d'une couche à la position x (échantillons de la banque) ; avec boucle : on replie x dans [ls, le[
        // et on fond la fin de boucle dans ce qui précède son début (aucun clic, même si les deux bouts diffèrent un peu)
        const rd = (A, x) => { const xi = x | 0, fr = x - xi; return A[xi] + (A[xi + 1] - A[xi]) * fr; };
        const tap = (ly, c, x) => {
            const A = ly.ch[c];
            if (!ly.le) return rd(A, x);
            const P = ly.le - ly.ls;
            if (x >= ly.le) x = ly.ls + ((x - ly.le) % P);
            if (x > ly.le - X) { const t = (x - (ly.le - X)) / X; return rd(A, x) * (1 - t) + rd(A, x - P) * t; }
            return rd(A, x);
        };
        const len = Math.min(a.le ? Infinity : a.ch[0].length, b.le ? Infinity : b.ch[0].length);
        let relE = 1;
        for (let k = 0; i0 + k < L.length; k++) {
            const x = k * ratio;
            if (x + 2 >= len || relE < 1e-4) break;
            if (k > on) relE *= rr;   // touche relâchée : l'étouffoir coupe la note
            const e = relE * g;
            for (let c = 0; c < 2; c++) {
                const va = tap(a, c, x), vb = b === a ? va : tap(b, c, x);
                (c ? R : L)[i0 + k] += (va + (vb - va) * w) * e;
            }
        }
    }
    // Kits de la batterie (région.kit) : Classique (le son d'origine), Trap (808), Boom bap (poussiéreux, années 90)
    const KITS = { classic: 'Classique', trap: 'Trap', boombap: 'Boom bap' };

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
        if (INSTRUMENTS[inst] && INSTRUMENTS[inst].bank) {
            const bank = BANKS[INSTRUMENTS[inst].bank];
            if (bank) return sampleVoice(L, R, bank, sr, i0, dur, p, vel);
            inst = INSTRUMENTS[inst].fb || 'piano';   // banque pas encore chargée : son de synthèse voisin en attendant
        }
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
        } else if (inst === 'rhodes') {
            // piano électrique à lames (tine) : FM 1:1 dont l'éclat dépend de la frappe, « cloche » de la lame à l'attaque,
            // léger grain de micro (saturation paire) et trémolo stéréo des amplis de scène
            const r = 0.25, n = on + Math.round(r * sr * 6), w = TAU * f / sr;
            const idx = 0.5 + 2.2 * Math.pow(vel / 127, 2), tau = Math.max(0.9, 3.2 - (p - 40) * 0.035) * sr;
            const bell = 0.12 * Math.pow(vel / 127, 1.5), wb = TAU * Math.min(f * 14.1, sr / 2.3) / sr;
            const pan = Math.max(-0.6, Math.min(0.6, (p - 60) / 50)), tr = TAU * 4.2 / sr;
            const end = Math.min(L.length, i0 + n);
            for (let i = i0; i < end; i++) {
                const k = i - i0, e = Math.exp(-k / tau), mi = idx * Math.exp(-k / (0.25 * sr)) + 0.25;
                let v = Math.sin(w * k + mi * Math.sin(w * k)) * 0.34 + bell * Math.sin(wb * k) * Math.exp(-k / (0.02 * sr));
                v = v + 0.12 * v * v;                        // grain du micro
                v *= e * amp * Math.min(1, k / att) * rel(k, on, r, sr);
                const t = 0.18 * Math.sin(tr * (i0 + k)), pp = Math.max(-1, Math.min(1, pan + t));
                L[i] += v * Math.cos((pp + 1) * Math.PI / 4) * 1.4142; R[i] += v * Math.sin((pp + 1) * Math.PI / 4) * 1.4142;
            }
        } else if (inst === 'pad') {
            // nappe : 5 dents de scie désaccordées réparties en stéréo, filtre qui s'ouvre lentement, attaque et relâchement longs
            const r = 1.2, a = 0.35 * sr, n = on + Math.round(r * sr * 5);
            const det = [-0.012, -0.005, 0, 0.006, 0.013], pans = [-0.8, -0.4, 0, 0.4, 0.8];
            const nh = Math.max(1, Math.min(12, Math.floor(sr / 2.4 / f)));
            const ph = det.map((_, j) => (j * 0.2137 + p * 0.071) % 1), lp = [[0, 0], [0, 0]];
            // une période de dent de scie adoucie en table (calculée une fois par note) : lue au lieu de nh sinus par échantillon
            const TL = 2048, tab = new Float32Array(TL + 1);
            for (let x = 0; x <= TL; x++) { let sv = 0; for (let h = 1; h <= nh; h++) sv += Math.sin(TAU * h * x / TL) / h; tab[x] = sv; }
            const end = Math.min(L.length, i0 + n);
            for (let i = i0; i < end; i++) {
                const k = i - i0, env = Math.min(1, k / a) * rel(k, on, r, sr);
                let l = 0, rr = 0;
                for (let j = 0; j < 5; j++) {
                    ph[j] = (ph[j] + f * (1 + det[j]) / sr) % 1;
                    const xf = ph[j] * TL, xi = xf | 0, sv = tab[xi] + (tab[xi + 1] - tab[xi]) * (xf - xi);
                    const g = 0.5 + 0.5 * pans[j];
                    l += sv * (1 - g); rr += sv * g;
                }
                const cut = 0.02 + 0.06 * Math.min(1, k / (1.5 * sr));
                lp[0][0] += (l - lp[0][0]) * cut; lp[0][1] += (lp[0][0] - lp[0][1]) * cut;
                lp[1][0] += (rr - lp[1][0]) * cut; lp[1][1] += (lp[1][0] - lp[1][1]) * cut;
                L[i] += lp[0][1] * 0.16 * amp * env; R[i] += lp[1][1] * 0.16 * amp * env;
            }
        } else if (inst === 'choeur') {
            // chœur « Aah » : 6 voix (dents de scie adoucies, désaccordées, vibrato propre à chacune) passées dans
            // les 3 formants de la voyelle « a » (filtres résonants), souffle léger, attaque et relâchement doux
            const r = 0.9, a = 0.28 * sr, n = on + Math.round(r * sr * 5), NV = 6;
            const nh = Math.max(1, Math.min(40, Math.floor(sr / 2.4 / f)));
            const TL = 2048, tab = new Float32Array(TL + 1);
            for (let x = 0; x <= TL; x++) { let sv = 0; for (let h = 1; h <= nh; h++) sv += Math.sin(TAU * h * x / TL) / h * (h < 3 ? 1 : 0.8); tab[x] = sv; }
            const ph = [], det = [], vr = [], vp = [], pan = [];
            for (let j = 0; j < NV; j++) { ph.push((j * 0.377 + p * 0.053) % 1); det.push((j - (NV - 1) / 2) * 0.0045); vr.push(TAU * (4.6 + j * 0.31) / sr); vp.push(j * 1.7); pan.push(j % 2 ? 0.75 : 0.25); }
            // formants de « a » (un peu plus sombres dans le grave) : fréquence, largeur, gain
            const F = [[730, 90, 1], [1090, 110, 0.5], [2440, 160, 0.22]].map(([fc, bw, gn]) => {
                fc *= p < 55 ? 0.9 : 1;
                const w0 = TAU * Math.min(fc, sr * 0.45) / sr, al = Math.sin(w0) * Math.sinh(Math.log(2) / 2 * (bw / fc) * w0 / Math.sin(w0));
                const a0 = 1 + al; return { b0: al / a0 * gn, b2: -al / a0 * gn, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, z: [[0, 0], [0, 0]] };
            });
            const nz = rng(p * 131 + 7), end = Math.min(L.length, i0 + n), g = 2.3 * amp;
            for (let i = i0; i < end; i++) {
                const k = i - i0, env = Math.min(1, k / a) * rel(k, on, r, sr), vib = Math.min(1, k / (0.6 * sr)) * 0.0035;
                let l = 0, rr = 0;
                for (let j = 0; j < NV; j++) {
                    ph[j] = (ph[j] + f * (1 + det[j] + vib * Math.sin(vr[j] * k + vp[j])) / sr) % 1;
                    const xf = ph[j] * TL, xi = xf | 0, sv = tab[xi] + (tab[xi + 1] - tab[xi]) * (xf - xi);
                    l += sv * (1 - pan[j]); rr += sv * pan[j];
                }
                const br = nz() * 0.25;
                let ol = 0, or = 0;
                for (const q of F) {
                    for (let c = 0; c < 2; c++) {
                        const x = (c ? rr : l) * 0.2 + br, zz = q.z[c];
                        const y = q.b0 * x + zz[0]; zz[0] = -q.a1 * y + zz[1]; zz[1] = q.b2 * x - q.a2 * y;
                        if (c) or += y; else ol += y;
                    }
                }
                L[i] += ol * g * env; R[i] += or * g * env;
            }
        } else if (inst === 'kalimba') {
            // kalimba : lame pincée = fondamentale qui chante + mode aigu (~5,9 ×) très bref + petit clic de pouce
            const r = 0.6, tau = Math.max(0.35, 1.6 - (p - 60) * 0.025) * sr, n = Math.min(Math.round(6 * sr), on + Math.round(r * sr * 6));
            const w1 = TAU * f / sr, w2 = TAU * Math.min(f * 5.93, sr / 2.3) / sr, w3 = TAU * Math.min(f * 2.01, sr / 2.3) / sr;
            const nz = rng(p * 977 + 3), bri = 0.25 + 0.5 * vel / 127;
            let cl = 0;
            put(L, R, i0, n, (p - 66) / 60, (k) => {
                cl += (nz() - cl) * 0.35;
                const v = Math.sin(w1 * k) * Math.exp(-k / tau) + bri * 0.5 * Math.sin(w2 * k) * Math.exp(-k / (0.045 * sr))
                    + 0.06 * Math.sin(w3 * k) * Math.exp(-k / (0.3 * sr)) + cl * 0.5 * Math.exp(-k / (0.0025 * sr));
                return v * 0.42 * amp * Math.min(1, k / att) * (k <= on ? 1 : Math.exp(-(k - on) / (r * sr)));
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

    // Cymbale « métal » des boîtes à rythmes : 6 carrés aux rapports de la 808, passe-haut
    function metal(sr) {
        const fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map(x => x * 1.7), ph = fr.map(() => 0);
        let a = 0, b = 0, pa = 0, pb = 0;
        return () => { let s = 0; for (let j = 0; j < 6; j++) { ph[j] = (ph[j] + fr[j] / sr) % 1; s += ph[j] < 0.5 ? 1 : -1; }
            s /= 6; a = 0.85 * (a + s - pa); pa = s; b = 0.85 * (b + a - pb); pb = a; return b; };
    }
    function drumVoice(L, R, sr, i0, p, vel, kit) {
        const amp = Math.pow(vel / 127, 1.2), nz = rng(p * 104729 + i0);
        const exp = (t, tau) => Math.exp(-t / tau);
        if (kit === 'trap' || kit === 'boombap') return kitVoice(L, R, sr, i0, p, amp, nz, exp, kit === 'trap');
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

    // Kits Trap et Boom bap (mêmes touches que le kit Classique)
    function kitVoice(L, R, sr, i0, p, amp, nz, exp, trap) {
        const sat = (x, d) => Math.tanh(x * d) / Math.tanh(d);
        if (p === 36 || p === 35) {
            // Trap : kick court et sec (le 808 fait le grave) · Boom bap : kick rond avec du corps et un « toc »
            let ph = 0;
            put(L, R, i0, Math.round((trap ? 0.35 : 0.5) * sr), 0, (k) => {
                const t = k / sr; ph += TAU * (trap ? 52 + 180 * exp(t, 0.018) : 58 + 110 * exp(t, 0.03)) / sr;
                const body = Math.sin(ph) * exp(t, trap ? 0.11 : 0.2), click = k < 60 ? nz() * (1 - k / 60) * (trap ? 0.5 : 0.3) : 0;
                return sat(body + click, trap ? 2.2 : 1.6) * 0.9 * amp * Math.min(1, k / 6);
            });
        } else if (p === 38 || p === 40) {
            // Trap : caisse claire serrée + couche de clap · Boom bap : claquement épais, un peu sale
            let hp = 0, prev = 0, bp = 0;
            put(L, R, i0, Math.round((trap ? 0.28 : 0.4) * sr), 0, (k) => {
                const t = k / sr, x = nz(); hp = (trap ? 0.88 : 0.75) * (hp + x - prev); prev = x; bp += (hp - bp) * 0.35;
                const tone = (Math.sin(TAU * (trap ? 220 : 180) * t) + 0.5 * Math.sin(TAU * (trap ? 330 : 280) * t)) * exp(t, trap ? 0.035 : 0.07);
                const clap = trap ? [0, 0.008, 0.016].reduce((a, b) => a + (t >= b ? exp(t - b, 0.005) : 0), 0) * hp * 0.3 : 0;
                return sat(tone * 0.45 + (trap ? hp : bp) * exp(t, trap ? 0.07 : 0.11) * 0.7 + clap, trap ? 1.4 : 2.0) * 0.85 * amp;
            });
        } else if (p === 39) {
            let hp = 0, prev = 0;
            put(L, R, i0, Math.round(0.35 * sr), 0.08, (k) => {
                const t = k / sr, x = nz(); hp = 0.8 * (hp + x - prev); prev = x;
                const burst = [0, 0.009, 0.019, 0.027].reduce((a, b) => a + (t >= b ? exp(t - b, 0.005) : 0), 0);
                return hp * (burst * 0.4 + (t > 0.03 ? exp(t - 0.03, trap ? 0.09 : 0.12) * 0.6 : 0)) * amp;
            });
        } else if (p === 37) {
            put(L, R, i0, Math.round(0.1 * sr), -0.15, (k) => {
                const t = k / sr; return (Math.sin(TAU * (trap ? 1900 : 1500) * t) * 0.45 + Math.sin(TAU * 820 * t) * 0.3 + nz() * 0.2) * exp(t, 0.014) * amp;
            });
        } else if (p === 42 || p === 44 || p === 46) {
            // charleston : métal de boîte à rythmes (Trap, très court et net) ou bruit plus sombre (Boom bap)
            const open = p === 46, tau = open ? (trap ? 0.12 : 0.18) : (trap ? 0.018 : 0.035), m = metal(sr);
            let lp = 0;
            put(L, R, i0, Math.round((open ? 0.7 : 0.15) * sr), 0.25, (k) => {
                const t = k / sr, v = trap ? m() * 0.8 + nz() * 0.15 : nz() * 0.6 + m() * 0.25;
                lp += (v - lp) * (trap ? 0.9 : 0.45);
                return lp * exp(t, tau) * 0.5 * amp * Math.min(1, k / 4);
            });
        } else if (p === 41 || p === 43 || p === 45 || p === 47) {
            const base = p === 41 ? 75 : p === 43 ? 95 : p === 45 ? 120 : 150;
            let ph = 0;
            put(L, R, i0, Math.round(0.5 * sr), p < 45 ? -0.3 : 0.3, (k) => {
                const t = k / sr; ph += TAU * (base + (trap ? 90 : 50) * exp(t, trap ? 0.03 : 0.05)) / sr;
                return sat(Math.sin(ph) * exp(t, trap ? 0.22 : 0.16), 1.5) * 0.75 * amp;
            });
        } else if (p === 49 || p === 51 || p === 57) {
            const m = metal(sr);
            put(L, R, i0, Math.round(1.8 * sr), -0.2, (k) => {
                const t = k / sr; return (m() * 0.5 + nz() * 0.35) * exp(t, 0.6) * 0.45 * amp;
            });
        }
    }

    // 808 de la trap : une seule voix ; une note qui commence avant la fin de la précédente y GLISSE (portamento, 60 ms)
    function render808(L, R, sr, spb, notes, swingOf) {
        const ns = notes.map(nt => ({ s: swingOf(nt.s), d: Math.max(0.02, nt.d), p: nt.p, v: Math.max(1, Math.min(127, nt.v || 100)) })).sort((a, b) => a.s - b.s);
        let i = 0;
        while (i < ns.length) {
            // une « phrase » : notes qui se chevauchent
            let j = i; while (j + 1 < ns.length && ns[j + 1].s < ns[j].s + ns[j].d - 1e-6) j++;
            const ph0 = ns[i], i0 = Math.round(ph0.s * spb * sr), endB = ns[j].s + ns[j].d;
            const on = Math.round((endB - ph0.s) * spb * sr), r = 0.12, n = on + Math.round(r * sr * 5), amp = Math.pow(ph0.v / 127, 1.3);
            const starts = ns.slice(i, j + 1).map(x => ({ k: Math.round((x.s - ph0.s) * spb * sr), f: hz(x.p) }));
            let ph = 0, q = 0, from = starts[0].f, to = starts[0].f, kq = 0;
            const end = Math.min(L.length, i0 + n), gl = 0.06 * sr;
            for (let x = i0; x < end; x++) {
                const k = x - i0;
                if (q + 1 < starts.length && k >= starts[q + 1].k) { q++; from = to; to = starts[q].f; kq = k; }
                const g = Math.min(1, (k - kq) / gl), f = q === 0 ? to : from * Math.pow(to / from, g);
                const t = k / sr, fr = f * (1 + 1.2 * Math.exp(-t / 0.03));
                ph += TAU * fr / sr;
                const e = Math.min(1, k / (0.002 * sr)) * Math.exp(-t / 3.5) * rel(k, on, r, sr);
                const v = Math.tanh(Math.sin(ph) * 2.2 * amp) * 0.6 * e;
                L[x] += v; R[x] += v;
            }
            i = j + 1;
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
        const swingOf = (st) => { if (swing > 0) { const k = Math.round(st * 4); if (k % 2 === 1 && Math.abs(st * 4 - k) < 0.02) st += swing * (1 / 12); } return st; };
        if (inst === 'bass808') { render808(L, R, sr, spb, notes.filter(nt => Math.round(swingOf(nt.s) * spb * sr) < n), swingOf); }
        else for (const nt of notes) {
            // Swing : un seizième sur deux glisse vers le triolet (100 % = triolet complet)
            let st = nt.s;
            if (swing > 0) { const k = Math.round(st * 4); if (k % 2 === 1 && Math.abs(st * 4 - k) < 0.02) st += swing * (1 / 12); }
            const i0 = Math.round(st * spb * sr);
            if (!(i0 >= 0) || i0 >= n) continue;
            const vel = Math.max(1, Math.min(127, nt.v || 100));
            if (inst === 'drums') drumVoice(L, R, sr, i0, nt.p, vel, midi.kit);
            else keysVoice(L, R, inst, sr, i0, Math.max(0.02, nt.d * spb), nt.p, vel);
        }
        // Soft-clip : jamais de saturation dure quand beaucoup de notes se superposent
        for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * 0.9); R[i] = Math.tanh(R[i] * 0.9); }
        return { channels: [L, R], length: n, sampleRate: sr, duration: n / sr };
    }

    // Une note seule, pour l'écouter quand on clique sur le clavier
    function preview(inst, p, vel = 100, sr = 44100, kit) {
        const isDrums = inst === 'drums';
        return render({ inst, kit, beats: isDrums ? 2 : 2.5, notes: [{ s: 0, d: isDrums ? 0.25 : 1, p, v: vel }] }, 120, sr);
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

    root.PulseSynth = { INSTRUMENTS, KITS, DRUM_LANES, setBank, hasBank, render, preview, loopNotes, hz, MAX_NOTES };
})(typeof window !== 'undefined' ? window : globalThis);
