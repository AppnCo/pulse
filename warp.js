// === Pulse — Warp (caler un son sur le tempo du projet, sans changer sa hauteur) ===
// Étirement temporel WSOLA : on rejoint des fenêtres de l'original (Hann, 50 % de recouvrement) en cherchant,
// pour chacune, l'endroit proche où la forme d'onde se raccorde au mieux à la précédente.
// DSP pur (Float32Array), sans dépendance : tourne dans le navigateur comme dans Node (tests).

(function(root) {
    const tick = () => new Promise(r => setTimeout(r, 0));

    // ratio = durée de sortie / durée d'entrée (0,75 : le son devient plus rapide, 1,25 : plus lent)
    async function stretch(channels, sr, ratio, onProgress, opts = {}) {
        const nCh = channels.length, len = channels[0].length;
        const N = opts.N || Math.max(512, 1 << Math.round(Math.log2(sr * 0.043)));    // ≈ 43 ms (2048 à 48 kHz)
        // Pas de synthèse : jamais plus grand que la moitié de la fenêtre, et assez court pour que les fenêtres
        // d'entrée se recouvrent d'au moins 50 % (sinon une attaque tombe entre deux fenêtres et s'affaiblit)
        const Hs = Math.max(1, Math.round((N >> 1) * Math.min(1, ratio)));
        const Ha = Hs / ratio;                                               // pas d'analyse idéal
        const D = Math.round(N * 0.19);                                      // tolérance de recherche (± ≈ 8 ms)
        const DEC = 4;                                                       // recherche sur une version allégée
        const outLen = Math.max(1, Math.round(len * ratio));
        const out = channels.map(() => new Float32Array(outLen + N * 2));
        const wsum = new Float32Array(outLen + N * 2);                       // somme des fenêtres : sert à normaliser
        const win = new Float32Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

        // Mono allégé pour la recherche du meilleur raccord
        const m = Math.floor(len / DEC);
        const mono = new Float32Array(m);
        for (let i = 0; i < m; i++) {
            let s = 0;
            for (let c = 0; c < nCh; c++) { const x = channels[c]; for (let k = 0; k < DEC; k++) s += x[i * DEC + k] || 0; }
            mono[i] = s / (nCh * DEC);
        }
        const get = (c, i) => (i >= 0 && i < len ? channels[c][i] : 0);

        const frames = Math.ceil(outLen / Hs) + 1;
        let prevPos = 0;                                                     // position choisie de la fenêtre précédente (entrée)
        const NL = N / DEC;                                                  // longueur de comparaison (allégée)
        let lastYield = Date.now();

        for (let k = 0; k < frames; k++) {
            let pos;
            if (k === 0) pos = 0;
            else {
                const target = Math.round(k * Ha);
                // Ce que la fenêtre précédente aurait « naturellement » enchaîné
                const ref = Math.round((prevPos + Hs) / DEC);
                let best = -Infinity, bestPos = target;
                const dLo = Math.max(-D, -target), dHi = D;
                for (let d = dLo; d <= dHi; d += DEC) {
                    const cand = Math.round((target + d) / DEC);
                    if (cand < 0 || cand + NL >= m || ref + NL >= m) continue;
                    let num = 0, e1 = 0, e2 = 0;
                    for (let i = 0; i < NL; i += 2) {
                        const a = mono[ref + i], b = mono[cand + i];
                        num += a * b; e1 += a * a; e2 += b * b;
                    }
                    const sc = num / Math.sqrt(e1 * e2 + 1e-9);
                    if (sc > best) { best = sc; bestPos = target + d; }
                }
                pos = bestPos;
                // Affinage à la résolution pleine autour du meilleur choix
                if (best > -Infinity) {
                    const refFull = prevPos + Hs;
                    let b2 = -Infinity, p2 = pos;
                    for (let d = -DEC; d <= DEC; d++) {
                        const cand = pos + d;
                        if (cand < 0) continue;
                        let num = 0, e1 = 0, e2 = 0;
                        for (let i = 0; i < N; i += 8) {
                            const a = get(0, refFull + i), b = get(0, cand + i);
                            num += a * b; e1 += a * a; e2 += b * b;
                        }
                        const sc = num / Math.sqrt(e1 * e2 + 1e-9);
                        if (sc > b2) { b2 = sc; p2 = cand; }
                    }
                    pos = p2;
                }
            }
            const o = k * Hs;
            for (let i = 0; i < N; i++) wsum[o + i] += win[i];
            for (let c = 0; c < nCh; c++) {
                const dst = out[c], src = channels[c];
                for (let i = 0; i < N; i++) {
                    const si = pos + i;
                    if (si >= 0 && si < len) dst[o + i] += src[si] * win[i];
                }
            }
            prevPos = pos;
            if (Date.now() - lastYield > 25) {
                lastYield = Date.now();
                if (onProgress) onProgress(k / frames);
                await tick();
            }
        }
        for (const o of out) for (let i = 0; i < outLen; i++) { const w = wsum[i]; if (w > 1e-3) o[i] /= w; }
        return out.map(o => o.subarray(0, outLen));
    }

    // Pas de BPM fiable ? On valide la demande avant de calculer
    function checkRatio(srcBpm, targetBpm) {
        if (!(srcBpm >= 30 && srcBpm <= 300) || !(targetBpm >= 30 && targetBpm <= 300)) return { ok: false, why: 'tempo hors limites' };
        const ratio = srcBpm / targetBpm;
        if (ratio < 0.5 || ratio > 2) return { ok: false, why: 'écart trop grand', ratio };
        return { ok: true, ratio, big: ratio < 0.75 || ratio > 1.33 };
    }

    root.PulseWarp = { stretch, checkRatio };
})(typeof window !== 'undefined' ? window : globalThis);
