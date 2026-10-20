// Parcours d'un jeune artiste : instru -> R -> voix -> exporter -> rouvrir
import { boot, RAP, instru, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot, nav } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, RAP);
  await instru(ev, 8, 0, 0); await sleep(500);
  console.log('instru placée:', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,t.type,t.preset,(t.clips||[]).length]))`));
  console.log('piste choisie', await ev(`state.selectedTrack`), 'armed', await ev(`JSON.stringify(state.project.tracks.map(t=>!!t.armed))`));
  // R : enregistrer
  await K('r'); await sleep(3500);
  console.log('rec?', await ev(`state.recording`), await ev(`document.querySelector('#toast,.flash,.toast')?.textContent||''`));
  await K(' '); await sleep(1500);
  console.log('après arrêt:', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).map(c=>[+c.start.toFixed(2),+c.duration.toFixed(2),c.name])]))`));
  console.log('playhead', await ev(`state.playhead`), 'playing', await ev(`state.playing`));
  // 2e prise : R depuis 0
  await shot('/private/tmp/claude-501/qa/par-1.jpg');
  // Export WAV
  await ev(`window.__dl=[]; openExportModal()`); await sleep(400);
  console.log('modale export:', (await ev(`document.querySelector('#exportModal, .export-modal, .modal-backdrop.visible')?.innerText||'(aucune)'`)).replace(/\n+/g,' | ').slice(0,500));
  await shot('/private/tmp/claude-501/qa/par-export.jpg');
  await ev(`doExport('wav')`); await sleep(2500);
  console.log('téléchargements', await ev(`JSON.stringify(window.__dl)`));
  // Rouvrir : recharger la page
  await ev(`flushProjectDocSave&&flushProjectDocSave()`); await sleep(500);
  await nav('http://localhost:8765/studio.html'); await sleep(2500);
  console.log('après rechargement:', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).map(c=>[+c.start.toFixed(2),+c.duration.toFixed(2),c.name,!!PulseAudio.getBuffer&&!!PulseAudio.getBuffer(c.id)])]))`));
  await shot('/private/tmp/claude-501/qa/par-2.jpg');
  console.log('inv', await ev(`JSON.stringify(${INVARIANTS})`));
};
