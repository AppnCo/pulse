// Une région posée sur une autre est prioritaire : elle coupe ce qui est derrière (comme Logic)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'pr', name: 'PR', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [
    { id: 'a', name: 'Fond', start: 0, duration: 6, offset: 0 },
    { id: 'b', name: 'Dessus', start: 8, duration: 2, offset: 0 }] }] });
  const out = await ev(`(async()=>{
    setSnapMode('off',true);
    const ME=(t,x,y)=>new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,button:0});
    const el=document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="1"]'); const r=el.getBoundingClientRect();
    const x0=r.left+r.width/2, y0=r.top+r.height/2, px=state.pxPerSecond;
    el.dispatchEvent(ME('mousedown',x0,y0));
    document.dispatchEvent(ME('mousemove',x0-px*1,y0));
    document.dispatchEvent(ME('mousemove',x0-px*5,y0));     // 8 → 3 s : recouvre la fin du fond (3 → 5)
    document.dispatchEvent(ME('mouseup',x0-px*5,y0));
    await new Promise(r=>setTimeout(r,100));
    return JSON.stringify(state.project.tracks[0].clips.map(c=>[c.name, +c.start.toFixed(2), +c.duration.toFixed(2)])) })()`);
  console.log('après avoir posé « Dessus » sur « Fond » :', out);
  const j = JSON.parse(out);
  const fond = j.find(c => c[0] === 'Fond'), dessus = j.find(c => c[0] === 'Dessus');
  if (!fond || !dessus || Math.abs(fond[2] - 3) > 0.05) throw new Error('Le fond n\'est pas coupé là où la région est posée');
};
