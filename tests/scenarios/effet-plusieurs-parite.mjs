// Le même effet plusieurs fois (« util », « util#2 »…) : mêmes résultats que le moteur Rust (effet_plusieurs_fois, deux_pitch_retard_compense)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, check } = c;
  await boot(c, { id: 'ep1', name: 'EP', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000;
    const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++) d[i]=0.1*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('ep',b);
    const s=ctx.createBuffer(1,3*sr,sr),e=s.getChannelData(0); for(let i=0;i<3*sr;i++) e[i]= i<sr?0:(((i*220/sr)%1)*0.6-0.3); PulseAudio.registerBuffer('es',s); })()`);
  const peak = async (fx, clip = 'ep', dur = 1) => JSON.parse(await ev(`(async()=>{ const t=state.project.tracks[0]; t.clips=[{id:'${clip}',start:0,duration:${dur},offset:0}];
    Object.assign(t, {effects:[],effectParams:{},fxOrder:undefined,automation:{}}, ${fx});
    const w=await PulseAudio.exportTrackWav(state.project,0); const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0);
    let m=0; for(let i=24000;i<47000;i++) m=Math.max(m,Math.abs(L[i])); let on=0; while(on<L.length && Math.abs(L[on])<=0.02) on++;
    return JSON.stringify([m,on/48000]) })()`));
  const [base] = await peak('{}');
  const db = (x) => 20 * Math.log10(x / base);
  const [one] = await peak(`{effects:['util'],effectParams:{util:{gain:6}}}`);
  const [two] = await peak(`{effects:['util','util#2'],effectParams:{util:{gain:6},'util#2':{gain:6}}}`);
  const [back] = await peak(`{effects:['util','util#2'],effectParams:{util:{gain:6},'util#2':{gain:-6}}}`);
  const [auto] = await peak(`{effects:['util','util#2'],effectParams:{util:{gain:6},'util#2':{gain:0}},automation:{'fx:util#2:gain':{points:[{t:0,v:0.75}]}}}`);
  const [a] = await peak(`{effects:['sat','util','sat#2'],fxOrder:['sat','util','sat#2'],effectParams:{sat:{drive:0},util:{gain:12},'sat#2':{drive:80}}}`);
  const [b] = await peak(`{effects:['sat','util','sat#2'],fxOrder:['sat#2','util','sat'],effectParams:{sat:{drive:0},util:{gain:12},'sat#2':{drive:80}}}`);
  check(`un Utilitaire +6 : ${db(one).toFixed(2)} dB`, Math.abs(db(one) - 6) < 0.05);
  check(`deux Utilitaires +6 : ${db(two).toFixed(2)} dB (12)`, Math.abs(db(two) - 12) < 0.05);
  check(`+6 puis −6 : ${db(back).toFixed(2)} dB (0)`, Math.abs(db(back)) < 0.05);
  check(`automation du 2e seulement : ${db(auto).toFixed(2)} dB (18)`, Math.abs(db(auto) - 18) < 0.1);
  check(`l'ordre des exemplaires compte : ${a.toFixed(3)} / ${b.toFixed(3)}`, Math.abs(a - b) > 0.01);
  const [, on] = await peak(`{effects:['pitch','pitch#2'],effectParams:{pitch:{semi:5},'pitch#2':{semi:-5}}}`, 'es', 3);
  check(`deux Pitch : la voix démarre à sa place (${on} s)`, Math.abs(on - 1) < 0.004);
};
