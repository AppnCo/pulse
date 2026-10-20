import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  for (const [w, h] of [[1440, 860], [1440, 760], [1920, 1080], [1280, 720]]) {
    await boot(c, RAP, { w, h });
    await ev(`toggleMixer()`); await sleep(500);
    console.log(w + 'x' + h, await ev(`JSON.stringify((()=>{ const m=document.querySelector('.mixer-panel, #mixer, .mixer')||document.getElementById('mixerPanel'); const mr=m.getBoundingClientRect();
      const strips=[...document.querySelectorAll('.mixer-strips .strip')].map(s=>{const r=s.getBoundingClientRect(); const f=s.querySelector('.strip-foot, .strip-out, .strip-dest'); return {n:(s.querySelector('.strip-name')||s).textContent.trim().slice(0,10), b:Math.round(r.bottom), sh:s.scrollHeight, ch:s.clientHeight}});
      return {mixerCls:m.className||m.id, top:Math.round(mr.top), bottom:Math.round(mr.bottom), vh:innerHeight, strips} })())`));
    if (w === 1440 && h === 760) await shot('/private/tmp/claude-501/qa/mixer-760.jpg');
  }
};
