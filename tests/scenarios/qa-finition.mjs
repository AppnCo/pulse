import { boot, instru, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  await instru(ev, 6, 0, 0);
  const Ms = mouse(send);
  const f = await pos(ev, '#inspector .strip:nth-of-type(2) button, #inspector .strip-fx-slot[data-fx="preset"], #inspector button.master-edit');
  console.log('bouton Finition', JSON.stringify(f), await ev(`[...document.querySelectorAll('#inspector button')].map(b=>b.textContent.trim()).join('|')`));
  await ev(`openMasterPanel(busById('mixbus1'), document.querySelectorAll('#inspector button')[1])`); await sleep(500);
  await shot('/private/tmp/claude-501/qa/finition.jpg');
  console.log(await ev(`document.querySelector('.fx-panel')?.innerText.slice(0,600)`));
};
