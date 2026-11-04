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
  ['l670', { input: 6, thr: 7, tc: 1, output: -2 }, [0.048365, 0.048365, 0.014093]],
  ['l670', { input: 10, thr: 5, tc: 5, output: -6, mix: 60 }, [0.083014, 0.083014, 0.025757]],
  ['dtr', { input: 6, output: 5, attack: 3, release: 4, ratio: 3, detHp: 1 }, [0.058205, 0.058205, 0.017068]],
  ['dtr', { input: 8, output: 3, attack: 1, release: 2, ratio: 7, dist: 2, detBand: 1, mix: 50 }, [0.065966, 0.065966, 0.021673]],
  ['stripe', { hpf: 80, lf: 4, lfF: 100, lmf: -3, lmfF: 400, lmfQ: 1.5, hmf: 5, hmfF: 3000, hf: 3, hfF: 10000, cthr: -24, cratio: 4, crel: 0.3 }, [0.031504, 0.031382, 0.011917]],
  ['stripe', { variant: 1, lpf: 12, hmf: 8, hmfF: 2000, hmfQ: 2, hfBell: 1, hf: -4, hfF: 6000, gthr: -40, grange: 20, cthr: -20, cratio: 20, cfast: 1, dynPre: 1, output: 4 }, [0.070925, 0.070925, 0.010359]],
  ['eq550', { lf: 4, lfF: 1, mf: 6, mfF: 3, hf: 4, hfF: 3 }, [0.131791, 0.131791, 0.053026]],
  ['eq550', { lf: -6, lfF: 2, lfPeak: 1, mf: -4, mfF: 1, hf: 8, hfF: 5, hfPeak: 1, band: 1, output: -3 }, [0.054618, 0.054618, 0.034231]],
  ['comp25', { thr: -18, ratio: 3, attack: 3, release: 3, knee: 1, thrust: 1, makeup: 6 }, [0.114105, 0.114101, 0.033354]],
  ['comp25', { thr: -14, ratio: 5, attack: 1, release: 6, relVar: 0.8, knee: 0, thrust: 2, feedback: 1, makeup: 8, mix: 70 }, [0.141093, 0.141094, 0.042066]],
  ['bus33', { cthr: -18, cratio: 2, crec: 4, makeup: 5 }, [0.147440, 0.147441, 0.042710]],
  ['bus33', { cthr: -16, cratio: 4, crec: 1, lon: 1, lthr: -6, lrec: 5, makeup: 8, mix: 80 }, [0.171531, 0.171500, 0.050472]],
  ['massif', { g1: 3, f1: 60, bw1: 4, g2: -2, f2: 300, bw2: 3, g3: 3, f3: 3000, bw3: 5, g4: 4, f4: 16000, bw4: 6, hpf: 0 }, [0.108726, 0.108726, 0.045409]],
  ['massif', { g1: -4, f1: 200, shelf1: 0, bw1: 7, g4: -3, f4: 8000, shelf4: 0, bw4: 2, lpf: 1, output: 2 }, [0.118539, 0.118539, 0.020230]],
  ['horizon', { g1: 3, f1: 60, g3: -2, f3: 400, q3: 1.5, g4: 3, f4: 3000, typ4: 1, g5: 2, f5: 12000, earth: 4, air: 5, char: 0.5, hpOn: 1, hpF: 30, hpS: 3 }, [0.119347, 0.119347, 0.066285]],
  ['horizon', { g2: 5, f2: 200, q2: 0.8, g3: 4, f3: 2500, ch3: 1, char: -0.7, strength: 130, lpOn: 1, lpF: 9000, lpS: 0, input: -3, output: 2 }, [0.193790, 0.193790, 0.016294]],
  ['plate', { decay: 2.5, pre: 30, bright: 70, lowcut: 120, mix: 40 }, [0.134996, 0.135534, 0.035645]],
  ['plate', { decay: 1.2, pre: 0, bright: 40, lowcut: 60, width: 140, mix: 60, variant: 1 }, [0.059170, 0.062295, 0.026672]],
  ['techo', { mode: 3, rate: 1.2, intensity: 55, bass: -2, treble: -3, echo: 35, spring: 25, input: -3 }, [0.244318, 0.229543, 0.057974]],
  ['techo', { mode: 6, rate: 0.7, intensity: 90, echo: 70, spring: 0, wow: 80 }, [0.171493, 0.227827, 0.060108]],
  ['hall80', { decay: 2.5, pre: 30, size: 100, bass: 1.5, xover: 500, treble: 7000, diffusion: 70, spin: 40, mix: 40 }, [0.134083, 0.137743, 0.034674]],
  ['hall80', { decay: 1.0, pre: 10, size: 70, bass: 0.8, treble: 4000, diffusion: 90, spin: 80, width: 130, mix: 60, variant: 2 }, [0.105457, 0.100519, 0.023421]],
  ['h910', { pitchL: 0.09, pitchR: -0.09, delay: 12, mix: 35 }, [0.104098, 0.116562, 0.038046]],
  ['h910', { pitchL: 7, pitchR: -5, delay: 40, feedback: 50, mix: 50, variant: 1 }, [0.124564, 0.125594, 0.036002]],
  ['dim', { mode: 1, mix: 100 }, [0.134686, 0.139287, 0.045639]],
  ['dim', { mode: 3, mix: 80, width: 130, variant: 1 }, [0.208333, 0.116070, 0.047483]],
  ['prev76', { gain: 24, output: -22, lowcut: 1, soft: 1 }, [0.104485, 0.104485, 0.013591]],
  ['prev76', { gain: 18, output: -16, variant: 1 }, [0.134893, 0.134892, 0.017656]],
  ['eclat', { intensity: 7, output: -2, noise: 40 }, [0.097129, 0.097129, 0.038122]],
  ['eclat', { intensity: 10, noise: 0, variant: 1 }, [0.123245, 0.123245, 0.051188]],
  ['souffle', { mid: 60, high: 80, trim: -2 }, [0.097694, 0.097693, 0.053265]],
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
