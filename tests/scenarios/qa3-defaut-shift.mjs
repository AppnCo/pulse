// QA3 n°7/8 : volumes par défaut partout, verrou Shift
import { boot, instru, mouse, pos, key, RAP, INVARIANTS, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const Ms = mouse(send); const K = key(send);
  const vols = () => ev(`JSON.stringify(state.project.tracks.map(t=>t.name+':'+(t.volume===undefined?'-':t.volume)).concat((state.project.buses||[]).map(b=>b.id+':'+(b.volume===undefined?'-':b.volume))).concat((state.project.sends||[]).map(s=>'send '+s.id+':'+s.volume)))`);
  await boot(c, { id: 'dv', name: 'DV', bpm: 120, buses: [], tracks: [{ name: 'Piste 1', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`addTrack('audio')`); await ev(`addTrack('inst')`); await ev(`addTrack('beat')`); await ev(`addTrack('keys')`); await sleep(600); await ev(`PulsePianoRoll&&PulsePianoRoll.isOpen()&&PulsePianoRoll.close(true)`);
  await ev(`addTrack('drums')`); await sleep(600); await ev(`PulsePianoRoll&&PulsePianoRoll.isOpen()&&PulsePianoRoll.close(true)`);
  console.log('8b. pistes ajoutées :', await vols());
  await instru(ev, 3, 0, 0); await sleep(200);
  console.log('8c. import sur piste existante, puis import sur nouvelle piste :');
  await ev(`(async()=>{ const ctx=PulseAudio.getContext(); const b=ctx.createBuffer(1,48000,48000); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'nouvelle.wav',{type:'audio/wav'}), state.project.tracks.length, 0); })()`); await sleep(500);
  console.log('   ', await vols());
  await ev(`duplicateTrack(0)`); await sleep(150);
  console.log('8d. dupliquer piste :', await vols());
  await ev(`state.project.tracks[0].volume=63; duplicateTrack(0)`); await sleep(150);
  console.log('8e. dupliquer piste à 63 :', await ev(`JSON.stringify(state.project.tracks.filter(t=>/copy/.test(t.name)).map(t=>t.name+':'+t.volume))`));
  await ev(`createGroupWithTrack(0)`); await sleep(150);
  console.log('8f. groupe créé :', await ev(`JSON.stringify(state.project.buses.map(b=>b.id+':'+b.volume))`));
  // projet ancien : volume 80 explicite -> reste 80 ?
  await boot(c, { id: 'old', name: 'Old', bpm: 100, buses: [{ id: 'g1', name: 'G', isGroup: true, volume: 80, output: 'master' }], tracks: [{ name: 'A', type: 'audio', volume: 80, output: 'g1', color: '#A855F7', clips: [] }, { name: 'B', type: 'audio', color: '#60A5FA', clips: [] }] });
  console.log('8g. ancien projet (volume 80 explicite) :', await vols(), ' affichage=', await ev(`JSON.stringify([...document.querySelectorAll('#tracksList .t-vol')].map(e=>e.value+'/'+e.dataset.tooltip))`));
  // ---- 7. verrou Shift ----
  const mk = () => boot(c, { id: 'sh', name: 'SH', bpm: 120, buses: [], tracks: [0, 1, 2].map(i => ({ name: 'P' + i, type: 'audio', color: '#A855F7', clips: i === 0 ? [{ id: 'a', name: 'R', start: 2, duration: 3, offset: 0 }] : [] })) }).then(() => ev(`setSnapMode('off',true)`));
  const dump = () => ev(`JSON.stringify(state.project.tracks.map(t=>(t.clips||[]).map(c=>[c.name,+c.start.toFixed(2),+c.duration.toFixed(2)])))`);
  const M = (type, x, y, buttons = 1, mod = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : buttons, clickCount: 1, modifiers: mod });
  const shiftDown = () => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
  const shiftUp = () => send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  // 7a : Shift tenu avant mouvement, geste vertical + un peu de dérive horizontale
  await mk(); let p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.6); let px = +(await ev('state.pxPerSecond'));
  const t1 = await pos(ev, '.timeline-track[data-i="2"]', 0.5, 0.5);
  await M('mouseMoved', p.x, p.y); await M('mousePressed', p.x, p.y); await M('mouseMoved', p.x + 2, p.y + 5); await shiftDown(); await M('mouseMoved', p.x + 5, p.y + 40, 1, 8); await M('mouseMoved', p.x + 30, t1.y, 1, 8); await M('mouseReleased', p.x + 30, t1.y, 1, 8); await shiftUp(); await sleep(200);
  console.log('7a. Shift + vertical avec dérive 30 px :', await dump(), ' classe axis-locked restante=', await ev(`document.body.classList.contains('axis-locked')`));
  // 7b : geste horizontal avec Shift, la souris descend de 2 pistes
  await mk(); p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.6);
  await M('mouseMoved', p.x, p.y); await M('mousePressed', p.x, p.y); await M('mouseMoved', p.x + 4, p.y + 1); await shiftDown(); await M('mouseMoved', p.x + px * 2, p.y + 2, 1, 8); await M('mouseMoved', p.x + px * 2, t1.y, 1, 8); await M('mouseReleased', p.x + px * 2, t1.y, 1, 8); await shiftUp(); await sleep(200);
  console.log('7b. Shift + horizontal puis la souris descend :', await dump());
  // 7c : Shift appuyé APRÈS un long déplacement horizontal, puis geste vertical
  await mk(); p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.6);
  await M('mouseMoved', p.x, p.y); await M('mousePressed', p.x, p.y); await M('mouseMoved', p.x + px * 3, p.y + 1); await shiftDown(); await sleep(50);
  console.log('7c. juste après Shift (souris immobile, région déplacée de 3 s) :', await dump());
  await M('mouseMoved', p.x + px * 3 + 1, t1.y, 1, 8); await M('mouseReleased', p.x + px * 3 + 1, t1.y, 1, 8); await shiftUp(); await sleep(200);
  console.log('7c. puis vertical :', await dump());
  // 7d : Shift deux fois (déverrouille) puis horizontal libre
  await mk(); p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.6);
  await M('mouseMoved', p.x, p.y); await M('mousePressed', p.x, p.y); await M('mouseMoved', p.x + 5, p.y); await shiftDown(); await shiftUp(); await shiftDown(); await shiftUp();
  await M('mouseMoved', p.x + px * 2, t1.y, 1, 0); await M('mouseReleased', p.x + px * 2, t1.y); await sleep(200);
  console.log('7d. Shift ×2 puis diagonale (libre) :', await dump());
  // 7e : Shift verrou + alt (duplique)
  await mk(); p = await pos(ev, '.timeline-track[data-i="0"] .clip', 0.5, 0.6);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 3, y: p.y + 10, buttons: 1, modifiers: 1 }); await shiftDown();
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 20, y: t1.y, buttons: 1, modifiers: 9 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + 20, y: t1.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 9 }); await shiftUp(); await sleep(200);
  console.log('7e. Alt + Shift vertical (duplique, temps figé) :', await dump());
};
