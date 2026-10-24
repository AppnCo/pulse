// Tranche façon Logic : cases vides, envoi vers un groupe, double-clic = écrire le chiffre, ⌘ + clic = 0, auto gain du compresseur
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [{ id: 'g1', name: 'Parallèle', output: 'master', volume: 100 }], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  check('cases d’effets vides visibles', await ev(`document.querySelectorAll('#inspector .insp-strip:first-child .insp-fx-box .insp-slot-empty').length`) >= 4);
  check('cases d’envois vides visibles', await ev(`document.querySelectorAll('#inspector .insp-strip:first-child .insp-sends-box .insp-slot-empty').length`) >= 2);
  // clic sur une case d'envoi vide : le menu propose reverb, écho et le groupe
  await ev(`document.querySelector('#inspector .insp-strip:first-child .insp-sends-box .insp-slot-empty').click()`); await sleep(150);
  const menu = await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent).join('|')`);
  check('menu d’envoi : nouveau bus (vide) et bus existants, sans reverb / écho imposés', /Nouveau bus/.test(menu) && /Parallèle/.test(menu) && !/Bus Reverb|Bus Écho/.test(menu), menu);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent==='Parallèle').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);
  check('envoi vers le groupe créé (50)', await ev(`(state.project.tracks[0].busSends||{}).g1`) === 50);
  // ⌘ + clic = 0
  const r = await ev(`(()=>{ const b=document.querySelector('#inspector .send-bar-row[data-bsend="g1"]').getBoundingClientRect(); return {x:b.left+8,y:b.top+11}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: 4 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: 4 });
  await sleep(200);
  check('⌘ + clic remet l’envoi à 0', await ev(`(state.project.tracks[0].busSends||{}).g1`) === 0);
  // double-clic : champ pour écrire le chiffre
  await ev(`document.querySelector('#inspector .send-bar-row[data-bsend="g1"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`); await sleep(100);
  check('double-clic ouvre un champ', await ev(`!!document.querySelector('#inspector .sb-edit')`));
  await ev(`(()=>{ const e=document.querySelector('#inspector .sb-edit'); e.value='73'; e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`); await sleep(200);
  check('le chiffre tapé est pris (73)', await ev(`(state.project.tracks[0].busSends||{}).g1`) === 73);
  // auto gain du compresseur
  await ev(`state.project.tracks[0].effects=['comp']; saveProject(); renderInspector(); openEffectPanel(0,'comp',document.querySelector('#inspector .insp-fx-row'))`); await sleep(300);
  check('bouton Auto gain allumé au départ', await ev(`document.querySelector('.fx-panel .fx-autogain')?.classList.contains('on')`));
  await ev(`document.querySelector('.fx-panel .fx-autogain').click()`); await sleep(150);
  check('éteint : rattrapage à 0 dB', await ev(`((state.project.tracks[0].effectParams||{}).comp||{}).makeup`) === 0);
  await ev(`document.querySelector('.fx-panel .fx-autogain').click()`); await sleep(150);
  check('rallumé : rattrapage automatique', await ev(`((state.project.tracks[0].effectParams||{}).comp||{}).makeup`) === undefined);
  // molette au survol : envoi, fader, pan
  const wh = async (sel, dy) => { const r = await ev(`(()=>{const b=document.querySelector('${sel}').getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2};})()`); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: dy }); await sleep(400); };
  const before = await ev(`(state.project.tracks[0].busSends||{}).g1`);
  await wh('#inspector .send-bar-row[data-bsend="g1"]', -120);
  check('molette vers le haut sur un envoi : il monte', await ev(`(state.project.tracks[0].busSends||{}).g1`) > before);
  const v0 = await ev(`state.project.tracks[0].volume ?? 100`);
  await wh('#inspector .insp-strip:first-child .insp-fader', -120);
  check('molette sur le fader : le volume monte', await ev(`state.project.tracks[0].volume ?? 100`) > v0);
  await wh('#inspector .insp-strip:first-child .insp-pan-input', -120);
  check('molette sur le pan : il bouge', await ev(`(state.project.tracks[0].pan||0)`) !== 0);
};
