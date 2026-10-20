// La copie de secours est un emplacement unique : elle est proposée sur un AUTRE projet
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, nav, shot } = c;
  const A = { id: 'projA', name: 'Projet A (vieux morceau)', bpm: 90, buses: [], tracks: [{ name: 'Instru A', type: 'audio', color: '#60A5FA', clips: [{ id: 'clipA1', name: 'a1', start: 0, duration: 5 }, { id: 'clipA2', name: 'a2', start: 6, duration: 5 }] }] };
  const B = { id: 'projB', name: 'Projet B (nouveau)', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }] };
  await boot(c, B, { ls: { pulse_autosave: JSON.stringify(A) } });
  await sleep(2000);
  console.log('projet ouvert :', await ev(`state.project.name`));
  console.log('bannière :', await ev(`[...document.querySelectorAll('body > div')].filter(d=>/sauvegarde plus récente/.test(d.textContent)).map(d=>d.textContent.trim().replace(/\\s+/g,' ')).join('|')`));
  await shot('/private/tmp/claude-501/qa/autosave.jpg');
  await ev(`document.getElementById('autosaveRestore').click()`); await sleep(500);
  console.log('après « La reprendre » : projet affiché =', await ev(`state.project.name`), '| id =', await ev(`state.project.id`));
};
