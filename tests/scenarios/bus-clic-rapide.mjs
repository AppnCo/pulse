// 31/10 : en-tête de bus — au survol, rien ne glisse sous la souris (le M restait sous le doigt) ;
// un clic rapide là où le volume se déroule choisit le bus sans toucher au volume ; après un arrêt, le volume est là
import { boot, mouse, pos, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c; const Ms = mouse(send);
  await boot(c, JSON.parse(JSON.stringify(RAP)), { w: 1440, h: 900 });
  const H = '.group-header[data-bus="vocal1"]';
  const xs = () => ev(`JSON.stringify([...document.querySelectorAll('${H} .g-mini')].map(b=>Math.round(b.getBoundingClientRect().left)))`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await sleep(500);
  const avant = await xs();
  const v = await pos(ev, `${H} .group-vol`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y });
  await sleep(40);
  check('au survol, les boutons ne bougent pas', (await xs()) === avant, avant + ' → ' + (await xs()));
  const vol0 = await ev(`busById('vocal1').volume ?? 100`);
  await Ms.click(v.x, v.y);
  await sleep(250);
  check('clic rapide à la place du volume : le bus est choisi', (await ev(`state.selectedBus`)) === 'vocal1');
  check('clic rapide : volume inchangé', (await ev(`busById('vocal1').volume ?? 100`)) === vol0);
  check('clic rapide : pas de M', (await ev(`!!busById('vocal1').muted`)) === false);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x + 1, y: v.y }); await sleep(700);
  check('après un arrêt de la souris, le volume est déroulé', (await ev(`getComputedStyle(document.querySelector('${H} .group-vol')).visibility`)) === 'visible');
};
