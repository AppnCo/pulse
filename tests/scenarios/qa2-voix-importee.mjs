// Une voix déjà enregistrée déposée sur la piste Lead (vide, non armée) : que devient la piste ?
import { boot, RAP, instru, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const Mo = mouse(send);
  await boot(c, RAP);
  await instru(ev, 20, 0, 0); await sleep(300);
  await instru(ev, 5, 2, 0); await sleep(500);    // « ma voix » posée sur Lead
  console.log('Lead :', await ev(`JSON.stringify({type:state.project.tracks[2].type, preset:state.project.tracks[2].preset, instru:isInstruTrack(state.project.tracks[2])})`));
  await ev(`toggleMixer()`); await sleep(300);
  console.log('Tune dans le mixeur pour Lead :', await ev(`!!document.querySelector('.strip[data-kind="track"][data-i="2"] .strip-fx-slot[data-fx="tune"]')`), '| pour Back :', await ev(`!!document.querySelector('.strip[data-kind="track"][data-i="3"] .strip-fx-slot[data-fx="tune"]')`));
  await ev(`toggleMixer()`);
  await ev(`openTrackContextMenu(300,300,2,state.project.tracks[2])`);
  console.log('menu piste Lead :', await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).filter(t=>/Tune/i.test(t)).join('|')||'aucun Auto-Tune'`));
  await ev(`closeAllMenus()`);
  console.log('icône :', await ev(`document.querySelector('.track-item[data-i="2"] .track-icon, .track-item[data-i="2"] svg')?.outerHTML.slice(0,60)`));
  await shot('/private/tmp/claude-501/qa/voix-importee.jpg');
};
