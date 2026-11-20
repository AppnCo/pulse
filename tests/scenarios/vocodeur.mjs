// Vocodeur : mêmes chiffres que le moteur Rust (vocodeur_comme_le_navigateur), dans la liste des effets, sa fenêtre s'ouvre,
// les boutons changent les réglages et le son. Son riche à 220 Hz qui commence à 1 s.
import { boot } from './qa-lib.mjs';
const CASES = [[{}, [0.118788, 0.11544, 0.03272]], [{ mode: 1, note: 45, chord: 3, formant: -3, air: 60 }, [0.155676, 0.154344, 0.036176]],
  [{ chord: 4, bands: 12, formant: 5, speed: 90, tone: 40, mix: 70 }, [0.090683, 0.088519, 0.039121]]];
export default async (c) => {
  const { ev, check, sleep } = c;
  await boot(c, { id: 'vc1', name: 'VC', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,3*sr,sr),d=b.getChannelData(0);
    for(let i=0;i<3*sr;i++) d[i] = i<sr ? 0 : (((i*220/sr)%1)*0.6-0.3); PulseAudio.registerBuffer('vc',b);
    state.project.tracks[0].clips=[{id:'vc',start:0,duration:3,offset:0}]; })()`);
  for (const [pp, want] of CASES) {
    const r = JSON.parse(await ev(`(async()=>{ const t=state.project.tracks[0]; t.effects=['vocoder']; t.effectParams={vocoder:${JSON.stringify(pp)}};
      const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
      const rms=(a,z)=>{let s=0; const i0=Math.round(a*48000),i1=Math.round(z*48000); for(let i=i0;i<i1;i++) s+=L[i]*L[i]; return Math.sqrt(s/(i1-i0));};
      let hf=0; for(let i=1.2*48000;i<1.8*48000;i++){ const v=L[i]-2*L[i-1]+L[i-2]; hf+=v*v; }
      return JSON.stringify([rms(1.2,1.8),rms(2.0,2.6),Math.sqrt(hf/(0.6*48000))].map(v=>+v.toFixed(6))) })()`));
    const ok = r.every((v, k) => Math.abs(v - want[k]) < want[k] * 0.01 + 2e-5);
    check(`parité ${JSON.stringify(pp)}`, ok, `${JSON.stringify(r)} / Rust ${JSON.stringify(want)}`);
  }
  // dans la liste des effets (catégorie Voix et hauteur) et sa fenêtre
  const inList = await ev(`ADD_FX_CATEGORIES.some(([n, l]) => n === 'Voix et hauteur' && l.includes('vocoder')) && FX_NAMES.vocoder === 'Vocodeur'`);
  check('Vocodeur dans « Voix et hauteur »', inList === true, String(inList));
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effects=['vocoder']; t.effectParams={}; openEffectPanel(0,'vocoder',document.body); })()`);
  await sleep(300);
  const ui = JSON.parse(await ev(`(()=>{ const p=document.querySelector('.voc-panel'); if(!p) return '{}';
    const r=p.getBoundingClientRect(); return JSON.stringify({ ok:true, w:r.width, h:r.height, bars:p.querySelectorAll('.voc-svg rect').length, knobs:p.querySelectorAll('.pk').length,
      inView: r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight }) })()`));
  check('la fenêtre s’ouvre, entière à l’écran', ui.ok && ui.inView, JSON.stringify(ui));
  check('bandes et 7 boutons', ui.bars > 20 && ui.knobs === 7, JSON.stringify(ui));
  const after = JSON.parse(await ev(`(()=>{ const p=document.querySelector('.voc-panel'); p.querySelector('.voc-mode[data-v="1"]').click(); p.querySelector('.voc-chord[data-v="3"]').click();
    const t=state.project.tracks[0]; const a={...t.effectParams.vocoder}; p.querySelector('.voc-look[data-i="0"]').click(); return JSON.stringify([a, {...t.effectParams.vocoder}, p.querySelector('.sat-big').textContent]); })()`));
  check('Note fixe + Mineur enregistrés', after[0].mode === 1 && after[0].chord === 3, JSON.stringify(after[0]));
  check('préréglage Robot rap appliqué', after[1].mode === 1 && after[1].chord === 0 && after[1].bands === 20, JSON.stringify(after[1]));
  check('la note jouée est écrite', /Note fixe : Do3/.test(after[2]), after[2]);
};
