// Pan comme Logic : piste mono = puissance constante ; son stéréo et groupe = balance (à fond d'un côté : +3 dB, l'autre côté s'éteint).
// Avant le 28/10 : un groupe à fond sur le côté montait de +6 dB (QA-RAPPORT-2 n° 21). Même loi dans render.rs (balance_gains).
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pb',name:'PB',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const ctx = await PulseAudio.init(), sr = 48000;
    const m = ctx.createBuffer(1, sr, sr); m.getChannelData(0).fill(0.2);
    const st = ctx.createBuffer(2, sr, sr); st.getChannelData(0).fill(0.1); st.getChannelData(1).fill(0.3);
    PulseAudio.registerBuffer('m', m); PulseAudio.registerBuffer('st', st);
    const p = state.project, t = p.tracks[0];
    const exp = async () => { const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer()); const k = sr / 2; return [ab.getChannelData(0)[k], ab.getChannelData(1)[k]]; };
    const out = {};
    t.clips = [{ id: 'm', start: 0, duration: 1, name: 'm' }];
    t.pan = 0; out.monoC = await exp(); t.pan = 100; out.monoR = await exp();
    t.clips = [{ id: 'st', start: 0, duration: 1, name: 'st' }];
    t.pan = 0; out.stC = await exp(); t.pan = 100; out.stR = await exp(); t.pan = -100; out.stL = await exp();
    t.clips = [{ id: 'm', start: 0, duration: 1, name: 'm' }]; t.pan = 0;
    p.buses = [{ id: 'g', name: 'G', isGroup: true, output: 'master', volume: 100, effects: [] }]; t.output = 'g';
    out.grC = await exp(); p.buses[0].pan = 100; out.grR = await exp();
    return JSON.stringify(out);
  })()`));
  console.log(JSON.stringify(r));
  const near = (a, b) => Math.abs(a - b) < 2e-3 * Math.max(1, Math.abs(b) * 10);
  const db = (a, b) => 20 * Math.log10(a / b);
  check('piste mono à fond à droite : +3 dB, gauche muette (inchangé)', near(r.monoR[0], 0) && Math.abs(db(r.monoR[1], r.monoC[1]) - 3.01) < 0.05, `${db(r.monoR[1], r.monoC[1]).toFixed(2)} dB`);
  check('piste stéréo au centre : gauche et droite intactes', Math.abs(r.stC[0] / r.stC[1] - 1 / 3) < 0.01, `${r.stC[0].toFixed(4)} / ${r.stC[1].toFixed(4)}`);
  check('piste stéréo à fond à droite : la gauche s\'éteint sans être reportée, droite +3 dB', near(r.stR[0], 0) && Math.abs(db(r.stR[1], r.stC[1]) - 3.01) < 0.05, `${r.stR[0].toFixed(4)} / ${db(r.stR[1], r.stC[1]).toFixed(2)} dB`);
  check('piste stéréo à fond à gauche : symétrique', near(r.stL[1], 0) && Math.abs(db(r.stL[0], r.stC[0]) - 3.01) < 0.05, `${db(r.stL[0], r.stC[0]).toFixed(2)} dB`);
  check('groupe à fond à droite : +3 dB comme une piste (avant : +6 dB)', near(r.grR[0], 0) && Math.abs(db(r.grR[1], r.grC[1]) - 3.01) < 0.05, `${db(r.grR[1], r.grC[1]).toFixed(2)} dB`);
};
