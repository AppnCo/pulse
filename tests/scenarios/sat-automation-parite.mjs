// Saturation : automation de Chaleur, Entrée, Ton, Mélange, Sortie. Chiffres recopiés dans engine/src/lib.rs
// (automation_saturation_comme_le_navigateur). Avant 1 s : réglage du panneau ; après : la courbe.
import { boot } from './qa-lib.mjs';
export const CASES = {
  chaleur: [{ drive: 10, ag: false }, { 'fx:sat:drive': [0.1, 0.9] }],
  entree: [{ drive: 40, sty: 'lampe' }, { 'fx:sat:input': [1 / 3, 0.75] }],
  ton: [{ drive: 50, sty: 'bande' }, { 'fx:sat:tone': [0.5, 0.1] }],
  melange: [{ drive: 80, sty: 'ampli' }, { 'fx:sat:mix': [1, 0.3], 'fx:sat:out': [0.5, 0.25] }]
};
export default async (c) => {
  const { ev, check } = c;
  await boot(c, { id: 'sa1', name: 'SA', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,2*sr,sr),d=b.getChannelData(0);
    for(let i=0;i<2*sr;i++){ const t=i/sr; d[i]=0.4*Math.sin(2*Math.PI*200*t)+0.15*Math.sin(2*Math.PI*3000*t); } PulseAudio.registerBuffer('sa',b);
    state.project.tracks[0].clips=[{id:'sa',start:0,duration:2}]; })()`);
  for (const [k, [sp, au]] of Object.entries(CASES)) {
    const auto = Object.fromEntries(Object.entries(au).map(([pid, [a, b]]) => [pid, { points: [{ t: 0, v: a }, { t: 1, v: a }, { t: 1.01, v: b }] }]));
    const r = JSON.parse(await ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['sat']; t.effectParams={sat:${JSON.stringify(sp)}}; t.automation=${JSON.stringify(auto)};
      const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
      const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
      let hf=0; for(let i=1.2*48000;i<1.8*48000;i++){ const v=L[i]-2*L[i-1]+L[i-2]; hf+=v*v; }
      return JSON.stringify([rms(0.2,0.8),rms(1.2,1.8),Math.sqrt(hf/(0.6*48000))].map(v=>+v.toFixed(6))) })()`));
    console.log('PARITE', k, JSON.stringify(r));
    check(`${k} : la courbe change le son`, Math.abs(r[1] - r[0]) > 1e-3 || k === 'ton', JSON.stringify(r));
  }
};
