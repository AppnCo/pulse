// Pitch « voix fidèle » : mêmes chiffres que le moteur Rust (pitch_comme_le_navigateur), et retard compensé
// (la voix démarre pile à 1 s). Son riche à 220 Hz qui commence à 1 s.
import { boot } from './qa-lib.mjs';
export const CASES = { monte: { semi: 5, mix: 100 }, descend: { semi: -7, mix: 100 }, formant: { semi: 0, formant: 4 }, tout: { semi: 3, formant: -3, mix: 70 } };
export default async (c) => {
  const { ev, check } = c;
  await boot(c, { id: 'pp1', name: 'PP', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,3*sr,sr),d=b.getChannelData(0);
    for(let i=0;i<3*sr;i++) d[i] = i<sr ? 0 : (((i*220/sr)%1)*0.6-0.3); PulseAudio.registerBuffer('pp',b);
    state.project.tracks[0].clips=[{id:'pp',start:0,duration:3,offset:0}]; })()`);
  for (const [k, pp] of Object.entries(CASES)) {
    const r = JSON.parse(await ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['pitch']; t.effectParams={pitch:${JSON.stringify(pp)}};
      const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
      const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
      let hf=0; for(let i=1.2*48000;i<1.8*48000;i++){ const v=L[i]-2*L[i-1]+L[i-2]; hf+=v*v; }
      let on=0; while(on<L.length && Math.abs(L[on])<=0.02) on++;
      return JSON.stringify([rms(1.2,1.8),rms(2.0,2.6),Math.sqrt(hf/(0.6*48000)),on/48000].map(v=>+v.toFixed(6))) })()`));
    console.log('PARITE', k, JSON.stringify(pp), JSON.stringify(r));
    check(`${k} : la voix démarre à sa place (${r[3]} s)`, Math.abs(r[3] - 1) < 0.004, String(r[3]));
  }
};
