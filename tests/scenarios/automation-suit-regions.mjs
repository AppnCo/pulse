// Réglage « L'automation suit les régions » : les points sous la région partent avec elle ; éteint (par défaut), rien ne bouge
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  const proj = { id: 'p', name: 'P', bpm: 120, sends: [], buses: [], tracks: [
    { name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'a', name: 'A', start: 2, duration: 2, offset: 0 }],
      automation: { pan: { points: [{ t: 0, v: 0.5 }, { t: 2.5, v: 1 }, { t: 3.5, v: 0 }, { t: 8, v: 0.5 }] } } },
    { name: 'B', type: 'audio', color: '#22D3EE', clips: [] }] };
  const drag = (dx) => ev(`(async()=>{
    setSnapMode('off', true);
    const ME=(t,x,y)=>new MouseEvent(t,{bubbles:true,clientX:x,clientY:y,button:0});
    const el=document.querySelector('.timeline-track[data-i="0"] .clip'); const r=el.getBoundingClientRect();
    const x0=r.left+r.width/2, y0=r.top+r.height*0.25, px=state.pxPerSecond;
    el.dispatchEvent(ME('mousedown',x0,y0)); document.dispatchEvent(ME('mousemove',x0+4,y0));
    document.dispatchEvent(ME('mousemove',x0+px*${dx},y0)); document.dispatchEvent(ME('mouseup',x0+px*${dx},y0));
    await new Promise(r=>setTimeout(r,150));
    return JSON.stringify({ start: state.project.tracks[0].clips[0].start, pts: state.project.tracks[0].automation.pan.points.map(p=>[p.t,p.v]) }); })()`).then(JSON.parse);
  await boot(c, proj);
  let r = await drag(4);
  check('réglage éteint (défaut) : la courbe ne bouge pas', r.start > 5.5 && JSON.stringify(r.pts) === JSON.stringify([[0, 0.5], [2.5, 1], [3.5, 0], [8, 0.5]]), JSON.stringify(r));
  await boot(c, proj, { ls: { pulse_auto_follow_regions: '1' } });
  r = await drag(4);
  const at = (t) => { const p = r.pts.slice().sort((a, b) => a[0] - b[0]); if (t <= p[0][0]) return p[0][1]; for (let i = 1; i < p.length; i++) if (t <= p[i][0]) { const [ta, va] = p[i - 1], [tb, vb] = p[i]; return tb === ta ? vb : va + (vb - va) * (t - ta) / (tb - ta); } return p[p.length - 1][1]; };
  check('réglage allumé : les points partent avec la région (+4 s)', Math.abs(at(6.5) - 1) < 0.02 && Math.abs(at(7.5) - 0) < 0.02, JSON.stringify(r));
  check('autour, la courbe d’avant reste (avant la région, au début)', Math.abs(at(1) - (0.5 + 0.5 * 1 / 2.5)) < 0.05, JSON.stringify(r));
  check('après la région, la courbe d’avant reprend (point à 8 s gardé)', Math.abs(at(8.5) - 0.5) < 0.02, JSON.stringify(r));
};
