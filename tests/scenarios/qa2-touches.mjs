import { boot, RAP, instru, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, RAP);
  await instru(ev, 4, 0, 0); await sleep(300);
  // 1. touche D
  await K('d'); await sleep(200);
  console.log('1. D : clips piste', await ev(`JSON.stringify(state.project.tracks[state.selectedTrack].clips.map(c=>[c.name,c.start,c.duration,c.id||null]))`));
  await ev(`undoAction()`); 
  console.log('   après ⌘Z : ', await ev(`JSON.stringify(state.project.tracks[state.selectedTrack].clips.map(c=>c.name))`));
  const ex = await ev(`(async()=>{ try { const w=await PulseAudio.exportWav(state.project,{normalize:false}); return w?('ok '+w.size):'null' } catch(e){ return 'ERR '+e.message } })()`);
  console.log('   export avec clip démo (sans audio):', ex);
  // 2. Entrée / Espace sur un bouton focalisé
  await ev(`document.getElementById('btnHelp').focus()`);
  await K('Enter'); await sleep(300);
  console.log('2. Entrée sur « ? » focalisé : aide ouverte =', await ev(`!!document.getElementById('cheatModal')`));
  await ev(`closeCheatSheet&&closeCheatSheet()`);
  await ev(`document.getElementById('btnHelp').focus()`);
  await K(' '); await sleep(300);
  console.log('   Espace sur « ? » focalisé : aide ouverte =', await ev(`!!document.getElementById('cheatModal')`), 'lecture =', await ev(`state.playing`));
  await ev(`state.playing&&togglePlay()`);
  await ev(`document.getElementById('btnExport').focus()`);
  await K('Enter'); await sleep(300);
  console.log('   Entrée sur « Exporter » focalisé : modale =', await ev(`!!document.querySelector('.export-modal, #exportModal')`));
  // 3. Entrée dans le champ nom de projet
  console.log('3. ids modale', await ev(`[...document.querySelectorAll('[id*=xport]')].map(e=>e.id).join(',')`));
};
