import { boot, instru, RAP, key, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, RAP);
  const K = key(send), Ms = mouse(send);
  await ev(`busById('vocal1').collapsed=true; busById('back').collapsed=true; renderAll(); state.selectedTrack=1; renderAll()`); await sleep(300);
  const vis = () => ev(`[...document.querySelectorAll('.track-item')].filter(e=>!e.classList.contains('is-group-collapsed')&&e.offsetHeight>0).map(e=>e.dataset.i+':'+e.querySelector('.track-name').textContent.trim().replace(/\\s+/g,' ')).join(', ')`);
  console.log('visibles:', await vis());
  for (let i = 0; i < 3; i++) { await K('ArrowDown'); await sleep(120); console.log('↓ => selectedTrack =', await ev(`state.selectedTrack+' '+state.project.tracks[state.selectedTrack].name`), ' visible=', await ev(`!document.querySelector('.track-item[data-i="'+state.selectedTrack+'"]').classList.contains('is-group-collapsed') && document.querySelector('.track-item[data-i="'+state.selectedTrack+'"]').offsetHeight>0`)); }
  // M agit sur la piste cachée
  await K('m'); await sleep(150);
  console.log('M => pistes muettes:', await ev(`state.project.tracks.filter(t=>t.muted).map(t=>t.name).join(',')`));
};
