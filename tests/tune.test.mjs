// node tests/tune.test.mjs — vérifie l'Auto-Tune sur des voix synthétiques
await import(process.env.TUNE || "../tune.js");
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
// bruit à graine fixe : avec Math.random le test tombait rouge 1 fois sur 10 (la confiance sur du bruit pur monte parfois à 0,7 — faiblesse connue de la lecture de gamme, à durcir)
let dseed = 12345; const drnd = () => { dseed = (dseed * 1103515245 + 12345) & 0x7fffffff; return dseed / 0x3fffffff - 1; };
const drums = new Float32Array(sr * 20); for (let i = 0; i < drums.length; i++) { const ph = (i / sr) % 0.5; drums[i] = ph < 0.05 ? drnd() * 0.5 : 0; }
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
  const A4 = 440, hz = (m) => 440 * 2 ** ((m - 69) / 12), N = 600;   // 3 s de mesures (une toutes les 5 ms)
  const outMidi = (f0, ratio) => Array.from(f0, (f, i) => 69 + 12 * Math.log2(f * ratio[i] / 440));
  const sd = (a) => { const v = a.slice(100); const m = v.reduce((p, q) => p + q, 0) / v.length; return Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length); };
  const all = new Array(12).fill(true);
  // Vibrato de ±0,4 demi-ton à 5,5 Hz autour d'un La juste
  const vib = Float32Array.from({ length: N }, (_, i) => hz(69 + 0.4 * Math.sin(2 * Math.PI * 5.5 * i * 0.005)));
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
  // Graphique : réglages note par note (cents, vibrato gardé, vitesse) et note coupée en deux
  const T3 = N * 0.005;
  const fine = outMidi(off, T.correctionCurve(off, all, 1, { edits: [{ t0: 0, t1: T3, note: 69.25 }] }).ratio)[N - 1];
  ok('Note à la main en cents : La + 25 cents tenu', Math.abs(fine - 69.25) < 0.01, fine.toFixed(3));
  const vKept = sd(outMidi(vib, T.correctionCurve(vib, all, 1, { edits: [{ t0: 0, t1: T3, note: 69, vib: 1 }] }).ratio));
  ok('Vibrato gardé sur une seule note (réglage général à 0)', vKept > 0.2, vKept.toFixed(3));
  const at = (more, k) => outMidi(off, T.correctionCurve(off, all, 1, more).ratio)[k];
  const slow = at({ edits: [{ t0: 0, t1: T3, note: 69, speed: 0.2 }] }, 20), fast = at({ edits: [{ t0: 0, t1: T3, note: 69 }] }, 20);
  ok('Vitesse lente sur une note : la correction met plus de temps', Math.abs(slow - 69) > Math.abs(fast - 69) + 0.05, `après 100 ms : ${slow.toFixed(3)} (lente) / ${fast.toFixed(3)}`);
  const cut = T.correctionCurve(off, all, 1, { edits: [{ t0: 0, t1: 1.5, note: 69 }, { t0: 1.5, t1: T3, note: 69 }] }).notes.filter(s => s.i1 - s.i0 > 8);
  ok('Note coupée en deux : deux blocs', cut.length === 2, JSON.stringify(cut.map(s => [s.i0, s.i1])));
  // Crayon : une courbe dessinée (La → Si en glissé sur 3 s) est suivie telle quelle, en un seul bloc
  const crv = T.correctionCurve(off, all, 1, { edits: [{ t0: 0, t1: T3, note: 70, curve: [[0, 69], [T3, 71]] }] });
  const om = outMidi(off, crv.ratio), mid = om[N >> 1], end = om[N - 2];
  ok('Crayon : la voix suit la courbe dessinée (glissé La → Si)', Math.abs(mid - 70) < 0.05 && Math.abs(end - 71) < 0.05 && crv.notes.filter(s => s.i1 - s.i0 > 8).length === 1, `milieu ${mid.toFixed(3)}, fin ${end.toFixed(3)}, blocs ${crv.notes.length}`);
  // Type de voix : une voix grave (65 Hz) n'est trouvée qu'en « Grave »
  const low = voice(() => 65, 1);
  const fMid = median(await T.trackPitch(low, sr, null, 'mid')), fLow = median(await T.trackPitch(low, sr, null, 'low'));
  ok('Type de voix « Grave » : trouve un Do grave à 65 Hz', Math.abs(cents(fLow, 65)) < 30, `médium : ${fMid ? fMid.toFixed(1) : 'rien'} Hz · grave : ${fLow.toFixed(1)} Hz`);
}

// --- Voix difficile : souffle par-dessus, 2e harmonique plus forte que la fondamentale, glissé, silences entre les mots.
// C'est là que l'ancien moteur « clignotait » (trous d'une trame, sauts d'octave) et que la voix devenait rauque / robot.
{
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const n = sr * 4, hard = new Float32Array(n); let ph = 0;
  const fAt = (t) => 180 * Math.pow(2, (0.4 * Math.sin(2 * Math.PI * 0.7 * t) + (t > 2 ? 3 * Math.min(1, (t - 2) / 0.3) : 0)) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = fAt(t); ph += 2 * Math.PI * f / sr;
    const word = (t % 0.8) < 0.62 ? Math.min(1, (t % 0.8) / 0.03, (0.62 - (t % 0.8)) / 0.05) : 0;   // mots de 620 ms, silences de 180 ms
    let s = 0.35 * Math.sin(ph) + 1.0 * Math.sin(2 * ph + 0.7) + 0.5 * Math.sin(3 * ph + 1.9) + 0.3 * Math.sin(4 * ph) + 0.2 * Math.sin(5 * ph + 0.3);
    hard[i] = 0.25 * word * s + 0.02 * rnd() + (word === 0 ? 0.05 * rnd() : 0);
  }
  const f0 = await T.trackPitch(hard, sr);
  let holes = 0, jumps = 0, wrong = 0, tot = 0;
  for (let i = 1; i + 1 < f0.length; i++) {
    const t = i * 0.005, inWord = (t % 0.8) > 0.06 && (t % 0.8) < 0.55;
    if (!(f0[i] > 0)) { if (f0[i - 1] > 0 && f0[i + 1] > 0) holes++; if (inWord) wrong++; }
    else { if (f0[i - 1] > 0 && Math.abs(cents(f0[i], f0[i - 1])) > 400) jumps++; if (inWord && Math.abs(cents(f0[i], fAt(t))) > 40) wrong++; }
    if (inWord) tot++;
  }
  ok('voix difficile : suivi sans trou ni saut d’octave', holes === 0 && jumps === 0 && wrong / tot < 0.02, `trous ${holes}, sauts ${jumps}, trames fausses ${wrong}/${tot}`);
  // Sans correction, la voix doit ressortir intacte
  const same = T.psola(hard, sr, f0, new Float32Array(f0.length).fill(1));
  let e = 0, p = 0; for (let i = 0; i < n; i++) { e += (same[i] - hard[i]) ** 2; p += hard[i] ** 2; }
  ok('sans correction : son intact', 10 * Math.log10(e / p) < -30, `résidu ${(10 * Math.log10(e / p)).toFixed(1)} dB`);
  // Monté d'un demi-ton : la note suit partout, sans accroc
  const up = T.psola(hard, sr, f0, Float32Array.from(f0, (f) => f > 0 ? 2 ** (1 / 12) : 1));
  const g = await T.trackPitch(up, sr); let good = 0, all = 0;
  for (let i = 4; i + 4 < f0.length; i++) if (f0[i] > 0 && f0[i - 4] > 0 && f0[i + 4] > 0) { all++; if (g[i] > 0 && Math.abs(cents(g[i], f0[i]) - 100) < 20) good++; }
  ok('+1 demi-ton : la note suit partout', good / all > 0.98, `${(100 * good / all).toFixed(1)} % des trames à moins de 20 cents`);
  // Stéréo : les deux canaux restent en phase (mêmes repères)
  const st = await T.process([hard, hard.map(v => 0.5 * v)], sr, { root: -1, strength: 1 });
  let dd = 0, pp = 0; for (let i = 0; i < n; i++) { dd += (st.channels[0][i] - 2 * st.channels[1][i]) ** 2; pp += st.channels[0][i] ** 2; }
  ok('stéréo en phase', 10 * Math.log10(dd / pp + 1e-20) < -60, `écart ${(10 * Math.log10(dd / pp + 1e-20)).toFixed(0)} dB`);
}
// --- Déplacer une note dans le temps : La (0–1 s), silence, Si (1,4–2,4 s) ; on avance le Si de 150 ms
{
  const sec = 3, n = sr * sec, x = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, on = (t < 1) || (t >= 1.4 && t < 2.4), f = t < 1.2 ? 220 : 246.94; ph += 2 * Math.PI * f / sr; if (!on) continue;
    const env = Math.min(1, (t < 1.2 ? t : t - 1.4) * 40, ((t < 1.2 ? 1 : 2.4) - t) * 40); let v = 0; for (let h = 1; h <= 10; h++) v += Math.sin(h * ph) / (h * (1 + Math.abs(h * f - 700) / 900)); x[i] = 0.35 * env * v; }
  const res = await T.process([x], sr, { root: -1, strength: 1, moves: [{ t0: 1.4, t1: 2.4, d: -0.15 }] });
  const y = res.channels[0], on = (z) => { for (let i = Math.round(1.05 * sr); i < n; i++) if (Math.abs(z[i]) > 0.05) return i / sr; return 0; };
  ok('Note déplacée : le Si commence 150 ms plus tôt', Math.abs(on(y) - 1.25) < 0.02, `début ${on(x).toFixed(3)} s → ${on(y).toFixed(3)} s`);
  const y0 = (await T.process([x], sr, { root: -1, strength: 1 })).channels[0];
  let same = 0; for (let i = 0; i < Math.round(0.9 * sr); i++) same = Math.max(same, Math.abs(y[i] - y0[i]));
  ok('Note déplacée : le La d\'avant ne bouge pas', same < 0.02, same.toFixed(4));
  const fB = median(await T.trackPitch(y.subarray(Math.round(1.4 * sr), Math.round(2.1 * sr)), sr));
  ok('Note déplacée : elle chante toujours un Si', Math.abs(cents(fB, 246.94)) < 15, fB.toFixed(1) + ' Hz');
  const jump = (z, a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(z[i] - z[i - 1])); return m; };
  ok('Note déplacée : pas de clic', jump(y, Math.round(1.1 * sr), Math.round(2.6 * sr)) < 1.6 * jump(x, Math.round(1.3 * sr), Math.round(2.5 * sr)), jump(y, Math.round(1.1 * sr), Math.round(2.6 * sr)).toFixed(3) + ' / ' + jump(x, Math.round(1.3 * sr), Math.round(2.5 * sr)).toFixed(3));
  ok('Sans déplacement : pas de carte de temps', !(await T.process([x], sr, { root: -1, strength: 1 })).warp, '');
}
process.exit(fail ? 1 : 0);
