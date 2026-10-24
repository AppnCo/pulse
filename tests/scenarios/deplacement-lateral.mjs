// Shift pendant le déplacement : surtout latéral → la région reste sur sa piste et glisse dans le temps
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 'dl', name: 'DL', bpm: 120, buses: [], tracks: [
    { name: 'Voix', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'A', start: 2, duration: 3, offset: 0 }] },
    { name: 'Back', type: 'audio', color: '#22D3EE', clips: [] }] });
  const out = await ev(`(async()=>{
    setSnapMode('grid',true); state.gridRes='beat';
    const ME=(t,x,y)=>new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,button:0});
    const el=document.querySelector('.timeline-track[data-i="0"] .clip'); const r=el.getBoundingClientRect();
    const t2=document.querySelector('.timeline-track[data-i="1"]').getBoundingClientRect();
    const x0=r.left+r.width/2, y0=r.top+r.height*0.25, px=state.pxPerSecond;   // moitié haute = déplacer (la basse = sélection)
    el.dispatchEvent(ME('mousedown',x0,y0));
    document.dispatchEvent(ME('mousemove',x0+4,y0+2));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true}));
    document.dispatchEvent(ME('mousemove',x0+px*3,y0+20));          // surtout latéral, un peu vers le bas
    document.dispatchEvent(ME('mousemove',x0+px*3,t2.top+10));      // le pointeur est sur la piste 2 mais l'axe est verrouillé
    document.dispatchEvent(ME('mouseup',x0+px*3,t2.top+10));
    await new Promise(r=>setTimeout(r,100));
    return JSON.stringify({p1:state.project.tracks[0].clips.map(c=>c.start), p2:state.project.tracks[1].clips.length}) })()`);
  console.log('résultat :', out);
  const j = JSON.parse(out);
  if (j.p2 !== 0 || j.p1.length !== 1 || !(j.p1[0] > 2)) throw new Error('Le verrou latéral ne tient pas');
};
