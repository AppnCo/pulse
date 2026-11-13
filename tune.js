// === Pulse — Auto-Tune (correction de justesse après la prise) ===
// 1. On suit la note chantée (algorithme YIN, sur une copie allégée du signal)
// 2. On choisit la note juste la plus proche dans la gamme
// 3. On recale la voix période par période (TD-PSOLA) : la durée ne change pas, le timbre reste naturel
// DSP pur (Float32Array), sans dépendance : tourne dans le navigateur comme dans Node (tests).

(function(root) {
    const HOP_SEC = 0.005;         // une mesure de note toutes les 5 ms
    const F_MIN = 70, F_MAX = 800; // étendue d'une voix (Hz)
    // Type de voix : où chercher la note (évite de confondre une voix grave avec son octave, etc.)
    const VOICE_RANGE = { high: [150, 1100], mid: [70, 800], low: [50, 450] };
    const MAJOR = [0, 2, 4, 5, 7, 9, 11];
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']   // notation anglaise, comme dans les plugins;

    const tick = () => new Promise(r => setTimeout(r, 0));

    // --- 1. Suivi de la note : f0[i] en Hz toutes les 5 ms (0 = pas de note : souffle, consonne, silence)
    // À chaque instant on garde PLUSIEURS notes possibles (creux de la fonction YIN), puis on choisit le chemin
    // le plus régulier sur toute la prise (Viterbi) : plus de saut d'octave ni de trou d'une trame au milieu d'une note.
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
        const tauMin = Math.max(2, Math.floor(sr2 / fMax)), tauMax = Math.ceil(sr2 / fMin);
        const nF = Math.ceil(x.length / (HOP_SEC * sr)) + 1;
        const f0 = new Float32Array(nF);
        const d = new Float32Array(tauMax + 2);
        const K = 6;                                   // notes possibles gardées par trame
        const candF = new Float32Array(nF * K), candC = new Float32Array(nF * K), candN = new Uint8Array(nF);
        const half = (W + tauMax + 1) >> 1;
        const lg = Math.log2;

        for (let f = 0; f < nF; f++) {
            const a = Math.round(f * HOP_SEC * sr2) - half;   // fenêtre centrée sur l'instant f
            if (a < 0 || a + W + tauMax + 1 >= n2) continue;
            let energy = 0;
            for (let j = 0; j < W; j++) energy += y[a + j] * y[a + j];
            if (energy / W < 1e-6) continue; // silence

            // Fonction de différence normalisée (YIN)
            let run = 0;
            d[0] = 1;
            for (let tau = 1; tau <= tauMax + 1; tau++) {
                let sum = 0;
                for (let j = 0; j < W; j++) { const v = y[a + j] - y[a + j + tau]; sum += v * v; }
                run += sum;
                d[tau] = run > 0 ? sum * tau / run : 1;
            }
            // Tous les creux crédibles
            let nc = 0;
            for (let tau = Math.max(2, tauMin); tau <= tauMax; tau++) {
                if (d[tau] >= 0.5 || d[tau] > d[tau - 1] || d[tau] >= d[tau + 1]) continue;
                const p = d[tau - 1], q = d[tau], r = d[tau + 1], den = p - 2 * q + r;
                const shift = den !== 0 ? Math.max(-1, Math.min(1, 0.5 * (p - r) / den)) : 0;
                const hz = sr2 / (tau + shift);
                // À qualité égale on préfère la période courte (sinon on tombe une octave trop bas)
                const cost = q + 0.03 * lg(tau / tauMin);
                let slot = nc < K ? nc++ : -1;
                if (slot < 0) { let w = 0; for (let k = 1; k < K; k++) if (candC[f * K + k] > candC[f * K + w]) w = k; if (candC[f * K + w] > cost) slot = w; }
                if (slot >= 0) { candF[f * K + slot] = hz; candC[f * K + slot] = cost; }
            }
            candN[f] = nc;
            if (f % 300 === 0) { if (onProgress) onProgress(0.7 * f / nF); await tick(); }
        }

        // Chemin le plus régulier : état K = « pas de note »
        const UNV = 0.22, SWITCH = 0.14, JUMP = 0.7;
        const S = K + 1, INF = 1e9;
        let prev = new Float64Array(S).fill(INF), cur = new Float64Array(S);
        prev[K] = 0;
        const back = new Uint8Array(nF * S);
        for (let f = 0; f < nF; f++) {
            const nc = candN[f];
            for (let s = 0; s < S; s++) {
                if (s < K && s >= nc) { cur[s] = INF; continue; }
                const em = s === K ? UNV : candC[f * K + s];
                let best = INF, arg = K;
                const np = f ? candN[f - 1] : 0;
                for (let q = 0; q < S; q++) {
                    if (q < K && q >= np) continue;
                    let tr;
                    if (s === K) tr = q === K ? 0 : SWITCH;
                    else if (q === K) tr = SWITCH;
                    else tr = Math.min(1, JUMP * Math.abs(lg(candF[f * K + s] / candF[(f - 1) * K + q])));
                    const c = prev[q] + tr;
                    if (c < best) { best = c; arg = q; }
                }
                cur[s] = best + em; back[f * S + s] = arg;
            }
            const t = prev; prev = cur; cur = t;
        }
        let s = 0;
        for (let q = 1; q < S; q++) if (prev[q] < prev[s]) s = q;
        for (let f = nF - 1; f >= 0; f--) { f0[f] = s === K ? 0 : candF[f * K + s]; s = back[f * S + s]; }
        return f0;
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
        const N = f0.length, midi = new Float32Array(N), trend = new Float32Array(N), steady = new Float32Array(N);
        for (let i = 0; i < N; i++) midi[i] = f0[i] > 0 ? hzToMidi(f0[i]) : 0;
        // Tendance de la note (moyenne sur ~150 ms) : ce qui dépasse autour, c'est le vibrato
        const TR = Math.round(0.075 / HOP_SEC), ST = Math.round(0.03 / HOP_SEC);
        const tmp = [];
        for (let i = 0; i < N; i++) {
            if (f0[i] <= 0) continue;
            if (vib > 0) { let s = 0, k = 0; for (let j = i - TR; j <= i + TR; j++) if (j >= 0 && j < N && f0[j] > 0) { s += midi[j]; k++; } trend[i] = s / k; }
            // Hauteur « posée » (médiane sur 60 ms) : c'est elle qui choisit la note, pas un écart d'un instant
            tmp.length = 0;
            for (let j = i - ST; j <= i + ST; j++) if (j >= 0 && j < N && f0[j] > 0) tmp.push(midi[j]);
            tmp.sort((p, q) => p - q); steady[i] = tmp[tmp.length >> 1];
        }
        const GAP = Math.round(0.06 / HOP_SEC);   // au-delà de 60 ms sans note, c'est une nouvelle note : la correction repart de zéro
        // Notes posées à la main dans le graphique : [{ t0, t1 (secondes), note (demi-tons MIDI) }] — elles passent avant la gamme
        const force = new Float32Array(N).fill(NaN);
        for (const e of (more.edits || [])) {
            if (!e || !Number.isFinite(e.note)) continue;
            const a = Math.max(0, Math.round(e.t0 / HOP_SEC)), b = Math.min(N, Math.round(e.t1 / HOP_SEC));
            for (let i = a; i < b; i++) force[i] = e.note;
        }
        // Les notes trouvées (un bloc par note tenue) : pour le graphique
        const notes = []; let seg = null;
        const closeSeg = () => { if (seg) { notes.push(seg); seg = null; } };
        let cur = 0, sumAbs = 0, voiced = 0, lastTarget = null, held = 0, gap = GAP + 1;
        for (let i = 0; i < N; i++) {
            if (f0[i] <= 0) { ratio[i] = 1; gap++; if (gap > GAP) { held = 0; lastTarget = null; closeSeg(); } continue; }
            if (gap > GAP) cur = 0;
            gap = 0;
            const m = midi[i], base = vib > 0 ? trend[i] : m, pick = vib > 0 ? trend[i] : steady[i];
            // Hystérésis : on ne change de note cible que si on s'en éloigne franchement (évite le gargouillis)
            let target = snapMidi(pick, root);
            if (lastTarget !== null && target !== lastTarget && Math.abs(pick - lastTarget) < 0.62 && snapMidi(lastTarget, root) === lastTarget) target = lastTarget;
            const forced = force[i] === force[i];
            if (forced) target = force[i];
            held = target === lastTarget ? held + 1 : 0;
            lastTarget = target;
            if (seg && seg.note === target && seg.forced === forced) seg.i1 = i; else { closeSeg(); seg = { i0: i, i1: i, note: target, forced }; }
            // Vibrato : la note visée suit le vibrato de la voix (0 = corrigé à plat comme avant, 1 = gardé entier)
            let want = target + vib * (m - base) - m;          // demi-tons
            // Souplesse : loin de la note (plus d'un demi-ton près), on laisse la voix libre
            if (flex > 0 && !forced) { const d = Math.abs(target - base), win = 0.5 * (1 - flex) + 0.02; if (d > win) want *= Math.max(0, 1 - (d - win) / 0.15); }
            // Humain : plus la note dure, plus la correction ralentit (jusqu'à +0,35 s de glissement)
            const a = human > 0 ? alphaOf(tau + human * 0.35 * Math.min(1, held * HOP_SEC / 0.4)) : alpha;
            cur += (want - cur) * a;
            ratio[i] = Math.pow(2, cur / 12);
            sumAbs += Math.abs(cur); voiced++;
        }
        closeSeg();
        return { ratio, notes, voicedPct: N ? voiced / N : 0, avgCents: voiced ? 100 * sumAbs / voiced : 0 };
    }

    // --- 3. Recalage période par période (TD-PSOLA)
    // Repères : un par période de la voix. On les pose en comparant chaque période à la précédente (corrélation),
    // pas sur « le pic le plus haut » : deux pics voisins de même hauteur faisaient sauter le repère → voix rauque.
    // Les repères se calculent une fois (sur le mono) et servent aux deux canaux : la stéréo reste en phase.
    function pitchMarks(x, sr, f0) {
        const n = x.length, hopS = HOP_SEC * sr, U = Math.round(0.005 * sr);
        const nF = f0.length;
        const f0At = (pos) => {
            const t = pos / hopS, i = Math.max(0, Math.min(nF - 1, Math.floor(t))), j = Math.min(nF - 1, i + 1), u = t - i;
            const a = f0[i], b = f0[j];
            if (a > 0 && b > 0) return a * Math.pow(b / a, Math.max(0, Math.min(1, u)));
            return u < 0.5 ? a : b;
        };
        const marks = [], voiced = [];
        const seg = [];
        const corrAt = (m, c, h) => {       // ressemblance entre la période autour de m et celle autour de c
            let ab = 0, aa = 0, bb = 0;
            for (let k = -h; k <= h; k++) { const u = x[m + k] || 0, v = x[c + k] || 0; ab += u * v; aa += u * u; bb += v * v; }
            return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
        };
        const step = (m, dir) => {          // repère suivant (dir = 1) ou précédent (dir = -1)
            const f = f0At(m); if (!(f > 0)) return -1;
            let T = sr / f;
            const f2 = f0At(m + dir * T); if (f2 > 0) T = 0.5 * (T + sr / f2);
            const h = Math.max(4, Math.round(T / 2)), lo = Math.round(0.8 * T), hi = Math.round(1.2 * T);
            let best = Math.round(T), bc = -2;
            for (let L = lo; L <= hi; L++) {
                const c = m + dir * L; if (c - h < 0 || c + h >= n) continue;
                const v = corrAt(m, c, h) - 0.25 * Math.abs(L - T) / T;   // à ressemblance égale, on reste près de la période mesurée
                if (v > bc) { bc = v; best = L; }
            }
            return m + dir * (bc > 0.3 ? best : Math.round(T));
        };
        let pos = 0;
        while (pos < n) {
            if (!(f0At(pos) > 0)) { marks.push(pos); voiced.push(false); pos += U; continue; }
            // Passage chanté : de pos jusqu'à la fin de la note
            let end = pos;
            while (end < n && f0At(end) > 0) end += Math.max(1, Math.round(hopS / 2));
            end = Math.min(n, end);
            // Départ : le plus grand pic de la partie la plus forte du passage
            let pk = pos, pv = 0, sgn = 1;
            for (let k = pos; k < end; k++) { const v = Math.abs(x[k]); if (v > pv) { pv = v; pk = k; sgn = x[k] < 0 ? -1 : 1; } }
            seg.length = 0; seg.push(pk);
            for (let m = pk; ;) { const c = step(m, 1); if (c < 0 || c >= end || c <= m) break; seg.push(c); m = c; }
            for (let m = pk; ;) { const c = step(m, -1); if (c < 0 || c < pos || c >= m) break; seg.unshift(c); m = c; }
            // Raccord avec ce qui précède : pas de repère collé au précédent
            const last = marks.length ? marks[marks.length - 1] : -1e9;
            for (const m of seg) if (m - last >= 8 && (!marks.length || m > marks[marks.length - 1])) { marks.push(m); voiced.push(true); }
            const T = sr / (f0At(seg[seg.length - 1]) || 200);
            pos = Math.max(pos + 1, Math.round(seg[seg.length - 1] + T));
        }
        return { marks, voiced };
    }

    function psola(x, sr, f0, ratio, pm) {
        const n = x.length;
        const y = new Float32Array(n);
        const hopS = HOP_SEC * sr;
        const { marks, voiced } = pm || pitchMarks(x, sr, f0);
        const M = marks.length;
        if (!M) return x.slice();
        const ratioAt = (pos) => {        // correction lissée entre deux mesures (pas d'escalier toutes les 5 ms)
            const t = pos / hopS, i = Math.max(0, Math.min(ratio.length - 1, Math.floor(t))), j = Math.min(ratio.length - 1, i + 1);
            return ratio[i] + (ratio[j] - ratio[i]) * Math.max(0, Math.min(1, t - i));
        };
        const U = Math.round(0.005 * sr);
        const left = (a) => a > 0 ? marks[a] - marks[a - 1] : U, right = (a) => a + 1 < M ? marks[a + 1] - marks[a] : U;
        // Synthèse : on rejoue les périodes au nouvel écartement
        let ts = marks[0], a = 0;
        // avant le premier repère : copie
        for (let i = 0; i < Math.min(n, marks[0]); i++) y[i] = x[i];
        let first = true;
        while (ts < n && a < M) {
            while (a + 1 < M && Math.abs(marks[a + 1] - ts) < Math.abs(marks[a] - ts)) a++;
            let r = 1, center = Math.round(ts);
            if (voiced[a]) r = Math.max(0.5, Math.min(2, ratioAt(ts)));
            else { center = marks[a]; }     // souffle, consonne : remis exactement à sa place, sans y toucher
            const m = marks[a], Tl = left(a), Tr = right(a);
            const g = r > 1 ? 1 / r : 1;    // plus de recouvrement quand on monte → on compense le volume
            const k0 = first ? 0 : -Tl; first = false;
            for (let k = k0; k < Tr; k++) {
                const si = m + k, di = center + k;
                if (si < 0 || si >= n || di < 0 || di >= n) continue;
                const w = k < 0 ? 0.5 + 0.5 * Math.cos(Math.PI * k / Tl) : 0.5 + 0.5 * Math.cos(Math.PI * k / Tr);
                y[di] += x[si] * w * g;
            }
            if (voiced[a]) ts += Tr / r;
            else { ts = a + 1 < M ? marks[a + 1] : n; }
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
        const { ratio, notes, voicedPct, avgCents } = correctionCurve(f0, opts.notes || root, opts.strength ?? 1, { human: opts.human, flex: opts.flex, vibrato: opts.vibrato, edits: opts.edits });
        const pm = pitchMarks(mono, sr, f0);
        const out = [];
        for (let c = 0; c < channels.length; c++) {
            out.push(psola(channels[c], sr, f0, ratio, pm));
            if (onProgress) onProgress(0.7 + 0.3 * (c + 1) / channels.length);
            await tick();
        }
        return { channels: out, root, voicedPct, avgCents, f0, ratio, notes, hop: HOP_SEC };
    }

    root.PulseTune = { process, trackPitch, detectKey, detectKeyFromMusic, chroma, toMask, scaleName, correctionCurve, psola, pitchMarks, keyLabel, NOTE_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
