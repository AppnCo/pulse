// « Pas de sortie » ne crée jamais de boucle : la tranche de droite ne montre pas le bus caché,
// et un projet déjà en boucle (bug du 07/11) est réparé à l'ouverture
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  const G = (id, name, out = 'master') => ({ id, name, isGroup: true, output: out, color: '#A855F7', volume: 100 });
  const T = (name, out) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [] });
  // projet abîmé : dr → no_out → no_out
  await boot(c, { id: 'psb', name: 'PSB', bpm: 120, sends: [],
    buses: [G('dr', 'Drums', 'no_out'), { id: 'no_out', name: 'Pas de sortie', hidden: true, noFolder: true, noOut: true, output: 'no_out', volume: 0 }, G('vx', 'Voix')],
    tracks: [T('Kick', 'dr'), T('Lead', 'vx')] }, { mic: false });
  await sleep(500);
  check('ouverture : le bus caché repart sur la sortie stéréo', await J(ev, `return busById('no_out').output === 'master' && busById('dr').output === 'no_out'`), await J(ev, `return state.project.buses.map(b => b.id + '→' + b.output).join(' ')`));
  // groupe Drums choisi : à droite, la sortie stéréo, pas le bus caché
  await ev(`(() => { state.selectedBus = 'dr'; state.mixBuses = new Set(['dr']); renderInspector(); })()`); await sleep(300);
  const ids = await J(ev, `return [...document.querySelectorAll('#inspector .insp-strip')].map(s => s.dataset.kind + ':' + (s.dataset.id || ''))`);
  check('inspecteur : jamais de tranche « Pas de sortie »', !ids.some(x => x.includes('no_out')), JSON.stringify(ids));
  // piste en « Pas de sortie » : pareil
  await ev(`(() => { state.selectedBus = null; state.mixBuses = new Set(); state.project.tracks[1].output = 'no_out'; selectTrack(1); renderInspector(); })()`); await sleep(300);
  const ids2 = await J(ev, `return [...document.querySelectorAll('#inspector .insp-strip')].map(s => s.dataset.kind + ':' + (s.dataset.id || ''))`);
  check('piste sans sortie : pas de tranche « Pas de sortie » non plus', !ids2.some(x => x.includes('no_out')), JSON.stringify(ids2));
  // ranger un groupe dans un bus qui passe déjà par lui : refusé
  await ev(`moveGroupInto('vx', 'dr'); moveGroupInto('dr', 'vx')`); await sleep(200);
  check('pas de boucle entre deux groupes', await J(ev, `return !(busById('dr').output === 'vx' && busById('vx').output === 'dr')`), await J(ev, `return state.project.buses.map(b => b.id + '→' + b.output).join(' ')`));
  check('le bus caché ne bouge jamais', await J(ev, `moveGroupInto('no_out', 'vx'); wrapGroups(['no_out']); return busById('no_out').output === 'master'`));
};
