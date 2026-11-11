// Plugin externe : copier son réglage sur une piste, le coller sur le même plugin d'une autre piste, ou en plus (moteur simulé)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'xcc', name: 'X', bpm: 120, sends: [], buses: [], tracks: [
    { name: 'Lead', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['vst#a'], effectParams: { 'vst#a': { path: '/p/AT.vst3', name: 'Auto-Tune Pro', vendor: 'Antares' } } },
    { name: 'Back', type: 'audio', color: '#C084FC', volume: 100, clips: [], effects: ['vst#b'], effectParams: { 'vst#b': { path: '/p/AT.vst3', name: 'Auto-Tune Pro', vendor: 'Antares' } } },
    { name: 'Adlib', type: 'audio', color: '#F0ABFC', volume: 100, clips: [], effects: [] }] }, { mic: false });
  await ev(`window.__calls = []; window.__TAURI__ = { core: { invoke: async (cmd, a) => { __calls.push([cmd, a && a.id, a && a.state]); return cmd === 'ext_state' ? 'ETAT-LEAD' : null; } } };`);
  // Copier sur Lead
  await ev(`openFxCopyMenu(100, 100, 'vst#a', state.project.tracks[0])`); await sleep(200);
  const items1 = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e => e.textContent.trim())`);
  check('menu d\'un externe : « Copier le réglage (Auto-Tune Pro) »', items1.some(t => /Copier le réglage \(Auto-Tune Pro\)/.test(t)), JSON.stringify(items1));
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => /Copier/.test(e.textContent)).click()`); await sleep(300);
  // Coller sur Back (même plugin) : remplacé par une copie qui porte l'état
  await ev(`openFxCopyMenu(100, 100, 'vst#b', state.project.tracks[1])`); await sleep(200);
  const items2 = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e => e.textContent.trim())`);
  check('Back : « Coller le réglage » proposé', items2.some(t => /Coller le réglage \(Auto-Tune Pro de « Lead »\)/.test(t)), JSON.stringify(items2));
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => /Coller le réglage/.test(e.textContent)).click()`); await sleep(400);
  const back = await J(ev, `const t = state.project.tracks[1]; return { effects: t.effects, p: t.effectParams, created: __calls.filter(c => c[0] === 'ext_create'), removed: __calls.filter(c => c[0] === 'ext_remove').map(c => c[1]) }`);
  const nid = back.effects[0];
  check('Back : un seul Auto-Tune, nouvelle instance avec l\'état de Lead, l\'ancienne retirée', back.effects.length === 1 && nid !== 'vst#b' && back.p[nid].state === 'ETAT-LEAD' && back.created.some(c => c[1] === nid && c[2] === 'ETAT-LEAD') && back.removed.includes('vst#b'), JSON.stringify(back));
  // Coller en plus sur Adlib (pas d'Auto-Tune) : depuis un clic droit… sur un plugin d'Adlib ? Adlib n'en a pas : on passe par la piste Lead (ajout en plus)
  await ev(`state.project.tracks[2].effects = ['eq']; openFxCopyMenu(100, 100, 'eq', state.project.tracks[2])`); await sleep(200);
  const items3 = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e => e.textContent.trim())`);
  check('Adlib : « Coller « Auto-Tune Pro » ici en plus » proposé', items3.some(t => /ici en plus/.test(t)), JSON.stringify(items3));
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e => /ici en plus/.test(e.textContent)).click()`); await sleep(400);
  const ad = await J(ev, `const t = state.project.tracks[2]; return { effects: t.effects, st: t.effects.filter(f => f.startsWith('vst')).map(f => t.effectParams[f].state) }`);
  check('Adlib : EQ + Auto-Tune réglé comme Lead', ad.effects.length === 2 && ad.effects[0] === 'eq' && ad.st[0] === 'ETAT-LEAD', JSON.stringify(ad));
  await ev(`delete window.__TAURI__`);
};
