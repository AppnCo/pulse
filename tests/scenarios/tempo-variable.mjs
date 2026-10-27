// Tempo et signature qui changent en cours de morceau (piste de tempo façon Logic, tempo.js + tempotrack.js) :
// règle, grille, aimant, compteur, flèches, métronome, régions MIDI (au tempo de leur début), export .mid, piste de tempo, annuler.
export default async ({ ev, nav, send, sleep, check, shot }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tv1',name:'TV',bpm:120,beatsPerBar:4,buses:[],sends:[],tracks:[{name:'Basse',type:'keys',midiInst:'piano',color:'#22C55E',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2200);
  // 120 BPM pendant 8 temps (2 mesures de 4 = 4 s), puis 60 BPM et 3 temps par mesure à partir de la mesure 3
  const r1 = JSON.parse(await ev(`(async()=>{
    const fixe = { grid: document.getElementById('timelineTracks').style.backgroundRepeat, lane: !document.getElementById('tempoLane') || document.getElementById('tempoLane').hidden };
    pushUndo();
    state.project.tempos = [{ beat: 8, bpm: 60 }]; state.project.signatures = [{ bar: 2, beats: 3 }];
    tempoMapChanged(); await new Promise(r => setTimeout(r, 300));
    const pps = state.pxPerSecond;
    const bars = [...document.querySelectorAll('#timelineRuler .ruler-label.major')].slice(0, 5).map(e => Math.round(parseFloat(e.style.left) / pps * 1000) / 1000);
    const sig = [...document.querySelectorAll('#timelineRuler .ruler-sig')].map(e => e.textContent);
    const g = document.getElementById('timelineTracks').style;
    state.snap = 'grid'; state.gridRes = 'bar';
    const snaps = [snapTime(5.2), snapTime(6)];
    state.gridRes = 'beat'; const snapBeat = [snapTime(4.4), snapTime(1.1)];
    state.gridRes = 'auto'; state.snap = 'off';
    _chronoMode = 'bars'; state.playhead = 5; updateChrono(); const chrono = document.getElementById('chrono').textContent.replace(/\\s+/g, ' ').trim(); _chronoMode = 'tc';
    state.playhead = 4; stepPlayhead(1, 'bar'); const nextBar = state.playhead; stepPlayhead(-1, 'bar'); const prevBar = state.playhead;
    stepPlayhead(1, 'beat'); const nextBeat = state.playhead;
    state.playhead = 0; updatePlayhead();
    const lane = document.getElementById('tempoLane');
    return JSON.stringify({ fixe, bars, sig, gridPieces: g.backgroundPosition.split(',').length, gridRepeat: g.backgroundRepeat.split(',')[0], snaps, snapBeat, chrono, nextBar, prevBar, nextBeat,
      laneShown: lane && !lane.hidden, lanePts: lane ? lane.querySelectorAll('.tl-pt').length : 0, laneLbl: lane ? [...lane.querySelectorAll('.tl-lbl')].map(e => e.textContent) : [] });
  })()`));
  console.log(JSON.stringify(r1));
  check('tempo fixe : grille d\'avant, pas de piste de tempo', r1.fixe.grid === '' && r1.fixe.lane, JSON.stringify(r1.fixe));
  check('règle : mesures à 0, 2, 4, 7, 10 s (4/4 à 120, puis 3/4 à 60)', JSON.stringify(r1.bars) === '[0,2,4,7,10]', JSON.stringify(r1.bars));
  check('pastille de signature 3/4 dans la règle', r1.sig.length === 1 && r1.sig[0] === '3/4', JSON.stringify(r1.sig));
  check('grille dessinée morceau par morceau', r1.gridPieces >= 3 && r1.gridRepeat.trim() === 'no-repeat', r1.gridPieces);
  check('aimant à la mesure : 5,2 s → 4 s, 6 s → 7 s', r1.snaps[0] === 4 && r1.snaps[1] === 7, JSON.stringify(r1.snaps));
  check('aimant au temps : 4,4 s → 4 s (1 s par temps), 1,1 s → 1 s (0,5 s par temps)', Math.abs(r1.snapBeat[0] - 4) < 1e-9 && Math.abs(r1.snapBeat[1] - 1) < 1e-9, JSON.stringify(r1.snapBeat));
  check('compteur en mesures : 5 s = mesure 3, temps 2', /^3 \| 2 \. 00$/.test(r1.chrono), r1.chrono);
  check('flèches : mesure suivante 7 s, précédente 4 s, temps suivant 5 s', r1.nextBar === 7 && r1.prevBar === 4 && Math.abs(r1.nextBeat - 5) < 1e-9, `${r1.nextBar} / ${r1.prevBar} / ${r1.nextBeat}`);
  check('piste de tempo affichée d\'office : 2 paliers, 120 puis 60', r1.laneShown && r1.lanePts === 2 && r1.laneLbl.join(',') === '120,60', JSON.stringify(r1.laneLbl));

  // Métronome : on note l'heure et la hauteur de chaque clic (accent = 1200 Hz au début de chaque mesure)
  const r2 = JSON.parse(await ev(`(async()=>{
    const ctx = await PulseAudio.init(), clicks = [];
    const orig = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { const o = orig(); const st = o.start.bind(o); o.start = (w) => { clicks.push([w, o.frequency.value]); st(w); }; return o; };
    PulseAudio.setMetronome(true, 120);
    const t0 = ctx.currentTime;
    PulseAudio.startMetronome(120, 3, state.project);
    await new Promise(r => setTimeout(r, 3300));
    PulseAudio.stopMetronome(); PulseAudio.setMetronome(false); ctx.createOscillator = orig;
    return JSON.stringify(clicks.map(([w, f]) => [Math.round((w - t0) * 100) / 100, f]));
  })()`));
  console.log('clics', JSON.stringify(r2));
  // (le clic pile au lancement peut tomber avant la première vérification du métronome, comme avant : on regarde les suivants)
  const at = (t) => r2.find(c => Math.abs(c[0] - t) < 0.03);
  check('métronome : 0,5 s par temps puis 1 s après le changement (clics à 0,5 / 1 / 2 / 3 s)', [0.5, 1, 2, 3].every(at) && !at(1.5) && !at(2.5), JSON.stringify(r2.map(c => c[0])));
  check('métronome : accent au 1er temps de la mesure 3 seulement', at(0.5)?.[1] === 800 && at(1)?.[1] === 1200 && at(2)?.[1] === 800 && at(3)?.[1] === 800, JSON.stringify(r2.map(c => c[1])));

  // Régions MIDI : au tempo de leur début, elles restent sur leur temps quand le tempo change
  const r3 = JSON.parse(await ev(`(async()=>{
    const wait = (ms) => new Promise(r => setTimeout(r, ms)), t = state.project.tracks[0];
    await createMidiClip(0, 4.5, true); await wait(300); PulsePianoRoll.close(true);
    const c = t.clips[0], a = { start: c.start, dur: c.duration, bpm: c.midi.bpm, beats: c.midi.beats };
    pushUndo(); state.project.bpm = 60; tempoMapChanged(); await wait(200);
    const b = { start: c.start, dur: c.duration, bpm: c.midi.bpm, tempos: JSON.stringify(state.project.tempos || null) };
    pushUndo(); setTempoAtBeat(8, 120); tempoMapChanged(); await wait(200);
    const d = { start: c.start, dur: c.duration, bpm: c.midi.bpm, id: c.id, buf: PulseAudio.hasBuffer(c.id) };
    c.start = 0; await wait(1600);                      // déplacée avant le changement : rendue au tempo du début (60)
    const e = { start: c.start, dur: c.duration, bpm: c.midi.bpm };
    c.start = 8; await wait(1600);
    const map = midiTempoMap(), bytes = Array.from(PulseMidiFile.encode([{ name: 'x', notes: [{ s: 0, d: 1, p: 60, v: 90 }] }], state.project.bpm, map));
    const has = (seq) => bytes.some((_, i) => seq.every((v, k) => bytes[i + k] === v));
    return JSON.stringify({ a, b, d, e, map, tempo120: has([0xFF, 0x51, 3, 0x07, 0xA1, 0x20]), tempo60: has([0xFF, 0x51, 3, 0x0F, 0x42, 0x40]), sig3: has([0xFF, 0x58, 4, 3]), sig4: has([0xFF, 0x58, 4, 4]) });
  })()`));
  console.log(JSON.stringify(r3));
  check('nouvelle région MIDI à la mesure 3 : 4 s, 3 temps à 60 BPM (3 s)', r3.a.start === 4 && Math.abs(r3.a.dur - 3) < 1e-9 && r3.a.bpm === 60 && r3.a.beats === 3, JSON.stringify(r3.a));
  check('tempo du début 120 → 60 : la région reste sur sa mesure (8 s)', Math.abs(r3.b.start - 8) < 1e-9 && Math.abs(r3.b.dur - 3) < 1e-9 && r3.b.tempos === 'null', JSON.stringify(r3.b));
  check('le changement passe à 120 : la région est rendue à 120 (1,5 s), son prêt', Math.abs(r3.d.start - 8) < 1e-9 && Math.abs(r3.d.dur - 1.5) < 1e-9 && r3.d.bpm === 120 && r3.d.buf, JSON.stringify(r3.d));
  check('région glissée avant le changement : rejouée au tempo de cet endroit', r3.e.start === 0 && r3.e.bpm === 60 && Math.abs(r3.e.dur - 3) < 1e-9, JSON.stringify(r3.e));
  check('export .mid : 60 BPM au début, 120 BPM et 3/4 ensuite', r3.tempo60 && r3.tempo120 && r3.sig3 && r3.sig4 && r3.map.tempos.length === 1 && r3.map.signatures.length === 1, JSON.stringify(r3.map));

  // Piste de tempo : double-clic → nouveau changement à la mesure ; glisser un point ; clic droit → supprimer ; ⌘Z
  const r4 = JSON.parse(await ev(`(async()=>{
    const wait = (ms) => new Promise(r => setTimeout(r, ms)), lane = document.getElementById('tempoLane');
    const tl = document.querySelector('.timeline'); tl.scrollLeft = 0;
    const rect = lane.getBoundingClientRect(), pps = state.pxPerSecond;
    const at = (sec) => rect.left + sec * pps;
    // double-clic à 12,4 s : 60 BPM jusqu'à 8 s, puis mesures de 3 temps à 120 (1,5 s) → mesure 6 à 12,5 s (temps 17)
    lane.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: at(12.4), clientY: rect.top + 15 }));
    await wait(150);
    const inp = document.querySelector('.ask-modal .ask-input'), askTitle = document.querySelector('.ask-modal .modal-title')?.textContent;
    inp.value = '90'; document.querySelector('.ask-modal .ask-ok').click(); await wait(300);
    const afterAdd = JSON.stringify(state.project.tempos);
    // glisser le point du changement à 120 (2e point) de 12 px vers le haut
    const dot = lane.querySelectorAll('.tl-pt')[1], dr = dot.getBoundingClientRect(), cx = dr.left + dr.width / 2, cy = dr.top + dr.height / 2;
    dot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: cx, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy - 6 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy - 12 }));
    const bubble = document.querySelector('.tempo-bubble')?.textContent || '';
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy - 12 }));
    await wait(300);
    const dragged = state.project.tempos.find(t => t.beat === 8)?.bpm;
    const regionBpm = state.project.tracks[0].clips[0].midi.bpm;
    // clic droit sur le 3e point → Supprimer
    const dot3 = lane.querySelectorAll('.tl-pt')[2], d3 = dot3.getBoundingClientRect();
    dot3.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: d3.left + 3, clientY: d3.top + 3 }));
    await wait(80);
    const items = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e => e.textContent);
    [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => /Supprimer ce changement/.test(e.textContent)).click(); await wait(300);
    const afterDel = JSON.stringify(state.project.tempos);
    // ⌘Z : le changement supprimé revient, la région ne bouge pas une deuxième fois
    const cBefore = state.project.tracks[0].clips[0].start;
    undoAction(); await wait(1600);
    const afterUndo = JSON.stringify(state.project.tempos), cAfter = state.project.tracks[0].clips[0].start;
    // revenir à un seul tempo
    const rr = document.getElementById('timelineRuler').getBoundingClientRect();
    document.getElementById('timelineRuler').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rr.left + 50, clientY: rr.top + 20 }));
    await wait(80);
    const rItems = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e => e.textContent);
    [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => /un seul tempo/.test(e.textContent)).click(); await wait(1600);
    const single = { tempos: state.project.tempos === undefined, sigs: state.project.signatures === undefined, grid: document.getElementById('timelineTracks').style.backgroundRepeat, sigChips: document.querySelectorAll('#timelineRuler .ruler-sig').length, region: state.project.tracks[0].clips[0].midi.bpm };
    return JSON.stringify({ askTitle, afterAdd, bubble, dragged, regionBpm, items, afterDel, afterUndo, cBefore, cAfter, rItems, single });
  })()`));
  console.log(JSON.stringify(r4));
  await shot('/private/tmp/claude-501/qa/tempo-variable.jpg');
  check('double-clic sur la piste de tempo : changement à la mesure la plus proche', /mesure 6/.test(r4.askTitle) && r4.afterAdd === '[{"beat":8,"bpm":120},{"beat":17,"bpm":90}]', r4.askTitle + ' ' + r4.afterAdd);
  check('glisser un point vers le haut : le tempo monte, bulle affichée, la région suit', r4.dragged > 120 && /BPM · mesure 3/.test(r4.bubble) && r4.regionBpm === r4.dragged, `${r4.dragged} « ${r4.bubble} » région ${r4.regionBpm}`);
  check('clic droit sur un point : supprimer le changement', r4.items.some(t => /Supprimer ce changement/.test(t)) && !/"beat":17/.test(r4.afterDel), r4.afterDel);
  check('⌘Z : le changement revient, la région ne bouge pas deux fois', /"beat":17/.test(r4.afterUndo) && r4.cBefore === r4.cAfter, `${r4.afterUndo} ${r4.cBefore}→${r4.cAfter}`);
  check('« revenir à un seul tempo » : carte vidée, grille fixe, région au tempo du projet', r4.single.tempos && r4.single.sigs && r4.single.grid === '' && r4.single.sigChips === 0 && r4.single.region === 60, JSON.stringify(r4.single));
};
