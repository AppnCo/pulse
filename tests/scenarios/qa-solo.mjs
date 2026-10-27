import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 's', name: 'S', bpm: 120, buses: [{ id: 'g1', name: 'G', isGroup: true, output: 'master', color: '#A855F7', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', volume: 100, output: 'g1', clips: [] }, { name: 'B', type: 'audio', color: '#22D3EE', volume: 100, output: 'g1', clips: [] }, { name: 'C', type: 'audio', color: '#34D399', volume: 100, output: 'master', clips: [] }] });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000; const mk=(id,f,a)=>{const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=a*Math.sin(2*Math.PI*f*i/sr); PulseAudio.registerBuffer(id,b);}; mk('a',300,0.1); mk('b',500,0.2); mk('c',700,0.4);
    state.project.tracks.forEach((t,i)=>t.clips=[{id:['a','b','c'][i],start:0,duration:1}]); renderAll(); })()`);
  const rms = `(async()=>{ const ctx=PulseAudio.getContext(); const sr=48000; const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr*0.3;i<sr*0.8;i++)s+=x[i]*x[i]; return +(Math.sqrt(s/(sr*0.5))*Math.SQRT2).toFixed(3); })()`;
  const set = (code) => ev(`(()=>{ state.project.tracks.forEach(t=>{t.muted=false;t.solo=false}); state.project.buses.forEach(b=>b.muted=false); ${code}; PulseAudio.refreshAudibility(state.project); })()`);
  const cases = [
    ['rien', ``, 'A+B+C = 0.7'],
    ['solo A', `state.project.tracks[0].solo=true`, '0.1'],
    ['solo C', `state.project.tracks[2].solo=true`, '0.4'],
    ['solo A + solo C', `state.project.tracks[0].solo=true; state.project.tracks[2].solo=true`, '0.5'],
    ['mute A', `state.project.tracks[0].muted=true`, '0.6'],
    ['mute A + solo A', `state.project.tracks[0].muted=true; state.project.tracks[0].solo=true`, '? (Logic: solo gagne -> 0.1, ou muet -> 0)'],
    ['groupe muet', `state.project.buses[0].muted=true`, '0.4'],
    ['groupe muet + solo A', `state.project.buses[0].muted=true; state.project.tracks[0].solo=true`, '? '],
    ['solo B + mute B', `state.project.tracks[1].muted=true; state.project.tracks[1].solo=true`, '?'],
  ];
  for (const [label, code, exp] of cases) { await set(code); console.log(label.padEnd(24), await ev(rms), '  attendu:', exp); }
};
