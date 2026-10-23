// Écriture d'automation pendant la lecture : Touch (défaut) revient à la courbe au relâchement, Latch garde la valeur jusqu'à l'arrêt, Read n'écrit rien
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [], buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', pan: 0, clips: [] }] });
  await ev(`state.selectedTrack=0; renderInspector(); toggleAutomationMode()`); await sleep(300);
  const gesture = async (vals) => {
    await ev(`document.querySelector('#inspector .insp-strip:first-child .insp-pan-input').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
    for (const v of vals) { await ev(`(()=>{ const p=document.querySelector('#inspector .insp-strip:first-child .insp-pan-input'); p.value=${v}; p.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(120); }
    await ev(`document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`);
  };
  const pts = () => ev(`JSON.stringify(((state.project.tracks[0].automation||{}).pan||{points:[]}).points)`).then(JSON.parse);
  // Touch
  await ev(`togglePlay()`); await sleep(400);
  await gesture([20, 50, 80, 100]);
  await sleep(400); await ev(`togglePlay()`); await sleep(300);
  let p = await pts();
  check('Touch : le geste est écrit (plusieurs points)', p.length >= 4, JSON.stringify(p));
  check('Touch : au relâchement la courbe revient au centre', Math.abs(p[p.length - 1].v - 0.5) < 0.02 && p.some(x => x.v > 0.9), JSON.stringify(p.map(x => x.v)));
  check('pastille : mode Touch affiché', /Touch/.test(await ev(`document.querySelector('.timeline-track .auto-chip')?.textContent||''`)));
  // Latch
  await ev(`state.project.tracks[0].automation={}; state.project.tracks[0].pan=0; state.project.tracks[0].autoMode='latch'; renderInspector(); renderTimelineTracks()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(300);
  await gesture([-40, -80]);
  await sleep(600);
  const stopAt = await ev(`PulseAudio.getPlaybackPosition()`);
  await ev(`togglePlay()`); await sleep(300);
  p = await pts();
  const last = p[p.length - 1];
  check('Latch : la dernière valeur tient jusqu’à l’arrêt', last && last.v < 0.15 && Math.abs(last.t - stopAt) < 0.25, JSON.stringify(last) + ' arrêt=' + stopAt);
  // Read
  await ev(`state.project.tracks[0].automation={}; state.project.tracks[0].autoMode='read'; renderTimelineTracks()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(300);
  await gesture([30, 60]);
  await sleep(200); await ev(`togglePlay()`); await sleep(200);
  check('Read : rien n’est écrit', (await pts()).length === 0);
};
