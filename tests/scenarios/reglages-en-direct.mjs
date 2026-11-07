// Réglages de plugins en direct pendant la lecture : (1) aucun redémarrage du son quand on bouge un réglage,
// (2) pour chaque machine et chaque réglage, le son reçu en direct = le son construit avec ce réglage (au bruit près)
import { boot, J } from './qa-lib.mjs';
const KINDS = { fet76: 'pulse-fet76', pre73: 'pulse-pre73', prev76: 'pulse-prev76', eclat: 'pulse-eclat', souffle: 'pulse-souffle', eqp1: 'pulse-eqp1', tape: 'pulse-tape', eq550: 'pulse-eq550',
  massif: 'pulse-massif', horizon: 'pulse-horizon', techo: 'pulse-techo', dim: 'pulse-dim', h910: 'pulse-h910', hall80: 'pulse-hall80', plate: 'pulse-plate', bus33: 'pulse-bus33',
  comp25: 'pulse-comp25', stripe: 'pulse-stripe', dtr: 'pulse-dtr', l670: 'pulse-l670', busg: 'pulse-busg', opto2a: 'pulse-opto2a', crush: 'pulse-crush', pitch: 'pulse-pitch',
  chorus: 'pulse-mod', flanger: 'pulse-mod', phaser: 'pulse-mod', tremolo: 'pulse-mod', doubler: 'pulse-mod', slapback: 'pulse-mod' };
export default async (c) => {
  const { ev, sleep, check } = c;
  const R = (s, d) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), name: 'r', start: s, duration: d, offset: 0, peaks: [0.5, 0.5] });
  await boot(c, { id: 'red', name: 'RED', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', output: 'master', clips: [R(0, 60)], effects: ['eq', 'fet76', 'plate', 'sat', 'gate', 'delay', 'reverb', 'limit'], effectParams: { sat: { drive: 20 }, gate: { threshold: -40 }, delay: { wet: 20 }, reverb: { wet: 15 }, limit: { ceiling: -1 }, eq: { bands: [{ type: 'hpf', freq: 80, gain: 0, q: 0.71, slope: 24 }, { type: 'bell', freq: 1000, gain: 0, q: 1 }] }, fet76: { input: 20 }, plate: {} } }] }, { mic: false });
  await ev(`state.playhead = 0; togglePlay()`); await sleep(1000);
  // 1. bouger un réglage du 76 et de la plaque : aucune reconstruction
  await ev(`window.__plays = 0; { const p = PulseAudio.play; PulseAudio.play = function (...a) { window.__plays++; return p.apply(this, a); }; PulseAudio.play._liveWrapped = true; }`);
  await ev(`(() => { const t = state.project.tracks[0]; for (let k = 0; k < 12; k++) { t.effectParams.fet76.input = 20 + k * 3; refreshPlaybackSoon(); } t.effectParams.plate.decay = 2.5; refreshPlaybackSoon();
    for (let k = 1; k <= 6; k++) { t.effectParams.sat.drive = 20 + k * 5; t.effectParams.gate.threshold = -40 + k; t.effectParams.delay.wet = 20 + k; t.effectParams.reverb.wet = 15 + k; t.effectParams.limit.ceiling = -1 - k / 10; refreshPlaybackSoon(); }
    for (let k = 0; k < 10; k++) { const b = t.effectParams.eq.bands.map(x => ({ ...x })); b[1].gain = k; b[1].freq = 1000 + k * 100; b[1].q = 1 + k / 10; t.effectParams.eq = { ...t.effectParams.eq, bands: b }; t.eqBands = b; refreshPlaybackSoon(); } })()`); await sleep(500);
  check('76, plaque, EQ, saturation, gate, delay, réverbe, limiteur : envoyés en direct, le son ne redémarre pas', await J(ev, `return window.__plays`) === 0, 'reconstructions=' + await J(ev, `return window.__plays`));
  // un vrai changement de structure reconstruit toujours
  await ev(`(() => { const t = state.project.tracks[0]; t.effects.push('tape'); refreshPlaybackSoon(); })()`); await sleep(500);
  check('plugin ajouté : le son est reconstruit (normal)', await J(ev, `return window.__plays`) >= 1);
  // 2. parité, machine par machine, réglage par réglage
  const res = JSON.parse(await ev(`(async () => {
    const ctx = PulseAudio.getContext(); const out = [], KINDS = ${JSON.stringify(KINDS)};
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(2, len, ctx.sampleRate); let sd = 7;
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) { sd = (sd * 1664525 + 1013904223) % 4294967296; d[i] = 0.25 * Math.sin(2 * Math.PI * 220 * i / ctx.sampleRate) + 0.15 * (sd / 4294967296 - 0.5) * (i % 9600 < 2400 ? 1 : 0.2); } }
    const PHASE = ['h910:pitchL', 'h910:pitchR', 'hall80:spin', 'crush:down', 'pitch:semi', 'chorus:rate', 'flanger:rate', 'phaser:rate', 'tremolo:rate', 'doubler:rate', 'slapback:rate', 'dim:rate', 'techo:wow', 'techo:flutter', 'h910:delayL', 'h910:delayR'];
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    for (const [kind, wname] of Object.entries(KINDS)) {
      const keys = (AUTO_FX[kind] || []);
      for (const key of keys) {
        const d = fxAllDefs(kind).find(x => x.key === key); if (!d) continue;
        const v1 = d.min + (d.max - d.min) * 0.8;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const mk = (p) => new AudioWorkletNode(ctx, wname, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCountMode: 'max', processorOptions: { kind, ...p } });
        const A = mk({ [key]: v1 }), B = mk({});
        // différence A − B calculée dans le moteur (même bloc de son, aucun décalage)
        const aA = ctx.createAnalyser(), aD = ctx.createAnalyser(); aA.fftSize = aD.fftSize = 16384;
        const inv = ctx.createGain(); inv.gain.value = -1;
        const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
        src.connect(A); src.connect(B); A.connect(aA); A.connect(aD); B.connect(inv); inv.connect(aD); aA.connect(mute); aD.connect(mute);
        src.start();
        await new Promise(r => setTimeout(r, 250));
        const xa = new Float32Array(16384), xd = new Float32Array(16384);
        aA.getFloatTimeDomainData(xa); aD.getFloatTimeDomainData(xd);
        const before = rms(xd) / Math.max(1e-9, rms(xa));
        B.port.postMessage({ live: { [key]: v1 } });
        await new Promise(r => setTimeout(r, ['techo', 'hall80', 'plate', 'slapback', 'doubler'].includes(kind) ? 4500 : 1800));
        aA.getFloatTimeDomainData(xa); aD.getFloatTimeDomainData(xd);
        let after = rms(xd) / Math.max(1e-9, rms(xa));
        // Réglages de vitesse / hauteur : l'oscillation garde sa phase en direct (normal) → on compare le spectre moyen, pas la forme d'onde
        let spec = null;
        if (PHASE.includes(kind + ':' + key)) {
          const aB = ctx.createAnalyser(); aB.fftSize = 8192; aB.smoothingTimeConstant = 0; B.connect(aB); aB.connect(mute);
          const fa = new Float32Array(4096), fb = new Float32Array(4096), sa = new Float32Array(4096), sb = new Float32Array(4096);
          const aS = ctx.createAnalyser(); aS.fftSize = 8192; aS.smoothingTimeConstant = 0; A.connect(aS); aS.connect(mute);
          for (let k = 0; k < 20; k++) { await new Promise(r => setTimeout(r, 60)); aS.getFloatFrequencyData(fa); aB.getFloatFrequencyData(fb); for (let i = 0; i < 4096; i++) { sa[i] += Math.pow(10, fa[i] / 10); sb[i] += Math.pow(10, fb[i] / 10); } }
          // écart moyen en dB sur les bandes qui comptent (au-dessus de -90 dB)
          let n = 0, d = 0; for (let i = 4; i < 4096; i++) { const x = 10 * Math.log10(sa[i] / 20 + 1e-12), y = 10 * Math.log10(sb[i] / 20 + 1e-12); if (x > -90 || y > -90) { d += Math.abs(x - y); n++; } }
          spec = n ? d / n : 0; after = spec < 2.5 ? 0 : after; aB.disconnect(); aS.disconnect();
        }
        out.push({ kind, key, before: +before.toFixed(4), after: +after.toFixed(4), ...(spec !== null ? { spectreDb: +spec.toFixed(2) } : {}) });
        src.stop(); [src, A, B, aA, aD, inv, mute].forEach(n => n.disconnect());
      }
    }
    // Plugins construits avec des conversions (mêmes formules que le moteur et que l'automation)
    const pct = (x) => x / 100, db2lin = (x) => Math.pow(10, x / 20);
    const CASES = [
      { kind: 'sat', w: 'pulse-sat', base: { drive: 30 }, conv: {} },
      { kind: 'deess', w: 'pulse-deesser2', base: { thr: -30, range: 6 }, conv: {}, keys: ['thr', 'range'] },
      { kind: 'deess', w: 'pulse-deesser', base: { amount: 40, freq: 5500 }, conv: {}, keys: ['amount'] },
      { kind: 'limit', w: 'pulse-limiter', base: { ceiling: db2lin(-1), gain: 0 }, conv: {}, build: { ceiling: db2lin } },
      { kind: 'delay', w: 'pulse-delay', base: { time: 0.25, feedback: 0.35, wet: 0.25, dry: 1 }, conv: { feedback: pct, wet: pct, dry: pct } },
      { kind: 'reverb', w: 'pulse-reverb', base: { wet: 0.18 }, conv: { wet: pct } },
      { kind: 'gate', w: 'pulse-gate', base: { threshold: -30, release: 150, reduction: 40 }, conv: {} },
    ];
    for (const cs of CASES) for (const key of (cs.keys || AUTO_FX[cs.kind] || [])) {
      const d = fxAllDefs(cs.kind).find(x => x.key === key); if (!d) continue;
      const v1 = d.min + (d.max - d.min) * 0.8;
      const live = cs.conv[key] ? cs.conv[key](v1) : v1, built = (cs.build && cs.build[key]) ? cs.build[key](v1) : live;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const mk = (p) => new AudioWorkletNode(ctx, cs.w, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCountMode: 'max', processorOptions: p });
      const A = mk({ ...cs.base, [key]: built }), B = mk(cs.base);
      const aA = ctx.createAnalyser(), aD = ctx.createAnalyser(); aA.fftSize = aD.fftSize = 16384;
      const inv = ctx.createGain(); inv.gain.value = -1; const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
      src.connect(A); src.connect(B); A.connect(aA); A.connect(aD); B.connect(inv); inv.connect(aD); aA.connect(mute); aD.connect(mute); src.start();
      await new Promise(r => setTimeout(r, 250));
      const xa = new Float32Array(16384), xd = new Float32Array(16384);
      aA.getFloatTimeDomainData(xa); aD.getFloatTimeDomainData(xd); const before = rms(xd) / Math.max(1e-9, rms(xa));
      B.port.postMessage({ live: { [key]: live } });
      await new Promise(r => setTimeout(r, ['delay', 'reverb'].includes(cs.kind) ? 4500 : 1800));
      aA.getFloatTimeDomainData(xa); aD.getFloatTimeDomainData(xd); const after = rms(xd) / Math.max(1e-9, rms(xa));
      out.push({ kind: cs.kind + (cs.w === 'pulse-deesser' ? '(ancien)' : ''), key, before: +before.toFixed(4), after: +after.toFixed(4) });
      src.stop(); [src, A, B, aA, aD, inv, mute].forEach(n => n.disconnect());
    }
    // EQ : gain / fréquence / largeur d'un point
    for (const [field, val] of [['gain', 9], ['freq', 3500], ['q', 4]]) {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const base = { i: 0, type: 'bell', freq: 1000, gain: 6, q: 1 };
      const mk = (b) => new AudioWorkletNode(ctx, 'pulse-eq', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCountMode: 'max', processorOptions: { bands: [b] } });
      const A = mk({ ...base, [field]: val }), B = mk(base);
      const aA = ctx.createAnalyser(), aD = ctx.createAnalyser(); aA.fftSize = aD.fftSize = 16384;
      const inv = ctx.createGain(); inv.gain.value = -1; const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
      src.connect(A); src.connect(B); A.connect(aA); A.connect(aD); B.connect(inv); inv.connect(aD); aA.connect(mute); aD.connect(mute); src.start();
      await new Promise(r => setTimeout(r, 250));
      const xa = new Float32Array(16384), xd = new Float32Array(16384);
      aA.getFloatTimeDomainData(xa); aD.getFloatTimeDomainData(xd); const before = rms(xd) / Math.max(1e-9, rms(xa));
      B.port.postMessage({ live: { ['b0-' + field]: val } });
      await new Promise(r => setTimeout(r, 1200));
      aA.getFloatTimeDomainData(xa); aD.getFloatTimeDomainData(xd); const after = rms(xd) / Math.max(1e-9, rms(xa));
      out.push({ kind: 'eq', key: field, before: +before.toFixed(4), after: +after.toFixed(4) });
      src.stop(); [src, A, B, aA, aD, inv, mute].forEach(n => n.disconnect());
    }
    return JSON.stringify(out); })()`));
  const tested = Array.isArray(res) ? res.filter(r => r.before > 0.01) : [];
  const bad = tested.filter(r => r.after > 0.02);
  console.log('réglages testés :', tested.length, '/ sans effet audible à cette valeur :', Array.isArray(res) ? res.length - tested.length : res);
  check('chaque réglage envoyé en direct donne le même son que reconstruit', Array.isArray(res) && tested.length > 40 && !bad.length, JSON.stringify(bad.slice(0, 12)));
};
