// Écho : EQ des répétitions (la voix d'origine n'y passe pas). Chiffres recopiés dans engine/src/lib.rs (echo_eq_comme_le_navigateur).
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'ee1', name: 'EE', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); let r=1; for(let i=0;i<4800;i++){ r=(r*16807)%2147483647; d[i]=0.5*(r/1073741823.5-1); } PulseAudio.registerBuffer('clap',b);
    state.project.tracks[0].clips=[{id:'clap',start:0,duration:1}]; })()`);
  const meas = (dp) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['delay']; t.effectParams={delay:${JSON.stringify(dp)}};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0),R=x.getChannelData(1)||L;
    const rms=(a,z,A)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=A[i]*A[i]; return Math.sqrt(s/(i1-i0));};
    return JSON.stringify([rms(0,0.1,L),rms(0.25,0.35,L),rms(0.5,0.6,L),rms(0.5,0.6,R)].map(v=>+v.toFixed(6))) })()`);
  const base = { wet: 50, feedback: 40, beats: 0.5 };
  const eq = [{ type: 'hpf', freq: 400, gain: 0, q: 0.7071, slope: 24 }, { type: 'bell', freq: 2000, gain: 6, q: 1 }, { type: 'lpf', freq: 6000, gain: 0, q: 0.7071, slope: 12 }];
  const a = JSON.parse(await meas(base)), z = JSON.parse(await meas({ ...base, eq: [] })), b = JSON.parse(await meas({ ...base, eq })), p = JSON.parse(await meas({ ...base, pp: 1, eq }));
  console.log('sans EQ :', JSON.stringify(a), '| EQ vide :', JSON.stringify(z), JSON.stringify(a) === JSON.stringify(z) ? 'PASS identique' : 'FAIL');
  console.log('avec EQ :', JSON.stringify(b), '| voix d\'origine intacte :', Math.abs(a[0] - b[0]) < 1e-6 ? 'PASS' : 'FAIL', '| 1re répétition changée :', Math.abs(a[1] - b[1]) / a[1] > 0.05 ? 'PASS' : 'FAIL');
  console.log('ping-pong + EQ :', JSON.stringify(p));
};
