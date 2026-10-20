import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot, nav } = c; const K = key(send); const Mo = mouse(send);
  await boot(c, { id: 't1', name: 'Texte', bpm: 120, buses: [], lyrics: 'L1\nL2\nL3\nL4', tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`addTrack('audio')`); await sleep(200);   // snapshot avec lyricsMap absent
  await ev(`document.getElementById('lyricsFollow').click()`); await sleep(200);
  await ev(`(()=>{const s=document.getElementById('lfStart'); s.value=5; s.dispatchEvent(new Event('change',{bubbles:true})); const p=document.getElementById('lfPer'); p.value='2'; p.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  console.log('map avant annuler', await ev(`JSON.stringify(state.project.lyricsMap)`));
  await ev(`undoAction()`); await sleep(200);
  console.log('après ⌘Z: map', await ev(`JSON.stringify(state.project.lyricsMap)`), 'champs', await ev(`document.getElementById('lfStart').value+'/'+document.getElementById('lfPer').value`), 'suivre actif', await ev(`lyricsFollowOn()`));
  // lecture à la mesure 5 : quelle ligne est allumée ?
  await ev(`state.playing=true; state.playhead=8.5; updatePlayhead()`); 
  console.log('ligne allumée à 8.5 s (mesure 5)', await ev(`document.querySelector('.lf-line.now')?.textContent||'aucune'`));
  await ev(`state.playing=false`);
  // taper au vrai clavier puis recharger sans attendre
  await ev(`document.getElementById('lyricsFollow').click()`); await sleep(100);
  await ev(`document.getElementById('lyricsText').focus()`);
  for (const ch of 'Yo ça va ?') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  await send('Input.insertText', { text: ' fin' });
  console.log('texte state', JSON.stringify(await ev(`state.project.lyrics`)));
  // Quitte sans blur : relance
  const before = await ev(`localStorage.getItem('pulse_current_project').includes('fin')`);
  console.log('déjà sauvegardé (<600ms)?', before);
  // Espace dans le texte, R, etc. 
  await K('r'); console.log('rec après r dans texte', await ev(`state.recording`));
  await ev(`document.getElementById('lyricsText').blur()`);
  // texte long : défilement ?
  await ev(`state.project.lyrics = Array.from({length:60},(_,i)=>'Ligne '+(i+1)).join('\\n'); setLyricsOpen(true); document.getElementById('lyricsFollow').click()`);
  await ev(`state.playing=true; state.playhead=60; updatePlayhead()`); await sleep(500);
  console.log('ligne à 60 s', await ev(`document.querySelector('.lf-line.now')?.textContent`));
  await ev(`state.playhead=600; updatePlayhead()`); await sleep(100);
  console.log('ligne à 600 s (fin du texte)', await ev(`document.querySelector('.lf-line.now')?.textContent`));
  await shot('/private/tmp/claude-501/qa/texte-1.jpg');
};
