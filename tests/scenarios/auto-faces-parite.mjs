// Automation des nouvelles façades (De-esser, Limiteur) : chiffres de l'export du navigateur,
// recopiés dans engine/src/lib.rs (automation_des_facades_comme_le_navigateur).
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'af1', name: 'AF', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,2*sr,sr),d=b.getChannelData(0); let r=7;
    for(let i=0;i<2*sr;i++){ const t=i/sr; r=(r*16807)%2147483647; d[i]=0.6*Math.sin(2*Math.PI*300*t)+0.25*(r/1073741823.5-1); } PulseAudio.registerBuffer('vs',b);
    state.project.tracks[0].clips=[{id:'vs',start:0,duration:2}]; })()`);
  const meas = (fx, fp, auto) => ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['${fx}']; t.effectParams={${fx}:${JSON.stringify(fp)}}; t.automation=${JSON.stringify(auto)};
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
    const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
    return JSON.stringify([rms(0.2,0.8),rms(1.2,1.8)].map(v=>+v.toFixed(6))) })()`);
  const ramp = { points: [{ t: 0, v: 0 }, { t: 1, v: 0 }, { t: 1.01, v: 1 }] };
  const de = JSON.parse(await meas('deess', { thr: -40, range: 12 }, { 'fx:deess:range': ramp }));
  const deT = JSON.parse(await meas('deess', { thr: -40, range: 12 }, { 'fx:deess:thr': { points: [{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 1.01, v: 0 }] } }));
  const li = JSON.parse(await meas('limit', { ceiling: -1, release: 120 }, { 'fx:limit:ceiling': { points: [{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 1.01, v: 0.5 }] } }));
  const lr = JSON.parse(await meas('limit', { ceiling: -6, release: 120 }, { 'fx:limit:release': ramp }));
  const ga = JSON.parse(await meas('gate', { threshold: -20, reduction: 40, ratio: 2, release: 150 }, { 'fx:gate:ratio': { points: [{ t: 0, v: 0 }, { t: 1, v: 0 }, { t: 1.01, v: 0.6 }] }, 'fx:gate:knee': ramp, 'fx:gate:attack': ramp, 'fx:gate:hold': ramp }));
  const mb = JSON.parse(await meas('mband', { bands: [{ lo: 20, hi: 400, thr: -40, range: -12 }, { lo: 400, hi: 20000, thr: -40, range: -6 }] }, { 'fx:mband:b0-range': { points: [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }, { t: 1.01, v: 0 }] }, 'fx:mband:b1-out': ramp, 'fx:mband:b0-att': ramp, 'fx:mband:b1-thr': ramp }));
  const ms = JSON.parse(await meas('msat', { bands: [{ base: true, sty: 'bande', va: 1, heat: 30 }, { lo: 200, hi: 2000, sty: 'lampe', va: 1, heat: 20 }], mix: 100 }, { 'fx:msat:b1-heat': ramp, 'fx:msat:b0-hi2': ramp, 'fx:msat:b1-out': { points: [{ t: 0, v: 0.6667 }, { t: 1, v: 0.6667 }, { t: 1.01, v: 0.3 }] }, 'fx:msat:mix': { points: [{ t: 0, v: 1 }, { t: 1.5, v: 0.4 }] }, 'fx:msat:b0-dyn': ramp }));
  const lg = JSON.parse(await meas('limit', { ceiling: -3 }, { 'fx:limit:gain': ramp }));
  console.log('limiteur gain 0 → 24 :', JSON.stringify(lg), lg[1] !== lg[0] ? 'PASS' : 'FAIL');
  const mbx = JSON.parse(await meas('mband', { bands: [{ lo: 200, hi: 2000, thr: -40, range: -12 }] }, { 'fx:mband:b0-lo': { points: [{ t: 0, v: 0.3 }, { t: 2, v: 0.6 }] }, 'fx:mband:b0-hi': ramp }));
  const msx = JSON.parse(await meas('msat', { bands: [{ base: true, sty: 'bande', va: 1, heat: 10 }, { lo: 200, hi: 2000, sty: 'ampli', va: 1, heat: 60, fb: 30 }] }, { 'fx:msat:b1-lo': { points: [{ t: 0, v: 0.3 }, { t: 2, v: 0.6 }] }, 'fx:msat:b1-hi': ramp }));
  console.log('multibande limites :', JSON.stringify(mbx), mbx[1] !== mbx[0] ? 'PASS' : 'FAIL');
  console.log('saturation multibande limites :', JSON.stringify(msx), msx[1] !== msx[0] ? 'PASS' : 'FAIL');
  console.log('gate ratio / genou / attaque / maintien :', JSON.stringify(ga), ga[1] !== ga[0] ? 'PASS' : 'FAIL');
  console.log('multibande plage / sortie / attaque / seuil :', JSON.stringify(mb), mb[1] !== mb[0] ? 'PASS' : 'FAIL');
  console.log('saturation multibande chaleur / ton / niveau / mélange / dynamique :', JSON.stringify(ms), ms[1] !== ms[0] ? 'PASS' : 'FAIL');
  console.log('de-esser plage 0 → 24 :', JSON.stringify(de), de[1] < de[0] * 0.97 ? 'PASS' : 'FAIL');
  console.log('de-esser seuil 0 → -60 :', JSON.stringify(deT), deT[1] < deT[0] * 0.97 ? 'PASS' : 'FAIL');
  console.log('limiteur plafond 0 → -6 :', JSON.stringify(li), li[1] < li[0] * 0.8 ? 'PASS' : 'FAIL');
  console.log('limiteur relâchement 5 → 2000 :', JSON.stringify(lr), lr[1] !== lr[0] ? 'PASS' : 'FAIL');
};
