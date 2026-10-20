import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  const P = { id: 'bs', name: 'Beat simple', templateId: 'beat-simple', bpm: 120, createdAt: 1, lastOpen: 1,
    tracks: [{ name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#7C3AED', clips: [] }, { name: 'Basse', type: 'keys', midiInst: 'bass', color: '#DDD6FE', clips: [] }], buses: [] };
  await boot(c, P);
  const toast = () => ev(`document.getElementById('flash')?.textContent||''`);
  console.log('état initial', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,t.type,t.armed,t.volume,t.output]))`));
  await shot('/private/tmp/claude-501/qa/beat-0.jpg');
  console.log('texte visible dans la timeline :', (await ev(`document.querySelector('.timeline')?.innerText||''`)).replace(/\s+/g,' ').slice(0,300));
  await K(' '); await sleep(300); console.log('Espace (rien) →', await toast(), '| lecture', await ev(`state.playing`));
  await ev(`state.playing&&togglePlay()`);
  await K('r'); await sleep(600); console.log('R sur piste batterie →', await toast(), '| rec', await ev(`state.recording`), '| pistes', await ev(`state.project.tracks.length`));
  await ev(`state.recording&&toggleRec()`); await sleep(500);
  // double-clic dans la timeline vide de la batterie pour créer une région
  const r = await pos(ev, `.timeline-track[data-i="0"]`, 0.1, 0.5);
  await Mo.click(r.x, r.y, 2); await sleep(700);
  console.log('double-clic piste batterie → éditeur', await ev(`PulsePianoRoll.isOpen()`), await toast());
  // Pose des pas, ferme avec Échap, joue ; puis la basse : sélection clavier et R
  await ev(`PulsePianoRoll.close()`); await sleep(300);
  await ev(`selectTrack(1)`); await K('r'); await sleep(600);
  console.log('R sur Basse →', await toast(), '| rec', await ev(`state.recording`));
  await ev(`state.recording&&toggleRec()`); await sleep(400);
  // Export d'un projet sans note
  await ev(`window.__dl=[]; doExport('wav')`); await sleep(1500);
  console.log('Export sans note →', await toast(), JSON.stringify(await ev(`window.__dl`)));
  // Instru drop zone ?
  console.log('zone instru visible ?', await ev(`!!document.querySelector('.instru-dropzone')`));
  // Ajout d'une voix: bouton +
  await ev(`addTrack('audio')`); await sleep(300);
  await K('r'); await sleep(2000); await K(' '); await sleep(1200);
  console.log('Voix ajoutée + R →', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,t.armed,(t.clips||[]).map(c=>c.name)]))`), await toast());
};
