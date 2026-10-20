import { boot, RAP, mouse, pos, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  const Ms = mouse(send);
  const p = await pos(ev, '#projectName');
  await Ms.click(p.x, p.y); await sleep(100);
  await ev(`document.getElementById('projectName').focus(); document.execCommand('selectAll'); document.execCommand('delete')`);
  await Ms.click(900, 700); await sleep(300);
  console.log('champ =', JSON.stringify(await ev(`document.getElementById('projectName').textContent`)), '| projet =', JSON.stringify(await ev(`state.project.name`)), '| titre onglet =', JSON.stringify(await ev(`document.title`)));
};
