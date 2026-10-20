import { boot, instru, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot, nav } = c;
  const long = 'Mon super morceau de rap très très long avec beaucoup de mots <b>gras</b> & "guillemets" 🎤 — version finale (v12) pour la sortie du 31 octobre';
  const proj = JSON.parse(JSON.stringify(RAP)); proj.name = long;
  proj.tracks[2].name = 'Lead avec un nom de piste interminable qui dépasse largement la place disponible';
  proj.buses[0].name = 'Un groupe au nom très très long pour voir';
  await boot(c, proj);
  await instru(ev, 6, 0, 0); await sleep(300);
  await shot('/private/tmp/claude-501/qa/nomlong.jpg');
  console.log('topbar: nom largeur', await ev(`document.getElementById('projectName').getBoundingClientRect().width`), 'html injecté ?', await ev(`document.getElementById('projectName').innerHTML.slice(0,80)`));
  console.log('débordements:', await ev(`JSON.stringify([...document.querySelectorAll('.track-item .track-name, .group-header .group-name, #projectName')].map(e=>({t:e.textContent.slice(0,20), sw:e.scrollWidth, cw:e.clientWidth, over:getComputedStyle(e).textOverflow})))`));
  await ev(`toggleMixer()`); await sleep(400);
  await shot('/private/tmp/claude-501/qa/nomlong-mixer.jpg');
  // accueil : récents
  await nav('http://localhost:8765/index.html'); await sleep(900);
  await shot('/private/tmp/claude-501/qa/nomlong-accueil.jpg');
};
