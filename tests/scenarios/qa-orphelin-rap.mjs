// Modèle Rap Studio : « Sortir du groupe All Vocal » sur Rec supprime All Vocal et coupe le chemin vers Mix Bus 1 / limiteur
import { boot, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, RAP);
  const Ms = mouse(send);
  const rms = `const ctx=PulseAudio.getContext(); const sr=48000; const m=async()=>{const x=(await ctx.decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr*0.3;i<sr*0.8;i++)s+=x[i]*x[i]; return +Math.sqrt(s/(sr*0.5)).toFixed(4);};`;
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.2*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('ton',b);
    state.project.tracks[2].clips=[{id:'ton',start:0,duration:1}]; busById('mixbus1').volume=0; renderAll(); })()`);
  console.log('Mix Bus 1 à zéro, avant :', await ev(`(async()=>{${rms} return await m()})()`), '(attendu 0 : le son doit passer par Mix Bus 1)');
  const p = await pos(ev, '.track-item[data-i="1"]');
  await Ms.rclick(p.x, p.y); await sleep(150);
  const it = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item')].filter(e=>/Sortir du groupe/.test(e.textContent)).map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent}}))`));
  console.log('entrée:', JSON.stringify(it));
  await Ms.click(it[0].x, it[0].y); await sleep(400);
  console.log('groupes:', await ev(`JSON.stringify(state.project.buses.map(b=>b.id+'→'+b.output))`));
  console.log('après sortie de Rec :', await ev(`(async()=>{${rms} return await m()})()`), '(si > 0 : le son contourne Mix Bus 1)');
  await ev(`undoAction()`); await sleep(300);
  console.log('après ⌘Z :', await ev(`(async()=>{${rms} return await m()})()`), ' groupes:', await ev(`JSON.stringify(state.project.buses.map(b=>b.id+'→'+b.output))`));
};
