// De-esser (nouveau moteur) : une « voix » (300 Hz) et deux « s » (bruit). Chiffres recopiés dans engine/src/lib.rs (deesser_v2_comme_le_navigateur).
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'dp1', name: 'DP', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); let r=7;
    for(let i=0;i<sr;i++){ const t=i/sr; r=(r*16807)%2147483647; const s=(t>0.3&&t<0.4)||(t>0.7&&t<0.75); d[i]=0.3*Math.sin(2*Math.PI*300*t)+(s?0.25*(r/1073741823.5-1):0); } PulseAudio.registerBuffer('vs',b);
    state.project.tracks[0].clips=[{id:'vs',start:0,duration:1}]; })()`);
  const meas = (dp) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['deess']; t.effectParams={deess:${JSON.stringify(dp)}};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
    const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
    return JSON.stringify([rms(0.1,0.2),rms(0.31,0.39),rms(0.71,0.74)].map(v=>+v.toFixed(6))) })()`);
  const off = JSON.parse(await meas({ amount: 0 }));
  const sep = JSON.parse(await meas({ thr: -30, range: 12, lo: 4000, hi: 12000 }));
  const wide = JSON.parse(await meas({ thr: -30, range: 12, lo: 4000, hi: 12000, wide: true }));
  const rel = JSON.parse(await meas({ thr: -12, range: 8, lo: 5000, hi: 11000, rel: true }));
  console.log('sans de-esser :', JSON.stringify(off));
  console.log('séparé :', JSON.stringify(sep), '| voix intacte', Math.abs(sep[0] - off[0]) / off[0] < 0.01 ? 'PASS' : 'FAIL', '| « s » baissés de', (20 * Math.log10(Math.sqrt(sep[1] ** 2 - sep[0] ** 2) / Math.sqrt(off[1] ** 2 - off[0] ** 2))).toFixed(1), 'dB', sep[1] < off[1] * 0.95 ? 'PASS' : 'FAIL');
  console.log('large :', JSON.stringify(wide), '| baisse plus forte sur le « s » que séparé', wide[1] < sep[1] ? 'PASS' : 'FAIL');
  console.log('tout-terrain :', JSON.stringify(rel));
};
