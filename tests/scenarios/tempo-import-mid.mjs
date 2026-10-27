// Import d'un .mid qui change de tempo / de signature : projet vide = il prend la carte du fichier (régions coupées à chaque
// changement de tempo), projet déjà rempli = il garde son tempo. Lecture des signatures en x/8. ⌘Z remet tout.
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tim1',name:'TIM',bpm:100,beatsPerBar:4,buses:[],sends:[],tracks:[{name:'Piano',type:'keys',midiInst:'piano',color:'#22C55E',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2200);
  const r = JSON.parse(await ev(`(async()=>{
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    let lastFlash = ''; const of = window.flash; window.flash = (m) => { lastFlash = m; of(m); };
    // fichier : 120 BPM 4/4, puis 60 BPM et 3/4 à partir du temps 8 (mesure 3)
    const notes = [{ s: 0, d: 1, p: 60, v: 100 }, { s: 4, d: 1, p: 62, v: 100 }, { s: 9, d: 1, p: 64, v: 100 }];
    const bytes = PulseMidiFile.encode([{ name: 'M', notes }], 120, { beats: 4, tempos: [{ beat: 8, bpm: 60 }], signatures: [{ beat: 8, beats: 3 }] });
    const dec = PulseMidiFile.decode(bytes);
    const f = new File([bytes], 'carte.mid', { type: 'audio/midi' });
    await importMidiFile(f, 0, 0); await wait(900);
    const p = state.project, cs = p.tracks[0].clips;
    const vide = { bpm: p.bpm, tempos: JSON.stringify(p.tempos || []), sigs: JSON.stringify(p.signatures || []), n: cs.length,
      clips: cs.map(c => [Math.round(c.start * 1000) / 1000, Math.round(c.duration * 1000) / 1000, c.midi.bpm, c.midi.notes.map(n => n.s).join('/')]),
      input: document.getElementById('bpmInput').value, lane: !!document.getElementById('tempoLane') && !document.getElementById('tempoLane').hidden, flash: lastFlash };
    await wait(1000);   // le guetteur de tempo ne doit rien déplacer
    const apres = cs.map(c => Math.round(c.start * 1000) / 1000).join(',');
    undoAction(); await wait(1200);
    const q = state.project;
    const annule = { bpm: q.bpm, tempos: !!q.tempos, sigs: !!q.signatures, n: q.tracks[0].clips.length };
    // projet déjà rempli : on garde son tempo
    await importMidiFile(new File([PulseMidiFile.encode([{ notes: [{ s: 0, d: 1, p: 60, v: 90 }] }], 90)], 'simple.mid'), 0, 0); await wait(400);
    const bpmAvant = state.project.bpm;
    await importMidiFile(f, 0, 0); await wait(900);
    const rempli = { bpm: state.project.bpm, bpmAvant, tempos: !!state.project.tempos, n: state.project.tracks[0].clips.length, flash: lastFlash };
    window.flash = of;
    return JSON.stringify({ dec: { bpm: dec.bpm, tempos: dec.tempos, sigs: dec.signatures, bpb: dec.beatsPerBar }, vide, apres, annule, rempli });
  })()`));
  console.log(JSON.stringify(r));
  check('relecture du fichier : 120 BPM, 60 au temps 8, 3/4 au temps 8', r.dec.bpm === 120 && r.dec.tempos.length === 1 && r.dec.tempos[0].beat === 8 && r.dec.tempos[0].bpm === 60 && r.dec.sigs.length === 1 && r.dec.sigs[0].beats === 3 && r.dec.bpb === 4, JSON.stringify(r.dec));
  check('projet vide : il prend le tempo et la signature du fichier', r.vide.bpm === 120 && r.vide.tempos === '[{"beat":8,"bpm":60}]' && r.vide.sigs === '[{"bar":2,"beats":3}]' && r.vide.input === '120', JSON.stringify(r.vide));
  check('deux régions, coupées au changement de tempo, chacune à son tempo', r.vide.n === 2 && JSON.stringify(r.vide.clips) === JSON.stringify([[0, 4, 120, '0/4'], [4, 4, 60, '1']]), JSON.stringify(r.vide.clips));
  check('piste de tempo affichée et message clair', r.vide.lane && /prend le tempo du fichier/.test(r.vide.flash), r.vide.flash);
  check('le guetteur de tempo ne bouge rien après l\'import', r.apres === '0,4', r.apres);
  check('⌘Z : tempo, signature et régions d\'avant', r.annule.bpm === 100 && !r.annule.tempos && !r.annule.sigs && r.annule.n === 0, JSON.stringify(r.annule));
  check('projet rempli : tempo gardé, changements non repris (et dit)', r.rempli.bpm === r.rempli.bpmAvant && !r.rempli.tempos && r.rempli.n === 2 && /pas repris/.test(r.rempli.flash), JSON.stringify(r.rempli));

  // signature en x/8 : 6/8 = 3 noires par mesure ; tempo qui ne démarre pas au début = 120 par défaut
  const r2 = JSON.parse(await ev(`(()=>{
    const hdr = [0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,0xE0];
    const ev = [0, 0xFF,0x58,4, 6,3,24,8,  0, 0x90,60,100, 0x83,0x60, 0x80,60,0,  0, 0xFF,0x2F,0];
    const trk = [0x4D,0x54,0x72,0x6B,0,0,0,ev.length, ...ev];
    const d = PulseMidiFile.decode(new Uint8Array([...hdr, ...trk]));
    return JSON.stringify({ bpb: d.beatsPerBar, bpm: d.bpm, sigs: d.signatures.length });
  })()`));
  check('6/8 lu comme 3 noires par mesure, sans tempo = pas de BPM imposé', r2.bpb === 3 && r2.bpm === null && r2.sigs === 0, JSON.stringify(r2));
  // champ BPM du haut et signature des réglages : la carte est remise au propre
  const r3 = JSON.parse(await ev(`(async()=>{
    const p = state.project; p.tempos = [{ beat: 8, bpm: 60 }]; p.signatures = [{ bar: 2, beats: 3 }]; tempoMapChanged();
    const bi = document.getElementById('bpmInput'); bi.value = '60'; bi.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const afterBpm = { bpm: p.bpm, tempos: p.tempos || null };
    openSettings && openSettings(); await new Promise(r => setTimeout(r, 300));
    const sel = document.querySelector('#setBeats'); let afterSig = null;
    if (sel) { sel.value = '3'; sel.dispatchEvent(new Event('change', { bubbles: true })); afterSig = { bpb: p.beatsPerBar, sigs: p.signatures || null }; }
    closeAllMenus && closeAllMenus(); document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
    return JSON.stringify({ afterBpm, afterSig });
  })()`));
  check('BPM du haut = tempo d\'un changement : ce changement disparaît', r3.afterBpm.bpm === 60 && r3.afterBpm.tempos === null, JSON.stringify(r3.afterBpm));
  check('signature des réglages = celle d\'un changement : ce changement disparaît', r3.afterSig && r3.afterSig.bpb === 3 && r3.afterSig.sigs === null, JSON.stringify(r3.afterSig));
};
