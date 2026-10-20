// Export : la queue de reverb / écho est-elle gardée quand l'envoi vient d'un GROUPE ?
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 'q', name: 'Q', bpm: 120, buses: [{ id: 'g1', name: 'G', isGroup: true, output: 'master', color: '#A855F7', volume: 100 }],
    sends: [{ id: 'revlong', type: 'reverb', name: 'Rev Long', volume: 100 }, { id: 'del14', type: 'delay', name: 'Del 1/4', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', volume: 100, output: 'g1', clips: [] }] });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000; const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr/4;i++)d[i]=0.5*Math.sin(2*Math.PI*300*i/sr)*(1-i/(sr/4)); PulseAudio.registerBuffer('a',b);
    state.project.tracks[0].clips=[{id:'a',start:0,duration:1}]; renderAll(); })()`);
  const dur = (label, code) => ev(`(async()=>{ ${code}; const w=await PulseAudio.exportWav(state.project,{}); const ab=await w.arrayBuffer(); const v=new DataView(ab); const n=v.getUint32(40,true)/ (v.getUint16(22,true)*2); const sr=v.getUint32(24,true); return ${JSON.stringify(label)}+' : '+(n/sr).toFixed(2)+' s'; })()`).then(console.log);
  await dur('aucun envoi', `0`);
  await dur('envoi Rev Long sur la PISTE (50)', `state.project.tracks[0].sends={revlong:50}`);
  await dur('envoi Rev Long sur le GROUPE (50)', `state.project.tracks[0].sends={}; state.project.buses[0].sends={revlong:50}`);
  await dur('envoi Echo sur le GROUPE (50)', `state.project.buses[0].sends={del14:50}`);
  await dur('envoi Echo sur la PISTE (50)', `state.project.buses[0].sends={}; state.project.tracks[0].sends={del14:50}`);
  await dur('effet reverb sur le GROUPE', `state.project.tracks[0].sends={}; state.project.buses[0].effects=['reverb']`);
};
