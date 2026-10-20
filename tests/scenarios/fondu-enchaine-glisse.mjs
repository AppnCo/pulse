// Tirer la poignée de fondu dans l'autre sens, contre une région voisine : fondu enchaîné
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 'xg', name: 'XG', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  const out = await ev(`(async()=>{
    await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000;
    const b=ctx.createBuffer(1,sr*6,sr); for(let i=0;i<b.length;i++) b.getChannelData(0)[i]=0.3*Math.sin(i/30);
    PulseAudio.registerBuffer('s',b);
    state.project.tracks[0].clips=[{id:'s',name:'1',start:0,duration:3,offset:0},{id:'s',name:'2',start:3,duration:3,offset:2}];
    renderAll(); await new Promise(r=>setTimeout(r,200));
    const ME=(t,x,y)=>new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,button:0});
    const z=document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="1"] .clip-fade-zone.in'); const r=z.getBoundingClientRect();
    const x0=r.left+r.width/2, y0=r.top+r.height/2, px=state.pxPerSecond;
    z.dispatchEvent(ME('mousedown',x0,y0));
    document.dispatchEvent(ME('mousemove',x0-px*0.5,y0));
    document.dispatchEvent(ME('mouseup',x0-px*0.5,y0));
    await new Promise(r=>setTimeout(r,150));
    const c2=state.project.tracks[0].clips.find(c=>c.name==='2');
    return JSON.stringify({start:+c2.start.toFixed(2), offset:+c2.offset.toFixed(2), duration:+c2.duration.toFixed(2)}) })()`);
  console.log('région 2 après avoir tiré le fondu vers la gauche :', out);
  const j = JSON.parse(out);
  if (!(j.start < 3 && j.offset < 2 && j.duration > 3)) throw new Error('Pas de fondu enchaîné créé');
};
