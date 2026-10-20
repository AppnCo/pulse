import { boot, RAP, instru, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send);
  await boot(c, RAP);
  await instru(ev, 10, 0, 0); await sleep(300);
  const toast = () => ev(`document.getElementById('flash')?.textContent||''`);
  // Export pendant la prise
  await K('r'); await sleep(1500);
  await K('e', CMD); await sleep(500);
  console.log('⌘E pendant la prise → modale :', await ev(`!!document.querySelector('.modal-backdrop.visible, #exportModal')`), '| rec', await ev(`state.recording`), '|', await toast());
  await ev(`window.__dl=[]; doExport('wav')`); await sleep(3000);
  console.log('export pendant la prise → dl', await ev(`JSON.stringify(window.__dl)`), '| rec', await ev(`state.recording`), '|', await toast());
  await K(' '); await sleep(1500);
  console.log('prise après : ', JSON.stringify(await ev(`state.project.tracks[1].clips.map(c=>[c.name,+c.duration.toFixed(2)])`)));
  // double export en parallèle
  await ev(`window.__dl=[]; Promise.all([doExport('wav'), doExport('mp3',128)])`); await sleep(6000);
  console.log('2 exports simultanés → dl', await ev(`JSON.stringify(window.__dl)`), '|', await toast());
  // export pendant la lecture
  await ev(`seekPlayhead(0)`); await K(' '); await sleep(600);
  await ev(`window.__dl=[]; doExport('wav')`); await sleep(3000);
  console.log('export pendant lecture → dl', await ev(`JSON.stringify(window.__dl)`), '| lecture', await ev(`state.playing`), '|', await toast());
  // boucle
  await K(' '); await sleep(200);
  await ev(`state.loop={start:1,end:3}; renderLoopOverlay&&renderLoopOverlay(); window.__dl=[]; doExport('wav',320,true)`); await sleep(3000);
  const d = await ev(`(async()=>{ return JSON.stringify(window.__dl) })()`);
  console.log('export sélection → dl', d);
};
