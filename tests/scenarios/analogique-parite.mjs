// Gamme Analogique (73 et 76) : mêmes chiffres que le moteur Rust (analogique_comme_le_navigateur), retard compensé
// (le son démarre pile à 1 s, sur une piste et sur un groupe). Son riche à 220 Hz qui commence à 1 s.
import { boot } from './qa-lib.mjs';
const CASES = [
  ['pre73', { gain: 20, output: -20, high: 4, mid: 3, midF: 3, low: 2, lowF: 1, hpf: 1 }, [0.099128, 0.099128, 0.027474]],
  ['fet76', { input: 36, output: 20, attack: 4, release: 5, ratio: 8 }, [0.043774, 0.043774, 0.012732]],
  ['fet76', { input: 40, output: 18, ratio: 0, mix: 70 }, [0.051816, 0.051816, 0.016344]],
];
export default async (c) => {
  const { ev, check } = c;
  await boot(c, { id: 'an1', name: 'AN', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,3*sr,sr),d=b.getChannelData(0);
    for(let i=0;i<3*sr;i++) d[i] = i<sr ? 0 : (((i*220/sr)%1)*0.6-0.3); PulseAudio.registerBuffer('an',b);
    state.project.tracks[0].clips=[{id:'an',start:0,duration:3,offset:0}]; })()`);
  for (const [fx, pp, want] of CASES) {
    const r = JSON.parse(await ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=[${JSON.stringify(fx)}]; t.effectParams={${fx}:${JSON.stringify(pp)}};
      const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
      const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
      let hf=0; for(let i=1.2*48000;i<1.8*48000;i++){ const v=L[i]-2*L[i-1]+L[i-2]; hf+=v*v; }
      return JSON.stringify([rms(1.2,1.8),rms(2.0,2.6),Math.sqrt(hf/(0.6*48000))].map(v=>+v.toFixed(6))) })()`));
    console.log('PARITE', fx, JSON.stringify(pp), JSON.stringify(r));
    // même calcul des deux côtés : 0,2 % d'écart permis (export 16 bits)
    check(`${fx} ${JSON.stringify(pp)} : comme le moteur Rust`, r.every((v, k) => Math.abs(v - want[k]) < want[k] * 0.002 + 5e-6), JSON.stringify(r) + ' / ' + JSON.stringify(want));
  }
  // Calage : 73 (à plat) + 76 (unité) sur la piste et sur un groupe, comparés au son sec : même départ, au même échantillon
  const g = JSON.parse(await ev(`(async()=>{ const t=state.project.tracks[0];
    const pcm=async(w)=>{ const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); return x.getChannelData(0); };
    const lag=(a,b)=>{ let best=0,bv=-1e9; for(let l=-40;l<=40;l++){ let s=0; for(let i=1.2*48000;i<1.6*48000;i++) s+=a[i]*b[i+l]; if(s>bv){bv=s;best=l;} } return best; };
    t.effects=[]; t.effectParams={}; t.output=undefined; state.project.buses=[]; const dry=await pcm(await PulseAudio.exportWav(state.project));
    t.effects=['pre73','fet76']; t.effectParams={pre73:{gain:0},fet76:{input:24,output:24}}; const tr=await pcm(await PulseAudio.exportWav(state.project));
    t.effects=[]; t.effectParams={}; t.output='g'; state.project.buses=[{id:'g',name:'G',volume:100,effects:['fet76'],effectParams:{fet76:{input:24,output:24}}}];
    const bu=await pcm(await PulseAudio.exportWav(state.project));
    return JSON.stringify([lag(dry,tr), lag(dry,bu)]) })()`));
  check(`piste 73 + 76 : calée sur le son sec (${g[0]} échantillons)`, g[0] === 0, String(g[0]));
  check(`groupe 76 : calé sur le son sec (${g[1]} échantillons)`, g[1] === 0, String(g[1]));
};
