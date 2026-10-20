import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, RAP, { w: 1000, h: 640 });
  await instru(ev, 8, 0, 0);
  await shot('/private/tmp/claude-501/qa/min-640.jpg');
  await ev(`toggleMixer()`); await sleep(600);
  await shot('/private/tmp/claude-501/qa/min-640-mixer.jpg');
  console.log(await ev(`JSON.stringify((()=>{const m=document.querySelector('.mixer.open'); const r=m.getBoundingClientRect(); const strip=document.querySelector('.mixer-strips .strip').getBoundingClientRect(); const tl=document.querySelector('.timeline').getBoundingClientRect(); return {mixTop:r.top,mixH:r.height,stripH:strip.height,timelineBottom:tl.bottom, tracksVisibleH:r.top-160}})())`));
};
