// node tests/tempo.test.mjs — carte de tempo : temps ↔ secondes, mesures, aimant, règle
await import('../tempo.js');
const T = globalThis.PulseTempo;
let fail = 0; const ok = (name, cond, info = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== '' ? ' — ' + info : '')); if (!cond) fail++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// 1. Sans carte : exactement l'ancien calcul (60 / bpm, beatsPerBar)
const p0 = { bpm: 96, beatsPerBar: 4 };
ok('tempo constant = 60 / bpm', near(T.beatsToSec(p0, 10), 10 * 60 / 96) && near(T.secToBeats(p0, 3), 3 * 96 / 60) && T.isConstant(p0));
ok('aimant constant = ancien calcul', near(T.snapSec(p0, 1.3, 1), Math.round(1.3 / 0.625) * 0.625) && near(T.snapSec(p0, 1.3, 'bar'), 2.5));
ok('position 1.1.1 au début, 2.1.1 à une mesure', T.formatPosition(p0, 0) === '1.1.1' && T.formatPosition(p0, 2.5) === '2.1.1', T.formatPosition(p0, 2.5));

// 2. Changement de tempo : 120 BPM pendant 8 temps (4 s), puis 60 BPM
const p1 = { bpm: 120, tempos: [{ beat: 8, bpm: 60 }] };
ok('avant le changement : 120 BPM', near(T.beatsToSec(p1, 4), 2));
ok('après : 1 temps = 1 s', near(T.beatsToSec(p1, 8), 4) && near(T.beatsToSec(p1, 10), 6), T.beatsToSec(p1, 10));
ok('aller-retour secondes ↔ temps', [0, 1.7, 4, 5.25, 33].every(s => near(T.beatsToSec(p1, T.secToBeats(p1, s)), s, 1e-9)));
ok('tempo lu à un instant', T.bpmAt(p1, 3.9) === 120 && T.bpmAt(p1, 4) === 60);
ok('changement au temps 0 : remplace le tempo du projet', near(T.beatsToSec({ bpm: 120, tempos: [{ beat: 0, bpm: 90 }] }, 3), 2));
ok('changements dans le désordre : triés', near(T.beatsToSec({ bpm: 120, tempos: [{ beat: 8, bpm: 60 }, { beat: 4, bpm: 240 }] }, 8), 2 + 1));

// 3. Signature : 4 temps pendant 2 mesures, puis 3 temps, puis 7 (mesure 4)
const p2 = { bpm: 120, beatsPerBar: 4, signatures: [{ bar: 2, beats: 3 }, { bar: 4, beats: 7 }] };
ok('mesure → premier temps', T.barToBeats(p2, 2) === 8 && T.barToBeats(p2, 3) === 11 && T.barToBeats(p2, 4) === 14 && T.barToBeats(p2, 5) === 21);
ok('temps → mesure', JSON.stringify(T.beatsToBar(p2, 12)) === JSON.stringify({ bar: 3, beat: 1, beats: 3 }), JSON.stringify(T.beatsToBar(p2, 12)));
ok('aimant à la mesure suit la signature', near(T.snapSec(p2, T.beatsToSec(p2, 12.4), 'bar'), T.beatsToSec(p2, 11)) && near(T.snapSec(p2, T.beatsToSec(p2, 12.6), 'bar'), T.beatsToSec(p2, 14)));
const lines = T.gridLines(p2, 0, T.beatsToSec(p2, 21), { barsOnly: true });
ok('règle : une ligne au début de chaque mesure', JSON.stringify(lines.map(l => l.bar)) === '[0,1,2,3,4,5]' && near(lines[3].sec, T.beatsToSec(p2, 11)), lines.map(l => l.bar).join(','));

// 4. Tempo + signature ensemble ; règle temps par temps
const p3 = { bpm: 100, beatsPerBar: 4, tempos: [{ beat: 6, bpm: 150 }], signatures: [{ bar: 1, beats: 3 }] };
const g = T.gridLines(p3, 0, T.beatsToSec(p3, 10));
ok('règle : 11 temps, mesures aux temps 0, 4, 7, 10', g.length === 11 && JSON.stringify(g.filter(l => l.isBar).map(l => Math.round(T.secToBeats(p3, l.sec)))) === '[0,4,7,10]');
ok('écart entre lignes : 0,6 s puis 0,4 s', near(g[1].sec - g[0].sec, 0.6) && near(g[8].sec - g[7].sec, 0.4));
ok('position « 3.2.1 » au temps 8', T.formatPosition(p3, T.beatsToSec(p3, 8)) === '3.2.1', T.formatPosition(p3, T.beatsToSec(p3, 8)));

// 5. Région MIDI à cheval sur un changement : la note garde sa place en temps
const r = T.regionBeatToSec(p1, 3, 3);   // région qui commence à 3 s (temps 6), note au 3e temps de la région = temps 9 = 5 s
ok('note MIDI après un changement de tempo', near(r, 2), r);

// 6. Valeurs abîmées : jamais NaN
const bad = { bpm: 'x', beatsPerBar: 0, tempos: [{ beat: -1, bpm: 120 }, { beat: NaN, bpm: 90 }, { beat: 4, bpm: 9999 }], signatures: [{ bar: 1.5, beats: 3 }] };
ok('valeurs abîmées ignorées ou bornées', Number.isFinite(T.beatsToSec(bad, 8)) && T.bpmAt(bad, 100) === 400 && T.isConstant({ bpm: 90, signatures: [{ bar: 1.5, beats: 3 }] }));

console.log(fail ? `${fail} ÉCHEC(S)` : 'tout est vert');
process.exit(fail ? 1 : 0);
