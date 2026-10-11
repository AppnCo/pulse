// === Pulse — Audio Engine (Web Audio API, v0.2 proto) ===
// Moteur temporaire web avant le passage à Tauri + Rust natif.
// Gère : init contexte, mic, enregistrement, lecture multipiste, export WAV.

window.PulseAudio = (function() {
    let ctx = null;
    let masterGain = null;
    let masterAnalyser = null;
    let micStream = null;
    let metronomeEnabled = false;
    let countInEnabled = true;
    let metroTimer = null;
    let metroNextTime = 0;
    let metroBeat = 0;
    let metroBpm = 90;

    // Enregistrement
    let recorder = null;
    let recorderChunks = [];
    let recorderStartSec = 0;       // position playhead au début de l'enregistrement
    let recorderTargetIdx = -1;     // piste cible
    let recorderStartTs = 0;        // ctx.currentTime au début
    let recordingCallbacks = { onStop: null, onProgress: null };
    let progressTimer = null;

    // Lecture
    let activeSources = [];
    let playbackStartCtxTime = 0;
    let playbackStartProjectTime = 0;

    // Cache des AudioBuffers par clip.id
    const buffers = new Map();

    async function init() {
        if (ctx) return ctx;
        ctx = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive',
            sampleRate: 48000
        });
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.9;
        // Analyser master pour le VU-mètre topbar
        masterAnalyser = ctx.createAnalyser();
        masterAnalyser.fftSize = 256;
        masterAnalyser.smoothingTimeConstant = 0.6;
        masterGain.connect(masterAnalyser);
        masterGain.connect(ctx.destination);
        return ctx;
    }

    function getMasterAnalyser() { return masterAnalyser; }

    function setMasterVolume(v0to100) {
        if (masterGain) masterGain.gain.setTargetAtTime(v0to100 / 100, ctx.currentTime, 0.01);
    }

    async function resumeIfNeeded() {
        await init();
        if (ctx.state === 'suspended') await ctx.resume();
    }

    async function requestMic() {
        if (micStream) return micStream;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            return micStream;
        } catch (err) {
            console.error('Mic denied', err);
            throw err;
        }
    }

    function releaseMic() {
        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }
    }

    async function startRecording(targetTrackIdx, projectStartSec, callbacks = {}) {
        await resumeIfNeeded();
        await requestMic();

        recorderChunks = [];
        recorderTargetIdx = targetTrackIdx;
        recorderStartSec = projectStartSec;
        recorderStartTs = ctx.currentTime;
        recordingCallbacks = callbacks;

        // On choisit le meilleur mime supporté par le navigateur
        const mime = pickBestMime();
        recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) recorderChunks.push(e.data);
        };

        recorder.start(100); // chunk toutes les 100ms

        // Progress ticker (pour l'animation du clip en cours)
        if (callbacks.onProgress) {
            progressTimer = setInterval(() => {
                const elapsed = ctx.currentTime - recorderStartTs;
                callbacks.onProgress(elapsed);
            }, 50);
        }
    }

    async function stopRecording() {
        if (!recorder) return null;
        return new Promise(resolve => {
            recorder.onstop = async () => {
                if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
                const blob = new Blob(recorderChunks, { type: recorder.mimeType || 'audio/webm' });
                let audioBuffer = null;
                try {
                    const arrBuf = await blob.arrayBuffer();
                    audioBuffer = await ctx.decodeAudioData(arrBuf);
                } catch (err) {
                    console.error('Decode after rec failed', err);
                }
                const duration = audioBuffer ? audioBuffer.duration : 0;
                resolve({
                    audioBuffer,
                    blob,
                    duration,
                    startSec: recorderStartSec,
                    targetTrackIdx: recorderTargetIdx,
                    mime: recorder.mimeType
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
        const samplesPerPeak = Math.floor(samples.length / numPeaks);
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

    function hasBuffer(clipId) {
        return buffers.has(clipId);
    }

    function clearBuffers() {
        buffers.clear();
    }

    // === Lecture multipiste synchronisée depuis fromTime (en secondes) ===
    async function play(project, fromTime) {
        await resumeIfNeeded();
        stopAll();
        clearLiveNodes();

        playbackStartCtxTime = ctx.currentTime + 0.05; // petit lookahead
        playbackStartProjectTime = fromTime;

        const anySolo = project.tracks.some(t => t.solo);

        project.tracks.forEach((track, trackIdx) => {
            if (track.muted) return;
            if (anySolo && !track.solo) return;

            // Chaîne : clip → [effects chain] → gain piste → pan? → analyser → master
            const trackGain = ctx.createGain();
            trackGain.gain.value = (track.volume ?? 80) / 100;

            // Effects chain
            const fx = createEffectsChain(track.effects || []);
            fx.output.connect(trackGain);

            // Pan + analyser pour VU-mètre
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.6;

            let panNode = null;
            if (track.pan !== undefined && track.pan !== null) {
                panNode = ctx.createStereoPanner();
                panNode.pan.value = Math.max(-1, Math.min(1, (track.pan || 0) / 100));
                trackGain.connect(panNode);
                panNode.connect(analyser);
            } else {
                trackGain.connect(analyser);
            }
            analyser.connect(masterGain);

            setLiveTrackNodes(trackIdx, trackGain, panNode, analyser);

            (track.clips || []).forEach(clip => {
                if (clip.muted) return;
                const buf = buffers.get(clip.id);
                if (!buf) return;

                const clipStart = clip.start;
                const clipEnd = clip.start + clip.duration;
                if (fromTime >= clipEnd) return;

                const offsetInClip = Math.max(0, fromTime - clipStart);
                const whenAhead = Math.max(0, clipStart - fromTime);
                const remainingDuration = clipEnd - Math.max(clipStart, fromTime);

                const source = ctx.createBufferSource();
                source.buffer = buf;

                // Fades : GainNode entre la source et l'effet
                const hasFade = (clip.fadeIn && clip.fadeIn > 0) || (clip.fadeOut && clip.fadeOut > 0);
                if (hasFade) {
                    const fg = ctx.createGain();
                    source.connect(fg);
                    fg.connect(fx.input);
                    const clipAbsStart = playbackStartCtxTime + whenAhead;
                    const clipAbsEnd   = clipAbsStart + remainingDuration;

                    // Fade-in
                    if (clip.fadeIn > 0) {
                        const fiDuration = clip.fadeIn;
                        const fiElapsed  = offsetInClip; // combien de fade déjà consommé
                        if (fiElapsed < fiDuration) {
                            const startGain = fiElapsed / fiDuration;
                            const rampEnd   = clipAbsStart + (fiDuration - fiElapsed);
                            fg.gain.setValueAtTime(startGain, clipAbsStart);
                            fg.gain.linearRampToValueAtTime(1, rampEnd);
                        } else {
                            fg.gain.setValueAtTime(1, clipAbsStart);
                        }
                    } else {
                        fg.gain.setValueAtTime(1, clipAbsStart);
                    }

                    // Fade-out
                    if (clip.fadeOut > 0) {
                        const foStart = clipAbsEnd - clip.fadeOut;
                        if (foStart > clipAbsStart) {
                            fg.gain.setValueAtTime(1, foStart);
                        }
                        fg.gain.linearRampToValueAtTime(0.001, clipAbsEnd);
                    }
                } else {
                    source.connect(fx.input);
                }

                try {
                    source.start(playbackStartCtxTime + whenAhead, offsetInClip, remainingDuration);
                } catch (err) {
                    console.error('BufferSource start failed', err);
                }
                activeSources.push(source);
            });
        });
    }

    function stopAll() {
        activeSources.forEach(s => {
            try { s.stop(); } catch {}
        });
        activeSources = [];
    }

    function getPlaybackPosition() {
        if (!ctx) return 0;
        return playbackStartProjectTime + (ctx.currentTime - playbackStartCtxTime);
    }

    // === Export WAV mixdown ===
    async function exportWav(project) {
        await init();

        let totalDuration = 0;
        project.tracks.forEach(t => (t.clips || []).forEach(c => {
            totalDuration = Math.max(totalDuration, c.start + c.duration);
        }));
        if (totalDuration === 0) return null;

        const sampleRate = 48000;
        const offline = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);
        const mg = offline.createGain();
        mg.gain.value = 0.9;
        mg.connect(offline.destination);

        const anySolo = project.tracks.some(t => t.solo);

        project.tracks.forEach(track => {
            if (track.muted) return;
            if (anySolo && !track.solo) return;

            const trackGain = offline.createGain();
            trackGain.gain.value = (track.volume ?? 80) / 100;

            let output = trackGain;
            if (track.pan && track.pan !== 0) {
                const pan = offline.createStereoPanner();
                pan.pan.value = Math.max(-1, Math.min(1, track.pan / 100));
                trackGain.connect(pan);
                output = pan;
            }
            output.connect(mg);

            (track.clips || []).forEach(clip => {
                if (clip.muted) return;
                const buf = buffers.get(clip.id);
                if (!buf) return;
                const source = offline.createBufferSource();
                source.buffer = buf;
                // Fades sur export
                const hasFade = (clip.fadeIn && clip.fadeIn > 0) || (clip.fadeOut && clip.fadeOut > 0);
                if (hasFade) {
                    const fg = offline.createGain();
                    source.connect(fg);
                    fg.connect(trackGain);
                    if (clip.fadeIn > 0) {
                        fg.gain.setValueAtTime(0, clip.start);
                        fg.gain.linearRampToValueAtTime(1, clip.start + clip.fadeIn);
                    }
                    if (clip.fadeOut > 0) {
                        const foStart = clip.start + clip.duration - clip.fadeOut;
                        fg.gain.setValueAtTime(1, foStart);
                        fg.gain.linearRampToValueAtTime(0.001, clip.start + clip.duration);
                    }
                } else {
                    source.connect(trackGain);
                }
                source.start(clip.start, 0, clip.duration);
            });
        });

        const rendered = await offline.startRendering();
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

    // ===================== EFFETS INTÉGRÉS (presets Ridwane) =====================
    // Crée une chaîne EQ -> Comp -> Reverb selon les flags du track.effects
    // Retourne { input, output } pour brancher avant le gain de piste.
    function createEffectsChain(enabled = []) {
        const nodes = [];
        let input = null, prev = null;

        const connect = (n) => {
            if (!input) input = n;
            if (prev) prev.connect(n);
            prev = n;
            nodes.push(n);
        };

        // EQ 3-bandes (preset voix lead : HPF 80Hz + léger cut 300Hz + boost 4kHz)
        if (enabled.includes('eq')) {
            const hpf = ctx.createBiquadFilter();
            hpf.type = 'highpass';
            hpf.frequency.value = 80;
            hpf.Q.value = 0.7;
            connect(hpf);

            const midCut = ctx.createBiquadFilter();
            midCut.type = 'peaking';
            midCut.frequency.value = 300;
            midCut.Q.value = 1.0;
            midCut.gain.value = -2;
            connect(midCut);

            const presence = ctx.createBiquadFilter();
            presence.type = 'peaking';
            presence.frequency.value = 4000;
            presence.Q.value = 0.7;
            presence.gain.value = 2;
            connect(presence);

            const air = ctx.createBiquadFilter();
            air.type = 'highshelf';
            air.frequency.value = 10000;
            air.gain.value = 1;
            connect(air);
        }

        // Compresseur voix (preset Ridwane : ratio 3:1, attaque 10ms, release 50ms)
        if (enabled.includes('comp')) {
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -22;
            comp.knee.value = 10;
            comp.ratio.value = 3;
            comp.attack.value = 0.010;
            comp.release.value = 0.050;
            connect(comp);

            // Compense le gain réduit par la compression
            const makeup = ctx.createGain();
            makeup.gain.value = 1.3;
            connect(makeup);
        }

        // Reverb (ConvolverNode avec IR généré algorithmiquement)
        if (enabled.includes('reverb')) {
            const dry = ctx.createGain();
            const wet = ctx.createGain();
            const conv = ctx.createConvolver();
            conv.buffer = generateImpulseResponse(ctx, 1.8, 2.5); // 1.8s, decay 2.5
            dry.gain.value = 0.82;
            wet.gain.value = 0.18;

            // Split : prev --> dry --> sum
            //         prev --> conv --> wet --> sum
            const sum = ctx.createGain();
            if (prev) {
                prev.connect(dry);
                prev.connect(conv);
            } else {
                // Si pas de prev (reverb seul), input = conv
                input = conv;
            }
            conv.connect(wet);
            dry.connect(sum);
            wet.connect(sum);
            prev = sum;
            nodes.push(dry, wet, conv, sum);
        }

        if (!input) {
            // Chaîne vide → pass-through
            const g = ctx.createGain();
            input = g;
            prev = g;
            nodes.push(g);
        }

        return { input, output: prev, nodes };
    }

    // Génère un IR algorithmique (bruit décroissant exponentiellement, stéréo)
    function generateImpulseResponse(audioCtx, durationSec, decay) {
        const sampleRate = audioCtx.sampleRate;
        const length = Math.floor(sampleRate * durationSec);
        const impulse = audioCtx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        return impulse;
    }

    function setLiveTrackNodes(trackIdx, gainNode, panNode, analyser) {
        liveNodes.set(trackIdx, { gainNode, panNode, analyser });
    }

    function getTrackAnalyser(trackIdx) {
        const n = liveNodes.get(trackIdx);
        return n ? n.analyser : null;
    }

    function updateTrackVolume(trackIdx, vol0to100) {
        const n = liveNodes.get(trackIdx);
        if (n && n.gainNode) {
            n.gainNode.gain.setTargetAtTime(vol0to100 / 100, ctx.currentTime, 0.01);
        }
    }

    function updateTrackPan(trackIdx, pan100) {
        const n = liveNodes.get(trackIdx);
        if (n && n.panNode) {
            n.panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan100 / 100)), ctx.currentTime, 0.01);
        }
    }

    function clearLiveNodes() {
        liveNodes.clear();
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
    function startMetronome(bpm, projectPlayheadSec = 0) {
        metroBpm = bpm;
        const beatSec = 60 / bpm;
        // Combien de beats sont déjà passés avant la position du playhead
        const beatsPassed = Math.floor(projectPlayheadSec / beatSec);
        metroBeat = beatsPassed;
        // Position du prochain beat (en secondes projet)
        const nextBeatInProject = (beatsPassed + 1) * beatSec;
        const offsetFromNow = nextBeatInProject - projectPlayheadSec;
        metroNextTime = ctx.currentTime + offsetFromNow;
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
        if (!metronomeEnabled && !metroCountIn.active) {
            stopMetronome();
            return;
        }
        const beatSec = 60 / metroBpm;
        const lookahead = 0.1;
        while (metroNextTime < ctx.currentTime + lookahead) {
            scheduleClick(metroNextTime, metroBeat % 4 === 0);
            metroBeat++;
            metroNextTime += beatSec;

            if (metroCountIn.active && metroBeat >= metroCountIn.beats) {
                metroCountIn.active = false;
                if (metroCountIn.onComplete) metroCountIn.onComplete();
                if (!metronomeEnabled) { stopMetronome(); return; }
            }
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
    }

    const metroCountIn = { active: false, beats: 4, onComplete: null };

    // Count-in : joue 4 clicks puis exécute onComplete au moment où le vrai beat 1 doit sonner
    async function playCountIn(bpm, beats = 4) {
        await resumeIfNeeded();
        return new Promise(resolve => {
            metroCountIn.active = true;
            metroCountIn.beats = beats;
            metroCountIn.onComplete = resolve;
            startMetronome(bpm, 0);
        });
    }

    function stopCountIn() {
        metroCountIn.active = false;
        if (!metronomeEnabled) stopMetronome();
    }

    return {
        init, resumeIfNeeded, requestMic, releaseMic,
        startRecording, stopRecording,
        registerBuffer, hasBuffer, clearBuffers, computePeaks,
        play, stopAll, getPlaybackPosition,
        updateTrackVolume, updateTrackPan, clearLiveNodes,
        getTrackAnalyser, getMasterAnalyser, setMasterVolume,
        setMetronome, setMetronomeBpm, setCountIn, isCountInEnabled,
        startMetronome, stopMetronome, playCountIn, stopCountIn,
        exportWav, audioBufferToWav,
        getContext: () => ctx
    };
})();
