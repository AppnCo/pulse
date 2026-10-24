// Saturation multibande : 200 Hz + 3 kHz. Chiffres recopiés dans engine/src/lib.rs (saturation_multibande_comme_le_navigateur).
import { boot } from './qa-lib.mjs';
export const CASES = {
  base: { bands: [{ base: true, sty: 'bande', va: 1, heat: 50 }] },
  libre: { bands: [{ base: true, sty: 'lampe', va: 1, heat: 40 }, { lo: 2000, hi: 6000, sty: 'ampli', va: 2, heat: 60, dyn: 20, fb: 30, hi2: 3, mix: 70, out: -2 }] },
  sansbase: { bands: [{ lo: 100, hi: 400, sty: 'repli', va: 1, heat: 80, slope: 48 }] },
  lofi: { bands: [{ base: true, sty: 'lofi', va: 1, heat: 30 }], mix: 60, out: -3 },
  solo: { bands: [{ base: true, sty: 'transfo', va: 0, heat: 50 }, { lo: 2000, hi: 6000, sty: 'bande', va: 0, heat: 20, solo: true, dyn: -30 }] },
  sansag: { bands: [{ base: true, sty: 'bande', va: 1, heat: 50 }], ag: false }
};
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'ms1', name: 'MS', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0);
    for(let i=0;i<sr;i++){ const t=i/sr; d[i]=(0.4*Math.sin(2*Math.PI*200*t)+0.15*Math.sin(2*Math.PI*3000*t))*(t<0.5?1:0.3); } PulseAudio.registerBuffer('ms',b);
    state.project.tracks[0].clips=[{id:'ms',start:0,duration:1}]; })()`);
  const meas = (mp) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['msat']; t.effectParams={msat:${JSON.stringify(mp)}};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
    const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
    let hf=0; for(let i=4800;i<19200;i++){ const v=L[i]-2*L[i-1]+L[i-2]; hf+=v*v; }
    return JSON.stringify([rms(0.1,0.4),rms(0.6,0.9),Math.sqrt(hf/14400)].map(v=>+v.toFixed(6))) })()`);
  const dry = JSON.parse(await meas({ bands: [] }));
  console.log('sans saturation :', JSON.stringify(dry));
  for (const [k, v] of Object.entries(CASES)) console.log(k, ':', await meas(v));
};
