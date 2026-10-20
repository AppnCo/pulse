// Un groupe cliqué dans la liste s'affiche à gauche comme une piste : direction, effets, envois, pan, volume
import { boot, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, RAP);
  await ev(`document.querySelector('.group-header[data-bus="vocal1"] .group-name').click()`); await sleep(300);
  const d = JSON.parse(await ev(`JSON.stringify({
    noms:[...document.querySelectorAll('#inspector .insp-strip .strip-name')].map(e=>e.textContent.trim()),
    sortie:[...document.querySelectorAll('#inspector .insp-output')].map(e=>e.textContent.trim()),
    ajouter:!!document.querySelector('#inspector .insp-add-fx'),
    envois:document.querySelectorAll('#inspector .insp-send').length, pan:!!document.querySelector('#inspector .insp-pan-input')})`));
  console.log('groupe dans le bloc de gauche :', JSON.stringify(d));
  if (d.noms[0] !== 'Vocal 1' || !d.ajouter || !d.sortie.length) throw new Error('Le groupe ne s affiche pas comme une piste');
  // + Effet puis EQ : l'EQ du groupe est ajouté
  await ev(`document.querySelector('#inspector .insp-add-fx').click()`); await sleep(150);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/EQ/.test(e.textContent)).click()`); await sleep(300);
  console.log('effets du groupe :', await ev(`JSON.stringify(busById('vocal1').effects)`));
  // direction : vers Mix Bus 1 directement
  await ev(`document.querySelector('#inspector .insp-output').click()`); await sleep(150);
  const items = await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()))`);
  console.log('directions proposées :', items);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/Mix Bus 1/.test(e.textContent)).click()`); await sleep(300);
  const out = await ev(`busById('vocal1').output`);
  console.log('nouvelle direction :', out);
  if (out !== 'mixbus1') throw new Error('Direction non changée');
};
