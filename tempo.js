// === Pulse — carte de tempo (tempo et signature qui changent en cours de morceau, comme la piste Tempo de Logic) ===
// Les deux moteurs ne manipulent que des secondes : cette carte sert seulement à passer des temps (noires) aux secondes
// et des mesures aux temps (grille, règle, aimant, métronome, MIDI, compteur). Une seule fonction pour tout le monde.
//   project.tempos     = [{ beat, bpm }]   changement de tempo au temps `beat` (noires depuis le début, 0 = début), en paliers
//   project.signatures = [{ bar, beats }]  à partir de la mesure `bar` (0 = première), `beats` temps par mesure
// Sans ces listes : project.bpm et project.beatsPerBar partout (même comportement qu'avant).
// Pur JS, sans dépendance : tourne dans le navigateur comme dans Node (tests/tempo.test.mjs).

(function (root) {
    const clampBpm = (b) => Math.max(20, Math.min(400, Number(b) || 120));
    const clampBeats = (n) => Math.max(1, Math.min(12, Math.round(Number(n)) || 4));

    // Paliers de tempo triés, le premier toujours au temps 0 ; chacun avec sa position en secondes
    function tempoSegments(project) {
        const base = clampBpm(project && project.bpm);
        const list = ((project && project.tempos) || [])
            .filter(e => e && Number.isFinite(e.beat) && e.beat >= 0)
            .map(e => ({ beat: e.beat, bpm: clampBpm(e.bpm) }))
            .sort((a, b) => a.beat - b.beat);
        if (!list.length || list[0].beat > 1e-9) list.unshift({ beat: 0, bpm: base });
        const segs = [];
        let sec = 0;
        for (let i = 0; i < list.length; i++) {
            if (i && list[i].beat - list[i - 1].beat < 1e-9) { segs[segs.length - 1].bpm = list[i].bpm; continue; }   // deux changements au même endroit : le dernier gagne
            if (segs.length) { const p = segs[segs.length - 1]; sec = p.sec + (list[i].beat - p.beat) * 60 / p.bpm; }
            segs.push({ beat: list[i].beat, bpm: list[i].bpm, sec });
        }
        return segs;
    }
    function segAtBeat(segs, beat) { let s = segs[0]; for (const x of segs) { if (x.beat <= beat + 1e-9) s = x; else break; } return s; }
    function segAtSec(segs, sec) { let s = segs[0]; for (const x of segs) { if (x.sec <= sec + 1e-9) s = x; else break; } return s; }

    // Temps (noires depuis le début, peut être fractionnaire) → secondes, et l'inverse
    function beatsToSec(project, beat, segs = tempoSegments(project)) {
        const s = segAtBeat(segs, beat);
        return s.sec + (beat - s.beat) * 60 / s.bpm;
    }
    function secToBeats(project, sec, segs = tempoSegments(project)) {
        const s = segAtSec(segs, sec);
        return s.beat + (sec - s.sec) * s.bpm / 60;
    }
    function bpmAt(project, sec) { return segAtSec(tempoSegments(project), sec).bpm; }

    // Signatures triées, la première toujours à la mesure 0 ; chacune avec son premier temps
    function sigSegments(project) {
        const base = clampBeats(project && project.beatsPerBar);
        const list = ((project && project.signatures) || [])
            .filter(e => e && Number.isInteger(e.bar) && e.bar >= 0)
            .map(e => ({ bar: e.bar, beats: clampBeats(e.beats) }))
            .sort((a, b) => a.bar - b.bar);
        if (!list.length || list[0].bar > 0) list.unshift({ bar: 0, beats: base });
        const segs = [];
        let beat = 0;
        for (const e of list) {
            if (segs.length && segs[segs.length - 1].bar === e.bar) { segs[segs.length - 1].beats = e.beats; continue; }
            if (segs.length) { const p = segs[segs.length - 1]; beat = p.beat + (e.bar - p.bar) * p.beats; }
            segs.push({ bar: e.bar, beats: e.beats, beat });
        }
        return segs;
    }
    // Mesure (0 = première) → temps de son début ; temps → { bar, beat } (0-based, `beat` fractionnaire dans la mesure)
    function barToBeats(project, bar, segs = sigSegments(project)) {
        let s = segs[0]; for (const x of segs) { if (x.bar <= bar) s = x; else break; }
        return s.beat + (bar - s.bar) * s.beats;
    }
    function beatsToBar(project, beat, segs = sigSegments(project)) {
        let s = segs[0]; for (const x of segs) { if (x.beat <= beat + 1e-9) s = x; else break; }
        const bar = s.bar + Math.floor((beat - s.beat) / s.beats + 1e-9);
        return { bar, beat: beat - (s.beat + (bar - s.bar) * s.beats), beats: s.beats };
    }
    function beatsPerBarAt(project, sec) { return beatsToBar(project, secToBeats(project, sec)).beats; }

    // Position lisible façon Logic : mesure.temps.division (1-based), ex. « 3.2.1 »
    function formatPosition(project, sec, div = 4) {
        const p = beatsToBar(project, secToBeats(project, sec));
        const b = Math.floor(p.beat + 1e-9);
        return `${p.bar + 1}.${b + 1}.${Math.floor((p.beat - b) * div + 1e-6) + 1}`;
    }

    // Aimant : position de grille la plus proche. unit = 'bar' ou une fraction de temps (1 = noire, 0.25 = double croche…)
    function snapSec(project, sec, unit) {
        const tsegs = tempoSegments(project);
        const beat = secToBeats(project, sec, tsegs);
        let target;
        if (unit === 'bar') {
            const ssegs = sigSegments(project), p = beatsToBar(project, beat, ssegs);
            const a = barToBeats(project, p.bar, ssegs), b = barToBeats(project, p.bar + 1, ssegs);
            target = beat - a < b - beat ? a : b;
        } else {
            const u = unit > 0 ? unit : 1;
            target = Math.round(beat / u) * u;
        }
        return Math.max(0, beatsToSec(project, target, tsegs));
    }

    // Lignes de la règle entre deux instants : [{ sec, bar, beat, isBar }] (une par temps ; `every` = 1 ligne de mesure sur N)
    function gridLines(project, fromSec, toSec, opts = {}) {
        const tsegs = tempoSegments(project), ssegs = sigSegments(project), every = Math.max(1, opts.every || 1);
        const out = [];
        let beat = Math.max(0, Math.floor(secToBeats(project, Math.max(0, fromSec), tsegs)));
        for (let guard = 0; guard < 100000; guard++, beat++) {
            const sec = beatsToSec(project, beat, tsegs);
            if (sec > toSec + 1e-9) break;
            const p = beatsToBar(project, beat, ssegs), isBar = p.beat < 1e-9;
            if (opts.barsOnly && !isBar) continue;
            if (isBar && p.bar % every) continue;
            out.push({ sec, bar: p.bar, beat: Math.round(p.beat), isBar });
        }
        return out;
    }

    // Région MIDI (notes en temps) jouée à partir de `startSec` : position en secondes d'une note à `beat` temps du début de la région
    function regionBeatToSec(project, startSec, beat) {
        const segs = tempoSegments(project);
        return beatsToSec(project, secToBeats(project, startSec, segs) + beat, segs) - startSec;
    }

    // Tempo constant ? (rien à recalculer : tous les anciens calculs « 60 / bpm » restent justes)
    function isConstant(project) { return tempoSegments(project).length === 1 && sigSegments(project).length === 1; }

    root.PulseTempo = { tempoSegments, sigSegments, beatsToSec, secToBeats, bpmAt, barToBeats, beatsToBar, beatsPerBarAt,
        formatPosition, snapSec, gridLines, regionBeatToSec, isConstant };
})(typeof window !== 'undefined' ? window : globalThis);
