// PulseTune est un effet comme les autres : il se met aussi sur la piste REC, avec les notes en lettres
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'Rec', type: 'audio', isCapture: true, armed: true, color: '#F472B6' }] });
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  await ev(`document.querySelector('#inspector .insp-add-fx').click()`); await sleep(150);
  check('PulseTune proposé sur la piste REC', await ev(`!!document.querySelector('.track-ctx-menu .fam-fx[data-fx="tune"]')`));
  await ev(`document.querySelector('.track-ctx-menu .fam-fx[data-fx="tune"]').click()`); await sleep(400);
  check('PulseTune posé sur la piste REC', await ev(`showTuneSlot(state.project.tracks[0]) && !!document.querySelector('#inspector [data-fx="tune"]')`));
  check('tonalités en lettres (C D E…)', await ev(`[...document.querySelectorAll('.tune-tonic option')].map(o=>o.textContent).join(' ')`) === 'C C# D D# E F F# G G# A A# B');
};
