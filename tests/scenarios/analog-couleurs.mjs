// Façades analogiques : deux Éclair 76 de variantes différentes ouverts ensemble gardent chacun leur couleur, aiguille visible au repos
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'acol', name: 'A', bpm: 120, sends: [], buses: [], tracks: [
    { name: 'Lead', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['fet76'], effectParams: { fet76: { input: 24, output: 24, attack: 3, release: 5, ratio: 4, mix: 100, variant: 0 } } },
    { name: 'Back', type: 'audio', color: '#C084FC', volume: 100, clips: [], effects: ['fet76'], effectParams: { fet76: { input: 24, output: 24, attack: 3, release: 5, ratio: 4, mix: 100, variant: 1 } } }] }, { mic: false });
  await ev(`openEffectPanel(0, 'fet76', document.body)`); await sleep(400);
  await ev(`openEffectPanel(1, 'fet76', document.body)`); await sleep(600);
  const r = await J(ev, `return [...document.querySelectorAll('.fx-panel svg.ana-svg')].map(svg => { const rect = [...svg.querySelectorAll('rect')].find(x => (x.getAttribute('fill')||'').startsWith('url(#anaPanel')); const ref = rect && rect.getAttribute('fill').match(/#([^)]+)/)[1]; const grad = document.getElementById(ref); const nd = svg.querySelector('.ana-needle'); const b = nd && nd.getBoundingClientRect(); return { ref, owner: grad && svg.contains(grad), c0: grad && grad.querySelector('stop').getAttribute('stop-color'), needle: b ? [Math.round(b.width), Math.round(b.height)] : null }; })`);
  check('deux façades, chacune son dégradé', r.length === 2 && r.every(x => x.owner) && r[0].ref !== r[1].ref, JSON.stringify(r));
  check('Noir et Argent : couleurs différentes', r.length === 2 && r[0].c0 !== r[1].c0, JSON.stringify(r.map(x => x.c0)));
  check('aiguille visible au repos (taille non nulle)', r.every(x => x.needle && x.needle[1] > 10), JSON.stringify(r.map(x => x.needle)));
};
