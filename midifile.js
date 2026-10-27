// === Pulse — Fichiers .mid (Standard MIDI File) : lire et écrire ===
// DSP/format pur, sans dépendance : navigateur comme Node (tests).
// Une région = { inst, beats, notes: [{ s, d, p, v }] } avec s et d en temps (noires).

(function(root) {
    const PPQ = 480;

    // ---------- Écriture ----------
    const vlq = (n) => { const out = [n & 0x7F]; while ((n >>= 7) > 0) out.unshift((n & 0x7F) | 0x80); return out; };
    const be16 = (n) => [(n >> 8) & 255, n & 255];
    const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const text = (s) => Array.from(new TextEncoder().encode(s));

    function trackBytes(events) {
        // events : { t (ticks), bytes[] } triés ; on écrit les deltas
        events.sort((a, b) => a.t - b.t || (a.order || 0) - (b.order || 0));
        const body = [];
        let last = 0;
        for (const e of events) { body.push(...vlq(Math.max(0, e.t - last)), ...e.bytes); last = e.t; }
        body.push(0, 0xFF, 0x2F, 0);
        return [...text('MTrk'), ...be32(body.length), ...body];
    }

    // tracks : [{ name, drums, notes:[{s,d,p,v}], offset (en temps) }]
    // map (facultatif) : { beats, tempos: [{ beat, bpm }], signatures: [{ beat, beats }] } — changements de tempo et de signature
    // écrits dans la piste de tête (Logic, FL, Ableton les relisent)
    function encode(tracks, bpm, map) {
        const usec = (b) => Math.round(60000000 / Math.max(20, Math.min(400, b)));
        const tempoEv = (t, b) => { const u = usec(b); return { t, bytes: [0xFF, 0x51, 3, (u >> 16) & 255, (u >> 8) & 255, u & 255] }; };
        const sigEv = (t, n) => ({ t, bytes: [0xFF, 0x58, 4, Math.max(1, Math.min(12, n | 0)), 2, 24, 8] });
        const head = [tempoEv(0, bpm), sigEv(0, (map && map.beats) || 4)];
        if (map) {
            (map.tempos || []).forEach(e => { if (e.beat > 0) head.push(tempoEv(Math.round(e.beat * PPQ), e.bpm)); });
            (map.signatures || []).forEach(e => { if (e.beat > 0) head.push(sigEv(Math.round(e.beat * PPQ), e.beats)); });
        }
        const chunks = [trackBytes(head)];
        for (const tr of tracks) {
            const ev = [];
            if (tr.name) { const n = text(tr.name); ev.push({ t: 0, bytes: [0xFF, 0x03, ...vlq(n.length), ...n] }); }
            const ch = tr.drums ? 9 : 0;
            for (const n of tr.notes) {
                const on = Math.max(0, Math.round((n.s + (tr.offset || 0)) * PPQ));
                const off = on + Math.max(1, Math.round(n.d * PPQ));
                const p = Math.max(0, Math.min(127, n.p | 0)), v = Math.max(1, Math.min(127, n.v | 0));
                ev.push({ t: on, order: 1, bytes: [0x90 | ch, p, v] });
                ev.push({ t: off, order: 0, bytes: [0x80 | ch, p, 0] });
            }
            chunks.push(trackBytes(ev));
        }
        const header = [...text('MThd'), ...be32(6), ...be16(1), ...be16(chunks.length), ...be16(PPQ)];
        return new Uint8Array([...header, ...chunks.flat()]);
    }

    // ---------- Lecture ----------
    // Renvoie { notes, beats, bpm, drums, ppq, names, beatsPerBar, tempos: [{ beat, bpm }], signatures: [{ beat, beats }] } (changements après le début). Lève une Error en français si le fichier est illisible.
    function decode(buf) {
        const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        let i = 0;
        const u8 = () => { if (i >= d.length) throw new Error('fin de fichier inattendue'); return d[i++]; };
        const u16 = () => (u8() << 8) | u8();
        const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
        const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
        if (d.length < 14 || tag() !== 'MThd') throw new Error('ce fichier n\'est pas un fichier .mid');
        const hl = u32(); u16(); const nTr = u16(), div = u16();
        i = 8 + hl;
        if (div & 0x8000) throw new Error('ce fichier .mid utilise un découpage en images (SMPTE), non géré');
        const ppq = div || PPQ;
        const notes = [], names = [];
        let drumHits = 0, allHits = 0;
        const tempoEv = [], sigEv = [];
        for (let t = 0; t < nTr && i < d.length; t++) {
            const id = tag(), len = u32(), end = Math.min(d.length, i + len);
            if (id !== 'MTrk') { i = end; continue; }
            let tick = 0, run = 0;
            const open = new Map();   // canal:note → { t, v }
            while (i < end) {
                let dt = 0, b;
                do { b = u8(); dt = (dt << 7) | (b & 0x7F); } while (b & 0x80 && i < end);
                tick += dt;
                let st = d[i];
                if (st & 0x80) { i++; if (st < 0xF0) run = st; } else st = run;
                if (st === 0xFF) {
                    const type = u8(); let l = 0, c;
                    do { c = u8(); l = (l << 7) | (c & 0x7F); } while (c & 0x80);
                    if (type === 0x51 && l === 3) {
                        const b = Math.round(60000000 / ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) * 10) / 10;
                        tempoEv.push({ beat: tick / ppq, bpm: b });
                    }
                    // signature : numérateur / 2^dénominateur, ramenée en noires par mesure (6/8 → 3)
                    if (type === 0x58 && l >= 2) sigEv.push({ beat: tick / ppq, beats: Math.max(1, Math.min(12, Math.round(d[i] * 4 / Math.pow(2, d[i + 1])) || 4)) });
                    if (type === 0x03 && l > 0) names.push(new TextDecoder().decode(d.subarray(i, i + l)));
                    i += l;
                } else if (st === 0xF0 || st === 0xF7) {
                    let l = 0, c; do { c = u8(); l = (l << 7) | (c & 0x7F); } while (c & 0x80); i += l;
                } else {
                    const kind = st & 0xF0, ch = st & 15;
                    const two = kind !== 0xC0 && kind !== 0xD0;
                    const a = u8(), v = two ? u8() : 0;
                    if (kind === 0x90 && v > 0) {
                        const key = ch * 128 + a;
                        if (open.has(key)) { const o = open.get(key); notes.push({ s: o.t / ppq, d: Math.max(0.03, (tick - o.t) / ppq), p: a, v: o.v }); }
                        open.set(key, { t: tick, v });
                        allHits++; if (ch === 9) drumHits++;
                    } else if (kind === 0x80 || (kind === 0x90 && v === 0)) {
                        const key = ch * 128 + a, o = open.get(key);
                        if (o) { notes.push({ s: o.t / ppq, d: Math.max(0.03, (tick - o.t) / ppq), p: a, v: o.v }); open.delete(key); }
                    }
                }
            }
            open.forEach((o, key) => notes.push({ s: o.t / ppq, d: Math.max(0.25, 1), p: key % 128, v: o.v }));
            i = end;
        }
        if (!notes.length) throw new Error('aucune note dans ce fichier .mid');
        // Carte de tempo du fichier : paliers triés, le dernier gagne quand deux tombent au même endroit
        const clean = (list, k) => {
            const out = [];
            list.sort((a, b) => a.beat - b.beat).forEach(e => {
                const last = out[out.length - 1];
                if (last && Math.abs(last.beat - e.beat) < 1e-6) last[k] = e[k]; else out.push({ ...e });
            });
            return out.filter((e, j) => j === 0 || e[k] !== out[j - 1][k]);
        };
        const tempos = clean(tempoEv, 'bpm'), sigs = clean(sigEv, 'beats');
        const bpm = tempos.length && tempos[0].beat < 1e-6 ? tempos[0].bpm : (tempos.length ? 120 : null);
        const beatsPerBar = sigs.length && sigs[0].beat < 1e-6 ? sigs[0].beats : 4;
        notes.sort((a, b) => a.s - b.s || a.p - b.p);
        const last = Math.max(...notes.map(n => n.s + n.d));
        return { notes, beats: Math.max(4, Math.ceil(last / 4 - 1e-6) * 4), bpm, drums: allHits > 0 && drumHits / allHits > 0.6, ppq, names,
            beatsPerBar, tempos: tempos.filter(e => e.beat > 1e-6), signatures: sigs.filter(e => e.beat > 1e-6) };
    }

    root.PulseMidiFile = { encode, decode, PPQ };
})(typeof window !== 'undefined' ? window : globalThis);
