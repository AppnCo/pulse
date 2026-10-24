// Multibande : 100 Hz continu + 3 kHz par moments. Chiffres recopiés dans engine/src/lib.rs (multibande_comme_le_navigateur).
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'mb1', name: 'MB', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0);
    for(let i=0;i<sr;i++){ const t=i/sr; d[i]=0.4*Math.sin(2*Math.PI*100*t)+((t>0.5&&t<0.8)?0.2*Math.sin(2*Math.PI*3000*t):0); } PulseAudio.registerBuffer('mb',b);
    state.project.tracks[0].clips=[{id:'mb',start:0,duration:1}]; })()`);
  const meas = (mp) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['mband']; t.effectParams={mband:${JSON.stringify(mp)}};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
    const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
    return JSON.stringify([rms(0.2,0.45),rms(0.55,0.78)].map(v=>+v.toFixed(6))) })()`);
  const dry = JSON.parse(await meas({ bands: [] }));
  const idle = JSON.parse(await meas({ bands: [{ lo: 60, hi: 200, thr: 0, range: -8 }] }));
  const B = [{ lo: 60, hi: 200, thr: -20, range: -8, att: 5, rel: 80 }, { lo: 2000, hi: 5000, thr: -30, range: 6, out: -2 }];
  const both = JSON.parse(await meas({ bands: B }));
  const solo = JSON.parse(await meas({ bands: [B[0], { ...B[1], solo: true }] }));
  const mute = JSON.parse(await meas({ bands: [{ ...B[0], mute: true }, B[1]] }));
  console.log('sans bande :', JSON.stringify(dry), '| bande au repos (seuil 0 dB) :', JSON.stringify(idle), Math.abs(idle[0] - dry[0]) < 1e-5 ? 'PASS son intact' : 'FAIL');
  console.log('deux bandes :', JSON.stringify(both), '| graves baissés', both[0] < dry[0] * 0.8 ? 'PASS' : 'FAIL');
  console.log('solo bande 2 :', JSON.stringify(solo), '| muet bande 1 :', JSON.stringify(mute));
};
