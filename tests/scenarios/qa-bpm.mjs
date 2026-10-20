import { boot, mouse, pos, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, null);
  const Ms = mouse(send);
  const p = await pos(ev, '#bpmInput');
  for (const val of ['300', 'abc', '', '12', '99.7', '-5']) {
    await Ms.click(p.x, p.y, 3);
    await ev(`document.getElementById('bpmInput').select()`);
    for (const ch of val) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    if (!val) await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(200);
    console.log(JSON.stringify(val), '=> champ=', await ev(`document.getElementById('bpmInput').value`), 'projet=', await ev(`state.project.bpm`), 'focus=', await ev(`document.activeElement.id`), 'flash=', await ev(`document.getElementById('flash')?.textContent`));
    await ev(`document.getElementById('bpmInput').blur()`);
  }
};
