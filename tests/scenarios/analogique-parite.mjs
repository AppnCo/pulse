// Gamme Analogique (73 et 76) : mêmes chiffres que le moteur Rust (analogique_comme_le_navigateur), retard compensé
// (le son démarre pile à 1 s, sur une piste et sur un groupe). Son riche à 220 Hz qui commence à 1 s.
import { boot } from './qa-lib.mjs';
const CASES = [
  ['pre73', { gain: 20, output: -20, high: 4, mid: 3, midF: 3, low: 2, lowF: 1, hpf: 1 }, [0.099128, 0.099128, 0.027474]],
  ['pre73', { gain: 15, output: -15, variant: 1, lmid: 6, lmidF: 2, mid: -5, midF: 4, hiq: 1, high: 5, highF: 2, low: 3 }, [0.145194, 0.145194, 0.046324]],
  ['pre73', { gain: 20, output: -20, variant: 2, high: 3, hpf: 0 }, [0.102257, 0.102257, 0.019812]],
  ['fet76', { input: 36, output: 20, attack: 4, release: 5, ratio: 8 }, [0.043774, 0.043774, 0.012732]],
  ['fet76', { input: 40, output: 18, ratio: 0, mix: 70 }, [0.051816, 0.051816, 0.016344]],
  ['fet76', { input: 36, output: 22, ratio: 12, variant: 1 }, [0.050767, 0.050767, 0.012441]],
  ['fet76', { input: 36, output: 22, ratio: 4, variant: 2, mix: 60 }, [0.092849, 0.092849, 0.028566]],
  ['eqp1', { lowF: 2, lowBoost: 8, lowAtten: 6, highF: 4, highBoost: 5, bw: 3, attenF: 1, highAtten: 3 }, [0.109054, 0.109054, 0.040556]],
  ['busg', { thr: -24, ratio: 4, attack: 2, release: 4, makeup: 6, scHpf: 1 }, [0.076336, 0.076336, 0.022543]],
  ['busg', { thr: -20, ratio: 10, attack: 0, release: 1, makeup: 8, variant: 1, mix: 70 }, [0.118260, 0.118260, 0.035387]],
  ['tape', { input: 8, output: -6, speed: 0, machine: 1, bias: -30, noise: 30, wow: 60 }, [0.168613, 0.168633, 0.030798]],
  ['tape', { input: 4, machine: 2, bias: 20, noise: 60, wow: 80, mix: 75 }, [0.168641, 0.175706, 0.020833]],
  ['opto2a', { peak: 60, gain: 55, variant: 0 }, [0.086484, 0.082398, 0.018677]],
  ['opto2a', { peak: 45, limit: 1, emph: 50, variant: 2, mix: 80 }, [0.055303, 0.053787, 0.016746]],
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
    t.output=undefined; state.project.buses=[]; t.effects=['tape']; t.effectParams={tape:{noise:0,wow:0}}; const tp=await pcm(await PulseAudio.exportWav(state.project));
    return JSON.stringify([lag(dry,tr), lag(dry,bu), lag(dry,tp)]) })()`));
  check(`piste 73 + 76 : calée sur le son sec (${g[0]} échantillons)`, g[0] === 0, String(g[0]));
  check(`groupe 76 : calé sur le son sec (${g[1]} échantillons)`, g[1] === 0, String(g[1]));
  check(`Bande 80 : calée sur le son sec (${g[2]} échantillons)`, g[2] === 0, String(g[2]));
};
