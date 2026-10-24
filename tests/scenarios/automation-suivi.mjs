// Pendant la lecture, le gauche/droite et les envois de la tranche suivent leur courbe (comme les faders motorisés de Logic)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [{ id: 'rv', name: 'Rev', type: 'reverb', size: 2, volume: 100 }], buses: [],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', pan: 0, sends: { rv: 10 }, clips: [],
      automation: { pan: { points: [{ t: 0, v: 1 }, { t: 30, v: 1 }] }, 'send:rv': { points: [{ t: 0, v: 0.8 }, { t: 30, v: 0.8 }] } } }] });
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  check('à l’arrêt : la tranche montre le réglage fixe', await ev(`document.querySelector('#inspector .insp-pan-input').value`) === '0');
  await ev(`togglePlay()`); await sleep(400);
  check('en lecture : le pan suit la courbe (à droite)', await ev(`document.querySelector('#inspector .insp-pan-input').value`) === '100');
  check('en lecture : l’envoi suit la courbe (80)', await ev(`document.querySelector('#inspector .send-bar-row[data-send="rv"] .sb-val').textContent`) === '80');
  await ev(`togglePlay()`); await sleep(200);
  check('le réglage enregistré n’a pas bougé', await ev(`state.project.tracks[0].pan||0`) === 0 && await ev(`state.project.tracks[0].sends.rv`) === 10);
  // fenêtre de plugin : le seuil suit sa courbe en lecture, revient au réglage à l'arrêt
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effects=['comp']; t.effectParams={comp:{threshold:-20}}; t.automation['fx:comp:threshold']={points:[{t:0,v:0.25},{t:30,v:0.25}]}; renderInspector(); openEffectPanel(0,'comp',document.querySelector('#inspector .insp-fx-row[data-fx="comp"]')); })()`); await sleep(300);
  const val = () => ev(`document.querySelector('.fx-panel .fx-val[data-key="threshold"]')?.textContent||''`);
  const avant = await val();
  await ev(`state.playhead=0; togglePlay()`); await sleep(400);
  const pendant = await val();
  await ev(`togglePlay()`); await sleep(300);
  const apres = await val();
  check('plugin : le seuil suit la courbe en lecture (-30 dB)', /-30/.test(pendant), `avant=${avant} pendant=${pendant} après=${apres}`);
  check('plugin : retour au réglage enregistré à l’arrêt', apres === avant, `avant=${avant} après=${apres}`);
};
