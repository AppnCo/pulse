// node tests/tune.test.mjs — vérifie l'Auto-Tune sur des voix synthétiques
await import('../tune.js');
const T = globalThis.PulseTune, sr = 48000;
// "Voix" : source riche en harmoniques, enveloppe de formants grossière, fréquence variable
function voice(freqFn, sec) {
  const n = Math.round(sr * sec), x = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const f = freqFn(i / sr); ph += 2 * Math.PI * f / sr;
    let s = 0; for (let h = 1; h <= 12; h++) s += Math.sin(h * ph) / (h * (1 + Math.abs(h * f - 700) / 900));
    x[i] = 0.4 * s; }
  return x;
}
const median = (a) => { const s = Array.from(a).filter(v => v > 0).sort((p, q) => p - q); return s[s.length >> 1]; };
const cents = (a, b) => 1200 * Math.log2(a / b);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
let fail = 0; const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + ' — ' + info); if (!cond) fail++; };

// 1. Note tenue fausse : 452 Hz (entre La 440 et La# 466) → doit revenir sur 440
let x = voice(() => 452, 1.5);
let f0 = await T.trackPitch(x, sr);
ok('détection', Math.abs(cents(median(f0), 452)) < 8, `mesuré ${median(f0).toFixed(1)} Hz pour 452`);
let r = await T.process([x], sr, { root: -1, strength: 1 });
let g0 = await T.trackPitch(r.channels[0], sr);
ok('recalage robot', Math.abs(cents(median(g0), 440)) < 8, `sortie ${median(g0).toFixed(1)} Hz (cible 440), correction moyenne ${r.avgCents.toFixed(0)} cents`);
ok('volume conservé', Math.abs(rms(r.channels[0]) / rms(x) - 1) < 0.15, `rapport ${(rms(r.channels[0]) / rms(x)).toFixed(2)}`);
ok('durée conservée', r.channels[0].length === x.length, `${x.length} échantillons`);

// 2. Voix grave avec vibrato autour de 111,5 Hz (La2 = 110) — reste dans la zone du La
x = voice((t) => 111.5 * Math.pow(2, 0.3 / 12 * Math.sin(2 * Math.PI * 5.5 * t)), 1.5);
r = await T.process([x], sr, { root: -1, strength: 1 });
g0 = await T.trackPitch(r.channels[0], sr);
const spread = (a) => { const s = Array.from(a).filter(v => v > 0).map(v => cents(v, 110)).sort((p, q) => p - q); return s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)]; };
ok('vibrato aplati (robot)', Math.abs(cents(median(g0), 110)) < 10 && spread(g0) < 25, `médiane ${median(g0).toFixed(1)} Hz, étendue ${spread(g0).toFixed(0)} cents (avant : ~60)`);

// 3. Gamme : en Do majeur un Do# (277) doit aller sur Do (262) ou Ré (294), jamais rester
x = voice(() => 280, 1.2);
r = await T.process([x], sr, { root: 0, strength: 1 });
g0 = await T.trackPitch(r.channels[0], sr);
const m = median(g0);
ok('respect de la gamme', Math.abs(cents(m, 261.63)) < 12 || Math.abs(cents(m, 293.66)) < 12, `sortie ${m.toFixed(1)} Hz`);

// 4. Mode naturel : on corrige moins vite, mais on finit juste
x = voice(() => 452, 1.5);
r = await T.process([x], sr, { root: -1, strength: 0.3 });
g0 = await T.trackPitch(r.channels[0], sr);
ok('naturel finit juste', Math.abs(cents(g0[Math.floor(g0.length * 0.8)], 440)) < 12, `fin ${g0[Math.floor(g0.length * 0.8)].toFixed(1)} Hz`);

// 5. Souffle / consonne (bruit) : on ne touche pas
x = new Float32Array(sr).map(() => (Math.random() * 2 - 1) * 0.2);
r = await T.process([x], sr, { root: -1, strength: 1 });
ok('bruit laissé tel quel', r.voicedPct < 0.15 && Math.abs(rms(r.channels[0]) / rms(x) - 1) < 0.2, `voisé ${(r.voicedPct * 100).toFixed(0)} %, volume ${(rms(r.channels[0]) / rms(x)).toFixed(2)}`);

// 6. Tonalité devinée : mélodie en Sol majeur
const melody = [392, 440, 493.9, 523.3, 587.3, 659.3, 740, 784];
x = voice((t) => melody[Math.min(7, Math.floor(t / 0.4))], 3.2);
f0 = await T.trackPitch(x, sr);
ok('tonalité', T.detectKey(f0) === 7, T.keyLabel(T.detectKey(f0)));

// 7. Vitesse
const t0 = Date.now(); x = voice(() => 300, 10); await T.process([x], sr, { root: -1, strength: 1 });
console.log(`vitesse : 10 s de voix traitées en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// 8. Gamme lue sur une instru : accords + basse + batterie (bruit), comme une prod
function prod(chords, secPer = 2) {
  const n = Math.round(sr * secPer * chords.length * 4), x = new Float32Array(n);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / sr, c = chords[Math.floor(t / secPer) % chords.length];
    let s = 0;
    for (const m of c.notes) for (let h = 1; h <= 4; h++) s += Math.sin(2 * Math.PI * hz(m) * h * t) / (h * 3);
    s += 0.9 * Math.sin(2 * Math.PI * hz(c.bass) * t);                    // 808
    const ph = t % 0.33; s += ph < 0.03 ? (Math.random() * 2 - 1) * 0.8 : 0; // charley
    x[i] = 0.2 * s;
  }
  return x;
}
const maskStr = (m) => m.map((v, i) => v ? T.NOTE_NAMES[i] : '').filter(Boolean).join(' ');
// La mineur : Am F C G
let k = await T.detectKeyFromMusic(prod([{ notes: [57, 60, 64], bass: 33 }, { notes: [53, 57, 60], bass: 29 }, { notes: [48, 52, 55], bass: 36 }, { notes: [55, 59, 62], bass: 31 }]), sr);
ok('gamme instru (La mineur)', maskStr(k.notes) === 'C D E F G A B', `${T.scaleName(k.tonic, k.minor)} — notes ${maskStr(k.notes)} — confiance ${k.confidence.toFixed(2)}`);
// Fa# mineur façon trap : F#m D E F#m
k = await T.detectKeyFromMusic(prod([{ notes: [54, 57, 61], bass: 30 }, { notes: [50, 54, 57], bass: 26 }, { notes: [52, 56, 59], bass: 28 }, { notes: [54, 57, 61], bass: 30 }]), sr);
ok('gamme instru (Fa# mineur)', k.tonic === 6 && k.minor, `${T.scaleName(k.tonic, k.minor)} — notes ${maskStr(k.notes)} — confiance ${k.confidence.toFixed(2)}`);
// Batterie seule : pas de gamme fiable
const drums = new Float32Array(sr * 20); for (let i = 0; i < drums.length; i++) { const ph = (i / sr) % 0.5; drums[i] = ph < 0.05 ? (Math.random() * 2 - 1) * 0.5 : 0; }
k = await T.detectKeyFromMusic(drums, sr);
ok('batterie seule = pas sûr', !k || k.confidence < 0.35, k ? `confiance ${k.confidence.toFixed(2)}` : 'rien trouvé');

// 9. Notes choisies au clavier : on n'autorise que Do et Sol → un Ré faux (300 Hz) doit tomber sur Do (261,6) ou… Ré interdit
const only = new Array(12).fill(false); only[0] = true; only[7] = true;
x = voice(() => 300, 1.2);
r = await T.process([x], sr, { notes: only, strength: 1 });
g0 = await T.trackPitch(r.channels[0], sr);
const m9 = median(g0);
ok('notes au clavier', Math.abs(cents(m9, 261.63)) < 12, `sortie ${m9.toFixed(1)} Hz (Ré interdit → Do 261,6)`);

// --- Réglages « Pro » (PulseTune) : on mesure la note visée par la courbe de correction (sans PSOLA)
{
  const A4 = 440, hz = (m) => 440 * 2 ** ((m - 69) / 12), N = 300;   // 3 s de mesures (une toutes les 10 ms)
  const outMidi = (f0, ratio) => Array.from(f0, (f, i) => 69 + 12 * Math.log2(f * ratio[i] / 440));
  const sd = (a) => { const v = a.slice(50); const m = v.reduce((p, q) => p + q, 0) / v.length; return Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length); };
  const all = new Array(12).fill(true);
  // Vibrato de ±0,4 demi-ton à 5,5 Hz autour d'un La juste
  const vib = Float32Array.from({ length: N }, (_, i) => hz(69 + 0.4 * Math.sin(2 * Math.PI * 5.5 * i * 0.01)));
  const flat = sd(outMidi(vib, T.correctionCurve(vib, all, 1).ratio)), kept = sd(outMidi(vib, T.correctionCurve(vib, all, 1, { vibrato: 1 }).ratio));
  ok('Vibrato 0 % : aplati comme avant', flat < 0.05, `écart ${flat.toFixed(3)} demi-ton`);
  ok('Vibrato 100 % : le vibrato reste', kept > 0.2, `écart ${kept.toFixed(3)} demi-ton (voix : ${sd(Array.from(vib, f => 69 + 12 * Math.log2(f / 440))).toFixed(3)})`);
  // Souplesse : voix tenue 0,35 demi-ton trop haut
  const off = new Float32Array(N).fill(hz(69.35));
  const corr = (more) => 69.35 - outMidi(off, T.correctionCurve(off, all, 1, more).ratio)[N - 1];
  ok('Souplesse 0 : corrigé jusqu’à la note', Math.abs(corr({}) - 0.35) < 0.02, corr({}).toFixed(3) + ' demi-ton corrigé');
  ok('Souplesse 100 % : loin de la note, la voix reste libre', corr({ flex: 1 }) < 0.05, corr({ flex: 1 }).toFixed(3) + ' demi-ton corrigé');
  // Humain : note tenue qui dérive doucement de +0,3 demi-ton sur 3 s
  const drift = Float32Array.from({ length: N }, (_, i) => hz(69 + 0.3 * i / N));
  const dRobot = outMidi(drift, T.correctionCurve(drift, all, 1).ratio)[N - 1] - 69, dHuman = outMidi(drift, T.correctionCurve(drift, all, 1, { human: 1 }).ratio)[N - 1] - 69;
  ok('Humain : la note tenue garde un peu de sa vie', dHuman > dRobot + 0.005, `fin de note : ${dRobot.toFixed(3)} (sans) → ${dHuman.toFixed(3)} demi-ton (avec)`);
  // Type de voix : une voix grave (65 Hz) n'est trouvée qu'en « Grave »
  const low = voice(() => 65, 1);
  const fMid = median(await T.trackPitch(low, sr, null, 'mid')), fLow = median(await T.trackPitch(low, sr, null, 'low'));
  ok('Type de voix « Grave » : trouve un Do grave à 65 Hz', Math.abs(cents(fLow, 65)) < 30, `médium : ${fMid ? fMid.toFixed(1) : 'rien'} Hz · grave : ${fLow.toFixed(1)} Hz`);
}
process.exit(fail ? 1 : 0);
