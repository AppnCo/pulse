// Taille des formes d'onde de toutes les pistes (14/11) : bouton à côté du métronome, comme Logic ; ⌘ + clic = normal
import { boot, J, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: 1440, h: 860 });
  await instru(ev, 8, 0, 0); await sleep(400);
  const h = () => J(ev, `const p=document.querySelector('.clip .clip-wave-svg path'); return p ? p.getBBox().height : null`);
  const h1 = await h();
  await ev(`(()=>{ const i=document.getElementById('waveZoomIn'); i.value=3; i.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(300);
  const h3 = await h();
  check('formes d\'onde agrandies', h1 && h3 > h1 * 1.5, h1 + ' → ' + h3);
  check('réglage gardé', await J(ev, `return localStorage.getItem('pulse_wave_zoom')`) === '3');
  await ev(`(()=>{ const i=document.getElementById('waveZoomIn'); i.value=1; i.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(300);
  check('retour à la taille normale', Math.abs((await h()) - h1) < 1);
};
