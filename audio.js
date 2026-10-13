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
    let micSource = null;
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
    let playbackStartCtxTime = 0;
    let playbackStartProjectTime = 0;
    let isPlaying = false;

    // Cache des AudioBuffers par clip.id
    const buffers = new Map();
    // --- Effets maison (tournent dans le fil audio, en lecture comme à l'export)
    // De-esser : on isole les aigus ; quand ils dominent la voix (un « S », un « CH »), on les baisse eux seuls.
    // Le seuil est relatif (aigus / voix entière) : ça marche pareil qu'on ait enregistré fort ou pas.
    const FX_WORKLET = `
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
        registerProcessor('pulse-deesser', PulseDeesser);

        // Compresseur : resserre l'écart entre les mots forts et les mots faibles.
        // Rattrapage de volume modéré et connu d'avance (le compresseur du navigateur, lui, ajoutait jusqu'à +18 dB).
        class PulseComp extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.thr = p.threshold ?? -22;
                this.slopeC = 1 - 1 / Math.max(1, p.ratio ?? 3);
                this.knee = p.knee ?? 10;
                this.att = 1 - Math.exp(-1 / (Math.max(0.0001, (p.attack ?? 10) / 1000) * sampleRate));
                this.rel = 1 - Math.exp(-1 / (Math.max(0.005, (p.release ?? 50) / 1000) * sampleRate));
                this.makeup = Math.pow(10, (p.makeup ?? (-this.thr * this.slopeC * 0.35)) / 20);
                // Mélange (compression parallèle) : 100 % = tout le signal compressé, 0 % = signal d'origine
                this.mix = Math.max(0, Math.min(1, (p.mix ?? 100) / 100));
                this.red = 0; // réduction en cours (dB, >= 0)
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (!inp || !inp.length) return true;
                const n = inp[0].length, nc = Math.min(inp.length, out.length);
                const thr = this.thr, knee = this.knee, half = knee / 2;
                for (let i = 0; i < n; i++) {
                    let pk = 0;
                    for (let ch = 0; ch < nc; ch++) { const a = inp[ch][i] < 0 ? -inp[ch][i] : inp[ch][i]; if (a > pk) pk = a; }
                    let want = 0;
                    if (pk > 1e-5) {
                        const over = 20 * Math.log10(pk) - thr;
                        if (over >= half) want = over * this.slopeC;
                        else if (over > -half) want = this.slopeC * (over + half) * (over + half) / (2 * knee); // genou doux
                    }
                    this.red += (want - this.red) * (want > this.red ? this.att : this.rel);
                    const g = (1 - this.mix) + this.mix * Math.pow(10, -this.red / 20) * this.makeup;
                    for (let ch = 0; ch < nc; ch++) out[ch][i] = inp[ch][i] * g;
                }
                return true;
            }
        }
        registerProcessor('pulse-comp', PulseComp);

        // Reverb : 8 échos très courts en parallèle + 4 diffuseurs en série (schéma « Freeverb »).
        // Aucun hasard dedans : le même réglage donne exactement le même son partout (navigateur, export, moteur natif).
        class PulseReverb extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.wet = Math.max(0, Math.min(1, p.wet ?? 0.18));
                const size = p.size ?? 1.8;
                this.fb = 0.72 + 0.2 * Math.max(0, Math.min(1, (size - 1.2) / 2));
                this.damp = 0.35;
                const k = sampleRate / 44100, len = (n) => Math.max(1, Math.round(n * k));
                const mk = (n) => ({ buf: new Float64Array(len(n)), i: 0, store: 0 });
                const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], AP = [556, 441, 341, 225];
                this.comb = [COMB.map(n => mk(n)), COMB.map(n => mk(n + 23))];   // droite décalée = largeur stéréo
                this.ap = [AP.map(n => mk(n)), AP.map(n => mk(n + 23))];
                this.nc = 1;
                // Temps avant que la reverb démarre (pré-délai), 0 par défaut
                const pre = Math.round(Math.max(0, Math.min(0.5, p.pre || 0)) * sampleRate);
                this.pre = pre > 0 ? new Float64Array(pre) : null; this.pi = 0;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                if (inp && inp.length) this.nc = inp.length;
                const n = out[0].length, mono = this.nc < 2;
                const a = inp && inp[0], b = inp && inp[1];
                // Une piste mono sort en stéréo : on la baisse de 3 dB pour qu'elle garde le volume qu'elle aurait sans reverb
                const dry = (1 - this.wet) * (mono ? Math.SQRT1_2 : 1), wet = this.wet * 3 * (mono ? Math.SQRT1_2 : 1);
                for (let i = 0; i < n; i++) {
                    const xl = a ? a[i] : 0, xr = mono ? xl : (b ? b[i] : 0);
                    let x = (xl + xr) * 0.015;
                    if (this.pre) { const d = this.pre[this.pi]; this.pre[this.pi] = x; x = d; if (++this.pi >= this.pre.length) this.pi = 0; }
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
                        out[ch][i] = (ch ? xr : xl) * dry + acc * wet;
                    }
                }
                return true;
            }
        }
        registerProcessor('pulse-reverb', PulseReverb);

        // Limiteur de sécurité du master : ne touche à rien sous -1 dB, retient seulement les crêtes qui satureraient.
        // Il « voit venir » la crête 1,5 ms à l'avance, donc il baisse en douceur au lieu d'écraser.
        // (Celui du navigateur mettait 0,1 s à s'ouvrir : le premier temps de chaque morceau sortait deux fois moins fort.)
        class PulseLimiter extends AudioWorkletProcessor {
            constructor(o) {
                super();
                const p = (o && o.processorOptions) || {};
                this.thr = p.ceiling > 0 ? Math.min(1, p.ceiling) : 0.966; // plafond : -0,3 dB par défaut
                this.port.onmessage = (e) => { if (e.data && e.data.ceiling > 0) this.thr = Math.min(1, e.data.ceiling); };
                this.L = Math.max(1, Math.round(0.0015 * sampleRate));
                this.buf = [new Float32Array(this.L), new Float32Array(this.L)];
                this.i = 0; this.env = 0; this.gain = 1;
                this.att = 1 - Math.exp(-4 / this.L);
                this.rel = 1 - Math.exp(-1 / (0.12 * sampleRate));
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                const n = out[0].length, nc = out.length, ni = inp ? inp.length : 0;
                for (let i = 0; i < n; i++) {
                    let pk = 0;
                    for (let ch = 0; ch < nc; ch++) {
                        const x = ni ? inp[ch < ni ? ch : 0][i] : 0, a = x < 0 ? -x : x;
                        if (a > pk) pk = a;
                        const d = this.buf[ch][this.i];
                        this.buf[ch][this.i] = x;
                        out[ch][i] = d;
                    }
                    this.env = pk > this.env ? pk : this.env + (pk - this.env) * this.rel;
                    const target = this.env > this.thr ? this.thr / this.env : 1;
                    this.gain += (target - this.gain) * (target < this.gain ? this.att : this.rel);
                    for (let ch = 0; ch < nc; ch++) {
                        const y = out[ch][i] * this.gain;
                        out[ch][i] = y > this.thr ? this.thr : y < -this.thr ? -this.thr : y; // rien ne dépasse le plafond
                    }
                    if (++this.i >= this.L) this.i = 0;
                }
                return true;
            }
        }
        registerProcessor('pulse-limiter', PulseLimiter);

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
                this.buf = []; this.lp = []; this.i = 0;
            }
            process(inputs, outputs) {
                const inp = inputs[0], out = outputs[0];
                const n = out[0].length, nc = out.length, ni = inp ? inp.length : 0;
                while (this.buf.length < nc) { this.buf.push(new Float64Array(this.D)); this.lp.push(0); }
                for (let i = 0; i < n; i++) {
                    for (let ch = 0; ch < nc; ch++) {
                        const x = ch < ni ? inp[ch][i] : 0, b = this.buf[ch];
                        const d = b[this.i];
                        this.lp[ch] = d + (this.lp[ch] - d) * this.k;
                        b[this.i] = x + this.lp[ch] * this.fb;
                        out[ch][i] = x * this.dry + d * this.wet;
                    }
                    if (++this.i >= this.D) this.i = 0;
                }
                return true;
            }
        }
        registerProcessor('pulse-delay', PulseDelay);

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

    const FX_CHAIN = ['eq', 'sat', 'deess', 'comp', 'master', 'limit', 'delay', 'reverb']; // ordre habituel des effets
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
        ctx = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
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
        const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(lowLatency ? { latency: { ideal: 0 } } : {}) };
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
        micSource = ctx.createMediaStreamSource(micStream);
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

    function releaseMic() {
        if (micSource) { try { micSource.disconnect(); } catch {} micSource = null; }
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

    function clipEndSec(clip) {
        const natural = clip.start + clip.duration;
        return (clip.loopEnd && clip.loopEnd > natural) ? clip.loopEnd : natural;
    }

    function projectEndSec(project, onlyTrack = null) {
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
    function buildGraph(actx, project, dest, opts) {
        const { fromTime = 0, t0 = 0, endTime = Infinity, onlyTrack = null, live = false } = opts;
        const sources = [];

        // Bus : piste → bus → bus… → master (un stem seul contourne les bus)
        const busNodes = new Map();
        const getBus = (id, depth = 0) => {
            if (!id || id === 'master' || onlyTrack !== null || depth > 8) return dest;
            if (busNodes.has(id)) return busNodes.get(id);
            const bus = (project.buses || []).find(b => b.id === id);
            if (!bus) return dest;
            // Effets communs du groupe (ex. une seule reverb pour toutes les voix) → volume du groupe → sortie
            const fx = createEffectsChain(actx, bus.effects || [], { ...(bus.effectParams || {}), order: bus.fxOrder }, project.bpm, project.ceilingDb ?? ceilingDb);
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
            if (bus.pan) {
                const pn = actx.createStereoPanner();
                pn.pan.value = Math.max(-1, Math.min(1, bus.pan / 100));
                tail.connect(pn);
                tail = pn;
            }
            tail.connect(out);
            // Envois du groupe (reverb, écho…) : pris après son volume et son pan, comme sur une piste
            if (onlyTrack === null) {
                for (const [sendId, level] of Object.entries(bus.sends || {})) {
                    if (!(level > 0)) continue;
                    const sendIn = getSend(sendId);
                    if (!sendIn) continue;
                    const sg = actx.createGain();
                    sg.gain.value = level / 100;
                    tail.connect(sg); sg.connect(sendIn);
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
                    ? new AudioWorkletNode(actx, 'pulse-delay', { ...common, processorOptions: { time: delaySeconds(sd, project.bpm), feedback: (sd.feedback ?? 35) / 100, wet: 1, dry: 0 } })
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
            const trackDest = getBus(track.output);

            // Chaîne : clip → gain clip (fades) → effets → gain piste → pan → [analyser] → master
            const vol = (track.volume ?? 100) / 100;
            const trackGain = actx.createGain();
            trackGain.gain.value = audible ? vol : 0;

            const fx = createEffectsChain(actx, track.effects || [], { ...(track.effectParams || {}), order: track.fxOrder }, project.bpm);
            fx.output.connect(trackGain);

            const panNode = actx.createStereoPanner();
            panNode.pan.value = Math.max(-1, Math.min(1, (track.pan || 0) / 100));
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

            for (const [sendId, level] of Object.entries(track.sends || {})) {
                if (!(level > 0)) continue;
                const send = getSend(sendId);
                if (!send) continue;
                const sg = actx.createGain();
                sg.gain.value = level / 100;
                panNode.connect(sg); sg.connect(send);
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
                    if (o.start < start - 1e-6 && oEnd > start + 1e-6) xIn = Math.max(xIn, Math.min(oEnd, end) - start);       // une région précédente recouvre mon début
                    if (o.start > start + 1e-6 && o.start < end - 1e-6) xOut = Math.max(xOut, Math.min(end, oEnd) - o.start);  // une région suivante recouvre ma fin
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
                g.connect(fx.input);

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

    async function play(project, fromTime) {
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
        stopAll();
        clearLiveNodes();

        playbackStartCtxTime = ctx.currentTime + 0.05; // petit lookahead
        playbackStartProjectTime = fromTime;
        activeSources = buildGraph(ctx, project, masterGain, {
            fromTime, t0: playbackStartCtxTime, live: true
        });
        isPlaying = true;
        // Capture lancée juste avant la lecture : on la cale sur CE départ (et on n'y touche plus ensuite)
        if ((recNode || recorder) && !recAlign) recAlign = { c: playbackStartCtxTime, p: playbackStartProjectTime };
    }

    function stopAll() {
        if (nativeOn) { nativeOn = false; clearTimeout(nativeTimer); try { nativeBackend && nativeBackend.stop(); } catch {} }
        activeSources.forEach(s => {
            try { s.stop(); } catch {}
        });
        activeSources = [];
        isPlaying = false;
    }

    function getPlaybackPosition() {
        if (nativeOn) return nativeFrom + (performance.now() - nativeWall) / 1000;
        if (!ctx) return 0;
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

    async function renderOffline(project, opts, onlyTrack) {
        await init();
        const totalDuration = projectEndSec(project, onlyTrack);
        if (totalDuration === 0) return null;

        const rangeStart = opts.startSec ?? 0;
        const isRange = opts.endSec !== undefined;
        const rangeEnd = opts.endSec ?? totalDuration;
        if (rangeEnd - rangeStart <= 0) return null;

        // Queue de reverb : on laisse l'effet mourir proprement après le dernier clip
        // Queue : on laisse la reverb et les échos mourir proprement après le dernier clip
        const uses = (name) => project.tracks.some((t, i) => (onlyTrack === null || i === onlyTrack) && (t.effects || []).includes(name))
            || (onlyTrack === null && (project.buses || []).some(b => (b.effects || []).includes(name)));
        const sendUsed = (type) => (project.sends || []).some(sd => !sd.muted && (sd.type === 'delay') === (type === 'delay')
            && (project.tracks.some((t, i) => (onlyTrack === null || i === onlyTrack) && (t.sends || {})[sd.id] > 0)
                || (onlyTrack === null && (project.buses || []).some(b => (b.sends || {})[sd.id] > 0))));
        const tail = isRange ? 0 : (uses('delay') || sendUsed('delay')) ? 4 : (uses('reverb') || sendUsed('reverb')) ? 2.5 : 0;
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

        buildGraph(offline, project, mg, { fromTime: rangeStart, t0: 0, endTime: rangeEnd, onlyTrack });

        const rendered = await offline.startRendering();
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

    // ===================== EFFETS INTÉGRÉS (presets Ridwane) =====================
    // Crée une chaîne EQ -> Comp -> Reverb selon les flags du track.effects
    // Retourne { input, output } pour brancher avant le gain de piste.
    function createEffectsChain(actx, enabled = [], params = {}, bpm = 120, ceiling = ceilingDb) {
        const input = actx.createGain();
        let prev = input;
        const connect = (n) => { prev.connect(n); prev = n; };

        // Chaque effet est un bloc ; on les branche dans l'ordre demandé (ordre habituel si rien n'est précisé)
        const B = {};

        // EQ 4-bandes
        B.eq = () => {
            if (enabled.includes('eq') && Array.isArray((params.eq || {}).bands)) {
                // EQ libre : autant de bandes que tu veux (cloche, étagères, coupe-bas, coupe-haut)
                for (const bd of params.eq.bands.slice(0, 24)) {
                    if (!bd || bd.on === false || !(bd.freq > 0)) continue;
                    const f = actx.createBiquadFilter();
                    f.frequency.value = Math.max(20, Math.min(20000, bd.freq));
                    const q = bd.q > 0 ? bd.q : 1;
                    if (bd.type === 'hpf' || bd.type === 'lpf') {
                        f.type = bd.type === 'hpf' ? 'highpass' : 'lowpass';
                        f.Q.value = 20 * Math.log10(q); // Web Audio règle le Q des coupe-bas / coupe-haut en dB
                    } else if (bd.type === 'lowshelf' || bd.type === 'highshelf') {
                        f.type = bd.type;
                        f.gain.value = bd.gain || 0;
                    } else {
                        f.type = 'peaking';
                        f.Q.value = q;
                        f.gain.value = bd.gain || 0;
                    }
                    connect(f);
                }
            } else if (enabled.includes('eq')) {
                const ep = params.eq || {};
                const hpf = actx.createBiquadFilter();
                hpf.type = 'highpass';
                hpf.frequency.value = ep.hpf !== undefined ? ep.hpf : 80;
                hpf.Q.value = 0.7;
                connect(hpf);

                const midCut = actx.createBiquadFilter();
                midCut.type = 'peaking';
                midCut.frequency.value = 300;
                midCut.Q.value = 1.0;
                midCut.gain.value = ep.midGain !== undefined ? ep.midGain : -2;
                connect(midCut);

                const presence = actx.createBiquadFilter();
                presence.type = 'peaking';
                presence.frequency.value = 4000;
                presence.Q.value = 0.7;
                presence.gain.value = ep.presence !== undefined ? ep.presence : 2;
                connect(presence);

                const air = actx.createBiquadFilter();
                air.type = 'highshelf';
                air.frequency.value = 10000;
                air.gain.value = ep.air !== undefined ? ep.air : 1;
                connect(air);

                // Coupe-haut optionnel (effet « téléphone »)
                if (ep.lpf) {
                    const lpf = actx.createBiquadFilter();
                    lpf.type = 'lowpass';
                    lpf.frequency.value = ep.lpf;
                    lpf.Q.value = 0.7;
                    connect(lpf);
                }
            }
        };

        // Saturation douce (« Doux ↔ Agressif »)
        B.sat = () => {
            const drive = enabled.includes('sat') ? ((params.sat || {}).drive || 0) : 0;
            if (drive > 0) {
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
            const deess = enabled.includes('deess') ? ((params.deess || {}).amount || 0) : 0;
            if (deess > 0 && fxReady.has(actx)) {
                connect(new AudioWorkletNode(actx, 'pulse-deesser', {
                    numberOfInputs: 1, numberOfOutputs: 1,
                    channelCountMode: 'max', // une voix mono reste mono (même volume qu'avant)
                    processorOptions: { amount: deess, freq: (params.deess || {}).freq || 5500 }
                }));
            }
        };

        // Compresseur (maison si possible ; sinon celui du navigateur, plus fort en sortie)
        B.comp = () => {
            if (enabled.includes('comp')) {
                const cp = params.comp || {};
                if (fxReady.has(actx)) {
                    connect(new AudioWorkletNode(actx, 'pulse-comp', {
                        numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                        processorOptions: { threshold: cp.threshold, ratio: cp.ratio, attack: cp.attack, release: cp.release, makeup: cp.makeup, mix: cp.mix }
                    }));
                } else {
                    const comp = actx.createDynamicsCompressor();
                    comp.threshold.value = cp.threshold !== undefined ? cp.threshold : -22;
                    comp.knee.value = 10;
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
                connect(new AudioWorkletNode(actx, 'pulse-limiter', {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
                    processorOptions: { ceiling: dbToLin((params.limit || {}).ceiling ?? ceiling) }
                }));
            }
        };

        // Écho
        B.delay = () => {
            if (enabled.includes('delay') && fxReady.has(actx)) {
                const dp = params.delay || {};
                connect(new AudioWorkletNode(actx, 'pulse-delay', {
                    numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
                    processorOptions: { time: delaySeconds(dp, bpm), feedback: (dp.feedback ?? 35) / 100, wet: (dp.wet ?? 25) / 100 }
                }));
            }
        };

        // Reverb (maison si possible ; sinon celle du navigateur)
        B.reverb = () => {
            if (enabled.includes('reverb') && fxReady.has(actx)) {
                const rp = params.reverb || {};
                connect(new AudioWorkletNode(actx, 'pulse-reverb', {
                    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCountMode: 'max',
                    processorOptions: { wet: rp.wet !== undefined ? rp.wet / 100 : 0.18, size: rp.size }
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
    function startMetronome(bpm, projectPlayheadSec = 0) {
        metroBpm = bpm;
        const beatSec = 60 / bpm;
        // Prochain beat à partir du playhead (pile dessus = on le joue)
        const nextBeat = Math.ceil(projectPlayheadSec / beatSec - 1e-6);
        metroBeat = nextBeat;
        // Même référence temporelle que la lecture (lookahead inclus)
        const base = isPlaying ? playbackStartCtxTime - (playbackStartProjectTime - projectPlayheadSec) : ctx.currentTime;
        metroNextTime = base + (nextBeat * beatSec - projectPlayheadSec);
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
        while (metroNextTime < ctx.currentTime + lookahead) {
            if (metroNextTime >= ctx.currentTime - 0.01) scheduleClick(metroNextTime, metroBeat % metroBpbar === 0);
            metroBeat++;
            metroNextTime += beatSec;
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
        hasMic, isCapturing, setMonitor, isMonitorOn, setMonitorRoute, isLowLatency, setLowLatency, getLatencyInfo, setCeiling, getCeiling: () => ceilingDb, getMasterVolume: () => masterVolume * 100, listInputs, setInputDevice, muteTrackBetween, calibrateLatency, getMicLabel, getMicDeviceId, consumeMicFallback, updateBusVolume,
        startRecording, stopRecording,
        registerBuffer, hasBuffer, getBuffer, getBufferDuration, clearBuffers, computePeaks,
        play, stopAll, getPlaybackPosition, setNativeBackend, isNative, setBeatsPerBar,
        updateTrackVolume, updateTrackPan, refreshAudibility, clearLiveNodes,
        getTrackAnalyser, getTrackMeters, trackChannelCount, getMasterAnalyser, getTrackSpectrum, getBusSpectrum, setMasterVolume,
        setMetronome, setMetronomeBpm, setCountIn, isCountInEnabled,
        startMetronome, stopMetronome, playCountIn, stopCountIn, isCountingIn,
        exportWav, exportTrackWav, audioBufferToWav, computeNormalizeGain,
        getContext: () => ctx
    };
})();
