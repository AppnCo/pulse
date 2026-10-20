import { boot, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  const Ms = mouse(send);
  const p = await pos(ev, '#inspector .insp-pan-input');
  await Ms.M('mouseMoved', p.x, p.y); await sleep(800);
  await shot('/private/tmp/claude-501/qa/tt-pan.jpg');
  const q = await pos(ev, '.brand-mini');
  await Ms.M('mouseMoved', q.x, q.y); await sleep(800);
  await shot('/private/tmp/claude-501/qa/tt-brand.jpg');
  const r = await pos(ev, '.track-item[data-i="2"] .track-resize');
  console.log(JSON.stringify(r), await ev(`document.querySelector('.track-item[data-i="2"] .track-resize').outerHTML.slice(0,200)`));
  await Ms.M('mouseMoved', r.x, r.y); await sleep(800);
  await shot('/private/tmp/claude-501/qa/tt-resize.jpg');
};
