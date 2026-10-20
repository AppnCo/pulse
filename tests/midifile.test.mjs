// node tests/midifile.test.mjs — écriture puis relecture d'un .mid
await import('../midifile.js');
const M = globalThis.PulseMidiFile;
let fail = 0; const ok = (n, c, i) => { console.log((c ? 'PASS ' : 'FAIL ') + n + ' — ' + i); if (!c) fail++; };
const notes = [{ s: 0, d: 1, p: 60, v: 100 }, { s: 1, d: 0.5, p: 64, v: 80 }, { s: 2.25, d: 0.25, p: 67, v: 127 }, { s: 130, d: 2, p: 36, v: 90 }];
const bytes = M.encode([{ name: 'Piano', notes }], 93);
ok('en-tête MThd', String.fromCharCode(...bytes.slice(0, 4)) === 'MThd', bytes.length + ' octets');
const r = M.decode(bytes);
ok('notes relues', r.notes.length === 4 && r.notes.every((n, i) => Math.abs(n.s - notes[i].s) < 0.003 && Math.abs(n.d - notes[i].d) < 0.003 && n.p === notes[i].p && n.v === notes[i].v), JSON.stringify(r.notes.map(n => [n.s, n.d, n.p, n.v])));
ok('tempo', r.bpm === 93, r.bpm + ' BPM');
ok('longueur en mesures', r.beats === 132, r.beats + ' temps');
ok('nom de piste', r.names.includes('Piano'), r.names.join(','));
const dr = M.decode(M.encode([{ drums: true, notes: [{ s: 0, d: 0.25, p: 36, v: 100 }, { s: 1, d: 0.25, p: 38, v: 100 }] }], 120));
ok('batterie reconnue (canal 10)', dr.drums === true, String(dr.drums));
let msg = ''; try { M.decode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])); } catch (e) { msg = e.message; }
ok('fichier invalide refusé', /pas un fichier/.test(msg), msg);
msg = ''; try { M.decode(M.encode([{ notes: [] }], 120)); } catch (e) { msg = e.message; }
ok('fichier sans note refusé', /aucune note/.test(msg), msg);
// note tenue non fermée + running status : on construit à la main
const hand = new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0x01,0xE0, 0x4D,0x54,0x72,0x6B,0,0,0,12, 0,0x90,60,100, 0x60,62,100, 0x60,0x80,60,0, 0,0xFF,0x2F,0]);
const h = M.decode(hand);
ok('running status + note jamais fermée', h.notes.length === 2 && h.notes[0].p === 60 && Math.abs(h.notes[0].d - 0.4) < 1e-6, JSON.stringify(h.notes));
process.exit(fail ? 1 : 0);
