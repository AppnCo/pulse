// Tempo qui change en cours de morceau : l'écho calé sur le rythme (1/8) suit le tempo de l'endroit joué, comme Logic.
// Mêmes valeurs que le test Rust `echo_suit_la_piste_de_tempo` (engine/src/lib.rs) : parité des deux moteurs.
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const c = AudioNode.prototype.connect; window.__tap = null; AudioNode.prototype.connect = function (t, ...a) { if (t && t.constructor && t.constructor.name === 'AudioDestinationNode' && !window.__tap) window.__tap = this; return c.call(this, t, ...a); }; })();` });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'etv',name:'ETV',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const ctx = await PulseAudio.init(), sr = 48000;
    const b = ctx.createBuffer(1, sr, sr), d = b.getChannelData(0); for (let i = 0; i < 4800; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
    PulseAudio.registerBuffer('clap', b);
    const p = state.project, t = p.tracks[0];
    t.clips = [{ id: 'clap', start: 0, duration: 1, name: 'a' }, { id: 'clap', start: 3, duration: 1, name: 'b' }];
    t.effects = ['delay']; t.effectParams = { delay: { wet: 25, feedback: 38, beats: 0.5 } };
    const rmsAt = (x, a) => { let s = 0; const i0 = Math.round(a * sr), i1 = Math.round((a + 0.1) * sr); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / (i1 - i0)); };
    const exp = async () => (await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p, 0)).arrayBuffer())).getChannelData(0);
    const round = (v) => Math.round(v * 1e5) / 1e5;
    p.tempos = [{ beat: 4, bpm: 60 }];
    let x = await exp();
    const varie = [0.25, 0.5, 3.25, 3.5, 4.0].map(a => round(rmsAt(x, a)));
    delete p.tempos; x = await exp(); const fixe = round(rmsAt(x, 3.25));
    p.tempos = [{ beat: 4, bpm: 60 }]; t.effectParams.delay = { wet: 25, feedback: 38, ms: 250 }; x = await exp(); const ms = round(rmsAt(x, 3.25));
    // lecture qui démarre APRÈS le changement (2,9 s) : l'écho du coup de 3 s tombe à 3,5 s, pas à 3,25 s
    t.effectParams.delay = { wet: 25, feedback: 38, beats: 0.5 }; renderAll();
    const rec = []; const sp = ctx.createScriptProcessor(512, 2, 1); window.__tap.connect(sp); const z = ctx.createGain(); z.gain.value = 0; sp.connect(z); z.connect(ctx.destination);
    sp.onaudioprocess = (e) => { rec.push(Float32Array.from(e.inputBuffer.getChannelData(0))); };
    state.playhead = 2.9; await togglePlay(); const from = rec.length; await new Promise(r => setTimeout(r, 1100)); await togglePlay();
    const y = new Float32Array((rec.length - from) * 512); let o = 0; for (let k = from; k < rec.length; k++) { y.set(rec[k], o); o += 512; }
    // instants (après le premier son) où un écho démarre
    const lr = ctx.sampleRate; const env = (i) => { let s = 0; for (let k = i; k < i + 240 && k < y.length; k++) s = Math.max(s, Math.abs(y[k])); return s; };
    let first = -1; for (let i = 0; i < y.length; i += 120) if (env(i) > 0.05) { first = i; break; }
    let echo = -1; for (let i = first + Math.round(0.15 * lr); i < y.length; i += 120) if (env(i) > 0.01 && env(i - Math.round(0.05 * lr)) < 0.005) { echo = i; break; }
    return JSON.stringify({ varie, fixe, ms, ecart: first < 0 || echo < 0 ? null : Math.round((echo - first) / lr * 100) / 100 });
  })()`));
  console.log(JSON.stringify(r));
  const near = (v, want) => Math.abs(v - want) < want * 0.01 + 1e-5;
  check('avant le changement : écho 1/8 à 120 BPM (0,25 s)', near(r.varie[0], 0.06249) && near(r.varie[1], 0.02360), r.varie.slice(0, 2).join(' / '));
  check('après le changement : écho 1/8 à 60 BPM (0,5 s), mêmes valeurs que Rust', near(r.varie[2], 0) && near(r.varie[3], 0.06249) && near(r.varie[4], 0.02360), r.varie.slice(2).join(' / '));
  check('sans carte de tempo : écho à 0,25 s partout (comme avant)', near(r.fixe, 0.06249), r.fixe);
  check('écho en millisecondes : ne suit pas le tempo', near(r.ms, 0.06249), r.ms);
  check('lecture lancée après le changement : écho à 0,5 s', r.ecart !== null && Math.abs(r.ecart - 0.5) < 0.04, r.ecart);
};
