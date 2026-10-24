import { boot, RAP, instru, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  const P = { id: 'm1', name: 'Mix', bpm: 120, tracks: [
    { name: 'A', type: 'audio', color: '#A855F7', output: 'g1', clips: [] },
    { name: 'B', type: 'audio', color: '#22D3EE', output: 'master', clips: [] }],
    buses: [{ id: 'g1', name: 'Groupe 1', isGroup: true, output: 'master', color: '#A855F7' }] };
  await boot(c, P);
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.5*Math.sin(2*Math.PI*100*i/sr); PulseAudio.registerBuffer('s100',b);
    const b2=ctx.createBuffer(1,sr*2,sr),d2=b2.getChannelData(0); for(let i=0;i<d2.length;i++) d2[i]=0.5*Math.sin(2*Math.PI*1000*i/sr); PulseAudio.registerBuffer('s1k',b2);
    state.project.tracks[0].clips=[{id:'s100',start:0,duration:2}]; renderAll(); })()`);
  const meas = async (label) => { const r = await ev(`(async()=>{ const w=await PulseAudio.exportWav(state.project,{normalize:false}); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0),R=x.getChannelData(1); let l=0,r=0; const a=Math.floor(0.5*48000), e=Math.floor(1.5*48000); for(let i=a;i<e;i++){l+=L[i]*L[i]; r+=R[i]*R[i];} const n=e-a; return JSON.stringify({L:+Math.sqrt(l/n).toFixed(4),R:+Math.sqrt(r/n).toFixed(4),dur:+x.duration.toFixed(2)}) })()`); console.log(label.padEnd(34), r); };
  await meas('base (100 Hz, groupe sans fx)');
  // 1. COMP sur le groupe via le vrai clic dans le mixeur
  await ev(`toggleMixer()`); await sleep(400);
  const plus = await pos(ev, `.mixer-strips .strip[data-kind="bus"] .slot-plus[data-plus="fx"]`);
  await Mo.click(plus.x, plus.y); await sleep(300);
  await ev(`document.querySelector('.fx-add-menu .fam-fx[data-fx="comp"]').click()`); await sleep(400);
  console.log('panneau comp ouvert', await ev(`!!document.querySelector('.fx-panel')`), 'effets', await ev(`JSON.stringify(state.project.buses[0].effects)`));
  await meas('COMP groupe défauts');
  await ev(`state.project.buses[0].effectParams={comp:{threshold:-40,ratio:20,attack:1,release:50,mix:100}}`);
  await meas('COMP groupe -40 dB / 20:1');
  // 2. annulation avec le panneau ouvert
  await K('z', CMD); await sleep(200);
  console.log('après ⌘Z: effets', await ev(`JSON.stringify(state.project.buses[0].effects)`), 'panneau', await ev(`!!document.querySelector('.fx-panel')`));
  // 3. EQ groupe passe-haut 500 Hz
  await ev(`state.project.buses[0].effects=['eq']; state.project.buses[0].effectParams={eq:{hpf:500,midGain:0,presence:0,air:0}}`);
  await meas('EQ groupe hpf 500 (100 Hz)');
  // 4. pan groupe
  await ev(`state.project.buses[0].effects=[]; state.project.buses[0].pan=100`);
  await meas('pan groupe +100');
  await ev(`state.project.buses[0].pan=-100`);
  await meas('pan groupe -100');
  await ev(`state.project.buses[0].pan=0; state.project.tracks[0].pan=100`);
  await meas('pan piste +100');
  await ev(`state.project.buses[0].pan=100; state.project.tracks[0].pan=100`);
  await meas('pan piste +100 + groupe +100');
  await ev(`state.project.buses[0].pan=-100; state.project.tracks[0].pan=100`);
  await meas('pan piste +100 + groupe -100');
  // 5. groupe muet + volume 
  await ev(`state.project.buses[0].pan=0; state.project.tracks[0].pan=0; state.project.buses[0].volume=50`);
  await meas('vol groupe 50');
  await ev(`state.project.buses[0].muted=true`);
  await meas('groupe muet');
  await ev(`state.project.buses[0].muted=false; state.project.buses[0].volume=100; state.project.tracks[0].muted=true`);
  await meas('piste muette');
  await ev(`state.project.tracks[0].muted=false; state.project.tracks[0].solo=false;`);
  // 6. master
  await ev(`PulseAudio.setMasterVolume(50)`);
  await meas('master 50');
  await ev(`PulseAudio.setMasterVolume(100)`);
  // 7. dblclick fader piste => 80 ?
  const f = await pos(ev, `.strip[data-kind="track"][data-i="0"] .fader`);
  await Mo.click(f.x, f.y + 40); // volume changes
  console.log('vol après clic', await ev(`state.project.tracks[0].volume`));
  await Mo.click(f.x, f.y + 40, 2); await sleep(100);
  console.log('vol après dblclick', await ev(`state.project.tracks[0].volume`));
  await shot('/private/tmp/claude-501/qa/mix-1.jpg');
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
};
