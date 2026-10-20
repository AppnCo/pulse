import { boot, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, RAP);
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000; const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.3*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('v',b);
    state.project.tracks[1].clips=[{id:'v',start:0,duration:1,name:'Prise A'}]; renderAll(); })()`);
  await ev(`window.__dl.length=0`);
  await ev(`doExportStems()`); await sleep(1500);
  console.log('seule la piste Rec a du son : fichiers stems =', await ev(`JSON.stringify(window.__dl)`), '| message =', await ev(`document.getElementById('flash').textContent`));
  await ev(`window.__dl.length=0; state.project.tracks[2].clips=[{id:'v',start:0,duration:1,name:'x'}]; state.project.tracks[3].name='Lead'; state.project.tracks[3].clips=[{id:'v',start:0,duration:1,name:'x'}]; renderAll(); doExportStems()`); await sleep(2500);
  console.log('deux pistes nommées Lead :', await ev(`JSON.stringify(window.__dl)`));
  await ev(`window.__dl.length=0; exportProject(); `); await sleep(300);
  console.log('export complet (WAV) avec voix seulement sur Rec:'); await ev(`document.querySelector('.export-opt[data-fmt="wav"]')?.click()`); await sleep(2500);
  console.log(await ev(`JSON.stringify(window.__dl)`));
};
