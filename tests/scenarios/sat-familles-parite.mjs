// Saturation (la simple) : familles, Entrée, Ton, Mélange, Sortie, Volume égal. Chiffres recopiés dans
// engine/src/lib.rs (saturation_familles_comme_le_navigateur). « classique » = la saturation d'origine (inchangée).
import { boot } from './qa-lib.mjs';
export const CASES = {
  classique: { drive: 50 },
  bande: { drive: 60, sty: 'bande' },
  lampe: { drive: 40, sty: 'lampe', input: 6, tone: -50 },
  ampli: { drive: 80, sty: 'ampli', mix: 60, out: -3 },
  transfo: { drive: 30, sty: 'transfo', tone: 70 },
  repli: { drive: 50, sty: 'repli', ag: false },
  lofi: { drive: 30, sty: 'lofi', input: -6, mix: 50 }
};
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'sf1', name: 'SF', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0);
    for(let i=0;i<sr;i++){ const t=i/sr; d[i]=(0.4*Math.sin(2*Math.PI*200*t)+0.15*Math.sin(2*Math.PI*3000*t))*(t<0.5?1:0.3); } PulseAudio.registerBuffer('sf',b);
    state.project.tracks[0].clips=[{id:'sf',start:0,duration:1}]; })()`);
  const meas = (sp) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['sat']; t.effectParams={sat:${JSON.stringify(sp)}};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
    const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
    let hf=0; for(let i=4800;i<19200;i++){ const v=L[i]-2*L[i-1]+L[i-2]; hf+=v*v; }
    return JSON.stringify([rms(0.1,0.4),rms(0.6,0.9),Math.sqrt(hf/14400)].map(v=>+v.toFixed(6))) })()`);
  for (const [k, v] of Object.entries(CASES)) console.log('PARITE', k, JSON.stringify(v), await meas(v));
};
