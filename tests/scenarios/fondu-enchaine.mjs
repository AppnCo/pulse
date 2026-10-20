// Deux régions qui se chevauchent : fondu enchaîné automatique (le niveau reste régulier dans la zone commune)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'xf', name: 'XF', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] });
  const r = await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000;
    const b=ctx.createBuffer(1,sr*3,sr), d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.3*Math.sin(2*Math.PI*300*i/sr);
    PulseAudio.registerBuffer('t',b);
    const p={bpm:120,buses:[],sends:[],tracks:[{volume:100,clips:[{id:'t',start:0,duration:3},{id:'t',start:2,duration:3}]}]};
    const w=await PulseAudio.exportWav(p,{normalize:false}); const x=(await ctx.decodeAudioData(await w.arrayBuffer())).getChannelData(0);
    const rms=(a,z)=>{let s=0; for(let i=Math.floor(a*sr);i<Math.floor(z*sr);i++)s+=x[i]*x[i]; return Math.sqrt(s/((z-a)*sr));};
    return JSON.stringify({seul:+rms(0.5,1.5).toFixed(4), debut:+rms(2.0,2.2).toFixed(4), milieu:+rms(2.4,2.6).toFixed(4), fin:+rms(2.8,3.0).toFixed(4)}) })()`);
  console.log('niveaux (seul / début / milieu / fin du chevauchement) :', r);
  const j = JSON.parse(r);
  // sans fondu enchaîné le milieu serait ~2× (deux sons identiques en phase) ; avec : proche du niveau seul
  if (!(j.milieu < j.seul * 1.5)) throw new Error('Pas de fondu enchaîné : le milieu est trop fort');
};
