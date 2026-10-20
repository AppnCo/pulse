// Clic droit sur une région : « Supprimer le fondu » retire celui du côté cliqué (fondu simple ou enchaîné)
import { boot, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, { id: 'fs', name: 'FS', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000;
    const b=ctx.createBuffer(1,sr*6,sr); for(let i=0;i<b.length;i++) b.getChannelData(0)[i]=0.3*Math.sin(i/30); PulseAudio.registerBuffer('s',b);
    state.project.tracks[0].clips=[{id:'s',name:'1',start:0,duration:3,offset:0},{id:'s',name:'2',start:2.5,duration:3.5,offset:1.5,fadeOut:1}]; renderAll(); })()`);
  await sleep(300);
  const Ms = mouse(send);
  const menu = async (frac) => {
    const r = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="1"]').getBoundingClientRect(); return {x:r.left+r.width*${frac}, y:r.top+r.height*0.6}})())`));
    await Ms.rclick(r.x, r.y); await sleep(200);
    return JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.clip-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).filter(t=>/fondu/i.test(t)))`));
  };
  const left = await menu(0.3);
  console.log('entrées « fondu » (moitié gauche) :', JSON.stringify(left));
  await ev(`[...document.querySelectorAll('.clip-ctx-menu .ctx-item')].find(e=>/fondu enchaîné \\(début\\)/.test(e.textContent)).click()`); await sleep(300);
  const c2 = await ev(`JSON.stringify(state.project.tracks[0].clips.find(c=>c.name==='2'))`);
  console.log('région 2 après :', c2);
  const j = JSON.parse(c2);
  if (Math.abs(j.start - 3) > 0.01 || Math.abs(j.offset - 2) > 0.01) throw new Error('Le fondu enchaîné n\'est pas retiré');
  const right = await menu(0.9);
  console.log('entrées « fondu » (moitié droite) :', JSON.stringify(right));
  await ev(`[...document.querySelectorAll('.clip-ctx-menu .ctx-item')].find(e=>/fondu de sortie/.test(e.textContent)).click()`); await sleep(300);
  console.log('fadeOut après :', await ev(`state.project.tracks[0].clips.find(c=>c.name==='2').fadeOut`));
};
