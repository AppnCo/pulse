import { boot, RAP, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const Mo = mouse(send);
  await boot(c, RAP);
  await ev(`openSettings()`); await sleep(400);
  console.log((await ev(`(document.querySelector('.settings-modal, #settingsModal, .modal-backdrop')?.innerText||'').replace(/\\n+/g,' | ')`)).slice(0, 2500));
  await shot('/private/tmp/claude-501/qa/reglages-1440.jpg');
  // active chaque case/liste une fois, cherche des exceptions
  const n = await ev(`(()=>{ const m=document.querySelector('.settings-modal, #settingsModal, .modal-backdrop'); const els=[...m.querySelectorAll('input[type=checkbox],select,button')]; return els.length })()`);
  console.log('contrôles', n);
};
