import { boot, mouse, pos, key, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, null);
  await instru(ev, 6, 0, 0);
  const Ms = mouse(send), K = key(send);
  const p = await pos(ev, '#bpmInput');
  await Ms.click(p.x, p.y, 3);
  await ev(`document.getElementById('bpmInput').select()`);
  for (const ch of '100') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(200);
  console.log('après Entrée: bpm=', await ev(`state.project.bpm`), 'focus=', await ev(`document.activeElement.id`));
  await K(' '); await sleep(500);
  console.log('Espace -> lecture=', await ev(`state.playing`), 'champ=', JSON.stringify(await ev(`document.getElementById('bpmInput').value`)), 'bpm=', await ev(`state.project.bpm`));
};
