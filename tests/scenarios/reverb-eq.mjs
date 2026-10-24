// Reverb : EQ intégré (sur l'effet seulement), brillance, largeur — chiffres de l'export du navigateur,
// recopiés dans engine/src/lib.rs (reverb_eq_comme_le_navigateur) : les deux moteurs doivent sonner pareil.
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 're1', name: 'RE', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<4800;i++) d[i]=0.5*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('clap',b);
    state.project.tracks[0].clips=[{id:'clap',start:0,duration:1}]; })()`);
  const meas = (rp) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['reverb']; t.effectParams={reverb:${JSON.stringify(rp)}};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0),R=x.getChannelData(1);
    const rms=(a,z,A)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=A[i]*A[i]; return Math.sqrt(s/(i1-i0));};
    return JSON.stringify([rms(0,0.1,L),rms(0.3,0.9,L),rms(0.3,0.9,R),rms(1.5,2.5,L)].map(v=>+v.toFixed(6))) })()`);
  const base = { wet: 60, size: 2.4 };
  const full = { wet: 60, size: 2.4, bright: 80, width: 130, eq: [{ type: 'hpf', freq: 300, gain: 0, q: 0.7071, slope: 24 }, { type: 'bell', freq: 3000, gain: -6, q: 1 }, { type: 'highshelf', freq: 8000, gain: 4, q: 0.7 }, { type: 'bell', freq: 500, gain: 9, q: 1, on: false }] };
  const a = JSON.parse(await meas(base)), b = JSON.parse(await meas(full)), z = JSON.parse(await meas({ ...base, eq: [], bright: 50, width: 100 }));
  console.log('sans réglage nouveau :', JSON.stringify(a));
  console.log('neutre explicite (eq vide, brillance 50, largeur 100) :', JSON.stringify(z), JSON.stringify(a) === JSON.stringify(z) ? 'PASS identique' : 'FAIL');
  console.log('avec EQ + brillance + largeur :', JSON.stringify(b));
  // coupe-haut raide à 150 Hz sur l'effet : la queue (440 Hz) disparaît, le son direct reste
  const cut = JSON.parse(await meas({ ...base, eq: [{ type: 'lpf', freq: 150, gain: 0, q: 0.7071, slope: 48 }] })), dryOnly = JSON.parse(await meas({ ...base, wet: 0 }));
  console.log('coupe-haut 150 Hz sur l\'effet : queue', a[1], '→', cut[1], cut[1] < a[1] * 0.1 ? 'PASS' : 'FAIL');
  console.log('le son direct ne passe pas dans l\'EQ : direct seul', dryOnly[0], '| avec effet coupé', cut[0]);
  const dark = JSON.parse(await meas({ ...base, bright: 0 })), brightv = JSON.parse(await meas({ ...base, bright: 100 }));
  console.log('brillance 0 / 100, fin de queue :', dark[3], '/', brightv[3]);
  const mono = JSON.parse(await meas({ ...base, width: 0 }));
  console.log('largeur 0 → gauche = droite :', mono[1], mono[2], Math.abs(mono[1] - mono[2]) < 1e-4 ? 'PASS' : 'FAIL');
};
