// Mouvement calé sur le tempo : bouton « ♪ Note » dans la fenêtre, et le son exporté = la même vitesse en Hz (1/8 à 120 BPM = 4 Hz),
// comme le moteur Rust (mouvement_cale_sur_le_tempo).
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'mt1', name: 'MT', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['tremolo'], effectParams: { tremolo: { rate: 5, depth: 80 } } }] }, { mic: false });
  await ev(`openEffectPanel(0,'tremolo',document.body)`); await sleep(400);
  await ev(`document.querySelector('.mod-panel .mod-sync[data-s="1"]').click()`); await sleep(200);
  const p1 = JSON.parse(await J(ev, `return JSON.stringify(state.project.tracks[0].effectParams.tremolo)`));
  check('♪ Note : calé sur le tempo, note la plus proche de 5 Hz (1/8 T à 120 BPM)', p1.sync === 1 && Math.abs(p1.beats - 1 / 3) < 1e-6, JSON.stringify(p1));
  await ev(`document.querySelector('.mod-panel .mod-div[data-b="0.5"]').click()`); await sleep(200);
  check('choix 1/8', await J(ev, `return state.project.tracks[0].effectParams.tremolo.beats`) === 0.5);
  check('affichage en notes', /♪ 1\/8 · 4 Hz/.test(await J(ev, `return document.querySelector('.mod-panel .mod-v').textContent`)));
  const r = JSON.parse(await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000, b=ctx.createBuffer(1,sr*2,sr), d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.25*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('mt',b);
    const pcm=async(tp)=>{ const p={bpm:120,buses:[],tracks:[{volume:100,clips:[{id:'mt',start:0,duration:2}],effects:['tremolo'],effectParams:{tremolo:tp}}]}; const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer()); return x.getChannelData(0); };
    const a=await pcm({rate:0.3,depth:80,sync:1,beats:0.5}), z=await pcm({rate:4,depth:80}); let m=0; for(let i=0;i<a.length;i++) m=Math.max(m,Math.abs(a[i]-z[i])); return JSON.stringify(m) })()`));
  check('son : 1/8 à 120 BPM = 4 Hz', r < 1e-4, String(r));
  await ev(`document.querySelector('.mod-panel .mod-sync[data-s="0"]').click()`); await sleep(200);
  const p2 = JSON.parse(await J(ev, `return JSON.stringify(state.project.tracks[0].effectParams.tremolo)`));
  check('retour en Hz : garde la vitesse (4 Hz)', p2.sync === 0 && p2.rate === 4, JSON.stringify(p2));
};
