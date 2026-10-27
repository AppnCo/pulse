// === Pulse — Audio Engine (Web Audio API, v0.3 proto) ===
// Moteur temporaire web avant le passage à Tauri + Rust natif.
// Gère : init contexte, mic, enregistrement PCM sans perte, lecture multipiste, export.
// Lecture et export passent par le MÊME graphe (buildGraph) : ce qu'on entend = ce qu'on exporte.

window.PulseAudio = (function() {
    let ctx = null;
    let masterGain = null;
    let masterAnalyser = null;
    let masterVolume = 1.0; // fader master (100 = 0 dB affiché)
    // Marge interne : le fader à 0 dB laisse 1,9 dB de réserve avant le limiteur (réglages calibrés dessus, Rust compris)
    const MASTER_TRIM = 0.8;
    let micStream = null;
    let micSource = null;      // sortie « propre » du micro : l'entrée choisie de l'interface, en mono (tout le reste s'y branche)
    let micRaw = null, micSplit = null, micChannels = 1;
    let micAnalyser = null;
    let metronomeEnabled = false;
    let countInEnabled = true;
    let metroTimer = null;
    let metroNextTime = 0;
    let metroBeat = 0;
    let metroBpm = 120;

    // Enregistrement
    let recNode = null;             // AudioWorkletNode (PCM brut)
    let recSink = null;
    let recChunks = [];
    let recFirstFrameTime = -1;     // ctx.currentTime de la 1ère frame capturée
    let recSamples = 0;
    let recAlign = null;            // { c: temps contexte, p: position projet } de la lecture en cours au début de la capture
    let workletReady = null;
    let recorder = null;            // fallback MediaRecorder
    let recorderChunks = [];
    let recorderStartSec = 0;       // position playhead au début de l'enregistrement
    let recorderTargetIdx = -1;     // piste cible
    let recorderStartTs = 0;        // ctx.currentTime au début
    let progressTimer = null;

    // Lecture
    let activeSources = [];
    let activeGraph = [];   // tous les noeuds de la lecture en cours, débranchés à l'arrêt
    let activeOut = null;   // sortie (gain) du montage en cours, pour le fondu enchaîné quand on change un effet
    const fading = [];      // anciens montages en train de s'éteindre
    // Boucle sans trou : le tour suivant est monté ~250 ms avant la fin de boucle et démarre pile à la fin (fondu de 4 ms)
    let loopCfg = null, loopTimer = null, loopSwapTimer = null, loopNext = null, lastPlayProject = null;
    // Enregistrement en boucle : instants des tours (temps « linéaire » de la capture) et piste à taire à chaque tour
    let recWraps = [], recMute = null;
    let playbackStartCtxTime = 0;
    let playbackStartProjectTime = 0;
    let isPlaying = false;

    // Cache des AudioBuffers par clip.id
    const buffers = new Map();
    // --- Effets maison (tournent dans le fil audio, en lecture comme à l'export)
    // De-esser : on isole les aigus ; quand ils dominent la voix (un « S », un « CH »), on les baisse eux seuls.
    // Le seuil est relatif (aigus / voix entière) : ça marche pareil qu'on ait enregistré fort ou pas.
    const FX_WORKLET = `
        // Automation d'un réglage d'effet : la courbe arrive dans les options ({ réglage: [{ t, v }] }, valeurs déjà converties)
        // et l'effet la suit lui-même à chaque bloc de 128 échantillons, en lecture comme à l'export
        function pulseAutoAt(pts, t) {
            if (t <= pts[0].t) return pts[0].v;
            for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t); }
            return pts[pts.length - 1].v;
        }
        function pulseAuto(Cls, apply) {
            return class extends Cls {
                constructor(o) {
                    super(o);
                    const p = (o && o.processorOptions) || {};
                    this._ap = p; this._au = p.auto && Object.keys(p.auto).length ? p.auto : null;
                    // réglages en fréquence / temps : la courbe avance en octaves entre deux points (comme le moteur d'export)
                    if (this._au) for (const k of (p.autoLog || [])) if (this._au[k]) this._au[k] = this._au[k].map(q => ({ t: q.t, v: Math.log(Math.max(q.v, 1e-9)) }));
                    this._al = p.autoLog || [];
                    this._at0 = p.autoT0 || 0; this._af = p.autoFrom || 0;
                }
                process(i, o) {
                    if (this._au) { const t = currentTime - this._at0 + this._af, v = {}; for (const k in this._au) { const x = pulseAutoAt(this._au[k], t); v[k] = this._al.includes(k) ? Math.exp(x) : x; } apply(this, v); }
                    return super.process(i, o);
                }
            };
        }
        class PulseDeesser extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                const amount = Math.max(0, Math.min(100, p.amount || 0));
                this.maxRed = amount * 0.24;      // jusqu'à 24 dB de moins tout en haut du spectre
                this.slope = amount / 100 * 3;
                // Baisse appliquée : filtre 1er ordre une octave plus bas. « signal + aigu × (gain - 1) » donne
                // alors une vraie pente douce vers les aigus (shelf), sans trou ni déphasage audible.
                this.k = Math.exp(-2 * Math.PI * (p.freq || 5500) * 0.5 / sampleRate);
                this.lp = [];
                // Écoute (détection) : passe-haut 2e ordre, pour ne réagir qu'aux vraies sifflantes
                const w = 2 * Math.PI * (p.freq || 5500) / sampleRate, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
                this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0;
                this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
                this.z = [];
                this.envH = 0; this.envF = 0; this.gain = 1;
                this.att = 1 - Math.exp(-1 / (0.001 * sampleRate));
                this.rel = 1 - Math.exp(-1 / (0.060 * sampleRate));
                this.smooth = 1 - Math.exp(-1 / (0.002 * sampleRate));
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                while (this.z.length < nc) { this.z.push([0, 0, 0, 0]); this.lp.push(0); }
                for (let i = 0; i < n; i++) {
                    let pkH = 0, pkF = 0;
                    const hs = this._hs || (this._hs = [0, 0]);
                    for (let ch = 0; ch < nc; ch++) {
                        const x = inp[ch][i], z = this.z[ch];
                        const h = this.b0 * x + this.b1 * z[0] + this.b2 * z[1] - this.a1 * z[2] - this.a2 * z[3];
                        z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = h;
                        this.lp[ch] = x + (this.lp[ch] - x) * this.k;
                        hs[ch] = x - this.lp[ch];
                        const ah = h < 0 ? -h : h, af = x < 0 ? -x : x;
                        if (ah > pkH) pkH = ah;
                        if (af > pkF) pkF = af;
                    }
                    this.envH += (pkH - this.envH) * (pkH > this.envH ? this.att : this.rel);
                    this.envF += (pkF - this.envF) * (pkF > this.envF ? this.att : this.rel);
                    let target = 1;
                    if (this.envF > 0.001) {                       // sous -60 dB : on ne touche à rien
                        const r = this.envH / this.envF;
                        if (r > 0.35) {
                            const over = 20 * Math.log10(r / 0.35);
                            target = Math.pow(10, -Math.min(this.maxRed, over * this.slope) / 20);
                        }
                    }
                    this.gain += (target - this.gain) * this.smooth;
                    for (let ch = 0; ch < nc; ch++) out[ch][i] = inp[ch][i] + hs[ch] * (this.gain - 1);
                }
                return true;
            }
        }
        // De-esser « pro » (seuil, plage, zone des « s ») : même calcul que DeesserV2 dans engine/src/fx.rs.
        // Détection : passe-bande (coupe-bas à lo + coupe-haut à hi, 2e ordre). Voix seule = niveau des « s » ;
        // Tout-terrain = niveau des « s » par rapport à toute la voix. Séparé = on baisse seulement au-dessus de lo ; Large = toute la voix.
        class PulseDeesser2 extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                const biq = (hp, f) => { const w = 2 * Math.PI * f / sampleRate, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
                    return hp ? [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0] : [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0]; };
                this.lo = Math.max(1000, Math.min(16000, p.lo || 5000));
                this.hi = Math.max(this.lo * 1.2, Math.min(20000, sampleRate * 0.45, p.hi || 11000));
                this.khp = biq(true, this.lo); this.klp = biq(false, this.hi);
                this.thr = p.thr ?? -26; this.range = Math.max(0, Math.min(30, p.range ?? 10));
                this.wide = !!p.wide; this.rel = !!p.rel; this.listen = !!p.listen; this.live = !!p.live;
                this.k = Math.exp(-2 * Math.PI * this.lo * 0.5 / sampleRate);
                this.zh = []; this.zl = []; this.lp = [];
                this.envB = 0; this.envF = 0; this.gain = 1;
                this.att = 1 - Math.exp(-1 / (0.001 * sampleRate));
                this.relc = 1 - Math.exp(-1 / (0.060 * sampleRate));
                this.smooth = 1 - Math.exp(-1 / (0.002 * sampleRate));
                this.cnt = 0; this.mV = 0; this.mS = 0; this.mR = 0;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                while (this.zh.length < nc) { this.zh.push([0, 0, 0, 0]); this.zl.push([0, 0, 0, 0]); this.lp.push(0); }
                const band = this._b || (this._b = [0, 0]), hs = this._hs || (this._hs = [0, 0]);
                for (let i = 0; i < n; i++) {
                    let pkB = 0, pkF = 0;
                    for (let ch = 0; ch < nc; ch++) {
                        const x = inp[ch][i];
                        const h = biqRun(this.khp, this.zh[ch], x), b = biqRun(this.klp, this.zl[ch], h);
                        band[ch] = b;
                        this.lp[ch] = x + (this.lp[ch] - x) * this.k; hs[ch] = x - this.lp[ch];
                        const ab = b < 0 ? -b : b, af = x < 0 ? -x : x;
                        if (ab > pkB) pkB = ab; if (af > pkF) pkF = af;
                    }
                    this.envB += (pkB - this.envB) * (pkB > this.envB ? this.att : this.relc);
                    this.envF += (pkF - this.envF) * (pkF > this.envF ? this.att : this.relc);
                    let red = 0;
                    if (this.envF > 0.001) {
                        const det = 20 * Math.log10(Math.max(this.envB, 1e-9) / (this.rel ? this.envF : 1));
                        red = Math.max(0, Math.min(this.range, det - this.thr));
                    }
                    const target = Math.pow(10, -red / 20);
                    this.gain += (target - this.gain) * this.smooth;
                    for (let ch = 0; ch < nc; ch++) {
                        const x = inp[ch][i];
                        out[ch][i] = this.listen ? band[ch] : this.wide ? x * this.gain : x + hs[ch] * (this.gain - 1);
                    }
                    if (this.live) { if (pkF > this.mV) this.mV = pkF; if (this.envB > this.mS) this.mS = this.envB; const rd = -20 * Math.log10(this.gain); if (rd > this.mR) this.mR = rd; }
                }
                if (this.live && (this.cnt += n) >= 1200) { this.cnt = 0; this.port.postMessage({ v: this.mV, s: this.mS, r: this.mR, f: this.envF }); this.mV = 0; this.mS = 0; this.mR = 0; }
                return true;
            }
        }
        registerProcessor('pulse-deesser2', pulseAuto(PulseDeesser2, (s, v) => { if (v.thr !== undefined) s.thr = v.thr; if (v.range !== undefined) s.range = Math.max(0, Math.min(30, v.range)); }));
        // Saturation multibande : même calcul que MultiSat dans engine/src/fx.rs. Tout se fait à 4 fois la cadence
        // (même filtre que pulse-sat), donc bandes, son non traité et mélange restent alignés.
        // Bandes libres (elles prennent leur zone) + bande de départ (« base ») qui reçoit le reste du son.
        const MSAT_VK = [0.6, 1, 1.7];
        const msatCurve = (sty, x, k) => {
            x = Math.max(-4, Math.min(4, x));
            if (sty === 'lampe') return Math.tanh(k * (x + 0.18 * x * x)) / Math.tanh(k * 1.18);
            if (sty === 'ampli') { const a = k * x; return Math.max(-1, Math.min(1, a / (1 + Math.abs(a)) * (1 + 1 / k))); }
            if (sty === 'transfo') return Math.sin(Math.max(-1, Math.min(1, x * (0.6 + k * 0.08))) * Math.PI / 2);
            if (sty === 'repli') { let a = x * (1 + k * 0.35); for (let i = 0; i < 4; i++) { if (a > 1) a = 2 - a; else if (a < -1) a = -2 - a; } return a; }
            if (sty === 'lofi') { const q = 10 - Math.min(7, k); return Math.floor(Math.tanh(k * x) / Math.tanh(k) * q + 0.5) / q; }
            return Math.tanh(k * x * 0.9) / Math.tanh(k * 0.9);
        };
        // Auto gain : un son à −12 dB (sinus d'amplitude 0,25) ressort au même niveau, quelle que soit la chaleur
        const msatTrim = (sty, k) => { let s = 0; for (let i = 0; i < 64; i++) { const y = msatCurve(sty, 0.25 * Math.sin(2 * Math.PI * i / 64), k); s += y * y; } return 0.25 * Math.SQRT1_2 / Math.max(1e-6, Math.sqrt(s / 64)); };
        class PulseMsat extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {}, sr4 = sampleRate * 4;
                const biq = (hp, f) => { const w = 2 * Math.PI * f / sr4, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
                    return hp ? [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0] : [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0]; };
                const bpf = (f) => { const w = 2 * Math.PI * f / sr4, al = Math.sin(w) / 4, a0 = 1 + al; return [al / a0, 0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; };
                const co = (ms) => 1 - Math.exp(-1 / (ms / 1000 * sr4));
                const all = (Array.isArray(p.bands) ? p.bands : []).map((b, i) => b && { ...b, _i: i }).filter(b => b && b.on !== false);
                this.ag = p.ag !== false; this.sr4 = sr4;
                this.mkKs = (lo0, hi0, n) => { const lo = Math.max(20, Math.min(20000, lo0 || 20)), hi = Math.max(lo * 1.05, Math.min(20000, hi0 || 20000)), ks = [];
                    if (lo > 20.5) for (let i = 0; i < n; i++) ks.push(biq(true, lo)); if (hi < 19999) for (let i = 0; i < n; i++) ks.push(biq(false, hi)); return { ks, bp: bpf(Math.sqrt(lo * hi)) }; };
                const mk = (b, isBase) => {
                    const lo = isBase ? 20 : Math.max(20, Math.min(20000, b.lo || 20)), hi = isBase ? 20000 : Math.max(lo * 1.05, Math.min(20000, b.hi || 20000));
                    const n = (b.slope || 24) >= 48 ? 4 : (b.slope || 24) >= 24 ? 2 : 1, ks = isBase ? [] : this.mkKs(b.lo, b.hi, n).ks;
                    const sty = b.sty || 'bande', va = Math.max(0, Math.min(2, b.va ?? 1)), k = (1 + Math.max(0, Math.min(100, b.heat ?? 30)) / 100 * 7) * MSAT_VK[va];
                    const tone = [['lowshelf', 150, b.lo2, 0.7071], ['bell', 1000, b.md, 0.7], ['highshelf', 6000, b.hi2, 0.7071], ['bell', 3500, b.pr, 1.2]]
                        .filter(t => t[2]).flatMap(t => eqBandCoefs({ type: t[0], freq: t[1], gain: t[2], q: t[3] }, sr4));
                    return { ks, st: [ks.map(() => [0, 0, 0, 0]), ks.map(() => [0, 0, 0, 0])], tone, ts: [tone.map(() => [0, 0, 0, 0]), tone.map(() => [0, 0, 0, 0])],
                        sty, k, trim: p.ag === false ? 1 : msatTrim(sty, k),
                        dyn: Math.max(-50, Math.min(50, b.dyn || 0)), env: 0, att: co(5), rel: co(80),
                        fbk: Math.max(0, Math.min(100, b.fb || 0)) / 100 * 0.6, bp: bpf(isBase ? 1000 : Math.sqrt(lo * hi)), fs: [[0, 0, 0, 0], [0, 0, 0, 0]], last: [0, 0],
                        hold: sty === 'lofi' && va === 1 ? 4 * (1 + Math.floor(Math.max(0, Math.min(100, b.heat ?? 30)) / 100 * 15)) : 0, hc: 0, hv: [0, 0],
                        mix: Math.max(0, Math.min(100, b.mix ?? 100)) / 100, lvl: b.mute ? 0 : Math.pow(10, Math.max(-60, Math.min(24, b.out || 0)) / 20), solo: !!b.solo,
                        i: b._i, va, mute: !!b.mute, tg: [b.lo2 || 0, b.md || 0, b.hi2 || 0, b.pr || 0], n, lo: b.lo || 20, hi: b.hi || 20000, isBase };
                };
                const bb = all.find(b => b.base);
                this.free = all.filter(b => !b.base).slice(0, 6).map(b => mk(b, false));
                this.base = bb ? mk(bb, true) : null;
                this.anySolo = this.free.some(b => b.solo) || !!(this.base && this.base.solo);
                this.gmix = Math.max(0, Math.min(100, p.mix ?? 100)) / 100; this.gout = Math.pow(10, Math.max(-24, Math.min(24, p.out || 0)) / 20);
                this.xin = [new Float64Array(16), new Float64Array(16)]; this.xs = [new Float64Array(64), new Float64Array(64)]; this.pos = [0, 0];
            }
            band(b, v, nc) {   // v : [g, d] le son de la bande pour chaque côté ; renvoie dans v la sortie de la bande
                let pk = 0; for (let ch = 0; ch < nc; ch++) { const a = v[ch] < 0 ? -v[ch] : v[ch]; if (a > pk) pk = a; }
                b.env += (pk - b.env) * (pk > b.env ? b.att : b.rel);
                let gd = 1;
                if (b.dyn !== 0) { const L = 20 * Math.log10(Math.max(b.env, 1e-9)); let r = 0;
                    if (b.dyn > 0) r = Math.min(24, Math.max(0, L + 24) * b.dyn / 50 * 0.75); else if (L > -70) r = Math.min(24, Math.max(0, -24 - L) * -b.dyn / 50 * 0.75);
                    gd = Math.pow(10, -r / 20); }
                const doHold = b.hold > 0 && (b.hc++ % b.hold === 0);
                for (let ch = 0; ch < nc; ch++) {
                    const dry = v[ch];
                    let u = dry * gd;
                    if (b.fbk > 0) u += b.fbk * biqRun(b.bp, b.fs[ch], b.last[ch]);
                    let w = msatCurve(b.sty, u, b.k); b.last[ch] = w;
                    if (b.hold > 0) { if (doHold) b.hv[ch] = w; w = b.hv[ch]; }
                    w *= b.trim;
                    const ts = b.ts[ch]; for (let j = 0; j < b.tone.length; j++) w = biqRun(b.tone[j], ts[j], w);
                    v[ch] = (dry * (1 - b.mix) + w * b.mix) * b.lvl;
                }
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length, 2), h = satFir, fr = this.free, nf = fr.length;
                const x4 = this._x4 || (this._x4 = [0, 0]), res = this._r || (this._r = [0, 0]), acc = this._a || (this._a = [0, 0]), v = this._v || (this._v = [0, 0]);
                const bv = this._bv || (this._bv = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
                for (let i = 0; i < n; i++) {
                    for (let ch = 0; ch < nc; ch++) { const xin = this.xin[ch]; xin.copyWithin(1, 0, 15); xin[0] = inp[ch][i]; }
                    for (let p4 = 0; p4 < 4; p4++) {
                        for (let ch = 0; ch < nc; ch++) { const xin = this.xin[ch]; let u = 0; for (let j = 0; j < 16; j++) u += h[p4 + 4 * j] * xin[j]; x4[ch] = 4 * u; res[ch] = x4[ch]; acc[ch] = 0; }
                        // bandes libres : chacune prend sa zone au son
                        for (let k = 0; k < nf; k++) {
                            const b = fr[k], o = bv[k];
                            for (let ch = 0; ch < nc; ch++) { let s = x4[ch]; const st = b.st[ch]; for (let j = 0; j < b.ks.length; j++) s = biqRun(b.ks[j], st[j], s); o[ch] = s; res[ch] -= s; }
                            this.band(b, o, nc);
                            if (!this.anySolo || b.solo) for (let ch = 0; ch < nc; ch++) acc[ch] += o[ch];
                        }
                        // le reste du son : la bande de départ, ou tel quel sans elle
                        if (this.base) { v[0] = res[0]; v[1] = res[1]; this.band(this.base, v, nc); if (!this.anySolo || this.base.solo) for (let ch = 0; ch < nc; ch++) acc[ch] += v[ch]; }
                        else if (!this.anySolo) for (let ch = 0; ch < nc; ch++) acc[ch] += res[ch];
                        for (let ch = 0; ch < nc; ch++) {
                            const y = (x4[ch] * (1 - this.gmix) + acc[ch] * this.gmix) * this.gout;
                            const xs = this.xs[ch]; this.pos[ch] = (this.pos[ch] + 1) % 64; xs[this.pos[ch]] = y;
                        }
                    }
                    for (let ch = 0; ch < nc; ch++) { const xs = this.xs[ch]; let y = 0, idx = this.pos[ch]; for (let j = 0; j < 64; j++) { y += h[j] * xs[idx]; idx = (idx + 63) % 64; } out[ch][i] = y; }
                }
                return true;
            }
        }
        // Automation : « mix » / « out » = tout l'effet, « b1-heat » = la chaleur de la bande n° 1 (sa place dans la liste du panneau)
        const MSAT_TONE = ['lo2', 'md', 'hi2', 'pr'];
        registerProcessor('pulse-msat', pulseAuto(PulseMsat, (s, v) => {
            for (const k in v) {
                const x = v[k];
                if (k === 'mix') { s.gmix = Math.max(0, Math.min(100, x)) / 100; continue; }
                if (k === 'out') { s.gout = Math.pow(10, Math.max(-24, Math.min(24, x)) / 20); continue; }
                const dash = k.indexOf('-'), m = k[0] === 'b' && dash > 1 ? [k, k.slice(1, dash), k.slice(dash + 1)] : null; if (!m) continue;   // découpage à la main : les \\d se perdent dans cette chaîne
                const b = s.free.find(y => y.i === +m[1]) || (s.base && s.base.i === +m[1] ? s.base : null); if (!b) continue;
                const f = m[2], ti = MSAT_TONE.indexOf(f);
                if (f === 'heat') { const h = Math.max(0, Math.min(100, x)); b.k = (1 + h / 100 * 7) * MSAT_VK[b.va]; b.trim = s.ag ? msatTrim(b.sty, b.k) : 1; if (b.sty === 'lofi' && b.va === 1) b.hold = 4 * (1 + Math.floor(h / 100 * 15)); }
                else if (f === 'dyn') b.dyn = Math.max(-50, Math.min(50, x));
                else if (f === 'fb') b.fbk = Math.max(0, Math.min(100, x)) / 100 * 0.6;
                else if (f === 'mix') b.mix = Math.max(0, Math.min(100, x)) / 100;
                else if (f === 'out') b.lvl = b.mute ? 0 : Math.pow(10, Math.max(-60, Math.min(24, x)) / 20);
                else if ((f === 'lo' || f === 'hi') && !b.isBase && b[f] !== x) {
                    b[f] = x; const r = s.mkKs(b.lo, b.hi, b.n);
                    if (r.ks.length !== b.ks.length) b.st = [r.ks.map(() => [0, 0, 0, 0]), r.ks.map(() => [0, 0, 0, 0])];
                    b.ks = r.ks; b.bp = r.bp;
                }
                else if (ti >= 0 && (b.tg[ti] !== x || !b.tAll)) {
                    // ton automatisé : les 4 filtres restent en place (à 0 dB ils ne changent rien)
                    b.tg[ti] = x;
                    const tone = [['lowshelf', 150, b.tg[0], 0.7071], ['bell', 1000, b.tg[1], 0.7], ['highshelf', 6000, b.tg[2], 0.7071], ['bell', 3500, b.tg[3], 1.2]]
                        .flatMap(t => eqBandCoefs({ type: t[0], freq: t[1], gain: t[2], q: t[3] }, s.sr4));
                    if (tone.length !== b.tone.length) b.ts = [tone.map(() => [0, 0, 0, 0]), tone.map(() => [0, 0, 0, 0])];
                    b.tone = tone; b.tAll = true;
                }
            }
        }));
        // Multibande à bandes libres : même calcul que MultiBand dans engine/src/fx.rs.
        // Chaque bande isole sa zone (Linkwitz-Riley 24 dB/oct : deux filtres 2e ordre de chaque côté) et la monte ou la baisse
        // selon son niveau : gain = plage × (dépassement du seuil / 12 dB, entre 0 et 1), plus sa sortie. Sortie = son + Σ bande × (gain − 1) :
        // une bande qui ne travaille pas laisse le son intact.
        class PulseMband extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                const biq = (hp, f) => { const w = 2 * Math.PI * f / sampleRate, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
                    return hp ? [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0] : [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0]; };
                const co = (ms) => 1 - Math.exp(-1 / (Math.max(0.05, ms) / 1000 * sampleRate));
                this.co = co;
                // filtres d'une bande (refaits quand ses limites sont automatisées)
                this.mkKs = (lo0, hi0) => { const lo = Math.max(20, Math.min(20000, lo0 || 20)), hi = Math.max(lo * 1.05, Math.min(20000, sampleRate * 0.45, hi0 || 20000));
                    const ks = []; if (lo > 20.5) ks.push(biq(true, lo), biq(true, lo)); if (hi < 19999) ks.push(biq(false, hi), biq(false, hi)); return ks; };
                this.bands = (Array.isArray(p.bands) ? p.bands : []).map((b, i) => b && { ...b, _i: i }).filter(b => b && b.on !== false).slice(0, 6).map(b => {
                    const ks = this.mkKs(b.lo, b.hi);
                    return { ks, st: [ks.map(() => [0, 0, 0, 0]), ks.map(() => [0, 0, 0, 0])], env: 0, att: co(b.att ?? 10), rel: co(b.rel ?? 120),
                        thr: b.thr ?? -30, range: Math.max(-24, Math.min(24, b.range ?? -6)), out: Math.max(-24, Math.min(24, b.out || 0)), solo: !!b.solo, mute: !!b.mute, mg: 0, i: b._i, lo: b.lo || 20, hi: b.hi || 20000 };
                });
                this.anySolo = this.bands.some(b => b.solo);
                this.live = !!p.live; this.cnt = 0;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length), bs = this.bands, nb = bs.length;
                const bp = this._bp || (this._bp = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
                for (let i = 0; i < n; i++) {
                    let y0 = nc > 0 ? inp[0][i] : 0, y1 = nc > 1 ? inp[1][i] : 0;
                    const x0 = y0, x1 = y1;
                    if (this.anySolo) { y0 = 0; y1 = 0; }
                    for (let k = 0; k < nb; k++) {
                        const b = bs[k], v = bp[k];
                        let pk = 0;
                        for (let ch = 0; ch < nc; ch++) {
                            let s = ch ? x1 : x0;
                            const st = b.st[ch];
                            for (let j = 0; j < b.ks.length; j++) s = biqRun(b.ks[j], st[j], s);
                            v[ch] = s; const a = s < 0 ? -s : s; if (a > pk) pk = a;
                        }
                        b.env += (pk - b.env) * (pk > b.env ? b.att : b.rel);
                        const over = 20 * Math.log10(Math.max(b.env, 1e-9)) - b.thr;
                        const gd = b.range * Math.max(0, Math.min(1, over / 12));
                        const gl = b.mute ? 0 : Math.pow(10, (gd + b.out) / 20);
                        if (this.anySolo) { if (b.solo) { y0 += v[0] * gl; y1 += v[1] * gl; } }
                        else { y0 += v[0] * (gl - 1); y1 += v[1] * (gl - 1); }
                        if (this.live && Math.abs(gd) > Math.abs(b.mg)) b.mg = gd;
                    }
                    out[0][i] = y0; if (nc > 1) out[1][i] = y1;
                }
                if (this.live && (this.cnt += n) >= 1200) { this.cnt = 0; this.port.postMessage({ g: bs.map(b => b.mg), e: bs.map(b => 20 * Math.log10(Math.max(b.env, 1e-9))) }); bs.forEach(b => b.mg = 0); }
                return true;
            }
        }
        // Automation : « b2-thr » = le seuil de la bande n° 2 (sa place dans la liste du panneau)
        registerProcessor('pulse-mband', pulseAuto(PulseMband, (s, v) => {
            for (const k in v) { const dash = k.indexOf('-'), m = k[0] === 'b' && dash > 1 ? [k, k.slice(1, dash), k.slice(dash + 1)] : null; if (!m) continue; const b = s.bands.find(x => x.i === +m[1]); if (!b) continue; const x = v[k];
                if (m[2] === 'thr') b.thr = x; else if (m[2] === 'range') b.range = Math.max(-24, Math.min(24, x)); else if (m[2] === 'out') b.out = Math.max(-24, Math.min(24, x));
                else if (m[2] === 'att') b.att = s.co(x); else if (m[2] === 'rel') b.rel = s.co(x);
                else if ((m[2] === 'lo' || m[2] === 'hi') && b[m[2]] !== x) { b[m[2]] = x; const ks = s.mkKs(b.lo, b.hi); if (ks.length !== b.ks.length) b.st = [ks.map(() => [0, 0, 0, 0]), ks.map(() => [0, 0, 0, 0])]; b.ks = ks; } }
        }));
        // Saturation suréchantillonnée ×4 : même calcul que Saturator dans engine/src/fx.rs
        // (filtre de 64 coefficients, Blackman, coupure 0,1125 de la cadence ×4 ; parasites −22 dB → −99 dB)
        const satFir = (() => {
            const h = new Float64Array(64), fc = 0.1125;
            for (let i = 0; i < 64; i++) {
                const m = i - 31.5, x = 2 * fc * m, sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
                h[i] = 2 * fc * sinc * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / 63) + 0.08 * Math.cos(4 * Math.PI * i / 63));
            }
            let s = 0; for (let i = 0; i < 64; i++) s += h[i];
            for (let i = 0; i < 64; i++) h[i] /= s;
            return h;
        })();
        class PulseSat extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.k = 1 + (p.drive || 0) * 0.05; this.tk = Math.tanh(this.k);
                this.trim = 1 / Math.sqrt(this.k / this.tk);
                this.xin = [new Float64Array(16), new Float64Array(16)]; this.xs = [new Float64Array(64), new Float64Array(64)]; this.pos = [0, 0];
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length, 2), h = satFir, k = this.k, tk = this.tk;
                for (let ch = 0; ch < nc; ch++) {
                    const xin = this.xin[ch], xs = this.xs[ch], a = inp[ch], o = out[ch];
                    let pos = this.pos[ch];
                    for (let i = 0; i < n; i++) {
                        xin.copyWithin(1, 0, 15); xin[0] = a[i];
                        for (let p = 0; p < 4; p++) {
                            let u = 0;
                            for (let j = 0; j < 16; j++) u += h[p + 4 * j] * xin[j];
                            const v = Math.max(-1, Math.min(1, 4 * u));
                            pos = (pos + 1) % 64;
                            xs[pos] = Math.tanh(k * v) / tk;
                        }
                        let y = 0, idx = pos;
                        for (let j = 0; j < 64; j++) { y += h[j] * xs[idx]; idx = (idx + 63) % 64; }
                        o[i] = y * this.trim;
                    }
                    this.pos[ch] = pos;
                }
                return true;
            }
        }
        registerProcessor('pulse-sat', PulseSat);
        // EQ « calé sur l'analogique » : mêmes fonctions que la page (copiées ici telles quelles)
        ${eqMatched.toString()}
        ${eqSections.toString()}
        ${eqBandCoefs.toString()}
        const biqRun = (k, st, x) => { const y = k[0] * x + k[1] * st[0] + k[2] * st[1] - k[3] * st[2] - k[4] * st[3]; st[1] = st[0]; st[0] = x; st[3] = st[2]; st[2] = y; return y; };
        class PulseEq extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                // bandes : { i (place dans la liste, pour l'automation), type, freq, gain, q, slope }
                this.bands = (p.bands || []).map(b => ({ ...b, k: eqBandCoefs(b, sampleRate) }));
                this.st = [];
            }
            setBand(i, field, v) {
                const b = this.bands.find(x => x.i === i); if (!b || b[field] === v) return;
                b[field] = v; b.k = eqBandCoefs(b, sampleRate);
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                for (let ch = 0; ch < nc; ch++) {
                    if (!this.st[ch]) this.st[ch] = [];
                    const sts = this.st[ch], o = out[ch];
                    o.set(inp[ch]);
                    let si = 0;
                    for (const b of this.bands) for (const k of b.k) {
                        const st = sts[si] || (sts[si] = [0, 0, 0, 0]); si++;
                        for (let i = 0; i < n; i++) o[i] = biqRun(k, st, o[i]);
                    }
                }
                return true;
            }
        }
        registerProcessor('pulse-eq', pulseAuto(PulseEq, (s, v) => {
            for (const key in v) { const d = key.indexOf('-'); if (key[0] === 'b' && d > 1) s.setBand(+key.slice(1, d), key.slice(d + 1), v[key]); }   // « b3-freq »
        }));
        // Point dynamique de l'EQ : même calcul que DynBand dans engine/src/fx.rs (les deux doivent sonner pareil)
        const dynCoef = (type, f, q, g) => {
            const w = 2 * Math.PI * f / sampleRate, c = Math.cos(w), sn = Math.sin(w), a = Math.pow(10, g / 40);
            let k;
            if (type === 'bandpass') { const al = sn / (2 * q); k = [al, 0, -al, 1 + al, -2 * c, 1 - al]; }
            else if (type === 'peaking') { const al = sn / (2 * q); k = [1 + al * a, -2 * c, 1 - al * a, 1 + al / a, -2 * c, 1 - al / a]; }
            else {
                const be = 2 * Math.sqrt(a) * (sn / 2) * Math.SQRT2;
                k = type === 'lowshelf'
                    ? [a * ((a + 1) - (a - 1) * c + be), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - be), (a + 1) + (a - 1) * c + be, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - be]
                    : [a * ((a + 1) + (a - 1) * c + be), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - be), (a + 1) - (a - 1) * c + be, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - be];
            }
            return [k[0] / k[3], k[1] / k[3], k[2] / k[3], k[4] / k[3], k[5] / k[3]];
        };
        const dynSecs = (bd, g) => eqBandCoefs({ ...bd, freq: Math.max(20, Math.min(20000, bd.freq)), gain: g }, sampleRate);
        class PulseDynEq extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.bd = p.band || {}; this.live = !!p.live;
                const q = this.bd.type === 'bell' && this.bd.q > 0 ? this.bd.q : 0.7;
                this.det = dynCoef('bandpass', Math.max(20, Math.min(20000, this.bd.freq || 1000)), q, 0); this.dz = [0, 0, 0, 0];
                this.env = 0; this.att = Math.exp(-1 / (0.005 * sampleRate)); this.rel = Math.exp(-1 / (0.08 * sampleRate));
                this.k = dynSecs(this.bd, this.bd.gain || 0); this.z = []; this.cnt = 0; this.g = this.bd.gain || 0; this.lastPost = 0;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length), bd = this.bd, ns = this.k.length;
                while (this.z.length < nc * ns) this.z.push([0, 0, 0, 0]);
                for (let i = 0; i < n; i++) {
                    if (this.cnt % 32 === 0) {
                        const over = Math.max(0, 20 * Math.log10(this.env + 1e-9) - (bd.thr ?? -30));
                        this.g = (bd.gain || 0) + (bd.dyn || 0) * Math.min(1, over / 12);
                        this.k = dynSecs(bd, this.g);
                    }
                    this.cnt++;
                    const m = nc === 2 ? (inp[0][i] + inp[1][i]) * 0.5 : inp[0][i];
                    const d0 = this.det, z = this.dz;
                    const y = d0[0] * m + d0[1] * z[0] + d0[2] * z[1] - d0[3] * z[2] - d0[4] * z[3];
                    z[1] = z[0]; z[0] = m; z[3] = z[2]; z[2] = y;
                    const d = y < 0 ? -y : y, kk = d > this.env ? this.att : this.rel;
                    this.env = kk * this.env + (1 - kk) * d;
                    for (let ch = 0; ch < nc; ch++) {
                        let x = inp[ch][i];
                        for (let s = 0; s < ns; s++) {
                            const c = this.k[s], st = this.z[ch * ns + s];
                            const v = c[0] * x + c[1] * st[0] + c[2] * st[1] - c[3] * st[2] - c[4] * st[3];
                            st[1] = st[0]; st[0] = x; st[3] = st[2]; st[2] = v; x = v;
                        }
                        out[ch][i] = x;
                    }
                }
                // à l'écran : où en est le point (toutes les ~30 ms)
                if (this.live && currentTime - this.lastPost > 0.03) { this.lastPost = currentTime; this.port.postMessage(this.g); }
                return true;
            }
        }
        registerProcessor('pulse-dyneq', PulseDynEq);
        registerProcessor('pulse-deesser', pulseAuto(PulseDeesser, (s, v) => { if (v.amount !== undefined) { const a = Math.max(0, Math.min(100, v.amount)); s.maxRed = a * 0.24; s.slope = a / 100 * 3; } }));

        // Gate : coupe le bruit entre deux phrases. Mêmes calculs que Gate dans engine/src/fx.rs.
        // Écoute le plus fort des canaux (pistes liées) ; ouvert = gain 1, fermé = baisse de « reduction » dB, 50 ms de maintien.
        class PulseGate extends AudioWorkletProcessor {
            // Même calcul que Gate dans engine/src/fx.rs. Sans ratio : gate franc (son d'avant). Avec ratio : expandeur
            // (sous le seuil, chaque dB en moins en enlève « ratio − 1 » de plus, au plus « Coupure »), genou doux.
            // Déclencheur filtré (coupe-bas / coupe-haut 12 dB/oct) ; « écouter » = on entend ce que le gate voit (lecture seulement)
            constructor(options) {
                super();
                const p = (options && options.processorOptions) || {};
                const coef = (sec) => 1 - Math.exp(-1 / (sec * sampleRate));
                this.thr = Math.pow(10, (p.threshold ?? -45) / 20); this.thrDb = p.threshold ?? -45;
                this.range = p.reduction ?? 40; this.floor = Math.pow(10, -this.range / 20);
                this.ratio = p.ratio > 0 ? Math.max(1, p.ratio) : 0; this.knee = Math.max(0, p.knee || 0);
                this.hold = Math.round(Math.max(0, p.hold ?? 50) / 1000 * sampleRate);
                this.att = coef(0.0005); this.envRel = coef(0.02);
                this.gAtt = coef(Math.max(0.0001, (p.attack ?? 2) / 1000)); this.gRel = coef(Math.max(0.005, (p.release ?? 150) / 1000));
                this.env = 0; this.left = 0; this.gain = 1;
                const bq = (type, f) => { const w = 2 * Math.PI * f / sampleRate, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
                    return type === 'hp' ? [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0] : [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0]; };
                this.hp = p.hp > 20 ? bq('hp', Math.min(p.hp, sampleRate * 0.45)) : null;
                this.lp = p.lp > 0 && p.lp < 20000 ? bq('lp', Math.min(p.lp, sampleRate * 0.45)) : null;
                this.zh = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.zl = [[0, 0, 0, 0], [0, 0, 0, 0]];
                this.listen = !!p.listen; this.live = !!p.live; this.cnt = 0; this.mEnv = 0; this.mGain = 1;
            }
            target() {
                if (this.left > 0) return 1;
                if (!this.ratio) return this.floor;
                const u = this.thrDb - 20 * Math.log10(Math.max(this.env, 1e-6)), k = this.knee / 2;
                const r = u <= -k ? 0 : u < k ? (u + k) * (u + k) / (4 * Math.max(this.knee, 1e-3)) * (this.ratio - 1) : u * (this.ratio - 1);
                return Math.pow(10, -Math.min(this.range, Math.max(0, r)) / 20);
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                const run = (k, z, x) => { const y = k[0] * x + k[1] * z[0] + k[2] * z[1] - k[3] * z[2] - k[4] * z[3]; z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y; return y; };
                for (let i = 0; i < n; i++) {
                    let pk = 0;
                    for (let ch = 0; ch < nc; ch++) {
                        let d = inp[ch][i];
                        if (this.hp) d = run(this.hp, this.zh[ch], d);
                        if (this.lp) d = run(this.lp, this.zl[ch], d);
                        if (this.listen) out[ch][i] = d;
                        const a = d < 0 ? -d : d; if (a > pk) pk = a;
                    }
                    this.env += (pk - this.env) * (pk > this.env ? this.att : this.envRel);
                    if (this.env > this.thr) this.left = this.hold; else if (this.left > 0) this.left--;
                    const target = this.target();
                    this.gain += (target - this.gain) * (target > this.gain ? this.gAtt : this.gRel);
                    if (!this.listen) for (let ch = 0; ch < nc; ch++) out[ch][i] = inp[ch][i] * this.gain;
                    if (this.env > this.mEnv) this.mEnv = this.env; if (this.gain < this.mGain) this.mGain = this.gain;
                }
                // à l'écran : niveau vu par le gate et gain appliqué, ~40 fois par seconde
                if (this.live && (this.cnt += n) >= 1200) { this.cnt = 0; this.port.postMessage({ e: this.mEnv, g: this.mGain }); this.mEnv = 0; this.mGain = 1; }
                return true;
            }
        }
        registerProcessor('pulse-gate', pulseAuto(PulseGate, (s, v) => { if (v.threshold !== undefined) { s.thr = Math.pow(10, v.threshold / 20); s.thrDb = v.threshold; } if (v.reduction !== undefined) { s.floor = Math.pow(10, -v.reduction / 20); s.range = v.reduction; } if (v.release !== undefined) s.gRel = 1 - Math.exp(-1 / (Math.max(0.005, v.release / 1000) * sampleRate));
            if (v.ratio !== undefined) s.ratio = v.ratio >= 99 ? 0 : Math.max(1, v.ratio); if (v.knee !== undefined) s.knee = Math.max(0, v.knee);
            if (v.attack !== undefined) s.gAtt = 1 - Math.exp(-1 / (Math.max(0.0001, v.attack / 1000) * sampleRate)); if (v.hold !== undefined) s.hold = Math.round(Math.max(0, v.hold) / 1000 * sampleRate); }));

        // Effets de mouvement : chorus, flanger, phaser, trémolo, doubleur de voix, slapback.
        // Mêmes calculs que ModFx dans engine/src/fx.rs (une ligne à retard par canal, un LFO commun décalé d'un canal à l'autre).
        const MOD_DEFAULTS = {
            chorus:   { rate: 0.8,  depth: 5,  feedback: 0,  mix: 50 },
            flanger:  { rate: 0.25, depth: 2,  feedback: 50, mix: 50 },
            phaser:   { rate: 0.4,  depth: 70, feedback: 40, mix: 50 },
            tremolo:  { rate: 5,    depth: 50, feedback: 0,  mix: 100 },
            doubler:  { rate: 0.35, depth: 50, feedback: 0,  mix: 50 },
            slapback: { rate: 0,    depth: 0,  feedback: 12, mix: 25 }
        };
        class PulseMod extends AudioWorkletProcessor {
            constructor(options) {
                super();
                const o = (options && options.processorOptions) || {};
                this.kind = o.kind;
                const d = MOD_DEFAULTS[this.kind] || MOD_DEFAULTS.chorus;
                this.rate = o.rate ?? d.rate;
                this.depth = o.depth ?? d.depth;
                this.fb = (o.feedback ?? d.feedback) / 100;
                this.mix = (o.mix ?? d.mix) / 100;
                this.time = (o.time ?? 110) / 1000;
                this.width = o.width ?? d.depth;
                this.off = this.kind === 'doubler' ? 0.5 : 0.25;
                this.size = Math.ceil(0.35 * sampleRate) + 4;
                this.buf = [new Float64Array(this.size), new Float64Array(this.size)];
                this.w = 0; this.ph = 0;
                this.z = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.prev = [0, 0];
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length, 2), kind = this.kind;
                for (let i = 0; i < n; i++) {
                    for (let ch = 0; ch < nc; ch++) {
                        const x = inp[ch][i];
                        const lfo = Math.sin(2 * Math.PI * (this.ph + this.off * ch));
                        if (kind === 'tremolo') {
                            out[ch][i] = x * (1 - this.depth / 100 * (0.5 - 0.5 * lfo));
                            continue;
                        }
                        if (kind === 'phaser') {
                            const f = 300 * Math.pow(10, (0.5 + 0.5 * lfo) * this.depth / 100);
                            const t = Math.tan(Math.PI * f / sampleRate), a = (t - 1) / (t + 1);
                            let v = x + this.fb * this.prev[ch];
                            const z = this.z[ch];
                            for (let s = 0; s < 4; s++) { const y = a * v + z[s]; z[s] = v - a * y; v = y; }
                            this.prev[ch] = v;
                            out[ch][i] = x * (1 - this.mix) + v * this.mix;
                            continue;
                        }
                        let dsec;
                        if (kind === 'chorus') dsec = 0.012 + this.depth / 1000 * lfo;
                        else if (kind === 'flanger') dsec = 0.0005 + this.depth / 1000 * (0.5 + 0.5 * lfo);
                        else if (kind === 'doubler') dsec = 0.025 + this.width / 100 * 0.006 * lfo;
                        else dsec = this.time;
                        const b = this.buf[ch];
                        let pos = this.w - dsec * sampleRate;
                        pos = ((pos % this.size) + this.size) % this.size;
                        const i0 = Math.floor(pos), fr = pos - i0;
                        const wet = b[i0] + (b[(i0 + 1) % this.size] - b[i0]) * fr;
                        b[this.w] = x + this.fb * wet;
                        out[ch][i] = x * (1 - this.mix) + wet * this.mix;
                    }
                    this.w = (this.w + 1) % this.size;
                    this.ph += this.rate / sampleRate; if (this.ph >= 1) this.ph -= 1;
                }
                return true;
            }
        }
        registerProcessor('pulse-mod', pulseAuto(PulseMod, (s, v) => { if (v.rate !== undefined) s.rate = v.rate; if (v.depth !== undefined) s.depth = v.depth; if (v.width !== undefined) s.width = v.width; if (v.feedback !== undefined) s.fb = v.feedback / 100; if (v.mix !== undefined) s.mix = v.mix / 100; if (v.time !== undefined) s.time = v.time / 1000; }));

        // Bitcrusher : moins de bits et moins d'échantillons par seconde (son lo-fi)
        class PulseCrush extends AudioWorkletProcessor {
            constructor(options) {
                super();
                const o = (options && options.processorOptions) || {};
                this.q = Math.pow(2, (o.bits ?? 8) - 1);
                this.down = Math.max(1, Math.round(o.down ?? 4));
                this.mix = (o.mix ?? 100) / 100;
                this.c = 0; this.held = [0, 0];
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length, 2);
                for (let i = 0; i < n; i++) {
                    for (let ch = 0; ch < nc; ch++) {
                        const x = inp[ch][i];
                        if (this.c === 0) this.held[ch] = Math.floor(x * this.q + 0.5) / this.q;
                        out[ch][i] = x * (1 - this.mix) + this.held[ch] * this.mix;
                    }
                    this.c = (this.c + 1) % this.down;
                }
                return true;
            }
        }
        registerProcessor('pulse-crush', pulseAuto(PulseCrush, (s, v) => { if (v.bits !== undefined) s.q = Math.pow(2, v.bits - 1); if (v.down !== undefined) s.down = Math.max(1, Math.round(v.down)); if (v.mix !== undefined) s.mix = v.mix / 100; }));

        // Utilitaire (mono, inversion de phase, gain) et largeur stéréo (milieu / côtés)
        class PulseUtil extends AudioWorkletProcessor {
            constructor(options) {
                super();
                const o = (options && options.processorOptions) || {};
                this.kind = o.kind;
                this.g = Math.pow(10, (o.gain ?? 0) / 20) * (o.invert ? -1 : 1);
                this.mono = !!o.mono;
                this.width = (o.width ?? 100) / 100;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                for (let i = 0; i < n; i++) {
                    if (this.kind === 'width') {
                        if (nc < 2) { out[0][i] = inp[0][i]; continue; }
                        const m = (inp[0][i] + inp[1][i]) / 2, s = (inp[0][i] - inp[1][i]) / 2 * this.width;
                        out[0][i] = m + s; out[1][i] = m - s;
                    } else if (this.mono && nc >= 2) {
                        const m = (inp[0][i] + inp[1][i]) / 2 * this.g;
                        out[0][i] = m; out[1][i] = m;
                    } else {
                        for (let ch = 0; ch < nc; ch++) out[ch][i] = inp[ch][i] * this.g;
                    }
                }
                return true;
            }
        }
        registerProcessor('pulse-util', pulseAuto(PulseUtil, (s, v) => { if (v.gain !== undefined) s.g = Math.pow(10, v.gain / 20) * (s._ap.invert ? -1 : 1); if (v.width !== undefined) s.width = v.width / 100; }));

        // Compresseur : resserre l'écart entre les mots forts et les mots faibles.
        // Rattrapage de volume modéré et connu d'avance (le compresseur du navigateur, lui, ajoutait jusqu'à +18 dB).
        class PulseComp extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.red = 0; this.report = !!p.report; this.cnt = 0;
                this.env2 = 0; this.slow = 0; this.dc = [0, 0];
                this.penv = 0; this.hcnt = 0;
                this.setup(p);
                // Réglages envoyés en direct pendant la lecture (sans reconstruire le son)
                this.port.onmessage = (e) => { if (e.data && e.data.set) { if (this._ap) this._ap = { ...this._ap, ...e.data.set }; this.setup(this._ap ? { ...this._ap } : e.data.set); } };
            }
            setup(p) {
                this.thr = p.threshold ?? -22;
                this.slopeC = 1 - 1 / Math.max(1, p.ratio ?? 3);
                this.knee = p.knee ?? 10;
                this.att = 1 - Math.exp(-1 / (Math.max(0.0001, (p.attack ?? 10) / 1000) * sampleRate));
                this.rel = 1 - Math.exp(-1 / (Math.max(0.005, (p.release ?? 50) / 1000) * sampleRate));
                this.makeup = Math.pow(10, (p.makeup ?? (-this.thr * this.slopeC * 0.35)) / 20);
                // Mélange (compression parallèle) : 100 % = tout le signal compressé, 0 % = signal d'origine
                this.mix = Math.max(0, Math.min(1, (p.mix ?? 100) / 100));
                // Caractère : 0 Propre (numérique, sans couleur), 1 Opto (lent, doux, chaleur de lampe),
                // 2 FET (très rapide, harmoniques impaires qui montent avec la compression), 3 Bus (VCA de console, colle le mix)
                this.mode = Math.round(p.mode ?? 0);
                if (this.mode === 2) this.att = 1 - Math.exp(-1 / (Math.max(0.00005, (p.attack ?? 10) / 4000) * sampleRate));
                this.rmsC = 1 - Math.exp(-1 / (0.005 * sampleRate));      // détection en valeur moyenne (Opto, Bus) sur 5 ms
                this.slowC = 1 - Math.exp(-1 / (1.0 * sampleRate));       // Opto : la cellule « se charge » en 1 s
                this.relSlow = 1 - Math.exp(-1 / (Math.max(0.005, (p.release ?? 50) / 1000) * 4 * sampleRate));
                this.dcC = 1 - Math.exp(-1 / (0.05 * sampleRate));
                // Propre : maintien des crêtes du détecteur (12 ms) — le gain ne suit plus chaque arche d'une basse
                // (3e harmonique à 60 Hz : −18 / −36 dB → sous −97 dB). Même calcul que Compressor dans engine/src/fx.rs
                this.holdN = this.mode === 0 ? Math.round(0.012 * sampleRate) : 0;
                this.holdDec = Math.exp(-1 / (0.002 * sampleRate));
                // Bus, relâchement Auto : 0,1 s sur les pointes, jusqu'à 1,2 s quand la compression dure
                this.autoRel = this.mode === 3 && !!p.autoRel;
                if (this.autoRel) { this.rel = 1 - Math.exp(-1 / (0.1 * sampleRate)); this.relSlow = 1 - Math.exp(-1 / (1.2 * sampleRate)); }
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                const thr = this.thr, knee = this.knee, half = knee / 2;
                const m = this.mode;
                for (let i = 0; i < n; i++) {
                    let pk = 0, sq = 0;
                    for (let ch = 0; ch < nc; ch++) { const a = inp[ch][i] < 0 ? -inp[ch][i] : inp[ch][i]; if (a > pk) pk = a; if (a * a > sq) sq = a * a; }
                    let lvl = pk;
                    if (this.holdN > 0) {
                        if (pk >= this.penv) { this.penv = pk; this.hcnt = this.holdN; }
                        else if (this.hcnt > 0) this.hcnt--;
                        else this.penv *= this.holdDec;
                        lvl = this.penv;
                    }
                    if (m === 1 || m === 3) { this.env2 += (sq - this.env2) * this.rmsC; lvl = Math.sqrt(this.env2) * Math.SQRT2; }
                    let want = 0;
                    if (lvl > 1e-5) {
                        const over = 20 * Math.log10(lvl) - thr;
                        if (over >= half) want = over * this.slopeC;
                        else if (over > -half) want = this.slopeC * (over + half) * (over + half) / (2 * knee); // genou doux
                    }
                    let rc = this.rel;
                    if (m === 1 || this.autoRel) { this.slow += ((this.red > 3 ? 1 : 0) - this.slow) * this.slowC; rc = this.rel + (this.relSlow - this.rel) * this.slow; }
                    this.red += (want - this.red) * (want > this.red ? this.att : rc);
                    const gr = Math.pow(10, -this.red / 20) * this.makeup, h3 = m === 2 ? 0.15 + 0.02 * Math.min(this.red, 15) : 0.04;
                    for (let ch = 0; ch < nc; ch++) {
                        const x = inp[ch][i];
                        let w = x * gr;
                        if (m === 1) { const e = 0.12 * w * w / (1 + w * w); this.dc[ch] += (e - this.dc[ch]) * this.dcC; w += e - this.dc[ch]; }
                        else if (m >= 2) w -= h3 * w * w * w / (1 + w * w);
                        out[ch][i] = (1 - this.mix) * x + this.mix * w;
                    }
                }
                if (this.report && (this.cnt += n) >= 480) { this.cnt = 0; this.port.postMessage(this.red * this.mix); }
                return true;
            }
        }
        registerProcessor('pulse-comp', pulseAuto(PulseComp, (s, v) => s.setup({ ...s._ap, ...v })));

        // Reverb : 8 échos très courts en parallèle + 4 diffuseurs en série (schéma « Freeverb »).
        // Aucun hasard dedans : le même réglage donne exactement le même son partout (navigateur, export, moteur natif).
        // Ducking (écho, reverb) : l'effet se pousse quand la voix joue et ressort dans les trous.
        // Même calcul que Ducker dans engine/src/fx.rs : suiveur 10 ms / 100 ms, de rien à -30 dBFS à plein effet à -10 dBFS.
        class Ducker {
            constructor(amount) { this.amt = Math.max(0, Math.min(1, (amount || 0) / 100)); this.env = 0; this.att = Math.exp(-1 / (0.01 * sampleRate)); this.rel = Math.exp(-1 / (0.1 * sampleRate)); }
            gain(x) {
                const d = x < 0 ? -x : x, k = d > this.env ? this.att : this.rel;
                this.env = k * this.env + (1 - k) * d;
                if (this.amt <= 0) return 1;
                const a = Math.max(0, Math.min(1, (20 * Math.log10(this.env + 1e-9) + 30) / 20));
                return 1 - this.amt * a;
            }
        }
        class PulseReverb extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.wet = Math.max(0, Math.min(1, p.wet ?? 0.18));
                const size = p.size ?? 1.8;
                // Déclin (0,5 à 5, 2,5 = neutre) : allonge ou raccourcit la queue. Même calcul que engine/src/fx.rs (Reverb::new)
                this.fb = Math.max(0.5, Math.min(0.97, 0.72 + 0.2 * Math.max(0, Math.min(1, (size - 1.2) / 2)) + ((p.decay ?? 2.5) - 2.5) * 0.025));
                // Brillance (0 sombre … 100 brillant, 50 = neutre) : à quel point la queue perd ses aigus. Même calcul que fx.rs
                this.damp = p.bright !== undefined && p.bright !== null ? Math.max(0.02, Math.min(0.7, 0.35 + (50 - p.bright) / 50 * 0.3)) : 0.35;
                // Largeur de la queue (0 = mono, 100 = normal, 150 = plus large)
                this.w = p.width !== undefined && p.width !== null ? Math.max(0, Math.min(150, p.width)) / 100 : 1;
                // EQ de la reverb : il ne touche que l'effet, pas la voix d'origine (mêmes filtres que l'EQ)
                this.eq = (Array.isArray(p.eq) ? p.eq : []).filter(b => b && b.on !== false).flatMap(b => eqBandCoefs({ ...b, freq: Math.max(20, Math.min(20000, b.freq || 1000)) }, sampleRate));
                this.eqs = [this.eq.map(() => [0, 0, 0, 0]), this.eq.map(() => [0, 0, 0, 0])];
                this.acc = [0, 0];
                const k = sampleRate / 44100, len = (n) => Math.max(1, Math.round(n * k));
                const mk = (n) => ({ buf: new Float64Array(len(n)), i: 0, store: 0 });
                const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], AP = [556, 441, 341, 225];
                this.comb = [COMB.map(n => mk(n)), COMB.map(n => mk(n + 23))];   // droite décalée = largeur stéréo
                this.ap = [AP.map(n => mk(n)), AP.map(n => mk(n + 23))];
                this.nc = 1;
                // Temps avant que la reverb démarre (pré-délai), 0 par défaut
                const pre = Math.round(Math.max(0, Math.min(0.5, p.pre || 0)) * sampleRate);
                this.pre = pre > 0 ? new Float64Array(pre) : null; this.pi = 0;
                // Grave / Aigu : ce qu'on retire de ce qui entre dans la reverb (0 = rien)
                this.kl = p.low > 20 ? Math.exp(-2 * Math.PI * p.low / sampleRate) : 0; this.zl = 0;
                this.kh = p.high > 0 && p.high < 20000 ? Math.exp(-2 * Math.PI * p.high / sampleRate) : 0; this.zh = 0;
                this.duck = new Ducker(p.duck);
                this.outG = Math.pow(10, (p.out || 0) / 20);   // sortie de l'effet (bus d'envoi : -9,5 dB)
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (inp && inp.length) this.nc = inp.length;
                const n = out[0].length, mono = this.nc < 2;
                const a = inp && inp[0], b = inp && inp[1];
                // Une piste mono sort en stéréo : on la baisse de 3 dB pour qu'elle garde le volume qu'elle aurait sans reverb
                const dry = (1 - this.wet) * (mono ? Math.SQRT1_2 : 1), wet = this.wet * 3 * this.outG * (mono ? Math.SQRT1_2 : 1);
                for (let i = 0; i < n; i++) {
                    const xl = a ? a[i] : 0, xr = mono ? xl : (b ? b[i] : 0);
                    let x = (xl + xr) * 0.015;
                    const dg = this.duck.gain((xl + xr) * 0.5);
                    if (this.kl) { this.zl = x + (this.zl - x) * this.kl; x = x - this.zl; }
                    if (this.kh) { this.zh = x + (this.zh - x) * this.kh; x = this.zh; }
                    if (this.pre) { const d = this.pre[this.pi]; this.pre[this.pi] = x; x = d; if (++this.pi >= this.pre.length) this.pi = 0; }
                    const w2 = this.acc;
                    for (let ch = 0; ch < 2; ch++) {
                        let acc = 0;
                        const cs = this.comb[ch];
                        for (let c = 0; c < 8; c++) {
                            const f = cs[c], y = f.buf[f.i];
                            f.store = y * (1 - this.damp) + f.store * this.damp;
                            f.buf[f.i] = x + f.store * this.fb;
                            if (++f.i >= f.buf.length) f.i = 0;
                            acc += y;
                        }
                        const as = this.ap[ch];
                        for (let c = 0; c < 4; c++) {
                            const f = as[c], y = f.buf[f.i];
                            f.buf[f.i] = acc + y * 0.5;
                            if (++f.i >= f.buf.length) f.i = 0;
                            acc = y - acc;
                        }
                        if (this.eq.length) { const st = this.eqs[ch]; for (let e = 0; e < this.eq.length; e++) acc = biqRun(this.eq[e], st[e], acc); }
                        w2[ch] = acc;
                    }
                    if (this.w !== 1) { const m = (w2[0] + w2[1]) * 0.5, sd = (w2[0] - w2[1]) * 0.5 * this.w; w2[0] = m + sd; w2[1] = m - sd; }
                    out[0][i] = xl * dry + w2[0] * wet * dg;
                    out[1][i] = xr * dry + w2[1] * wet * dg;
                }
                return true;
            }
        }
        registerProcessor('pulse-reverb', pulseAuto(PulseReverb, (s, v) => { if (v.wet !== undefined) s.wet = Math.max(0, Math.min(1, v.wet)); }));

        // Pitch −/+ : deux têtes de lecture glissent dans une mémoire de 50 ms, en fondu croisé (sin²)
        // Même calcul que engine/src/fx.rs (Pitch::tick)
        class PulsePitch extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                const semi = Math.max(-12, Math.min(12, p.semi ?? 0));
                this.W = Math.round(0.05 * sampleRate);
                this.L = this.W * 2 + 8;
                this.step = (1 - Math.pow(2, semi / 12)) / this.W;
                this.mix = Math.max(0, Math.min(1, (p.mix ?? 100) / 100));
                this.ph = 0; this.i = 0; this.buf = [];
            }
            read(b, d) {
                let pos = this.i - d - 1; while (pos < 0) pos += this.L;
                const i0 = Math.floor(pos), f = pos - i0, i1 = (i0 + 1) % this.L;
                return b[i0] + (b[i1] - b[i0]) * f;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                const n = out[0].length, nc = out.length, ni = inp ? inp.length : 0;
                while (this.buf.length < nc) this.buf.push(new Float64Array(this.L));
                for (let i = 0; i < n; i++) {
                    const p1 = this.ph, p2 = (p1 + 0.5) % 1;
                    const g1 = Math.sin(Math.PI * p1) ** 2, g2 = Math.sin(Math.PI * p2) ** 2;
                    for (let ch = 0; ch < nc; ch++) {
                        const x = ch < ni ? inp[ch][i] : (ni ? inp[0][i] : 0), b = this.buf[ch];
                        b[this.i] = x;
                        const wet = this.read(b, p1 * this.W) * g1 + this.read(b, p2 * this.W) * g2;
                        out[ch][i] = x * (1 - this.mix) + wet * this.mix;
                    }
                    this.ph += this.step; this.ph -= Math.floor(this.ph);
                    if (++this.i >= this.L) this.i = 0;
                }
                return true;
            }
        }
        registerProcessor('pulse-pitch', pulseAuto(PulsePitch, (s, v) => { if (v.semi !== undefined) s.step = (1 - Math.pow(2, Math.max(-12, Math.min(12, v.semi)) / 12)) / s.W; if (v.mix !== undefined) s.mix = Math.max(0, Math.min(1, v.mix / 100)); }));

        // Limiteur de sécurité du master : ne touche à rien sous -1 dB, retient seulement les crêtes qui satureraient.
        // Il « voit venir » la crête 1,5 ms à l'avance, donc il baisse en douceur au lieu d'écraser.
        // (Celui du navigateur mettait 0,1 s à s'ouvrir : le premier temps de chaque morceau sortait deux fois moins fort.)
        class PulseLimiter extends AudioWorkletProcessor {
            // Même calcul que Limiter dans engine/src/fx.rs. Réglages : gain d'entrée (dB), plafond, relâchement (ms),
            // anticipation (ms), pic réel (les crêtes entre les échantillons comptent aussi, détection ×4)
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.thr = p.ceiling > 0 ? Math.min(1, p.ceiling) : 0.966; // plafond : -0,3 dB par défaut
                this.port.onmessage = (e) => { if (e.data && e.data.ceiling > 0) this.thr = Math.min(1, e.data.ceiling); };
                this.g = Math.pow(10, (p.gain || 0) / 20);
                this.tp = !!p.tp;
                const look = Math.max(0.1, Math.min(10, p.lookahead ?? 1.5)) / 1000;
                this.L = Math.max(1, Math.round(look * sampleRate)) + (this.tp ? 8 : 0);   // le pic réel arrive ~8 échantillons plus tard
                this.buf = [new Float32Array(this.L), new Float32Array(this.L)];
                this.i = 0; this.env = 0; this.gain = 1; this.gain1 = 1;
                // Style : 0 Transparent (comme avant) · 1 Doux (réduction lissée en deux étages, relâchement ×2,2) · 2 Franc (attaque serrée, relâchement ×0,45)
                this.sty = p.style === 1 ? 1 : p.style === 2 ? 2 : 0;
                this.rm = [1, 2.2, 0.45][this.sty];
                this.att = 1 - Math.exp(-[4, 8, 10][this.sty] / Math.max(1, this.L - (this.tp ? 8 : 0)));
                this.rel = 1 - Math.exp(-1 / (Math.max(1, Math.min(2000, p.release ?? 120)) * this.rm / 1000 * sampleRate));
                this.hist = [new Float64Array(16), new Float64Array(16)];
                this.live = !!p.live; this.cnt = 0; this.mIn = 0; this.mOut = 0; this.mGr = 1;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                const n = out[0].length, nc = out.length, ni = inp ? inp.length : 0, h = satFir;
                for (let i = 0; i < n; i++) {
                    let pk = 0;
                    for (let ch = 0; ch < nc; ch++) {
                        const x = (ni ? inp[ch < ni ? ch : 0][i] : 0) * this.g, a = x < 0 ? -x : x;
                        if (a > pk) pk = a;
                        if (this.tp) {
                            // crêtes entre les échantillons : on recalcule 3 points intermédiaires (même filtre que la saturation)
                            const hs = this.hist[ch]; hs.copyWithin(1, 0, 15); hs[0] = x;
                            for (let ph = 1; ph < 4; ph++) { let u = 0; for (let j = 0; j < 16; j++) u += h[ph + 4 * j] * hs[j]; u = u < 0 ? -4 * u : 4 * u; if (u > pk) pk = u; }
                        }
                        const d = this.buf[ch][this.i];
                        this.buf[ch][this.i] = x;
                        out[ch][i] = d;
                    }
                    if (pk > this.mIn) this.mIn = pk;
                    this.env = pk > this.env ? pk : this.env + (pk - this.env) * this.rel;
                    const target = this.env > this.thr ? this.thr / this.env : 1;
                    if (this.sty === 1) {   // Doux : deux étages en série, la réduction arrive et repart sans à-coup
                        this.gain1 += (target - this.gain1) * (target < this.gain1 ? this.att : this.rel);
                        this.gain += (this.gain1 - this.gain) * (this.gain1 < this.gain ? this.att : this.rel);
                    } else this.gain += (target - this.gain) * (target < this.gain ? this.att : this.rel);
                    if (this.gain < this.mGr) this.mGr = this.gain;
                    for (let ch = 0; ch < nc; ch++) {
                        let y = out[ch][i] * this.gain;
                        y = y > this.thr ? this.thr : y < -this.thr ? -this.thr : y; // rien ne dépasse le plafond
                        out[ch][i] = y; const a = y < 0 ? -y : y; if (a > this.mOut) this.mOut = a;
                    }
                    if (++this.i >= this.L) this.i = 0;
                }
                // à l'écran : crête d'entrée, de sortie et réduction, ~40 fois par seconde
                if (this.live && (this.cnt += n) >= 1200) { this.cnt = 0; this.port.postMessage({ i: this.mIn, o: this.mOut, gr: this.mGr }); this.mIn = 0; this.mOut = 0; this.mGr = 1; }
                return true;
            }
        }
        registerProcessor('pulse-limiter', pulseAuto(PulseLimiter, (s, v) => { if (v.gain !== undefined) s.g = Math.pow(10, v.gain / 20); if (v.ceiling !== undefined) s.thr = Math.min(1, Math.pow(10, v.ceiling / 20)); if (v.release !== undefined) s.rel = 1 - Math.exp(-1 / (Math.max(1, Math.min(2000, v.release)) * s.rm / 1000 * sampleRate)); }));

        // Écho (delay) : le son revient après un temps choisi, de moins en moins fort et de plus en plus sourd.
        class PulseDelay extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.D = Math.max(1, Math.min(Math.round(4 * sampleRate), Math.round((p.time ?? 0.3) * sampleRate)));
                this.fb = Math.max(0, Math.min(0.9, p.feedback ?? 0.35));
                this.wet = Math.max(0, Math.min(1, p.wet ?? 0.25));
                this.dry = p.dry ?? 1; // 0 sur un envoi : on ne veut que l'écho
                this.k = Math.exp(-2 * Math.PI * 4000 / sampleRate); // chaque répétition perd des aigus
                this.pp = !!p.pp;   // ping-pong : les répétitions alternent gauche / droite
                this.buf = []; this.lp = []; this.i = 0;
                // Filtre des retours : coupe-haut (chaque répétition s'assombrit, 4 kHz par défaut) et coupe-bas (sur ce qui entre)
                if (p.lpf > 0) this.k = Math.exp(-2 * Math.PI * Math.min(20000, p.lpf) / sampleRate);
                this.kh = p.hpf > 20 ? Math.exp(-2 * Math.PI * p.hpf / sampleRate) : 0; this.zh = [0, 0];
                this.duck = new Ducker(p.duck);
                // EQ de l'écho : il colore les répétitions qu'on entend, pas la voix d'origine (mêmes filtres que l'EQ, comme fx.rs)
                this.eq = (Array.isArray(p.eq) ? p.eq : []).filter(b => b && b.on !== false).flatMap(b => eqBandCoefs({ ...b, freq: Math.max(20, Math.min(20000, b.freq || 1000)) }, sampleRate));
                this.eqs = [this.eq.map(() => [0, 0, 0, 0]), this.eq.map(() => [0, 0, 0, 0])];
            }
            eqw(ch, v) { const ks = this.eq; if (!ks.length) return v; const st = this.eqs[ch] || (this.eqs[ch] = ks.map(() => [0, 0, 0, 0])); for (let e = 0; e < ks.length; e++) v = biqRun(ks[e], st[e], v); return v; }
            hp(ch, x) { if (!this.kh) return x; this.zh[ch] = x + (this.zh[ch] - x) * this.kh; return x - this.zh[ch]; }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                const n = out[0].length, nc = out.length, ni = inp ? inp.length : 0;
                while (this.buf.length < Math.max(2, nc)) { this.buf.push(new Float64Array(this.D)); this.lp.push(0); }
                if (this.pp && nc >= 2) {
                    // Même calcul que le moteur Rust (engine/src/fx.rs, Delay::tick)
                    const bl = this.buf[0], br = this.buf[1];
                    for (let i = 0; i < n; i++) {
                        const xl = ni > 0 ? inp[0][i] : 0, xr = ni > 1 ? inp[1][i] : xl;
                        const dl = bl[this.i], dr = br[this.i], g = this.wet * this.duck.gain(0.5 * (xl + xr));
                        this.lp[0] = dl + (this.lp[0] - dl) * this.k;
                        this.lp[1] = dr + (this.lp[1] - dr) * this.k;
                        bl[this.i] = this.hp(0, 0.5 * (xl + xr)) + this.lp[1] * this.fb;
                        br[this.i] = this.lp[0] * this.fb;
                        out[0][i] = xl * this.dry + this.eqw(0, dl) * g;
                        out[1][i] = xr * this.dry + this.eqw(1, dr) * g;
                        if (++this.i >= this.D) this.i = 0;
                    }
                    return true;
                }
                for (let i = 0; i < n; i++) {
                    let m = 0; for (let ch = 0; ch < nc; ch++) m += ch < ni ? inp[ch][i] : 0;
                    const g = this.wet * this.duck.gain(m / nc);
                    for (let ch = 0; ch < nc; ch++) {
                        const x = ch < ni ? inp[ch][i] : 0, b = this.buf[ch];
                        const d = b[this.i];
                        this.lp[ch] = d + (this.lp[ch] - d) * this.k;
                        b[this.i] = this.hp(ch, x) + this.lp[ch] * this.fb;
                        out[ch][i] = x * this.dry + this.eqw(ch, d) * g;
                    }
                    if (++this.i >= this.D) this.i = 0;
                }
                return true;
            }
        }
        registerProcessor('pulse-delay', pulseAuto(PulseDelay, (s, v) => { if (v.feedback !== undefined) s.fb = Math.max(0, Math.min(0.9, v.feedback)); if (v.wet !== undefined) s.wet = Math.max(0, Math.min(1, v.wet)); if (v.dry !== undefined) s.dry = v.dry; }));

        // Largeur stéréo : on écarte ou on resserre ce qui diffère entre la gauche et la droite. 1 = inchangé.
        class PulseWidth extends AudioWorkletProcessor {
            constructor(o) { super(); const p = (o && o.processorOptions) || {}; this.w = Math.max(0, Math.min(2, p.width ?? 1)); }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const l = inp[0], r = inp[1] || inp[0], n = out[0].length;
                for (let i = 0; i < n; i++) {
                    const m = (l[i] + r[i]) * 0.5, sd = (l[i] - r[i]) * 0.5 * this.w;
                    out[0][i] = m + sd; out[1][i] = m - sd;
                }
                return true;
            }
        }
        registerProcessor('pulse-width', PulseWidth);`;

    const FX_CHAIN = ['pitch', 'filter', 'gate', 'eq', 'sat', 'msat', 'crush', 'deess', 'comp', 'mband', 'util', 'width', 'tremolo', 'phaser', 'flanger', 'chorus', 'doubler', 'slapback', 'master', 'limit', 'delay', 'reverb']; // ordre habituel des effets
    const SEND_REVERB_TRIM = 1 / 3; // la reverb seule sort 3 fois trop fort par rapport au son direct : on la ramène à niveau

    // Temps de l'écho en secondes : calé sur le rythme (beats = nombre de temps) ou donné en millisecondes
    function delaySeconds(dp, bpm) {
        if (dp.ms > 0) return dp.ms / 1000;
        return (60 / (bpm > 0 ? bpm : 90)) * (dp.beats > 0 ? dp.beats : 0.5);
    }
    const fxReady = new WeakSet();
    async function ensureFx(actx) {
        if (fxReady.has(actx) || !actx.audioWorklet) return;
        const url = URL.createObjectURL(new Blob([FX_WORKLET], { type: 'application/javascript' }));
        try { await actx.audioWorklet.addModule(url); fxReady.add(actx); }
        catch (e) { console.warn('Effets maison indisponibles', e); }
        finally { URL.revokeObjectURL(url); }
    }

    // Cache des réponses impulsionnelles de reverb
    const irCache = new Map();

    // Deux appels en même temps doivent attendre la même préparation (sinon le second repart sans master)
    let initPromise = null;
    function init() {
        if (!initPromise) initPromise = doInit().catch((e) => { initPromise = null; throw e; });
        return initPromise;
    }
    async function doInit() {
        if (ctx) return ctx;
        // Fréquence : celle de la carte son (jamais forcée). Imposer 48 kHz sur une sortie en 44,1 kHz fait rééchantillonner
        // le navigateur en direct, d'où des craquements dans l'appli Mac (WebKit) alors que YouTube passe sans souci.
        ctx = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive'
        });
        await ensureFx(ctx);
        masterGain = ctx.createGain();
        masterGain.gain.value = masterVolume * MASTER_TRIM;
        // Analyser master pour le VU-mètre topbar
        masterAnalyser = ctx.createAnalyser();
        masterAnalyser.fftSize = 256;
        masterAnalyser.smoothingTimeConstant = 0.6;
        // Limiteur de sécurité : empêche la saturation quand voix + instru dépassent 0 dB
        const out = createSafetyLimiter(ctx, ceilingDb);
        liveLimiter = out.input;
        masterGain.connect(out.input);
        out.output.connect(masterAnalyser);
        out.output.connect(ctx.destination);
        return ctx;
    }

    // Transparent sous le seuil, écrase seulement les crêtes qui satureraient.
    // LIMITER_TRIM annule le gain de rattrapage automatique du compresseur du navigateur.
    const LIMITER_TRIM = 0.877; // mesuré : rattrapage auto de Chrome = ×1,14 avec ces réglages
    // Plafond du limiteur de sécurité (dB). -0,3 : assez pour qu'aucun export ne sature, sans rien enlever au son.
    let ceilingDb = -0.3, liveLimiter = null;
    const dbToLin = (db) => Math.pow(10, db / 20);
    function setCeiling(db) {
        ceilingDb = Math.max(-6, Math.min(0, Number.isFinite(db) ? db : -0.3));
        if (liveLimiter && liveLimiter.port) liveLimiter.port.postMessage({ ceiling: dbToLin(ceilingDb) });
    }
    function createSafetyLimiter(actx, db = ceilingDb) {
        if (fxReady.has(actx)) {
            const lim = new AudioWorkletNode(actx, 'pulse-limiter', {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
                channelCount: 2, channelCountMode: 'explicit',
                processorOptions: { ceiling: dbToLin(db) }
            });
            return { input: lim, output: lim };
        }
        // Repli si les effets maison ne sont pas disponibles : le compresseur du navigateur
        const comp = actx.createDynamicsCompressor();
        comp.threshold.value = -2;
        comp.knee.value = 0;
        comp.ratio.value = 20;
        comp.attack.value = 0.002;
        comp.release.value = 0.12;
        const trim = actx.createGain();
        trim.gain.value = LIMITER_TRIM;
        comp.connect(trim);
        return { input: comp, output: trim };
    }

    function getMasterAnalyser() { return masterAnalyser; }
    // Spectre d'une piste en lecture (null à l'arrêt ou si la piste ne joue pas)
    // Réduction réelle du compresseur (dB) par piste ('t' + numéro) ou groupe ('b' + id), mise à jour pendant la lecture
    const compGR = new Map();
    const compLive = new Map();   // grKey -> compresseur en cours de lecture (réglages en direct)
    function updateComp(key, cp) {
        const n = compLive.get(key); if (!n || !cp) return false;
        const r = { threshold: cp.threshold, ratio: cp.ratio, attack: cp.attack, release: cp.release, knee: cp.knee, makeup: cp.makeup, mix: cp.mix, mode: cp.mode, autoRel: cp.autoRel };
        try { n.port.postMessage({ set: r }); return true; } catch (e) { return false; }
    }
    const compGRts = new Map();
    // La valeur de l'aiguille vient du compresseur en cours de lecture ; si plus rien n'arrive (arrêt, graphe reconstruit), elle est périmée
    // Gate en lecture : { e: niveau vu par le gate, g: gain appliqué } pour son écran
    const gateLive = new Map();
    const deessLive = new Map(), mbandLive = new Map();
    function getMbandMeter(key) { const v = mbandLive.get(key); return v && performance.now() - v.ts < 250 ? v : null; }
    function getDeessMeter(key) { const v = deessLive.get(key); return v && performance.now() - v.ts < 250 ? v : null; }
    function getGateMeter(key) { const v = gateLive.get(key); return v && performance.now() - v.ts < 250 ? v : null; }
    // Limiteur en lecture : { i: crête d'entrée, o: crête de sortie, gr: gain le plus bas } pour son écran
    const limLive = new Map();
    function getLimiterMeter(key) { const v = limLive.get(key); return v && performance.now() - v.ts < 250 ? v : null; }
    function getCompReduction(key) { return compGR.has(key) && performance.now() - (compGRts.get(key) || 0) < 250 ? compGR.get(key) : null; }
    function getBusSpectrum(busId) { return liveBusSpec.get(busId) || null; }
    function getTrackSpectrum(trackIdx) { const n = liveNodes.get(trackIdx); return n && n.spec ? n.spec : null; }

    function setMasterVolume(v0to100) {
        masterVolume = v0to100 / 100;
        if (masterGain) masterGain.gain.setTargetAtTime(masterVolume * MASTER_TRIM, ctx.currentTime, 0.01);
    }

    async function resumeIfNeeded() {
        await init();
        if (ctx.state === 'suspended') await ctx.resume();
    }

    async function requestMic() {
        if (micStream) return micStream;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const err = new Error('getUserMedia indisponible');
            err.name = 'InsecureContextError';
            throw err;
        }
        // Mode Faible latence : on demande au navigateur le plus petit tampon d'entrée possible (indice, jamais bloquant)
        // channelCount : on demande toutes les entrées de l'interface (Apollo, Focusrite…) pour pouvoir choisir laquelle enregistrer
        const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 8 }, ...(lowLatency ? { latency: { ideal: 0 } } : {}) };
        const wanted = localStorage.getItem('pulse_mic_id') || '';
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: wanted ? { ...base, deviceId: { exact: wanted } } : base
            });
        } catch (err) {
            // Le micro choisi a été débranché : on retombe sur le micro par défaut
            if (!wanted || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err;
            localStorage.removeItem('pulse_mic_id');
            micFellBack = true;
            micStream = await navigator.mediaDevices.getUserMedia({ audio: base });
        }
        // Analyser d'entrée : niveau micro réel (non routé vers les enceintes → pas de larsen)
        micRaw = ctx.createMediaStreamSource(micStream);
        let nch = 1;
        try { nch = micStream.getAudioTracks()[0].getSettings().channelCount || 1; } catch {}
        micChannels = Math.max(1, nch);
        if (micChannels > 1) {
            // plusieurs entrées : on prend celle choisie (Réglages > Micro > Entrée de l'interface), en mono
            const pick = Math.min(micChannelPref(), micChannels - 1);
            micSplit = ctx.createChannelSplitter(micChannels);
            micRaw.connect(micSplit);
            micSource = ctx.createGain();
            micSource.channelCount = 1; micSource.channelCountMode = 'explicit';
            micSplit.connect(micSource, pick, 0);
        } else micSource = micRaw;
        micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 256;
        micAnalyser.smoothingTimeConstant = 0.3;
        micSource.connect(micAnalyser);
        applyMonitor();
        return micStream;
    }

    // Retour casque : on s'entend pendant qu'on enregistre. Branché direct sur la sortie (pas dans le mix,
    // donc jamais dans l'export). À n'utiliser qu'au casque : sur enceintes le micro se réentend et ça siffle.
    // monitorOn = « Monitoring logiciel » (Réglages) ; monitorRoute = au moins une piste a son bouton « i » actif.
    // Les deux doivent être vrais pour que la voix revienne dans le casque.
    let monitorGain = null, monitorOn = false, monitorHold = false, monitorRoute = true;
    try { monitorOn = localStorage.getItem('pulse_monitor') === '1'; } catch {}
    function applyMonitor() {
        if (!ctx || !micSource) return;
        if (!monitorGain) { monitorGain = ctx.createGain(); monitorGain.connect(ctx.destination); }
        try { micSource.disconnect(monitorGain); } catch {}
        const audible = monitorOn && monitorRoute;
        monitorGain.gain.value = audible && !monitorHold ? 1 : 0;
        if (audible) micSource.connect(monitorGain);
    }
    function setMonitor(on) {
        monitorOn = !!on;
        try { localStorage.setItem('pulse_monitor', monitorOn ? '1' : '0'); } catch {}
        applyMonitor();
    }
    function setMonitorRoute(on) {
        if (monitorRoute === !!on) return;
        monitorRoute = !!on;
        applyMonitor();
    }
    const isMonitorOn = () => monitorOn;

    // Mode Faible latence : actif par défaut. Change seulement l'ouverture du micro (indice de tampon minimal)
    // et l'affichage de la latence réelle ; le retour casque, lui, est déjà direct et sans effet.
    let lowLatency = true;
    try { lowLatency = localStorage.getItem('pulse_low_latency') !== '0'; } catch {}
    const isLowLatency = () => lowLatency;
    function setLowLatency(on) {
        lowLatency = !!on;
        try { localStorage.setItem('pulse_low_latency', lowLatency ? '1' : '0'); } catch {}
        // Le micro est rouvert avec le nouvel indice, sauf pendant une prise
        if (micStream && !(recNode || recorder)) { releaseMic(); return true; }
        return !micStream;
    }
    // Latence réelle de ce que tu entends (ms), mesurée sur ta carte son : entrée + sortie du navigateur
    function getLatencyInfo() {
        if (!ctx) return null;
        const out = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
        let inp = null;
        try {
            const st = micStream && micStream.getAudioTracks()[0].getSettings();
            if (st && typeof st.latency === 'number') inp = st.latency * 1000;
        } catch {}
        return { outMs: out, inMs: inp, totalMs: out + (inp || 0), lowLatency, sampleRate: ctx.sampleRate };
    }

    function getMicAnalyser() { return micAnalyser; }
    function hasMic() { return !!micStream; }
    function isCapturing() { return !!(recNode || recorder); }

    let micFellBack = false;
    // true une seule fois si on a dû revenir au micro par défaut
    function consumeMicFallback() { const v = micFellBack; micFellBack = false; return v; }

    function getMicLabel() {
        const t = micStream && micStream.getAudioTracks()[0];
        return t ? t.label : '';
    }

    function getMicDeviceId() {
        try { return (micStream && micStream.getAudioTracks()[0].getSettings().deviceId) || ''; } catch { return ''; }
    }

    async function listInputs() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
        return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    }

    // Change de micro : pris en compte à la prochaine demande (pas pendant une prise)
    function setInputDevice(deviceId) {
        if (recNode || recorder) return false;
        if (deviceId) localStorage.setItem('pulse_mic_id', deviceId);
        else localStorage.removeItem('pulse_mic_id');
        releaseMic();
        return true;
    }

    function micChannelPref() { try { return Math.max(0, (parseInt(localStorage.getItem('pulse_mic_channel') || '1', 10) || 1) - 1); } catch { return 0; } }
    // Entrée de l'interface à enregistrer (1 = la première). Pris en compte à la prochaine prise (le micro est rouvert).
    function setMicChannel(n) {
        if (recNode || recorder) return false;
        const want = Math.max(1, parseInt(n, 10) || 1);
        const same = (micChannelPref() + 1) === want;
        try { localStorage.setItem('pulse_mic_channel', String(want)); } catch {}
        if (!same) releaseMic();   // le micro est rouvert avec la nouvelle entrée ; rien à faire si c'est déjà la bonne
        return true;
    }
    function getMicChannels() { return micStream ? micChannels : 0; }
    function releaseMic() {
        if (micSource) { try { micSource.disconnect(); } catch {} micSource = null; }
        if (micRaw) { try { micRaw.disconnect(); } catch {} micRaw = null; }
        if (micSplit) { try { micSplit.disconnect(); } catch {} micSplit = null; }
        micAnalyser = null;
        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }
    }

    // Latence aller-retour estimée (sortie + entrée) + correction manuelle (localStorage pulse_latency_ms)
    function getRoundTripLatency() {
        let l = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        try {
            const s = micStream && micStream.getAudioTracks()[0].getSettings();
            if (s && typeof s.latency === 'number') l += s.latency;
        } catch {}
        const manual = parseFloat(localStorage.getItem('pulse_latency_ms') || '0');
        if (isFinite(manual)) l += manual / 1000;
        return Math.max(0, Math.min(0.5, l));
    }

    // Processor de capture : PCM float brut (canal 1), regroupé par blocs de 4096 samples
    const RECORDER_WORKLET = `
        class PulseRecorder extends AudioWorkletProcessor {
            constructor() {
                super();
                this.buf = new Float32Array(4096);
                this.n = 0;
                this.t0 = -1;
                this.on = true;
                this.port.onmessage = (e) => {
                    if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
                };
            }
            flush() {
                if (this.n) { this.port.postMessage({ pcm: this.buf.slice(0, this.n), t0: this.t0 }); this.n = 0; }
            }
            process(inputs) {
                if (!this.on) return false;
                const ch = inputs[0] && inputs[0][0];
                if (!ch) return true;
                if (this.t0 < 0) this.t0 = currentTime;
                if (this.n + ch.length > this.buf.length) this.flush();
                this.buf.set(ch, this.n);
                this.n += ch.length;
                return true;
            }
        }
        registerProcessor('pulse-recorder', PulseRecorder);`;

    function ensureWorklet() {
        if (!ctx.audioWorklet) return Promise.reject(new Error('AudioWorklet indisponible'));
        if (!workletReady) {
            const url = URL.createObjectURL(new Blob([RECORDER_WORKLET], { type: 'application/javascript' }));
            workletReady = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
            workletReady.catch(() => { workletReady = null; });
        }
        return workletReady;
    }

    async function startRecording(targetTrackIdx, projectStartSec, callbacks = {}) {
        await resumeIfNeeded();
        await requestMic();

        recorderTargetIdx = targetTrackIdx;
        recorderStartSec = projectStartSec;
        recorderStartTs = ctx.currentTime;
        recAlign = isPlaying ? { c: playbackStartCtxTime, p: playbackStartProjectTime } : null;
        recWraps = []; recMute = null;

        let usePcm = true;
        try { await ensureWorklet(); } catch (err) { console.warn('Worklet KO, fallback MediaRecorder', err); usePcm = false; }

        if (usePcm) {
            recChunks = [];
            recSamples = 0;
            recFirstFrameTime = -1;
            // 1 canal en mode "discrete" : on garde l'entrée 1 de l'interface sans l'atténuer
            recNode = new AudioWorkletNode(ctx, 'pulse-recorder', {
                numberOfInputs: 1, numberOfOutputs: 1,
                channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'discrete'
            });
            recNode.port.onmessage = (e) => {
                if (e.data.pcm) {
                    if (recFirstFrameTime < 0) recFirstFrameTime = e.data.t0;
                    recChunks.push(e.data.pcm);
                    recSamples += e.data.pcm.length;
                }
            };
            // Sortie muette vers la destination pour que le node soit bien "tiré" par le graphe
            recSink = ctx.createGain();
            recSink.gain.value = 0;
            micSource.connect(recNode);
            recNode.connect(recSink);
            recSink.connect(ctx.destination);
        } else {
            recorderChunks = [];
            const mime = pickBestMime();
            recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) recorderChunks.push(e.data);
            };
            recorder.start(100); // chunk toutes les 100ms
        }

        // Progress ticker (pour l'animation du clip en cours)
        if (callbacks.onProgress) {
            progressTimer = setInterval(() => {
                callbacks.onProgress(ctx.currentTime - recorderStartTs);
            }, 50);
        }
    }

    async function stopRecording() {
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        if (recNode) return stopPcmRecording();
        if (recorder) return stopMediaRecording();
        return null;
    }

    function stopPcmRecording() {
        return new Promise(resolve => {
            const node = recNode;
            const finish = () => {
                clearTimeout(guard);
                try { micSource.disconnect(node); } catch {}
                try { node.disconnect(); recSink.disconnect(); } catch {}
                recNode = null; recSink = null;

                const sr = ctx.sampleRate;
                const all = new Float32Array(recSamples);
                let o = 0;
                for (const c of recChunks) { all.set(c, o); o += c.length; }
                recChunks = [];

                // Alignement : où tombe la 1ère frame capturée dans le projet, latence compensée
                const latency = getRoundTripLatency();
                let startSec = recorderStartSec;
                let drop = latency;
                if (recAlign && recFirstFrameTime >= 0) {
                    const firstProj = recAlign.p + (recFirstFrameTime - recAlign.c) - latency;
                    if (firstProj < recorderStartSec) { drop = recorderStartSec - firstProj; }
                    else { drop = 0; startSec = firstProj; }
                }
                const dropSamples = Math.min(all.length, Math.max(0, Math.round(drop * sr)));
                const pcm = all.subarray(dropSamples);

                let audioBuffer = null;
                if (pcm.length > sr * 0.05) {
                    audioBuffer = ctx.createBuffer(1, pcm.length, sr);
                    audioBuffer.getChannelData(0).set(pcm);
                }
                resolve({
                    audioBuffer,
                    duration: audioBuffer ? audioBuffer.duration : 0,
                    startSec: Math.max(0, startSec),
                    targetTrackIdx: recorderTargetIdx,
                    latency
                });
            };
            const prev = node.port.onmessage;
            node.port.onmessage = (e) => { if (e.data.done) finish(); else prev(e); };
            const guard = setTimeout(finish, 800); // si le worklet ne répond pas
            node.port.postMessage('stop');
        });
    }

    function stopMediaRecording() {
        return new Promise(resolve => {
            recorder.onstop = async () => {
                const blob = new Blob(recorderChunks, { type: recorder.mimeType || 'audio/webm' });
                let audioBuffer = null;
                try {
                    audioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
                } catch (err) {
                    console.error('Decode after rec failed', err);
                }
                resolve({
                    audioBuffer,
                    duration: audioBuffer ? audioBuffer.duration : 0,
                    startSec: recorderStartSec,
                    targetTrackIdx: recorderTargetIdx
                });
                recorder = null;
            };
            recorder.stop();
        });
    }

    function pickBestMime() {
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/ogg;codecs=opus'
        ];
        return candidates.find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    }

    function registerBuffer(clipId, audioBuffer) {
        buffers.set(clipId, audioBuffer);
    }

    // Calcul des peaks d'énergie pour affichage waveform
    // Retourne un Float32Array avec `numPeaks` valeurs entre 0 et 1
    function computePeaks(audioBuffer, numPeaks = 300) {
        const samples = audioBuffer.getChannelData(0);
        const samplesPerPeak = Math.max(1, Math.floor(samples.length / numPeaks));
        const peaks = new Float32Array(numPeaks);
        for (let p = 0; p < numPeaks; p++) {
            let max = 0;
            const start = p * samplesPerPeak;
            const end = Math.min(start + samplesPerPeak, samples.length);
            for (let i = start; i < end; i++) {
                const abs = Math.abs(samples[i]);
                if (abs > max) max = abs;
            }
            peaks[p] = max;
        }
        return peaks;
    }

    function getBuffer(clipId) { return buffers.get(clipId) || null; }

    function hasBuffer(clipId) {
        return buffers.has(clipId);
    }

    function getBufferDuration(clipId) {
        const b = buffers.get(clipId);
        return b ? b.duration : 0;
    }

    function clearBuffers() {
        buffers.clear();
    }

    function isTrackAudible(project, track) {
        const anySolo = project.tracks.some(t => t.solo);
        return !track.muted && (!anySolo || track.solo);
    }

    function volumePoints(track) {
        const pts = track.automation && track.automation.volume && track.automation.volume.points;
        return Array.isArray(pts) ? pts.slice().sort((p, q) => p.t - q.t) : [];
    }

    // Valeur de la courbe à l'instant t (interpolation droite entre les points)
    function volumeAt(pts, t) {
        if (!pts.length) return 1;
        if (t <= pts[0].t) return pts[0].v;
        for (let i = 1; i < pts.length; i++) {
            if (t <= pts[i].t) {
                const a = pts[i - 1], b = pts[i];
                return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
            }
        }
        return pts[pts.length - 1].v;
    }

    // Plages des réglages d'effet automatisables ({ 'fx:comp:threshold': { min, max, log } }), données par l'interface
    let autoRanges = {};
    function setAutoRanges(m) { autoRanges = m || {}; }
    // Réglages de chaque bande du Multibande et de la Saturation multibande (mêmes plages que les boutons, et que auto_range dans fx.rs)
    const BAND_AUTO_RANGES = {
        mband: { lo: [20, 20000, 1], hi: [20, 20000, 1], thr: [-60, 0], range: [-24, 24], att: [0.5, 200, 1], rel: [20, 1000, 1], out: [-12, 12] },
        msat: { lo: [20, 20000, 1], hi: [20, 20000, 1], heat: [0, 100], dyn: [-50, 50], fb: [0, 100], mix: [0, 100], out: [-24, 12], lo2: [-12, 12], md: [-12, 12], hi2: [-12, 12], pr: [-12, 12] }
    };
    function autoRangeOf(pid) {
        const eqm = /^fx:eq:b\d+-(freq|gain)$/.exec(pid), bm = /^fx:(mband|msat):b\d+-(\w+)$/.exec(pid), br = bm && (BAND_AUTO_RANGES[bm[1]] || {})[bm[2]];
        return autoRanges[pid] || (eqm ? (eqm[1] === 'freq' ? { min: 20, max: 20000, log: true } : { min: -18, max: 18 }) : br ? { min: br[0], max: br[1], log: !!br[2] } : null);
    }
    function autoReal(pid, v) {
        const eqm = /^fx:eq:b\d+-(freq|gain)$/.exec(pid), bm = /^fx:(mband|msat):b\d+-(\w+)$/.exec(pid), br = bm && (BAND_AUTO_RANGES[bm[1]] || {})[bm[2]];
        const r = autoRanges[pid] || (eqm ? (eqm[1] === 'freq' ? { min: 20, max: 20000, log: true } : { min: -18, max: 18 }) : br ? { min: br[0], max: br[1], log: !!br[2] } : null);
        if (!r) return null; return r.log && r.min > 0 ? r.min * Math.pow(r.max / r.min, v) : r.min + v * (r.max - r.min); }
    // Automation d'un réglage quelconque : points { t, v } avec v entre 0 et 1 (position dans la plage du réglage)
    function autoCurvePts(owner, pid) {
        const pts = owner && owner.automation && owner.automation[pid] && owner.automation[pid].points;
        return Array.isArray(pts) && pts.length ? pts.slice().sort((p, q) => p.t - q.t) : [];
    }
    // Courbe en fréquence / temps (pts.log) : entre deux points on avance en octaves, comme le moteur d'export
    function pulseAutoAtMain(pts, t) { return pts.log ? Math.exp(volumeAt(pts.map(p => ({ t: p.t, v: Math.log(Math.max(p.v, 1e-9)) })), t)) : volumeAt(pts, t); }
    function autoRamp(param, pts, v, at) { if (pts.log && v > 0) param.exponentialRampToValueAtTime(v, at); else param.linearRampToValueAtTime(v, at); }
    // Filtres d'une bande d'EQ (mêmes calculs que eq_sections dans engine/src/fx.rs)
    // hpf / lpf : pente 12 (1 filtre, q = résonance), 24, 36 ou 48 dB/oct (Butterworth, la résonance va sur le dernier)
    // EQ « calé sur l'analogique » (filtres matched, M. Vicanek 2016) : la courbe suit celle d'un EQ analogique jusqu'à 20 kHz,
    // au lieu de se resserrer dans les aigus comme les filtres standards. Même calcul que eq_matched dans engine/src/fx.rs.
    // Renvoie [b0, b1, b2, a1, a2] (a0 = 1). type : peaking, lowshelf, highshelf, highpass, lowpass, notch. q linéaire.
    function eqMatched(type, f0, q, g, sr) {
        const f = Math.max(10, Math.min(f0, sr * 0.499)), PI = Math.PI;
        const poles = (w, Q) => {
            const z = 1 / (2 * Q);
            const a1 = z <= 1 ? -2 * Math.exp(-z * w) * Math.cos(Math.sqrt(1 - z * z) * w) : -2 * Math.exp(-z * w) * Math.cosh(Math.sqrt(z * z - 1) * w);
            return [a1, Math.exp(-2 * z * w)];
        };
        const ph = (fr) => { const p1 = Math.pow(Math.sin(PI * fr / sr), 2); return [1 - p1, p1, 4 * (1 - p1) * p1]; };
        const fromB = (B0, B1, B2, a1, a2) => {
            const s0 = Math.sqrt(Math.max(B0, 0)), s1 = Math.sqrt(Math.max(B1, 0)), W = 0.5 * (s0 + s1);
            const b0 = 0.5 * (W + Math.sqrt(Math.max(W * W + B2, 0)));
            return [b0, 0.5 * (s0 - s1), -B2 / (4 * b0), a1, a2];
        };
        const w0 = 2 * PI * f / sr;
        if (type === 'peaking' || type === 'bell') {
            const A = Math.pow(10, g / 40), G = A * A, [a1, a2] = poles(w0, A * q), [p0, p1, p2] = ph(f);
            const A0 = (1 + a1 + a2) ** 2, A1 = (1 - a1 + a2) ** 2, A2 = -4 * a2;
            const R1 = (A0 * p0 + A1 * p1 + A2 * p2) * G * G, R2 = (-A0 + A1 + 4 * (p0 - p1) * A2) * G * G;
            const B0 = A0, B2 = (R1 - R2 * p1 - B0) / (4 * p1 * p1), B1 = R2 + B0 + 4 * (p1 - p0) * B2;
            return fromB(B0, B1, B2, a1, a2);
        }
        if (type === 'lowpass' || type === 'highpass') {
            const [a1, a2] = poles(w0, q), [p0, p1, p2] = ph(f);
            const A0 = (1 + a1 + a2) ** 2, A1 = (1 - a1 + a2) ** 2, A2 = -4 * a2;
            if (type === 'highpass') { const b0 = Math.sqrt(Math.max(A0 * p0 + A1 * p1 + A2 * p2, 0)) * q / (4 * p1); return [b0, -2 * b0, b0, a1, a2]; }
            const B1 = ((A0 * p0 + A1 * p1 + A2 * p2) * q * q - A0 * p0) / p1;
            const b0 = 0.5 * (Math.sqrt(A0) + Math.sqrt(Math.max(B1, 0)));
            return [b0, Math.sqrt(A0) - b0, 0, a1, a2];
        }
        if (type === 'notch') {
            const [a1, a2] = poles(w0, q), c = Math.cos(w0), k = (1 + a1 + a2) / (2 - 2 * c);
            return [k, -2 * c * k, k, a1, a2];
        }
        // Plateaux : on calcule toujours la forme dont les pôles restent sous la fréquence (plateau grave qui monte,
        // plateau aigu qui descend), calée sur l'analogique en 0, à la fréquence et à Nyquist ; sinon on l'inverse
        const ls = type === 'lowshelf', inv = (ls && g < 0) || (!ls && g > 0), gd = inv ? -g : g;
        const A = Math.pow(10, gd / 40), Q = Math.SQRT1_2, sA = Math.sqrt(A);
        const H2 = (fr) => {
            const w = Math.max(fr, 1e-6) / f, re = -w * w, im = w * sA / Q;
            const [nr, ni, dr, di] = ls ? [A * (re + A), A * im, A * re + 1, im] : [A * (A * re + 1), A * im, re + A, im];
            return (nr * nr + ni * ni) / (dr * dr + di * di);
        };
        const [a1, a2] = poles(2 * PI * (ls ? f / sA : f * sA) / sr, Q), [p0, p1, p2] = ph(f);
        const A0 = (1 + a1 + a2) ** 2, A1 = (1 - a1 + a2) ** 2, A2 = -4 * a2;
        const B0 = A0 * H2(0), B1 = A1 * H2(sr / 2), B2 = (H2(f) * (A0 * p0 + A1 * p1 + A2 * p2) - B0 * p0 - B1 * p1) / p2;
        const c = fromB(B0, B1, B2, a1, a2);
        if (!inv) return c;
        // inverse : on échange zéros et pôles (le filtre est à phase minimale, l'inverse reste stable)
        return [1 / c[0], a1 / c[0], a2 / c[0], c[1] / c[0], c[2] / c[0]];
    }
    // Les filtres (coefficients) d'une bande d'EQ, à la fréquence d'échantillonnage donnée
    function eqBandCoefs(bd, sr) {
        return eqSections(bd).map(sec => eqMatched(sec.type, bd.freq, sec.qDb !== undefined ? Math.pow(10, sec.qDb / 20) : (sec.q !== undefined ? sec.q : Math.SQRT1_2), sec.gain || 0, sr));
    }
    // Ancienne chaîne fixe (projets d'avant l'EQ libre) = 4 points
    function legacyEqBands(ep) {
        const g = (k, d) => ep[k] !== undefined ? ep[k] : d;
        const out = [{ type: 'hpf', freq: g('hpf', 80), gain: 0, q: 1.0839 }, { type: 'bell', freq: 300, gain: g('midGain', -2), q: 1 },
            { type: 'bell', freq: 4000, gain: g('presence', 2), q: 0.7 }, { type: 'highshelf', freq: 10000, gain: g('air', 1), q: 0.7 }];
        if (ep.lpf) out.push({ type: 'lpf', freq: ep.lpf, gain: 0, q: 1.0839 });
        return out;
    }
    // Point dynamique (mêmes règles que eq_is_dynamic dans fx.rs)
    function eqIsDynamic(bd) { return !!bd && Number(bd.dyn) !== 0 && !!bd.dyn && ['bell', 'lowshelf', 'highshelf', 'tilt'].includes(bd.type); }
    const eqDynLive = new Map();   // 't0:2' (piste 0, point 2) -> { g, ts }
    function getEqDyn(key) { const v = eqDynLive.get(key); return v && performance.now() - v.ts < 300 ? v.g : null; }
    function eqSections(bd) {
        const q = bd.q > 0 ? bd.q : 1;
        if (bd.type === 'hpf' || bd.type === 'lpf') {
            const type = bd.type === 'hpf' ? 'highpass' : 'lowpass';
            const n = Math.max(1, Math.min(4, Math.round((bd.slope || 12) / 12)));
            if (n === 1) return [{ type, qDb: 20 * Math.log10(q) }];
            return Array.from({ length: n }, (_, k) => {
                let qk = 1 / (2 * Math.cos((2 * k + 1) * Math.PI / (4 * n)));
                if (k === n - 1) qk *= q / Math.SQRT1_2;
                return { type, qDb: 20 * Math.log10(qk) };
            });
        }
        if (bd.type === 'lowshelf' || bd.type === 'highshelf') return [{ type: bd.type, gain: bd.gain || 0, gainK: 1 }];
        if (bd.type === 'notch') return [{ type: 'notch', q }];
        if (bd.type === 'tilt') return [{ type: 'lowshelf', gain: -(bd.gain || 0) / 2, gainK: -0.5 }, { type: 'highshelf', gain: (bd.gain || 0) / 2, gainK: 0.5 }];
        return [{ type: 'peaking', q, gain: bd.gain || 0, gainK: 1 }];
    }
    function scheduleAuto(param, pts, toVal, fromTime, t0) {
        if (!pts.length) return;
        param.cancelScheduledValues(0);
        param.setValueAtTime(toVal(volumeAt(pts, fromTime)), t0);
        for (const p of pts) if (p.t > fromTime) param.linearRampToValueAtTime(toVal(p.v), t0 + (p.t - fromTime));
    }

    function clipEndSec(clip) {
        const natural = clip.start + clip.duration;
        return (clip.loopEnd && clip.loopEnd > natural) ? clip.loopEnd : natural;
    }

    // Délai de piste (`track.delayMs`, + = plus tard, − = plus tôt, comme le réglage « Délai » de Logic) : le son de la piste est décalé,
    // pas ses régions à l'écran ni son automation. Même calcul dans render.rs (with_track_delays).
    function withTrackDelays(project) {
        if (!project || !(project.tracks || []).some(t => t.delayMs)) return project;
        return { ...project, tracks: project.tracks.map(t => {
            const d = (t.delayMs || 0) / 1000; if (!d) return t;
            return { ...t, clips: (t.clips || []).map(c => ({ ...c, start: c.start + d, ...(c.loopEnd ? { loopEnd: c.loopEnd + d } : {}) })) };
        }) };
    }
    // Piste gelée (`track.frozen = { id, gain }`, comme « Geler » dans Logic) : elle joue son rendu (régions + effets de piste,
    // avant le fader) à la place de ses régions et de ses effets. Volume, pan, envois, sortie et délai de piste restent actifs.
    // Même calcul dans render.rs (with_frozen).
    function withFrozen(project) {
        if (!project || !(project.tracks || []).some(t => t.frozen)) return project;
        return { ...project, tracks: project.tracks.map(t => {
            if (!t.frozen) return t;
            const buf = buffers.get(t.frozen.id);
            return { ...t, effects: [], mono: false, clips: buf ? [{ id: t.frozen.id, start: 0, duration: buf.duration, offset: 0, gain: t.frozen.gain || 1 }] : [] };
        }) };
    }
    function projectEndSec(project, onlyTrack = null) {
        project = withTrackDelays(withFrozen(project));
        let end = 0;
        project.tracks.forEach((t, i) => {
            if (onlyTrack !== null && i !== onlyTrack) return;
            (t.clips || []).forEach(c => { if (!c.muted && !c.recording) end = Math.max(end, clipEndSec(c)); });
        });
        return end;
    }

    // === Graphe audio commun à la lecture et à l'export ===
    // actx     : AudioContext live ou OfflineAudioContext
    // dest     : node de sortie (master)
    // opts     : { fromTime, t0, endTime, onlyTrack, live }
    //   fromTime = position projet de départ, t0 = temps contexte correspondant
    //   live     = garde les pistes mutées dans le graphe (gain 0) pour mute/solo à chaud + VU-mètres
    //   freeze   = rendu d'une piste à geler : le son est pris juste après ses effets (voir renderFreeze)
    function buildGraph(actx, project, dest, opts) {
        project = withTrackDelays(withFrozen(project));
        const { fromTime = 0, t0 = 0, endTime = Infinity, onlyTrack = null, live = false, freeze = false } = opts;
        const sources = [];

        // Bus : piste → bus → bus… → master (un stem seul contourne les bus)
        const busNodes = new Map();
        const getBus = (id, depth = 0) => {
            if (!id || id === 'master' || onlyTrack !== null || depth > 8) return dest;
            if (busNodes.has(id)) return busNodes.get(id);
            const bus = (project.buses || []).find(b => b.id === id);
            if (!bus) return dest;
            // Effets communs du groupe (ex. une seule reverb pour toutes les voix) → volume du groupe → sortie
            const fx = createEffectsChain(actx, bus.effects || [], { ...(bus.effectParams || {}), order: bus.fxOrder, grKey: 'b' + id, auto: bus.automation, autoAt: { t0, from: fromTime } }, project.bpm, project.ceilingDb ?? ceilingDb);
            // Un bus reçoit toujours du stéréo (après le gauche / droite des pistes) : sans ça, le navigateur peut le croire mono
            // quand une piste n'a pas encore commencé, et la reverb du bus baisserait de 3 dB
            fx.input.channelCount = 2; fx.input.channelCountMode = 'explicit'; fx.input.channelInterpretation = 'speakers';
            const g = actx.createGain();
            g.gain.value = bus.muted ? 0 : (bus.volume ?? 100) / 100;
            fx.output.connect(g);
            busNodes.set(id, fx.input);
            const out = getBus(bus.output, depth + 1);
            // Courbe de volume du groupe (comme sur une piste)
            const bpts = volumePoints(bus);
            let tail = g;
            if (bpts.length) {
                const autoGain = actx.createGain();
                autoGain.gain.setValueAtTime(volumeAt(bpts, fromTime), t0);
                for (const p of bpts) {
                    if (p.t > fromTime) autoGain.gain.linearRampToValueAtTime(p.v, t0 + (p.t - fromTime));
                }
                g.connect(autoGain);
                tail = autoGain;
            }
            // Gauche / droite du groupe (comme une piste)
            if (bus.pan || autoCurvePts(bus, 'pan').length) {
                const pn = actx.createStereoPanner();
                pn.pan.value = Math.max(-1, Math.min(1, (bus.pan || 0) / 100));
                scheduleAuto(pn.pan, autoCurvePts(bus, 'pan'), n => -1 + 2 * n, fromTime, t0);   // après la valeur fixe, sinon elle écrase la courbe
                tail.connect(pn);
                tail = pn;
            }
            tail.connect(out);
            // Envoi « avant le fader » d'un groupe : pris à la sortie de ses effets (coupé si le groupe est coupé)
            let busPre = null;
            const busTap = (key) => {
                if (!(bus.preSends || {})[key]) return tail;
                if (!busPre) { busPre = actx.createGain(); busPre.gain.value = bus.muted ? 0 : 1; fx.output.connect(busPre); }
                return busPre;
            };
            // Envois du groupe (reverb, écho…) : pris après son volume et son pan, comme sur une piste
            if (onlyTrack === null) {
                for (const sendId of new Set([...Object.keys(bus.sends || {}), ...Object.keys(bus.automation || {}).filter(k => k.startsWith('send:')).map(k => k.slice(5))])) {
                    const level = (bus.sends || {})[sendId] || 0, ap = autoCurvePts(bus, 'send:' + sendId);
                    if (!(level > 0) && !ap.length) continue;
                    const sendIn = getSend(sendId);
                    if (!sendIn) continue;
                    const sg = actx.createGain();
                    sg.gain.value = level / 100;
                    scheduleAuto(sg.gain, ap, n => n, fromTime, t0);
                    busTap('send:' + sendId).connect(sg); sg.connect(sendIn);
                }
                for (const busId of new Set([...Object.keys(bus.busSends || {}), ...Object.keys(bus.automation || {}).filter(k => k.startsWith('busSend:')).map(k => k.slice(8))])) {
                    const level = (bus.busSends || {})[busId] || 0, ap = autoCurvePts(bus, 'busSend:' + busId);
                    if ((!(level > 0) && !ap.length) || busId === id) continue;
                    const tgt = getBus(busId);
                    if (!tgt || tgt === dest || tgt === out) continue;
                    const sg = actx.createGain();
                    sg.gain.value = level / 100;
                    scheduleAuto(sg.gain, ap, n => n, fromTime, t0);
                    busTap('busSend:' + busId).connect(sg); sg.connect(tgt);
                }
            }
            if (live) {
                liveBusNodes.set(id, g);
                // Spectre fin du groupe (EQ d'un groupe : voir le signal sous la courbe)
                const spec = actx.createAnalyser();
                spec.fftSize = 4096; spec.smoothingTimeConstant = 0.82;
                fx.output.connect(spec);
                liveBusSpec.set(id, spec);
            }
            return fx.input;
        };

        // Envois : un effet commun, 100 % effet (aucun son direct). Chaque piste y envoie la dose qu'elle veut,
        // prise après son volume et son placement gauche / droite. Le retour va droit au master.
        const sendNodes = new Map();
        const getSend = (id) => {
            if (sendNodes.has(id)) return sendNodes.get(id);
            const sd = (project.sends || []).find(x => x.id === id);
            let input = null;
            if (sd && !sd.muted && fxReady.has(actx)) {
                const common = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' };
                const node = sd.type === 'delay'
                    ? new AudioWorkletNode(actx, 'pulse-delay', { ...common, processorOptions: { time: delaySeconds(sd, project.bpm), feedback: (sd.feedback ?? 35) / 100, wet: 1, dry: 0, pp: !!sd.pp } })
                    : new AudioWorkletNode(actx, 'pulse-reverb', { ...common, processorOptions: { wet: 1, size: sd.size ?? 3.2, pre: (sd.pre || 0) / 1000 } });
                const ret = actx.createGain();
                ret.gain.value = (sd.volume ?? 100) / 100 * (sd.type === 'delay' ? 1 : SEND_REVERB_TRIM);
                input = actx.createGain();
                input.connect(node); node.connect(ret); ret.connect(dest);
            }
            sendNodes.set(id, input);
            return input;
        };

        project.tracks.forEach((track, trackIdx) => {
            if (onlyTrack !== null && trackIdx !== onlyTrack) return;
            const audible = onlyTrack !== null ? true : isTrackAudible(project, track);
            if (!audible && !live) return;
            const trackDest = freeze ? actx.createGain() : getBus(track.output);   // gel : la sortie normale de la piste ne va nulle part

            // Chaîne : clip → gain clip (fades) → effets → gain piste → pan → [analyser] → master
            const vol = (track.volume ?? 100) / 100;
            const trackGain = actx.createGain();
            trackGain.gain.value = audible ? vol : 0;

            const fx = createEffectsChain(actx, track.effects || [], { ...(track.effectParams || {}), order: track.fxOrder, grKey: 't' + trackIdx, auto: track.automation, autoAt: { t0, from: fromTime } }, project.bpm);
            fx.output.connect(trackGain);
            // Piste forcée en mono (bouton Mono / Stéréo) : les deux côtés se mélangent avant les effets
            let fxIn = fx.input;
            if (track.mono) {
                const fold = actx.createGain();
                fold.channelCount = 1; fold.channelCountMode = 'explicit'; fold.channelInterpretation = 'speakers';
                fold.connect(fx.input);
                fxIn = fold;
            }
            // Gel : le son après les effets, sans conversion ; un son mono garde un canal droit vide (le séparateur ne le recopie pas)
            if (freeze) {
                const sp = actx.createChannelSplitter(2), mg = actx.createChannelMerger(2);
                fx.output.connect(sp); sp.connect(mg, 0, 0); sp.connect(mg, 1, 1); mg.connect(dest);
            }

            const panNode = actx.createStereoPanner();
            panNode.pan.value = Math.max(-1, Math.min(1, (track.pan || 0) / 100));
            scheduleAuto(panNode.pan, autoCurvePts(track, 'pan'), n => -1 + 2 * n, fromTime, t0);
            let preMeter = trackGain;   // point de mesure du niveau : après le fader, avant le pan (comme un canal de console)
            // Courbe de volume (automation) : 0 = silence … 1 = niveau du fader
            const pts = volumePoints(track);
            if (pts.length) {
                const autoGain = actx.createGain();
                autoGain.gain.setValueAtTime(volumeAt(pts, fromTime), t0);
                for (const p of pts) {
                    if (p.t > fromTime) autoGain.gain.linearRampToValueAtTime(p.v, t0 + (p.t - fromTime));
                }
                trackGain.connect(autoGain);
                autoGain.connect(panNode);
                preMeter = autoGain;
            } else {
                trackGain.connect(panNode);
            }

            if (live) {
                const analyser = actx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.6;
                panNode.connect(analyser);
                analyser.connect(trackDest);
                // Spectre fin pour l'EQ : le son de la piste après ses effets (voir le signal sous la courbe)
                const spec = actx.createAnalyser();
                spec.fftSize = 4096;
                spec.smoothingTimeConstant = 0.82;
                fx.output.connect(spec);
                // Niveau gauche / droite pour le vu-mètre de la piste (deux barres collées en stéréo, une seule en mono)
                const msp = actx.createChannelSplitter(2);
                const mL = actx.createAnalyser(), mR = actx.createAnalyser();
                mL.fftSize = mR.fftSize = 512; mL.smoothingTimeConstant = mR.smoothingTimeConstant = 0.3;
                preMeter.connect(msp); msp.connect(mL, 0); msp.connect(mR, 1);
                liveNodes.set(trackIdx, { gainNode: trackGain, panNode, analyser, spec, meterL: mL, meterR: mR, vol, audible });
            } else {
                panNode.connect(trackDest);
            }

            // Envois « avant le fader » (Pre, comme Logic) : pris après les effets, avant le fader et le pan, coupés par le mute
            const pre = track.preSends || {};
            let preTap = null;
            const tapOf = (key) => {
                if (!pre[key]) return panNode;
                if (!preTap) { preTap = actx.createGain(); preTap.gain.value = audible ? 1 : 0; fx.output.connect(preTap); if (live && liveNodes.has(trackIdx)) liveNodes.get(trackIdx).preTap = preTap; }
                return preTap;
            };
            const sendIds = new Set([...Object.keys(track.sends || {}), ...Object.keys(track.automation || {}).filter(k => k.startsWith('send:')).map(k => k.slice(5))]);
            for (const sendId of sendIds) {
                const level = (track.sends || {})[sendId] || 0, ap = autoCurvePts(track, 'send:' + sendId);
                if (!(level > 0) && !ap.length) continue;
                const send = getSend(sendId);
                if (!send) continue;
                const sg = actx.createGain();
                sg.gain.value = level / 100;
                scheduleAuto(sg.gain, ap, n => n, fromTime, t0);
                tapOf('send:' + sendId).connect(sg); sg.connect(send);
            }
            // Envois vers un groupe (façon Aux de Logic) : le son part en plus vers l'entrée de ce groupe
            for (const busId of new Set([...Object.keys(track.busSends || {}), ...Object.keys(track.automation || {}).filter(k => k.startsWith('busSend:')).map(k => k.slice(8))])) {
                const level = (track.busSends || {})[busId] || 0, ap = autoCurvePts(track, 'busSend:' + busId);
                if (!(level > 0) && !ap.length) continue;
                const tgt = getBus(busId);
                if (!tgt || tgt === dest || tgt === trackDest) continue;
                const sg = actx.createGain();
                sg.gain.value = level / 100;
                scheduleAuto(sg.gain, ap, n => n, fromTime, t0);
                tapOf('busSend:' + busId).connect(sg); sg.connect(tgt);
            }

            (track.clips || []).forEach(clip => {
                if (clip.muted || clip.recording) return;
                const buf = buffers.get(clip.id);
                if (!buf) return;

                const start = clip.start;
                const dur = clip.duration;
                const end = clipEndSec(clip);
                const looped = end > start + dur + 1e-6;
                const segStart = Math.max(start, fromTime);
                const segEnd = Math.min(end, endTime);
                if (segEnd <= segStart || dur <= 0) return;

                const when = t0 + (segStart - fromTime);
                const playLen = segEnd - segStart;
                const into = segStart - start;          // temps déjà écoulé dans le clip
                const off = Math.max(0, clip.offset || 0); // début du clip dans le fichier source

                const source = actx.createBufferSource();
                source.buffer = buf;
                let bufPos = off + into;
                if (looped) {
                    source.loop = true;
                    source.loopStart = off;
                    source.loopEnd = Math.min(buf.duration, off + dur);
                    bufPos = off + (into % dur);
                }
                if (bufPos >= buf.duration) return;

                // Gain clip + fades (relatifs au clip entier, même si on démarre au milieu)
                const base = clip.gain !== undefined ? clip.gain : 1.0;
                // Fondu enchaîné automatique (comme Logic) : là où deux régions de la piste se chevauchent,
                // la première s'éteint et la seconde monte sur toute la zone commune
                let xIn = 0, xOut = 0;
                for (const o of (track.clips || [])) {
                    if (o === clip || o.muted || o.recording || !(o.duration > 0)) continue;
                    const oEnd = clipEndSec(o);
                    // chevauchement partiel seulement : une région entièrement contenue dans l'autre ne fait pas de fondu enchaîné
                    if (o.start < start - 1e-6 && oEnd > start + 1e-6 && oEnd < end - 1e-6) xIn = Math.max(xIn, oEnd - start);       // une région précédente recouvre mon début
                    if (o.start > start + 1e-6 && o.start < end - 1e-6 && oEnd > end + 1e-6) xOut = Math.max(xOut, end - o.start);  // une région suivante recouvre ma fin
                }
                const fi = Math.max(clip.fadeIn || 0, xIn);
                const fo = Math.max(clip.fadeOut || 0, xOut);
                const total = end - start;
                // Courbure des fondus : niveau = p^k (k = 1 : droit), comme le dessin et le moteur Rust
                const kIn = clip.fadeInCurve > 0 ? Math.max(0.25, Math.min(4, clip.fadeInCurve)) : 1;
                const kOut = clip.fadeOutCurve > 0 ? Math.max(0.25, Math.min(4, clip.fadeOutCurve)) : 1;
                const fiLevel = (x) => (fi > 0 && x < fi) ? Math.pow(x / fi, kIn) : 1;
                const foLevel = (x) => (fo > 0 && x > total - fo) ? Math.pow(Math.max(0, (total - x) / fo), kOut) : 1;
                // Une rampe par morceaux : droite si k = 1, sinon assez de segments pour suivre la courbe
                const ramp = (x0, x1, k) => {
                    const n = Math.abs(k - 1) < 1e-6 ? 1 : 32;
                    for (let j = 1; j <= n; j++) {
                        const x = x0 + (x1 - x0) * j / n;
                        g.gain.linearRampToValueAtTime(base * fiLevel(x) * foLevel(x), when + (x - into));
                    }
                };

                const g = actx.createGain();
                g.gain.setValueAtTime(base * fiLevel(into) * foLevel(into), when);
                if (fi > 0 && into < fi) {
                    ramp(into, Math.min(fi, into + playLen), kIn);
                }
                if (fo > 0 && into + playLen > total - fo) {
                    const foStart = Math.max(total - fo, into, fi > 0 ? Math.min(fi, into + playLen) : 0);
                    if (foStart > into) g.gain.setValueAtTime(base * fiLevel(foStart) * foLevel(foStart), when + (foStart - into));
                    ramp(foStart, into + playLen, kOut);
                }
                source.connect(g);
                // Effets posés sur la région seule : avant ceux de la piste ; l'écho / la reverb continuent après la fin de la région
                if (clip.fx && (clip.fx.effects || []).length) {
                    const cfx = createEffectsChain(actx, clip.fx.effects, { ...(clip.fx.effectParams || {}), order: clip.fx.fxOrder }, project.bpm, project.ceilingDb ?? ceilingDb);
                    g.connect(cfx.input); cfx.output.connect(fxIn);
                } else {
                    g.connect(fxIn);
                }

                try {
                    source.start(when, bufPos, playLen);
                } catch (err) {
                    console.error('BufferSource start failed', err);
                }
                sources.push(source);
            });
        });
        return sources;
    }

    // === Lecture multipiste synchronisée depuis fromTime (en secondes) ===
    // Moteur natif (appli de bureau) : `setNativeBackend(PulseNative)` avant la lecture ; jamais pendant une prise.
    let nativeBackend = null, nativeProject = null, nativeWall = 0, nativeFrom = 0, nativeOn = false, nativeTimer = null;
    function setNativeBackend(b) { nativeBackend = b || null; }
    function isNative() { return nativeOn; }
    function nativeRefreshSoon() {
        if (!nativeOn || !nativeProject) return;
        clearTimeout(nativeTimer);
        nativeTimer = setTimeout(() => {
            if (!nativeOn || !nativeProject) return;
            play(nativeProject, getPlaybackPosition());
        }, 250);
    }

    // Monte un passage de lecture complet (sources + effets) dans sa propre sortie, départ à t0 (temps du contexte)
    function buildPass(project, fromTime, t0) {
        const out = ctx.createGain(); out.connect(masterGain);
        const made = new Set(), protoConnect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (...a) { made.add(this); return protoConnect.apply(this, a); };
        let src;
        try { src = buildGraph(ctx, project, out, { fromTime, t0, live: true }); }
        finally { AudioNode.prototype.connect = protoConnect; }
        made.delete(masterGain); made.delete(out);
        return { src, graph: [...made], out };
    }
    function tearPass(o) {
        o.src.forEach(x => { try { x.stop(); } catch {} });
        o.graph.forEach(n => { try { n.disconnect(); } catch {} });
        try { o.out.disconnect(); } catch {}
    }
    // Annule un tour de boucle déjà monté (boucle changée, saut, arrêt) : le passage en cours reprend son volume
    function cancelLoopNext() {
        clearTimeout(loopTimer); loopTimer = null;
        clearTimeout(loopSwapTimer); loopSwapTimer = null;
        if (loopNext) {
            tearPass(loopNext);
            if (activeOut) { activeOut.gain.cancelScheduledValues(loopNext.c - 1e-4); activeOut.gain.setValueAtTime(1, Math.max(ctx.currentTime, loopNext.c - 1e-4)); }
            loopNext = null;
        }
    }
    function armLoop() {
        clearTimeout(loopTimer); loopTimer = null;
        // pendant une prise, la boucle continue (enregistrement en boucle) si la capture est calée sur la lecture
        if (!loopCfg || !isPlaying || nativeOn || ((recNode || recorder) && !recAlign) || !lastPlayProject || loopNext) return;
        const { a, b } = loopCfg, pos = getPlaybackPosition();
        if (b - a < 0.25 || pos >= b - 0.15) return;   // trop court ou trop tard : la page fait le saut elle-même (avec fondu)
        const tEnd = ctx.currentTime + (b - pos);
        loopTimer = setTimeout(() => {
            loopTimer = null;
            if (!isPlaying || !loopCfg || loopCfg.a !== a || loopCfg.b !== b || loopNext) return;
            if (tEnd - ctx.currentTime < 0.03) return;
            const XF = 0.004, pass = buildPass(lastPlayProject, a, tEnd);
            pass.out.gain.setValueAtTime(0, 0); pass.out.gain.setValueAtTime(0, tEnd); pass.out.gain.linearRampToValueAtTime(1, tEnd + XF);
            if (activeOut) { activeOut.gain.setValueAtTime(1, tEnd); activeOut.gain.linearRampToValueAtTime(0, tEnd + XF); }
            // prise en boucle : l'ancienne prise de la piste enregistrée reste muette à chaque tour
            if (recMute && (recNode || recorder)) { const n = liveNodes.get(recMute.idx); if (n) { n.gainNode.gain.cancelScheduledValues(0); n.gainNode.gain.setValueAtTime(0, 0); } }
            loopNext = { ...pass, c: tEnd, p: a };
            loopSwapTimer = setTimeout(() => {
                loopSwapTimer = null;
                if (!loopNext) return;
                const old = { src: activeSources, graph: activeGraph, out: activeOut };
                old.tear = () => { tearPass(old); const k = fading.indexOf(old); if (k >= 0) fading.splice(k, 1); };
                fading.push(old); old.timer = setTimeout(old.tear, 60);
                activeSources = loopNext.src; activeGraph = loopNext.graph; activeOut = loopNext.out;
                if ((recNode || recorder) && recAlign) recWraps.push(recAlign.p + (loopNext.c - recAlign.c));
                playbackStartCtxTime = loopNext.c; playbackStartProjectTime = loopNext.p;
                loopNext = null;
                armLoop();
            }, Math.max(0, (tEnd - ctx.currentTime) * 1000 + 20));
        }, Math.max(0, (b - pos - 0.25) * 1000));
    }
    // La page indique la boucle à chaque image (null = pas de boucle) ; on ne remonte le tour suivant que si elle change
    function setLoop(l) {
        const n = l ? { a: Math.min(l.start, l.end), b: Math.max(l.start, l.end) } : null;
        if ((!n && !loopCfg) || (n && loopCfg && Math.abs(n.a - loopCfg.a) < 1e-6 && Math.abs(n.b - loopCfg.b) < 1e-6)) return;
        loopCfg = n;
        cancelLoopNext();
        armLoop();
    }
    // Vrai quand le prochain tour de boucle est déjà prévu par le moteur : la page ne doit pas relancer la lecture elle-même
    function getRecWraps() { return recWraps.slice(); }
    // Position sur le temps continu de la capture (ne revient pas en arrière à chaque tour de boucle)
    function getRecLinearPosition() { return recAlign && ctx ? recAlign.p + (ctx.currentTime - recAlign.c) : getPlaybackPosition(); }
    function loopScheduled() { return !!(loopCfg && isPlaying && !nativeOn && (loopTimer || loopNext || loopSwapTimer)); }

    // opts.smooth : relance pour un changement d'effet pendant la lecture → fondu enchaîné de 20 ms entre l'ancien et le nouveau montage,
    // même position, sans coupure (avant : le son s'arrêtait net, 50 ms de silence + un « clac » à chaque plugin ajouté)
    async function play(project, fromTime, opts = {}) {
        if (nativeBackend && !(recNode || recorder)) {
            stopAll();
            clearLiveNodes();
            nativeProject = project; nativeFrom = fromTime;
            nativeOn = true; isPlaying = true;
            try {
                await nativeBackend.play(project, fromTime);
                nativeWall = performance.now();
            } catch (err) {
                nativeOn = false; isPlaying = false;
                console.error('moteur natif :', err);
                if (nativeBackend.onError) nativeBackend.onError(err);
                nativeBackend = null;
                // Repli : le moteur du navigateur joue à la place
                return play(project, fromTime);
            }
            return;
        }
        await resumeIfNeeded();
        cancelLoopNext();
        const smooth = !!(opts.smooth && isPlaying && activeOut && !(recNode || recorder));
        let old = null;
        const lead = smooth && !opts.jump ? 0.06 : 0.05;   // petit lookahead
        if (smooth) {
            // changement d'effet : la nouvelle lecture démarre là où le son SERA dans 60 ms ; saut (clic dans la règle, tour de boucle,
            // opts.jump) : elle démarre à la position demandée ; dans les deux cas l'ancienne continue jusqu'au fondu
            if (!opts.jump) fromTime = getPlaybackPosition() + lead;
            old = { src: activeSources, graph: activeGraph, out: activeOut };
            activeSources = []; activeGraph = []; activeOut = null;
        } else stopAll();
        clearLiveNodes();

        playbackStartCtxTime = ctx.currentTime + lead;
        playbackStartProjectTime = fromTime;
        // Chaque montage a sa propre sortie (c'est elle qu'on fond) ; on note chaque noeud créé pour pouvoir TOUT débrancher à l'arrêt
        // (sinon les anciens effets et analyseurs continuent de tourner dans le vide : le son devenait plus lent et craquait)
        const pass = buildPass(project, fromTime, playbackStartCtxTime), gOut = pass.out;
        activeSources = pass.src; activeGraph = pass.graph; activeOut = gOut;
        isPlaying = true;
        lastPlayProject = project;
        if (smooth) {
            const t0 = playbackStartCtxTime, XF = opts.jump ? 0.008 : 0.02, now = ctx.currentTime;
            gOut.gain.setValueAtTime(0, 0); gOut.gain.setValueAtTime(0, t0); gOut.gain.linearRampToValueAtTime(1, t0 + XF);
            // changement d'effet : les deux montages jouent la même chose, on les enchaîne au moment du départ ; saut : l'ancien s'éteint tout de suite
            const offAt = opts.jump ? now : t0;
            old.out.gain.cancelScheduledValues(0); old.out.gain.setValueAtTime(1, offAt); old.out.gain.linearRampToValueAtTime(0, offAt + XF);
            const tear = () => { old.src.forEach(x => { try { x.stop(); } catch {} }); old.graph.forEach(n => { try { n.disconnect(); } catch {} }); try { old.out.disconnect(); } catch {} const k = fading.indexOf(old); if (k >= 0) fading.splice(k, 1); };
            old.tear = tear; fading.push(old);
            old.timer = setTimeout(tear, (lead + XF + 0.06) * 1000);
        }
        // Capture lancée juste avant la lecture : on la cale sur CE départ (et on n'y touche plus ensuite)
        if ((recNode || recorder) && !recAlign) recAlign = { c: playbackStartCtxTime, p: playbackStartProjectTime };
        armLoop();
    }

    function stopAll() {
        if (nativeOn) { nativeOn = false; clearTimeout(nativeTimer); try { nativeBackend && nativeBackend.stop(); } catch {} }
        if (loopNext || loopTimer || loopSwapTimer) { clearTimeout(loopTimer); clearTimeout(loopSwapTimer); loopTimer = loopSwapTimer = null; if (loopNext) { tearPass(loopNext); loopNext = null; } }
        fading.slice().forEach(o => { clearTimeout(o.timer); o.tear(); });   // un fondu en cours est coupé tout de suite à l'arrêt
        activeSources.forEach(s => {
            try { s.stop(); } catch {}
        });
        activeSources = [];
        activeGraph.forEach(n => { try { n.disconnect(); } catch {} });
        activeGraph = [];
        if (activeOut) { try { activeOut.disconnect(); } catch {} activeOut = null; }
        isPlaying = false;
    }

    function getPlaybackPosition() {
        if (nativeOn) return nativeFrom + (performance.now() - nativeWall) / 1000;
        if (!ctx) return 0;
        if (loopNext && ctx.currentTime >= loopNext.c) return loopNext.p + (ctx.currentTime - loopNext.c);
        return playbackStartProjectTime + (ctx.currentTime - playbackStartCtxTime);
    }

    // === Export WAV mixdown (même graphe que la lecture : effets, fades, répétitions inclus) ===
    // opts: { startSec, endSec } pour export d'une plage seulement
    async function exportWav(project, opts = {}) {
        return renderOffline(project, opts, null);
    }

    // Exporte une piste unique (stem) en WAV — ignore solo/mute des autres pistes
    async function exportTrackWav(project, trackIdx) {
        if (!project.tracks[trackIdx]) return null;
        return renderOffline(project, {}, trackIdx);
    }

    // Geler une piste : rend ses régions et ses effets (automation des effets comprise), avant le fader, depuis 0 s.
    // Retourne { buffer, gain } ou null : buffer mono si le son de la piste l'est (même loi de pan que la piste vivante),
    // ramené sous 0 dBFS pour le WAV 16 bits ; `gain` est le facteur à réappliquer à la lecture.
    async function renderFreeze(project, trackIdx) {
        const t = project.tracks[trackIdx];
        if (!t || t.frozen) return null;
        const automation = Object.fromEntries(Object.entries(t.automation || {}).filter(([k]) => k.startsWith('fx:')));
        const copy = { ...project, tracks: project.tracks.map((x, i) => i !== trackIdx ? x
            : { ...x, volume: 100, pan: 0, delayMs: 0, sends: {}, busSends: {}, preSends: {}, automation }) };
        // 1 s de plus au moins pour la fin des effets (un filtre, un compresseur résonnent encore après la région), puis le silence de la fin est retiré
        const out = await renderOffline(copy, { freeze: true, raw: true, minTail: 1 }, trackIdx);
        if (!out) return null;
        const L0 = out.getChannelData(0), R0 = out.getChannelData(1);
        let end = L0.length;
        while (end > 0 && Math.abs(L0[end - 1]) <= 1e-6 && Math.abs(R0[end - 1]) <= 1e-6) end--;
        if (!end) return null;
        const L = L0.subarray(0, end), R = R0.subarray(0, end);
        const stereoSrc = !t.mono && (t.clips || []).some(c => !c.muted && !c.recording && (buffers.get(c.id)?.numberOfChannels || 1) > 1);
        let stereo = stereoSrc, peak = 0;
        for (let i = 0; i < L.length; i++) {
            if (R[i] !== 0) stereo = true;
            peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
        }
        const gain = peak > 0.99 ? peak / 0.99 : 1;
        const buffer = new AudioBuffer({ numberOfChannels: stereo ? 2 : 1, length: end, sampleRate: out.sampleRate });
        [L, R].slice(0, stereo ? 2 : 1).forEach((d, c) => { const o = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) o[i] = d[i] / gain; });
        return { buffer, gain };
    }

    async function renderOffline(project, opts, onlyTrack) {
        await init();
        project = withFrozen(project);   // une piste gelée n'a plus d'effets : sa queue est déjà dans son rendu
        const totalDuration = projectEndSec(project, onlyTrack);
        if (totalDuration === 0) return null;

        const rangeStart = opts.startSec ?? 0;
        const isRange = opts.endSec !== undefined;
        const rangeEnd = opts.endSec ?? totalDuration;
        if (rangeEnd - rangeStart <= 0) return null;

        // Queue de reverb : on laisse l'effet mourir proprement après le dernier clip
        // Queue : on laisse la reverb et les échos mourir proprement après le dernier clip
        const uses = (name) => project.tracks.some((t, i) => (onlyTrack === null || i === onlyTrack) && ((t.effects || []).includes(name) || (t.clips || []).some(c => c.fx && (c.fx.effects || []).includes(name))))
            || (onlyTrack === null && (project.buses || []).some(b => (b.effects || []).includes(name)));
        const sendUsed = (type) => (project.sends || []).some(sd => !sd.muted && (sd.type === 'delay') === (type === 'delay')
            && (project.tracks.some((t, i) => (onlyTrack === null || i === onlyTrack) && (t.sends || {})[sd.id] > 0)
                || (onlyTrack === null && (project.buses || []).some(b => (b.sends || {})[sd.id] > 0))));
        const tail = isRange ? 0 : Math.max(opts.minTail || 0, (uses('delay') || sendUsed('delay')) ? 4 : (uses('reverb') || sendUsed('reverb')) ? 2.5 : 0);
        const duration = rangeEnd - rangeStart + tail;

        const sampleRate = 48000;
        const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
        await ensureFx(offline);
        const mg = offline.createGain();
        mg.gain.value = onlyTrack === null ? masterVolume * MASTER_TRIM : 1;
        if (onlyTrack === null) {
            const lim = createSafetyLimiter(offline, project.ceilingDb ?? ceilingDb);
            mg.connect(lim.input);
            lim.output.connect(offline.destination);
        } else {
            mg.connect(offline.destination);
        }

        buildGraph(offline, project, mg, { fromTime: rangeStart, t0: 0, endTime: rangeEnd, onlyTrack, freeze: !!opts.freeze });

        const rendered = await offline.startRendering();
        if (opts.raw) return rendered;
        // « Volume au maximum » : on remonte tout le morceau pour que la crête arrive à -1 dBFS
        if (opts.normalize) {
            let peak = 0;
            for (let c = 0; c < rendered.numberOfChannels; c++) {
                const d = rendered.getChannelData(c);
                for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
            }
            if (peak > 1e-4) {
                const g = Math.min(8, dbToLin(project.ceilingDb ?? ceilingDb) / peak); // jamais plus de +18 dB : on n'amplifie pas un souffle
                for (let c = 0; c < rendered.numberOfChannels; c++) {
                    const d = rendered.getChannelData(c);
                    for (let i = 0; i < d.length; i++) d[i] *= g;
                }
            }
        }
        return audioBufferToWav(rendered);
    }

    function audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const samples = buffer.length;
        const dataSize = samples * numChannels * 2;
        const header = 44;
        const arrayBuffer = new ArrayBuffer(header + dataSize);
        const view = new DataView(arrayBuffer);

        writeStr(view, 0,  'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(view, 8,  'WAVE');
        writeStr(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        view.setUint16(32, numChannels * 2, true);
        view.setUint16(34, 16, true);
        writeStr(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        const channels = [];
        for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

        let offset = header;
        for (let i = 0; i < samples; i++) {
            for (let c = 0; c < numChannels; c++) {
                let s = Math.max(-1, Math.min(1, channels[c][i]));
                s = s < 0 ? s * 0x8000 : s * 0x7FFF;
                view.setInt16(offset, s, true);
                offset += 2;
            }
        }
        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    function writeStr(view, offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    // Références live des gain/pan + analyser par piste (pour update en direct + VU-mètres)
    const liveNodes = new Map();
    const liveBusNodes = new Map();
    const liveBusSpec = new Map();

    // ===================== EFFETS INTÉGRÉS (presets Pulse) =====================
    // Crée une chaîne EQ -> Comp -> Reverb selon les flags du track.effects
    // Retourne { input, output } pour brancher avant le gain de piste.
    function createEffectsChain(actx, enabled = [], params = {}, bpm = 120, ceiling = ceilingDb) {
        const input = actx.createGain();
        let prev = input;
        const connect = (n) => { prev.connect(n); prev = n; };
        // Courbes d'automation des réglages, converties dans l'unité de l'effet
        const autoAt = params.autoAt || { t0: 0, from: 0 };
        const curveOf = (fx, key, conv = (x) => x) => {
            const pid = `fx:${fx}:${key}`, pts = autoCurvePts({ automation: params.auto }, pid);
            if (!pts.length || autoReal(pid, 0) === null) return null;
            const out = pts.map(p => ({ t: p.t, v: conv(autoReal(pid, p.v)) }));
            const r = autoRangeOf(pid); if (r && r.log && r.min > 0) out.log = true;
            return out;
        };
        const autoAll = (fx) => autoOpts(fx, Object.fromEntries(Object.keys(params.auto || {}).filter(k => k.startsWith(`fx:${fx}:`)).map(k => [k.split(':')[2], null])));
        const hasAuto = (fx) => Object.keys(params.auto || {}).some(k => k.startsWith(`fx:${fx}:`) && autoCurvePts({ automation: params.auto }, k).length);
        const autoOpts = (fx, map) => {
            const auto = {};
            for (const [key, conv] of Object.entries(map)) { const c = curveOf(fx, key, conv || undefined); if (c) auto[key] = c; }
            return Object.keys(auto).length ? { auto, autoLog: Object.keys(auto).filter(k => auto[k].log), autoT0: autoAt.t0, autoFrom: autoAt.from } : {};
        };

        // Chaque effet est un bloc ; on les branche dans l'ordre demandé (ordre habituel si rien n'est précisé)
        const B = {};

        // Filtre : coupe les graves (coupe-bas) et / ou les aigus (coupe-haut). Pente 12 ou 24 dB par octave (Butterworth).
        // Mêmes formules que engine/src/fx.rs (Biquad passe-haut / passe-bas) : voir la parité dans lib.rs.
        B.filter = () => {
            if (!enabled.includes('filter')) return;
            const p = params.filter || {};
            const hpf = p.hpf ?? 80, lpf = p.lpf ?? 20000;
            const qdb = (lin) => 20 * Math.log10(lin);
            const qs = p.slope === 24 ? [0.5412, 1.3066] : [Math.SQRT1_2];
            const add = (type, freq) => qs.forEach((q) => {
                const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = qdb(q); connect(f);
                const c = curveOf('filter', type === 'highpass' ? 'hpf' : 'lpf');
                if (c) { f.frequency.setValueAtTime(pulseAutoAtMain(c, autoAt.from), autoAt.t0); c.forEach(p => { if (p.t > autoAt.from) autoRamp(f.frequency, c, p.v, autoAt.t0 + (p.t - autoAt.from)); }); }
            });
            if (curveOf('filter', 'hpf') && hpf <= 20) add('highpass', 20);
            if (curveOf('filter', 'lpf') && lpf >= 20000) add('lowpass', 20000);
            if (hpf > 20) add('highpass', Math.min(hpf, 20000));
            if (lpf < 20000) add('lowpass', Math.max(lpf, 20));
        };

        // Effets maison simples : un nœud par effet (voir les worklets pulse-mod / pulse-crush / pulse-util)
        const node = (name, kind) => {
            if (!enabled.includes(kind) || !fxReady.has(actx)) return;
            connect(new AudioWorkletNode(actx, name, {
                numberOfInputs: 1, numberOfOutputs: 1,
                channelCountMode: 'max', // une voix mono reste mono
                processorOptions: { kind, ...(params[kind] || {}), ...autoAll(kind) }
            }));
        };
        ['chorus', 'flanger', 'phaser', 'tremolo', 'doubler', 'slapback'].forEach((k) => { B[k] = () => node('pulse-mod', k); });
        B.crush = () => node('pulse-crush', 'crush');
        B.pitch = () => { if ((params.pitch || {}).semi || hasAuto('pitch')) node('pulse-pitch', 'pitch'); };
        B.util = () => node('pulse-util', 'util');
        B.width = () => node('pulse-util', 'width');

        // Gate : coupe le bruit entre deux phrases (voir le worklet pulse-gate)
        B.gate = () => {
            if (!enabled.includes('gate') || !fxReady.has(actx)) return;
            const p = params.gate || {}, live = !!params.grKey && !(typeof OfflineAudioContext !== 'undefined' && actx instanceof OfflineAudioContext);
            const node = new AudioWorkletNode(actx, 'pulse-gate', {
                numberOfInputs: 1, numberOfOutputs: 1,
                channelCountMode: 'max', // une voix mono reste mono
                processorOptions: { threshold: p.threshold ?? -45, release: p.release ?? 150, reduction: p.reduction ?? 40,
                    ratio: p.ratio, knee: p.knee, attack: p.attack, hold: p.hold, hp: p.hp, lp: p.lp, listen: live && !!p.listen, live, ...autoAll('gate') }
            });
            if (live) { const key = params.grKey; node.port.onmessage = (e) => gateLive.set(key, { ...e.data, ts: performance.now() }); }
            connect(node);
        };

        // EQ 4-bandes
        B.eq = () => {
            if (!enabled.includes('eq')) return;
            // EQ libre (ou ancienne chaîne fixe = 4 points) : cloche, plateaux, coupes, encoche, pente
            const ep = params.eq || {};
            const sched = (param, key, k = 1) => {
                const c = curveOf('eq', key); if (!c) return;
                param.setValueAtTime(pulseAutoAtMain(c, autoAt.from) * k, autoAt.t0);
                c.forEach(pt => { if (pt.t > autoAt.from) autoRamp(param, c, pt.v * k, autoAt.t0 + (pt.t - autoAt.from)); });
            };
            const isOffline = typeof OfflineAudioContext !== 'undefined' && actx instanceof OfflineAudioContext;
            const bandsEq = (Array.isArray(ep.bands) ? ep.bands : legacyEqBands(ep)).slice(0, 24);
            const solo = !isOffline && Number.isInteger(ep.solo) ? bandsEq[ep.solo] : null;
            const worklet = fxReady.has(actx);
            const isStatic = (bd) => bd && bd.on !== false && bd.freq > 0 && !(eqIsDynamic(bd) && worklet);
            if (solo && solo.freq > 0) {
                // Solo d'une bande (écoute seulement, jamais à l'export) : on n'entend que la zone du point
                const f = actx.createBiquadFilter();
                f.type = 'bandpass';
                f.frequency.value = Math.max(20, Math.min(20000, solo.freq));
                f.Q.value = solo.type === 'bell' || solo.type === 'notch' ? Math.max(0.5, solo.q || 1) : 0.7;
                connect(f);
            } else if (worklet) {
                // Filtres calés sur l'analogique (worklet pulse-eq), comme le moteur Rust ; l'automation y est suivie à chaque bloc
                const list = [];
                bandsEq.forEach((bd, i) => { if (isStatic(bd)) list.push({ i, type: bd.type, freq: Math.max(20, Math.min(20000, bd.freq)), gain: bd.gain || 0, q: bd.q || 1, slope: bd.slope }); });
                if (list.length) connect(new AudioWorkletNode(actx, 'pulse-eq', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                    processorOptions: { bands: list, ...autoAll('eq') } }));
            } else for (const [bi, bd] of bandsEq.entries()) {
                // Sans worklet (navigateur très ancien) : filtres standards du navigateur
                if (!isStatic(bd)) continue;
                for (const sec of eqSections(bd)) {
                    const f = actx.createBiquadFilter();
                    f.type = sec.type;
                    f.frequency.value = Math.max(20, Math.min(20000, bd.freq));
                    if (sec.qDb !== undefined) f.Q.value = sec.qDb;     // coupe-bas / coupe-haut : Q en dB dans Web Audio
                    else if (sec.q !== undefined) f.Q.value = sec.q;
                    if (sec.gain !== undefined) f.gain.value = sec.gain;
                    // Courbes posées APRÈS les valeurs fixes (fixer .value ajouterait un événement qui écraserait la courbe)
                    sched(f.frequency, `b${bi}-freq`);
                    if (sec.gainK) sched(f.gain, `b${bi}-gain`, sec.gainK);
                    connect(f);
                }
            }
            const out = Number(ep.out) || 0;
            if (out && !solo) { const g = actx.createGain(); g.gain.value = Math.pow(10, out / 20); connect(g); }
            // Points dynamiques : après les points fixes et la sortie (même ordre que Rust)
            if (!solo && worklet) for (const [bi, bd] of bandsEq.entries()) {
                if (!bd || bd.on === false || !(bd.freq > 0) || !eqIsDynamic(bd)) continue;
                const live = !!params.grKey && !isOffline;
                const node = new AudioWorkletNode(actx, 'pulse-dyneq', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                    processorOptions: { band: { type: bd.type, freq: bd.freq, gain: bd.gain || 0, q: bd.q || 1, dyn: Number(bd.dyn), thr: bd.thr ?? -30 }, live } });
                if (live) { const key = params.grKey + ':' + bi; node.port.onmessage = (e) => eqDynLive.set(key, { g: e.data, ts: performance.now() }); }
                connect(node);
            }
        };

        // Saturation douce (« Doux ↔ Agressif »)
        B.sat = () => {
            const drive = enabled.includes('sat') ? ((params.sat || {}).drive || 0) : 0;
            if (drive > 0 && fxReady.has(actx)) {
                connect(new AudioWorkletNode(actx, 'pulse-sat', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max', processorOptions: { drive } }));
            } else if (drive > 0) {
                const k = 1 + drive * 0.05;
                const curve = new Float32Array(1024);
                for (let i = 0; i < curve.length; i++) {
                    const x = (i / (curve.length - 1)) * 2 - 1;
                    curve[i] = Math.tanh(k * x) / Math.tanh(k);
                }
                const ws = actx.createWaveShaper();
                ws.curve = curve;
                ws.oversample = '2x';
                connect(ws);
                const trim = actx.createGain();
                trim.gain.value = 1 / Math.sqrt(k / Math.tanh(k)); // garde un volume perçu stable
                connect(trim);
            }
        };

        // De-esser : adoucit les « S » qui sifflent, sans toucher au reste de la voix
        B.deess = () => {
            const dp = params.deess || {};
            // Nouveau De-esser (seuil, plage, zone) : dès qu'un seuil est réglé
            if (enabled.includes('deess') && dp.thr !== undefined && fxReady.has(actx)) {
                const live = !!params.grKey && !(typeof OfflineAudioContext !== 'undefined' && actx instanceof OfflineAudioContext);
                const node = new AudioWorkletNode(actx, 'pulse-deesser2', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                    processorOptions: { thr: dp.thr, range: dp.range, lo: dp.lo, hi: dp.hi, wide: !!dp.wide, rel: !!dp.rel, listen: live && !!dp.listen, live, ...autoAll('deess') } });
                if (live) { const key = params.grKey; node.port.onmessage = (e) => deessLive.set(key, { ...e.data, ts: performance.now() }); }
                connect(node);
                return;
            }
            const deess = enabled.includes('deess') ? ((params.deess || {}).amount || 0) : 0;
            if ((deess > 0 || (enabled.includes('deess') && hasAuto('deess'))) && fxReady.has(actx)) {
                connect(new AudioWorkletNode(actx, 'pulse-deesser', {
                    numberOfInputs: 1, numberOfOutputs: 1,
                    channelCountMode: 'max', // une voix mono reste mono (même volume qu'avant)
                    processorOptions: { amount: deess, freq: (params.deess || {}).freq || 5500, ...autoAll('deess') }
                }));
            }
        };

        // Saturation multibande
        B.msat = () => {
            const sp = params.msat || {}, bands = (sp.bands || []).filter(b => b && b.on !== false);
            if (!enabled.includes('msat') || !bands.length || !fxReady.has(actx)) return;
            connect(new AudioWorkletNode(actx, 'pulse-msat', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max', processorOptions: { bands: sp.bands, mix: sp.mix, out: sp.out, ag: sp.ag, ...autoAll('msat') } }));
        };

        // Multibande (bandes libres)
        B.mband = () => {
            const mp = params.mband || {}, bands = (mp.bands || []).filter(b => b && b.on !== false);
            if (!enabled.includes('mband') || !bands.length || !fxReady.has(actx)) return;
            const live = !!params.grKey && !(typeof OfflineAudioContext !== 'undefined' && actx instanceof OfflineAudioContext);
            const node = new AudioWorkletNode(actx, 'pulse-mband', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max', processorOptions: { bands: mp.bands, live, ...autoAll('mband') } });
            if (live) { const key = params.grKey; node.port.onmessage = (e) => mbandLive.set(key, { ...e.data, ts: performance.now() }); }
            connect(node);
        };

        // Compresseur (maison si possible ; sinon celui du navigateur, plus fort en sortie)
        B.comp = () => {
            if (enabled.includes('comp')) {
                const cp = params.comp || {};
                if (fxReady.has(actx)) {
                    const live = !!params.grKey && !(typeof OfflineAudioContext !== 'undefined' && actx instanceof OfflineAudioContext);
                    const node = new AudioWorkletNode(actx, 'pulse-comp', {
                        numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                        processorOptions: { threshold: cp.threshold, ratio: cp.ratio, attack: cp.attack, release: cp.release, knee: cp.knee, makeup: cp.makeup, mix: cp.mix, mode: cp.mode, autoRel: cp.autoRel, report: live,
                            ...autoOpts('comp', { threshold: null, ratio: null, attack: null, release: null, knee: null, makeup: null, mix: null }) }
                    });
                    if (live) {
                        const old = compLive.get(params.grKey); if (old && old !== node) old.port.onmessage = null;   // l'ancien compresseur ne parle plus (sinon l'aiguille saute entre deux)
                        node.port.onmessage = (e) => { compGR.set(params.grKey, e.data); compGRts.set(params.grKey, performance.now()); };
                        compLive.set(params.grKey, node);
                    }
                    connect(node);
                } else {
                    const comp = actx.createDynamicsCompressor();
                    comp.threshold.value = cp.threshold !== undefined ? cp.threshold : -22;
                    comp.knee.value = cp.knee !== undefined ? cp.knee : 10;
                    comp.ratio.value = cp.ratio !== undefined ? cp.ratio : 3;
                    comp.attack.value = cp.attack !== undefined ? cp.attack / 1000 : 0.010;
                    comp.release.value = cp.release !== undefined ? cp.release / 1000 : 0.050;
                    connect(comp);
                }
            }
        };

        // Finition tout-en-un (premaster) : graves, clarté, colle, chaleur, largeur, puis volume retenu par un limiteur
        B.master = () => {
            if (enabled.includes('master') && fxReady.has(actx)) {
                const mp = params.master || {};
                const stereo = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' };
                if (mp.body) { const f = actx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 100; f.gain.value = mp.body; connect(f); }
                if (mp.air) { const f = actx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 10000; f.gain.value = mp.air; connect(f); }
                if (mp.glue > 0) {
                    connect(new AudioWorkletNode(actx, 'pulse-comp', { ...stereo, processorOptions: { threshold: -12 - mp.glue * 0.12, ratio: 1.5 + mp.glue * 0.015, attack: 30, release: 150 } }));
                }
                if (mp.warm > 0) {
                    const k = 1 + mp.warm * 0.03, curve = new Float32Array(1024);
                    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
                    const ws = actx.createWaveShaper(); ws.curve = curve; ws.oversample = '2x'; connect(ws);
                    const trim = actx.createGain(); trim.gain.value = 1 / Math.sqrt(k / Math.tanh(k)); connect(trim);
                }
                if (mp.width !== undefined && mp.width !== 1) connect(new AudioWorkletNode(actx, 'pulse-width', { ...stereo, processorOptions: { width: mp.width } }));
                if (mp.push > 0) {
                    const g = actx.createGain(); g.gain.value = dbToLin(mp.push); connect(g);
                    connect(new AudioWorkletNode(actx, 'pulse-limiter', { ...stereo, processorOptions: { ceiling: dbToLin(-1) } }));
                }
            }
        };

        // Limiteur de sécurité posé sur un bus (le dernier avant la sortie) : rien ne dépasse le plafond du projet
        B.limit = () => {
            if (enabled.includes('limit') && fxReady.has(actx)) {
                const lp = params.limit || {}, live = !!params.grKey && !(typeof OfflineAudioContext !== 'undefined' && actx instanceof OfflineAudioContext);
                const node = new AudioWorkletNode(actx, 'pulse-limiter', {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
                    processorOptions: { ceiling: dbToLin(lp.ceiling ?? ceiling), gain: lp.gain || 0, release: lp.release, lookahead: lp.lookahead, tp: !!lp.tp, style: lp.style || 0, live, ...autoAll('limit') }
                });
                if (live) { const key = params.grKey; node.port.onmessage = (e) => limLive.set(key, { ...e.data, ts: performance.now() }); }
                connect(node);
            }
        };

        // Écho
        B.delay = () => {
            if (enabled.includes('delay') && fxReady.has(actx)) {
                const dp = params.delay || {};
                connect(new AudioWorkletNode(actx, 'pulse-delay', {
                    numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                    ...(dp.pp ? { outputChannelCount: [2] } : {}),
                    processorOptions: { time: delaySeconds(dp, bpm), feedback: (dp.feedback ?? 35) / 100, wet: (dp.wet ?? 25) / 100, dry: (dp.dry ?? 100) / 100, pp: !!dp.pp,
                        hpf: dp.hpf || 0, lpf: dp.lpf || 0, duck: dp.duck || 0, eq: dp.eq,
                        ...autoOpts('delay', { feedback: (x) => x / 100, wet: (x) => x / 100, dry: (x) => x / 100 }) }
                }));
            }
        };

        // Reverb (maison si possible ; sinon celle du navigateur)
        B.reverb = () => {
            if (enabled.includes('reverb') && fxReady.has(actx)) {
                const rp = params.reverb || {};
                connect(new AudioWorkletNode(actx, 'pulse-reverb', {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCountMode: 'max',
                    processorOptions: { wet: rp.wet !== undefined ? rp.wet / 100 : 0.18, size: rp.size, decay: rp.decay, pre: (rp.pre || 0) / 1000, low: rp.low || 0, high: rp.high || 0, duck: rp.duck || 0, out: rp.out || 0, bright: rp.bright, width: rp.width, eq: rp.eq, ...autoOpts('reverb', { wet: (x) => x / 100 }) }
                }));
            } else if (enabled.includes('reverb')) {
                const rp = params.reverb || {};
                const wetAmt = rp.wet !== undefined ? rp.wet / 100 : 0.18;
                const size   = rp.size  !== undefined ? rp.size  : 1.8;
                const decay  = rp.decay !== undefined ? rp.decay : 2.5;
                const dry = actx.createGain();
                const wet = actx.createGain();
                const conv = actx.createConvolver();
                conv.buffer = getImpulseResponse(actx, size, decay);
                dry.gain.value = 1 - wetAmt;
                wet.gain.value = wetAmt;

                const sum = actx.createGain();
                prev.connect(dry);
                prev.connect(conv);
                conv.connect(wet);
                dry.connect(sum);
                wet.connect(sum);
                prev = sum;
            }
        };

        const custom = Array.isArray(params.order) ? params.order.filter(n => FX_CHAIN.includes(n)) : [];
        for (const n of [...custom, ...FX_CHAIN.filter(x => !custom.includes(x))]) B[n]();

        return { input, output: prev };
    }

    // IR algorithmique (bruit décroissant exponentiellement, stéréo), mis en cache
    function getImpulseResponse(actx, durationSec, decay) {
        const sampleRate = actx.sampleRate;
        const key = `${sampleRate}|${durationSec}|${decay}`;
        if (irCache.has(key)) return irCache.get(key);
        const length = Math.max(1, Math.floor(sampleRate * durationSec));
        const impulse = actx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        if (irCache.size > 12) irCache.clear();
        irCache.set(key, impulse);
        return impulse;
    }

    // Niveaux gauche / droite d'une piste (analyseurs avant pan) ; null si la piste ne joue pas
    function getTrackMeters(trackIdx) {
        const n = liveNodes.get(trackIdx);
        return n && n.meterL ? { l: n.meterL, r: n.meterR } : null;
    }
    // Nombre de canaux le plus large parmi les sons d'une piste (1 = mono)
    function trackChannelCount(track) {
        let ch = 0;
        for (const c of (track.clips || [])) {
            const b = buffers.get(c.id);
            if (b && b.numberOfChannels > ch) ch = b.numberOfChannels;
        }
        return ch;
    }

    function getTrackAnalyser(trackIdx) {
        const n = liveNodes.get(trackIdx);
        return n ? n.analyser : null;
    }

    function updateTrackVolume(trackIdx, vol0to100) {
        if (nativeOn) { nativeRefreshSoon(); return; }
        const n = liveNodes.get(trackIdx);
        if (!n) return;
        n.vol = vol0to100 / 100;
        if (n.audible) n.gainNode.gain.setTargetAtTime(n.vol, ctx.currentTime, 0.01);
    }

    function updateTrackPan(trackIdx, pan100) {
        if (nativeOn) { nativeRefreshSoon(); return; }
        const n = liveNodes.get(trackIdx);
        if (n && n.panNode) {
            n.panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan100 / 100)), ctx.currentTime, 0.01);
        }
    }

    // Mute / solo à chaud pendant la lecture
    function refreshAudibility(project) {
        if (nativeOn) { nativeRefreshSoon(); return; }
        if (!ctx) return;
        liveNodes.forEach((n, idx) => {
            const t = project.tracks[idx];
            if (!t) return;
            n.audible = isTrackAudible(project, t);
            n.gainNode.gain.cancelScheduledValues(ctx.currentTime);
            n.gainNode.gain.setTargetAtTime(n.audible ? n.vol : 0, ctx.currentTime, 0.008);
            if (n.preTap) n.preTap.gain.setTargetAtTime(n.audible ? 1 : 0, ctx.currentTime, 0.008);
        });
    }

    function updateBusVolume(busId, vol0to100) {
        if (nativeOn) { nativeRefreshSoon(); return; }
        const g = liveBusNodes.get(busId);
        if (g) g.gain.setTargetAtTime(vol0to100 / 100, ctx.currentTime, 0.01);
    }

    // Coupe la lecture d'une piste entre deux positions du projet (ancienne prise muette pendant qu'on la refait).
    // toProj = null → reste coupée jusqu'au prochain refreshAudibility().
    function muteTrackBetween(trackIdx, fromProj, toProj = null) {
        if (toProj === null && (recNode || recorder)) recMute = { idx: trackIdx };
        const n = liveNodes.get(trackIdx);
        if (!n || !isPlaying) return;
        const at = (p) => playbackStartCtxTime + (p - playbackStartProjectTime);
        const level = n.audible ? n.vol : 0;
        const g = n.gainNode.gain;
        const a = Math.max(ctx.currentTime, at(fromProj));
        g.setValueAtTime(level, a);
        g.linearRampToValueAtTime(0, a + 0.01);
        if (toProj !== null) {
            const b = Math.max(a + 0.02, at(toProj));
            g.setValueAtTime(0, b);
            g.linearRampToValueAtTime(level, b + 0.01);
        }
    }

    // Mesure la latence réelle : on joue des clics, le micro les réécoute, on chronomètre l'aller-retour.
    // Renvoie { ok, ms } ou { ok:false, reason: 'silence' | 'unstable' | 'busy' | 'unsupported' }
    async function calibrateLatency() {
        if (recNode || recorder || isPlaying) return { ok: false, reason: 'busy' };
        await resumeIfNeeded();
        await requestMic();
        try { await ensureWorklet(); } catch { return { ok: false, reason: 'unsupported' }; }
        // Pas de retour casque pendant la mesure : le micro se réentendrait
        monitorHold = true; applyMonitor();
        setTimeout(() => { monitorHold = false; applyMonitor(); }, (0.5 + 6 * 0.5 + 1) * 1000);

        const chunks = [];
        let t0 = -1, total = 0;
        const node = new AudioWorkletNode(ctx, 'pulse-recorder', {
            numberOfInputs: 1, numberOfOutputs: 1,
            channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'discrete'
        });
        node.port.onmessage = (e) => {
            if (!e.data.pcm) return;
            if (t0 < 0) t0 = e.data.t0;
            chunks.push(e.data.pcm); total += e.data.pcm.length;
        };
        const sink = ctx.createGain();
        sink.gain.value = 0;
        micSource.connect(node); node.connect(sink); sink.connect(ctx.destination);

        const N = 6, gap = 0.35, first = ctx.currentTime + 0.5;
        for (let i = 0; i < N; i++) {
            const when = first + i * gap;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 1500;
            g.gain.setValueAtTime(0.6, when);
            g.gain.setValueAtTime(0, when + 0.012);
            // Par le master : même chemin (limiteur compris) que l'instru qu'on entendra en enregistrant
            osc.connect(g); g.connect(masterGain);
            osc.start(when); osc.stop(when + 0.02);
        }
        await new Promise(r => setTimeout(r, (0.5 + N * gap + 0.4) * 1000));
        node.port.postMessage('stop');
        await new Promise(r => setTimeout(r, 120));
        try { micSource.disconnect(node); node.disconnect(); sink.disconnect(); } catch {}
        if (t0 < 0 || !total) return { ok: false, reason: 'silence' };

        const sr = ctx.sampleRate;
        const pcm = new Float32Array(total);
        let o = 0;
        for (const c of chunks) { pcm.set(c, o); o += c.length; }

        // Bruit de fond mesuré avant le premier clic
        const idx = (t) => Math.round((t - t0) * sr);
        let noise = 0;
        const nEnd = Math.max(1, Math.min(pcm.length, idx(first) - Math.round(0.05 * sr)));
        for (let i = 0; i < nEnd; i++) noise = Math.max(noise, Math.abs(pcm[i]));

        const delays = [];
        for (let i = 0; i < N; i++) {
            const a = idx(first + i * gap);
            const b = Math.min(pcm.length, a + Math.round(0.3 * sr));
            if (a < 0 || b <= a) continue;
            let peak = 0;
            for (let k = a; k < b; k++) peak = Math.max(peak, Math.abs(pcm[k]));
            if (peak < Math.max(0.01, noise * 4)) continue;      // clic pas entendu
            const thr = peak * 0.35;
            for (let k = a; k < b; k++) { if (Math.abs(pcm[k]) >= thr) { delays.push((k - a) / sr); break; } }
        }
        if (delays.length < 3) return { ok: false, reason: 'silence' };
        delays.sort((x, y) => x - y);
        const median = delays[Math.floor(delays.length / 2)];
        const close = delays.filter(d => Math.abs(d - median) < 0.004).length;
        if (close < Math.ceil(delays.length * 0.6)) return { ok: false, reason: 'unstable' };

        // On enregistre l'écart entre la mesure et l'estimation automatique
        localStorage.removeItem('pulse_latency_ms');
        const auto = getRoundTripLatency();
        localStorage.setItem('pulse_latency_ms', ((median - auto) * 1000).toFixed(1));
        return { ok: true, ms: Math.round(median * 1000) };
    }

    function clearLiveNodes() {
        liveNodes.clear();
        liveBusNodes.clear();
        liveBusSpec.clear();
    }

    // ===================== MÉTRONOME =====================
    function setMetronome(on, bpm) {
        metronomeEnabled = !!on;
        metroBpm = bpm || metroBpm;
        if (!on) stopMetronome();
    }

    function setCountIn(on) { countInEnabled = !!on; }
    function isCountInEnabled() { return countInEnabled; }

    // Démarre le métronome aligné sur la grille des beats du projet.
    // projectPlayheadSec : position actuelle du playhead en secondes (pour aligner)
    let metroBpbar = 4;
    function setBeatsPerBar(n) { metroBpbar = Math.max(1, Math.min(12, Math.round(n) || 4)); }
    // tempoMap : le projet (tempo et signature qui changent, tempo.js) — sinon tempo fixe `bpm`
    let metroMap = null, metroOrigin = 0;
    const mapVaries = (p) => !!(p && window.PulseTempo && ((p.tempos && p.tempos.length) || (p.signatures && p.signatures.length)));
    function startMetronome(bpm, projectPlayheadSec = 0, tempoMap = null) {
        metroBpm = bpm;
        metroMap = mapVaries(tempoMap) ? tempoMap : null;
        const beatSec = 60 / bpm;
        // Prochain beat à partir du playhead (pile dessus = on le joue)
        const nextBeat = metroMap ? Math.ceil(window.PulseTempo.secToBeats(metroMap, projectPlayheadSec) - 1e-6) : Math.ceil(projectPlayheadSec / beatSec - 1e-6);
        metroBeat = nextBeat;
        // Même référence temporelle que la lecture (lookahead inclus)
        const base = isPlaying ? playbackStartCtxTime - (playbackStartProjectTime - projectPlayheadSec) : ctx.currentTime;
        metroOrigin = base - projectPlayheadSec;     // heure de la carte son où tomberait le début du morceau
        metroNextTime = metroMap ? metroOrigin + window.PulseTempo.beatsToSec(metroMap, nextBeat) : base + (nextBeat * beatSec - projectPlayheadSec);
        if (metroTimer) clearInterval(metroTimer);
        metroTimer = setInterval(metroScheduler, 25);
    }

    // Pour mettre à jour le BPM à chaud (changement pendant la lecture)
    function setMetronomeBpm(bpm) {
        metroBpm = bpm;
    }

    function stopMetronome() {
        if (metroTimer) clearInterval(metroTimer);
        metroTimer = null;
    }

    function metroScheduler() {
        if (!metronomeEnabled) { stopMetronome(); return; }
        const beatSec = 60 / metroBpm;
        const lookahead = 0.1;
        if (metroMap && !mapVaries(metroMap)) metroMap = null;
        while (metroNextTime < ctx.currentTime + lookahead) {
            const accent = metroMap ? window.PulseTempo.beatsToBar(metroMap, metroBeat).beat < 1e-6 : metroBeat % metroBpbar === 0;
            if (metroNextTime >= ctx.currentTime - 0.01) scheduleClick(metroNextTime, accent);
            metroBeat++;
            metroNextTime = metroMap ? metroOrigin + window.PulseTempo.beatsToSec(metroMap, metroBeat) : metroNextTime + beatSec;
        }
    }

    function scheduleClick(when, isAccent) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = isAccent ? 1200 : 800;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.001, when);
        gain.gain.exponentialRampToValueAtTime(0.4, when + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(when);
        osc.stop(when + 0.08);
        return osc;
    }

    const countIn = { token: 0, timer: null, oscs: [], resolve: null };

    // Count-in : joue `beats` clicks tout de suite, puis résout pile quand le temps 1 doit tomber.
    // Résout à false si annulé (stopCountIn).
    async function playCountIn(bpm, beats = 4) {
        await resumeIfNeeded();
        stopCountIn();
        const beatSec = 60 / bpm;
        const lead = 0.06;
        const t0 = ctx.currentTime + lead;
        const token = ++countIn.token;
        for (let i = 0; i < beats; i++) countIn.oscs.push(scheduleClick(t0 + i * beatSec, i === 0));
        return new Promise(resolve => {
            countIn.resolve = resolve;
            // On rend la main ~70ms avant le temps 1 : le lancement de la lecture a son propre lookahead
            countIn.timer = setTimeout(() => {
                if (token !== countIn.token) return;
                countIn.resolve = null; countIn.oscs = [];
                resolve(true);
            }, Math.max(0, (lead + beats * beatSec - 0.07) * 1000));
        });
    }

    function stopCountIn() {
        countIn.token++;
        clearTimeout(countIn.timer);
        countIn.oscs.forEach(o => { try { o.stop(); } catch {} });
        countIn.oscs = [];
        if (countIn.resolve) { const r = countIn.resolve; countIn.resolve = null; r(false); }
    }

    function isCountingIn() { return !!countIn.resolve; }

    // Calcule le gain de normalisation pour qu'un buffer atteigne targetDb (défaut 0dBFS)
    function computeNormalizeGain(clipId, targetDb = -0.5) {
        const buf = buffers.get(clipId);
        if (!buf) return null;
        let peak = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                const abs = Math.abs(data[i]);
                if (abs > peak) peak = abs;
            }
        }
        if (peak === 0) return null;
        const targetLinear = Math.pow(10, targetDb / 20);
        return targetLinear / peak;
    }

    return {
        init, resumeIfNeeded, requestMic, releaseMic, getMicAnalyser, getRoundTripLatency,
        hasMic, isCapturing, setMonitor, isMonitorOn, setMonitorRoute, isLowLatency, setLowLatency, getLatencyInfo, setCeiling, getCeiling: () => ceilingDb, getMasterVolume: () => masterVolume * 100, listInputs, setInputDevice, setMicChannel, getMicChannels, muteTrackBetween, calibrateLatency, getMicLabel, getMicDeviceId, consumeMicFallback, updateBusVolume,
        startRecording, stopRecording,
        registerBuffer, hasBuffer, getBuffer, getBufferDuration, clearBuffers, computePeaks,
        play, stopAll, getPlaybackPosition, setNativeBackend, isNative, setBeatsPerBar,
        updateTrackVolume, updateTrackPan, updateComp, setAutoRanges, eqSections, eqIsDynamic, getEqDyn, eqBandCoefs, getLimiterMeter, getGateMeter, getDeessMeter, getMbandMeter, refreshAudibility, clearLiveNodes,
        getTrackAnalyser, getTrackMeters, trackChannelCount, getMasterAnalyser, getTrackSpectrum, getBusSpectrum, getCompReduction, setMasterVolume,
        setMetronome, setMetronomeBpm, setCountIn, isCountInEnabled,
        startMetronome, stopMetronome, playCountIn, stopCountIn, isCountingIn,
        exportWav, exportTrackWav, renderFreeze, audioBufferToWav, computeNormalizeGain, setLoop, loopScheduled, getRecWraps, getRecLinearPosition,
        getContext: () => ctx
    };
})();
