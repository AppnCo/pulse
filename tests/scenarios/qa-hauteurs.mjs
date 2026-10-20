import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, RAP);
  await instru(ev, 8, 0, 0);
  await ev(`state.project.tracks[2].clips=[{id:state.project.tracks[0].clips[0].id,name:'Lead clip',start:1,duration:3,peaks:state.project.tracks[0].clips[0].peaks}]; renderAll()`);
  for (const h of [24, 36, 48, 140, 260]) {
    await ev(`setTrackHeight(${h}, true)`); await sleep(300);
    console.log('hauteur', h, 'réelle', await ev(`document.querySelector('.track-item[data-i="2"]').getBoundingClientRect().height`),
      'débords:', await ev(`JSON.stringify([...document.querySelectorAll('.track-item[data-i="2"] *')].filter(e=>{const p=document.querySelector('.track-item[data-i="2"]').getBoundingClientRect(), r=e.getBoundingClientRect(); return r.width>0 && (r.bottom>p.bottom+1||r.top<p.top-1)}).map(e=>e.className||e.tagName).slice(0,6))`));
    await shot(`/private/tmp/claude-501/qa/h-${h}.jpg`);
  }
  await ev(`setTrackHeight(72, true)`);
  // zoom extrêmes
  for (const z of [1, 2, 400, 2000]) {
    await ev(`setZoom(${z}, 0)`); await sleep(300);
    console.log('zoom', z, 'réel', await ev(`state.pxPerSecond`), 'largeur piste', await ev(`document.querySelector('.timeline-track').getBoundingClientRect().width`), 'canvas/svg clip', await ev(`document.querySelectorAll('.clip').length`));
  }
  await shot('/private/tmp/claude-501/qa/zoom-max.jpg');
};
