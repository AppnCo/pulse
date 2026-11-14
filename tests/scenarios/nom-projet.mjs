// Nom du projet (14/11) : gardé dès la frappe (même sans sortir du champ), retrouvé à la réouverture et dans les récents
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'nomp', name: 'Projet sans titre', bpm: 120, buses: [], sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', output: 'master', clips: [] }] }, { mic: false });
  await sleep(300);
  await ev(`(()=>{ const el = document.getElementById('projectName'); el.focus(); el.textContent = 'Mon Son 14'; el.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`);
  await sleep(900);
  check('nom gardé sans quitter le champ', await J(ev, `return JSON.parse(localStorage.getItem('pulse_current_project')).name`) === 'Mon Son 14');
  check('récents à jour', await J(ev, `return (JSON.parse(localStorage.getItem('pulse_recent_projects')) || []).find(r => r.id === 'nomp')?.name`) === 'Mon Son 14');
  await ev(`PulsePersist.loadProjectDoc('nomp').then(d => { window.__nomDoc = d && d.name; })`); await sleep(300);
  const doc = await J(ev, `return window.__nomDoc`);
  check('projet rangé (IndexedDB) à jour', doc === 'Mon Son 14', String(doc));
  await ev(`location.reload()`); await sleep(2500);
  check('après réouverture : même nom', await J(ev, `return document.getElementById('projectName').textContent`) === 'Mon Son 14');
};
