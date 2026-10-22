// === Pulse — Auto-Tune (correction de justesse après la prise) ===
// 1. On suit la note chantée (algorithme YIN, sur une copie allégée du signal)
// 2. On choisit la note juste la plus proche dans la gamme
// 3. On recale la voix période par période (TD-PSOLA) : la durée ne change pas, le timbre reste naturel
// DSP pur (Float32Array), sans dépendance : tourne dans le navigateur comme dans Node (tests).

(function(root) {
    const HOP_SEC = 0.01;          // une mesure de note toutes les 10 ms
    const F_MIN = 70, F_MAX = 800; // étendue d'une voix (Hz)
    // Type de voix : où chercher la note (évite de confondre une voix grave avec son octave, etc.)
    const VOICE_RANGE = { high: [150, 1100], mid: [70, 800], low: [50, 450] };
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const NOTE_NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

    const tick = () => new Promise(r => setTimeout(r, 0));

    // --- 1. Suivi de la note : f0[i] en Hz toutes les 10 ms (0 = pas de note : souffle, consonne, silence)
    async function trackPitch(x, sr, onProgress, voice) {
        const [fMin, fMax] = VOICE_RANGE[voice] || [F_MIN, F_MAX];
        // Copie allégée (~16 kHz) : la détection n'a pas besoin des aigus
        const D = Math.max(1, Math.round(sr / 16000));
        const sr2 = sr / D;
        const n2 = Math.floor(x.length / D);
        const y = new Float32Array(n2);
        for (let i = 0; i < n2; i++) {
            let s = 0;
            for (let k = 0; k < D; k++) s += x[i * D + k];
            y[i] = s / D;
        }
        const W = Math.round(0.03 * sr2);
        const tauMin = Math.floor(sr2 / fMax), tauMax = Math.ceil(sr2 / fMin);
        const hop = Math.round(HOP_SEC * sr2);
        const frames = Math.max(0, Math.floor((n2 - W - tauMax) / hop));
        const f0 = new Float32Array(Math.ceil(x.length / (HOP_SEC * sr)) + 1);
        const d = new Float32Array(tauMax + 2);

        for (let f = 0; f < frames; f++) {
            const a = f * hop;
            let energy = 0;
            for (let j = 0; j < W; j++) energy += y[a + j] * y[a + j];
            if (energy / W < 1e-6) continue; // silence

            // Fonction de différence normalisée (YIN)
            let run = 0, best = -1;
            d[0] = 1;
            for (let tau = 1; tau <= tauMax + 1; tau++) {
                let sum = 0;
                for (let j = 0; j < W; j++) { const v = y[a + j] - y[a + j + tau]; sum += v * v; }
                run += sum;
                d[tau] = run > 0 ? sum * tau / run : 1;
            }
            for (let tau = tauMin; tau <= tauMax; tau++) {
                if (d[tau] < 0.15) {
                    while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
                    best = tau;
                    break;
                }
            }
            if (best < 0) {
                // Pas de creux franc : on prend le meilleur s'il reste crédible
                let m = tauMin;
                for (let tau = tauMin; tau <= tauMax; tau++) if (d[tau] < d[m]) m = tau;
                if (d[m] < 0.3) best = m;
            }
            if (best > 0) {
                // Affinage parabolique
                const p = d[best - 1], q = d[best], r = d[best + 1];
                const den = p - 2 * q + r;
                const shift = den !== 0 ? 0.5 * (p - r) / den : 0;
                const centerSec = (a + W / 2) / sr2;
                const idx = Math.round(centerSec / HOP_SEC);
                if (idx < f0.length) f0[idx] = sr2 / (best + Math.max(-1, Math.min(1, shift)));
            }
            if (f % 150 === 0) { if (onProgress) onProgress(0.7 * f / frames); await tick(); }
        }

        // Filtre médian (5 points) : supprime les sauts d'octave isolés
        const out = new Float32Array(f0.length);
        const win = [];
        for (let i = 0; i < f0.length; i++) {
            win.length = 0;
            for (let k = -2; k <= 2; k++) { const v = f0[i + k]; if (v > 0) win.push(v); }
            if (f0[i] > 0 && win.length >= 3) { win.sort((p, q) => p - q); out[i] = win[win.length >> 1]; }
            else out[i] = win.length >= 4 ? win.sort((p, q) => p - q)[win.length >> 1] : f0[i];
        }
        return out;
    }

    const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
    const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // --- Tonalité devinée d'après les notes chantées (majeur et son relatif mineur partagent les mêmes notes)
    function detectKey(f0) {
        const hist = new Float32Array(12);
        for (let i = 0; i < f0.length; i++) {
            if (f0[i] <= 0) continue;
            const m = hzToMidi(f0[i]);
            const pc = ((Math.round(m) % 12) + 12) % 12;
            hist[pc] += 1 - Math.min(0.5, Math.abs(m - Math.round(m))); // une note tenue juste pèse plus
        }
        let bestRoot = 0, bestScore = -1;
        for (let root = 0; root < 12; root++) {
            let s = 0;
            for (const iv of MAJOR) s += hist[(root + iv) % 12];
            s += 0.5 * hist[root] + 0.3 * hist[(root + 9) % 12]; // tonique majeure / mineure relative
            if (s > bestScore) { bestScore = s; bestRoot = root; }
        }
        return bestRoot;
    }

    function keyLabel(root) {
        return `${NOTE_NAMES[root]} majeur / ${NOTE_NAMES[(root + 9) % 12]} mineur`;
    }

    // Notes autorisées : tableau de 12 cases (Do, Do#, … Si), vrai = la voix a le droit de s'y poser.
    // On accepte aussi l'ancienne forme : 0-11 = gamme majeure de cette note, -1 = toutes les notes.
    function toMask(rootOrMask) {
        if (Array.isArray(rootOrMask)) {
            const m = Array.from({ length: 12 }, (_, i) => !!rootOrMask[i]);
            return m.some(Boolean) ? m : new Array(12).fill(true);
        }
        if (rootOrMask < 0) return new Array(12).fill(true);
        return Array.from({ length: 12 }, (_, pc) => MAJOR.includes((((pc - rootOrMask) % 12) + 12) % 12));
    }

    // Note juste la plus proche parmi les notes autorisées
    function snapMidi(m, mask) {
        let best = Math.round(m), bestDist = Infinity;
        const base = Math.floor(m) - 6;
        for (let c = base; c <= base + 13; c++) {
            if (!mask[((c % 12) + 12) % 12]) continue;
            const dist = Math.abs(c - m);
            if (dist < bestDist) { bestDist = dist; best = c; }
        }
        return best;
    }

    // --- Gamme lue sur l'instru (et pas sur la voix : c'est elle qui chante faux, pas la prod)
    // On mesure combien chaque note (Do, Do#, …) est présente dans la musique, puis on compare aux 24 gammes.
    const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < len / 2; k++) {
                    const a = i + k, b = a + len / 2;
                    const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
                    const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                }
            }
        }
    }

    // Présence de chacune des 12 notes dans un morceau (somme normalisée à 1)
    async function chroma(x, sr, maxSec = 90) {
        const D = Math.max(1, Math.round(sr / 11025)), sr2 = sr / D;
        // On saute l'intro (souvent sans basse ni accords) quand le morceau est assez long
        const total = Math.floor(x.length / D);
        const want = Math.min(total, Math.floor(maxSec * sr2));
        const from = Math.max(0, Math.min(total - want, Math.floor(total * 0.15)));
        const N = 8192, hop = 4096;
        const win = new Float32Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        // Chaque case de fréquence utile → sa note (on ignore ce qui tombe entre deux notes)
        const binPc = new Int8Array(N / 2).fill(-1);
        for (let k = 1; k < N / 2; k++) {
            const f = k * sr2 / N;
            if (f < 60 || f > 2000) continue;
            const m = hzToMidi(f);
            if (Math.abs(m - Math.round(m)) < 0.35) binPc[k] = ((Math.round(m) % 12) + 12) % 12;
        }
        const out = new Float64Array(12), re = new Float32Array(N), im = new Float32Array(N), fr = new Float64Array(12);
        let frames = 0;
        for (let a = from; a + N <= from + want; a += hop) {
            for (let i = 0; i < N; i++) {
                let v = 0; const p = (a + i) * D;
                for (let k = 0; k < D; k++) v += x[p + k];
                re[i] = v / D * win[i]; im[i] = 0;
            }
            fft(re, im);
            fr.fill(0);
            let sum = 0;
            for (let k = 1; k < N / 2; k++) {
                if (binPc[k] < 0) continue;
                const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
                fr[binPc[k]] += mag; sum += mag;
            }
            if (sum > 1e-3) { for (let i = 0; i < 12; i++) out[i] += fr[i] / sum; frames++; } // chaque instant pèse pareil
            if (frames % 20 === 0) await tick();
        }
        if (!frames) return null;
        for (let i = 0; i < 12; i++) out[i] /= frames;
        return out;
    }

    function corr(a, b, shift) {
        let ma = 0, mb = 0;
        for (let i = 0; i < 12; i++) { ma += a[(i + shift) % 12]; mb += b[i]; }
        ma /= 12; mb /= 12;
        let num = 0, da = 0, db = 0;
        for (let i = 0; i < 12; i++) {
            const u = a[(i + shift) % 12] - ma, v = b[i] - mb;
            num += u * v; da += u * u; db += v * v;
        }
        return da && db ? num / Math.sqrt(da * db) : 0;
    }

    // Retourne { tonic, minor, notes (12 cases), confidence 0-1 } ou null si rien d'exploitable (silence, batterie seule)
    async function detectKeyFromMusic(x, sr) {
        const ch = await chroma(x, sr);
        if (!ch) return null;
        const scores = [];
        for (let t = 0; t < 12; t++) {
            scores.push({ tonic: t, minor: false, s: corr(ch, KS_MAJOR, t) });
            scores.push({ tonic: t, minor: true, s: corr(ch, KS_MINOR, t) });
        }
        scores.sort((p, q) => q.s - p.s);
        const best = scores[0];
        const majorRoot = best.minor ? (best.tonic + 3) % 12 : best.tonic;
        // Confiance : écart avec la meilleure gamme qui n'utilise pas les mêmes notes
        const other = scores.find(k => (k.minor ? (k.tonic + 3) % 12 : k.tonic) !== majorRoot);
        const confidence = Math.max(0, Math.min(1, (best.s - (other ? other.s : 0)) * 4)) * (best.s > 0.4 ? 1 : 0.4);
        return { tonic: best.tonic, minor: best.minor, notes: toMask(majorRoot), confidence };
    }

    function scaleName(tonic, minor) { return `${NOTE_NAMES[tonic]} ${minor ? 'mineur' : 'majeur'}`; }

    // --- 2. Correction voulue à chaque instant, en rapport de fréquence (1 = on ne touche pas)
    // strength : 0 = très naturel (la correction glisse doucement) … 1 = effet robot (saut immédiat)
    // more (0 à 1, facultatifs) : humain = les notes tenues sont corrigées plus doucement (elles restent vivantes),
    // souplesse = on ne corrige que quand la voix est déjà près de la note, vibrato = garde le vibrato de la voix.
    function correctionCurve(f0, root, strength, more = {}) {
        const ratio = new Float32Array(f0.length).fill(1);
        const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));
        const human = clamp01(more.human), flex = clamp01(more.flex), vib = clamp01(more.vibrato);
        const tau = Math.pow(1 - Math.max(0, Math.min(1, strength)), 2) * 0.25; // temps de glissement (s)
        const alphaOf = (t) => t <= 0.0005 ? 1 : 1 - Math.exp(-HOP_SEC / t);
        const alpha = alphaOf(tau);
        root = toMask(root);
        // Tendance de la note (moyenne sur ~150 ms) : ce qui dépasse autour, c'est le vibrato
        const midi = new Float32Array(f0.length), trend = new Float32Array(f0.length);
        for (let i = 0; i < f0.length; i++) midi[i] = f0[i] > 0 ? hzToMidi(f0[i]) : 0;
        if (vib > 0) for (let i = 0; i < f0.length; i++) {
            if (f0[i] <= 0) continue;
            let s = 0, k = 0; for (let j = i - 7; j <= i + 7; j++) if (j >= 0 && j < f0.length && f0[j] > 0) { s += midi[j]; k++; }
            trend[i] = s / k;
        }
        let cur = 0, sumAbs = 0, voiced = 0, lastTarget = null, held = 0;
        for (let i = 0; i < f0.length; i++) {
            if (f0[i] <= 0) { ratio[i] = 1; held = 0; continue; }
            const m = midi[i], base = vib > 0 ? trend[i] : m;
            // Hystérésis : on ne change de note cible que si on s'en éloigne franchement (évite le gargouillis)
            let target = snapMidi(base, root);
            if (lastTarget !== null && target !== lastTarget && Math.abs(base - lastTarget) < 0.62 && snapMidi(lastTarget, root) === lastTarget) target = lastTarget;
            held = target === lastTarget ? held + 1 : 0;
            lastTarget = target;
            // Vibrato : la note visée suit le vibrato de la voix (0 = corrigé à plat comme avant, 1 = gardé entier)
            let want = target + vib * (m - base) - m;          // demi-tons
            // Souplesse : loin de la note (plus d'un demi-ton près), on laisse la voix libre
            if (flex > 0) { const d = Math.abs(target - base), win = 0.5 * (1 - flex) + 0.02; if (d > win) want *= Math.max(0, 1 - (d - win) / 0.15); }
            // Humain : plus la note dure, plus la correction ralentit (jusqu'à +0,35 s de glissement)
            const a = human > 0 ? alphaOf(tau + human * 0.35 * Math.min(1, held * HOP_SEC / 0.4)) : alpha;
            cur += (want - cur) * a;
            ratio[i] = Math.pow(2, cur / 12);
            sumAbs += Math.abs(cur); voiced++;
        }
        return { ratio, voicedPct: f0.length ? voiced / f0.length : 0, avgCents: voiced ? 100 * sumAbs / voiced : 0 };
    }

    // --- 3. Recalage période par période (TD-PSOLA)
    function psola(x, sr, f0, ratio) {
        const n = x.length;
        const y = new Float32Array(n);
        const hopS = HOP_SEC * sr;
        const UNVOICED_T = Math.round(0.005 * sr);
        const f0At = (pos) => { const i = Math.min(f0.length - 1, Math.max(0, Math.round(pos / hopS))); return f0[i]; };
        const ratioAt = (pos) => { const i = Math.min(ratio.length - 1, Math.max(0, Math.round(pos / hopS))); return ratio[i]; };

        // Repères d'analyse : un par période, calé sur le pic local de l'onde
        const marks = [], periods = [], isVoiced = [];
        let pos = 0;
        while (pos < n) {
            const f = f0At(pos);
            if (f > 0) {
                const T = Math.max(8, Math.round(sr / f));
                const from = Math.max(0, Math.round(pos - 0.3 * T)), to = Math.min(n - 1, Math.round(pos + 0.3 * T));
                let peak = from;
                for (let k = from; k <= to; k++) if (x[k] > x[peak]) peak = k;
                if (marks.length && peak <= marks[marks.length - 1]) peak = Math.round(pos);
                marks.push(peak); periods.push(T); isVoiced.push(true);
                pos = peak + T;
            } else {
                marks.push(Math.round(pos)); periods.push(UNVOICED_T); isVoiced.push(false);
                pos += UNVOICED_T;
            }
        }
        if (!marks.length) return x.slice();

        // Synthèse : on rejoue les périodes au nouvel écartement
        let ts = 0, a = 0;
        while (ts < n) {
            while (a + 1 < marks.length && Math.abs(marks[a + 1] - ts) <= Math.abs(marks[a] - ts)) a++;
            const T = periods[a];
            const r = isVoiced[a] ? Math.max(0.5, Math.min(2, ratioAt(ts))) : 1;
            const m = marks[a];
            const center = Math.round(ts);
            const g = 1 / r; // plus de recouvrement quand on monte → on compense le volume
            for (let k = -T; k <= T; k++) {
                const si = m + k, di = center + k;
                if (si < 0 || si >= n || di < 0 || di >= n) continue;
                y[di] += x[si] * (0.5 + 0.5 * Math.cos(Math.PI * k / T)) * g;
            }
            ts += T / r;
        }
        return y;
    }

    // opts : { notes: 12 cases vrai/faux | root: 'auto' | -1 (toutes les notes) | 0-11, strength: 0-1 }
    // channels : tableau de Float32Array (même longueur). Retourne { channels, root, voicedPct, avgCents }.
    async function process(channels, sr, opts = {}, onProgress) {
        const n = channels[0].length;
        let mono = channels[0];
        if (channels.length > 1) {
            mono = new Float32Array(n);
            for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
        }
        const f0 = await trackPitch(mono, sr, onProgress, opts.voice);
        // opts.notes (12 cases, choisies au clavier ou lues sur l'instru) passe avant tout
        const root = opts.notes ? null : (opts.root === 'auto' || opts.root === undefined ? detectKey(f0) : opts.root);
        const { ratio, voicedPct, avgCents } = correctionCurve(f0, opts.notes || root, opts.strength ?? 1, { human: opts.human, flex: opts.flex, vibrato: opts.vibrato });
        const out = [];
        for (let c = 0; c < channels.length; c++) {
            out.push(psola(channels[c], sr, f0, ratio));
            if (onProgress) onProgress(0.7 + 0.3 * (c + 1) / channels.length);
            await tick();
        }
        return { channels: out, root, voicedPct, avgCents };
    }

    root.PulseTune = { process, trackPitch, detectKey, detectKeyFromMusic, chroma, toMask, scaleName, correctionCurve, psola, keyLabel, NOTE_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
