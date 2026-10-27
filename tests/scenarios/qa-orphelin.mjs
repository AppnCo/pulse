// Groupe imbriqué : sortir la dernière piste directe du groupe parent laisse un sous-groupe orphelin
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, { id: 'g', name: 'G', bpm: 120, buses: [
      { id: 'g1', name: 'Voix', isGroup: true, output: 'master', color: '#A855F7', volume: 100 },
      { id: 'g3', name: 'Sous', isGroup: true, output: 'g1', color: '#22D3EE', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', volume: 100, output: 'g1', clips: [] },
      { name: 'C', type: 'audio', color: '#34D399', volume: 100, output: 'g3', clips: [] }] });
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{try{${code}}catch(e){return 'EXC '+e.stack}})()`));
  const rms = `const ctx=PulseAudio.getContext(); const sr=48000; const m=async()=>{const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr*0.3;i<sr*0.8;i++)s+=x[i]*x[i]; return +Math.sqrt(s/(sr*0.5)).toFixed(4);};`;
  await R('prépare', `await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.2*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('ton',b);
    state.project.tracks[1].clips=[{id:'ton',start:0,duration:1}]; renderAll(); return 'ok'`);
  await R('avant : rms', `${rms} return await m()`);
  await R('sortir A de Voix', `${rms} removeTrackFromGroup(0); await new Promise(r=>setTimeout(r,300)); return JSON.stringify(state.project.buses.map(b=>b.id+'→'+b.output))+' rms='+await m()+' en-têtes='+[...document.querySelectorAll('.group-header .group-name')].map(e=>e.textContent)`);
  await shot('/private/tmp/claude-501/qa/orphelin.jpg');
};
