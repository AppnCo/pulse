// Taper du texte (paroles, nom de piste, nom de groupe, marqueur) ne doit déclencher aucun raccourci
import { boot, instru, RAP, key, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, RAP);
  await instru(ev, 6, 0, 0);
  const Ms = mouse(send);
  const type = async (s) => { for (const ch of s) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code: ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase(), text: ch, windowsVirtualKeyCode: ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0) }); } };
  const snap = () => ev(`JSON.stringify({rec:state.recording,play:state.playing,loop:state.looping,metro:state.metronome,tool:state.tool,mixer:state.mixerOpen,n:state.project.tracks.length,ph:state.playhead,snap:state.snap,undo:_undoStack.length})`);
  const s0 = await snap();
  // 1. paroles
  await ev(`setLyricsOpen(true)`); await sleep(300);
  const ta = await pos(ev, '#lyricsText, .lyrics-text, textarea');
  console.log('zone texte', JSON.stringify(ta), await ev(`document.querySelector('textarea')?.id`));
  await Ms.click(ta.x, ta.y); await sleep(100);
  await type('rklmqsbezfxa t 123 ');
  await sleep(200);
  console.log('paroles tapées :', JSON.stringify(await ev(`document.querySelector('textarea').value`)), '\n  état changé =', (await snap()) !== s0);
  console.log('  avant ', s0, '\n  après ', await snap());
  // 2. renommer une piste (double-clic)
  await ev(`setLyricsOpen(false)`); await sleep(200);
  const n = await pos(ev, '.track-item[data-i="2"] .track-name');
  await Ms.click(n.x, n.y, 2); await sleep(150);
  console.log('édition nom piste :', await ev(`document.activeElement.className+' '+document.activeElement.isContentEditable`));
  const s1 = await snap();
  await type('rklm q s');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(200);
  console.log('nom obtenu :', await ev(`state.project.tracks[2].name`), ' | état changé =', (await snap()) !== s1, await snap());
  // 3. renommer un groupe
  const g = await pos(ev, '.group-header[data-bus="back"] .group-name');
  await Ms.click(g.x, g.y, 2); await sleep(150);
  const s2 = await snap();
  await type('rk lm');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await sleep(200);
  console.log('nom groupe :', await ev(`busById('back').name`), ' | état changé =', (await snap()) !== s2);
  // 4. renommer le projet
  const pn = await pos(ev, '#projectName, .project-name, .topbar .name');
  console.log('nom projet zone', JSON.stringify(pn), await ev(`document.title`));
};
