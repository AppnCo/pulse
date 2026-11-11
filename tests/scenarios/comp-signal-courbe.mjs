// Compresseur : pendant la lecture, le signal se promène sur la courbe entrée / sortie (point + barre), comme Pro-C ; caché à l'arrêt
import { boot, J, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'csc', name: 'C', bpm: 120, sends: [], buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['comp'], effectParams: { comp: { threshold: -30, ratio: 4, mode: 0 } } }] }, { mic: false });
  await instru(ev, 8, 0, 0); await sleep(300);
  await ev(`try { localStorage.setItem('pulse_comp_view', 'curve'); } catch {} openEffectPanel(0, 'comp', document.body)`); await sleep(400);
  check('à l\'arrêt : pas de point', await J(ev, `const l = document.querySelector('.fx-panel .viz-live'); return !!l && l.style.display === 'none'`));
  await ev(`togglePlay()`); await sleep(1500);
  const r = await J(ev, `const l = document.querySelector('.fx-panel .viz-live'); const d = l.querySelector('.viz-live-dot'); return { shown: l.style.display !== 'none', cx: +d.getAttribute('cx'), cy: +d.getAttribute('cy'), inp: PulseAudio.getCompInput('t0') }`);
  check('en lecture : le point est sur la courbe (niveau d\'entrée reçu)', r.shown && r.inp !== null && r.cx > 7, JSON.stringify(r));
  await ev(`togglePlay()`); await sleep(500);
};
