import { boot, RAP, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, RAP);
  await ev(`toggleMixer()`); await sleep(300);
  console.log('mixeur (Afficher les réglages avancés = non) :', await ev(`[...document.querySelectorAll('.mixer-strips .strip')].map(s=>s.querySelector('.strip-name')?.textContent.trim().replace(/\\s+/g,' ')).join(' | ')`));
  console.log('piste/groupe masqués dans la liste des pistes :', await ev(`[...document.querySelectorAll('#tracksList .group-name, #tracksList .track-name')].map(e=>e.textContent.trim()).join(' | ')`));
  console.log('inspecteur piste Instru (dest) :', await ev(`(setInspectorOpen(true), renderInspector(), [...document.querySelectorAll('#inspector .insp-strip .strip-name')].map(e=>e.textContent).join(' > '))`));
};
