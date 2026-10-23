// Automation façon Logic : réglage dessiné choisi par menu ou par autosélection, courbe nommée, EQ neuf vide, aucun envoi par défaut
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Parallèle', output: 'master', volume: 100 }], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [{ id: 'c1', start: 0, duration: 4, offset: 0 }] }] });
  check('projet neuf : aucun retour d’effet par défaut', await ev(`projectSends().length`) === 0);
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  // EQ neuf : aucun point
  await ev(`document.querySelector('#inspector .insp-add-fx').click()`); await sleep(150);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .fam-fx')].find(e=>e.dataset.fx==='eq').click()`); await sleep(300);
  check('EQ neuf : aucune bande', await ev(`eqBandsOf(state.project.tracks[0].effectParams.eq || {}).length`) === 0);
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  // mode A
  await ev(`toggleAutomationMode()`); await sleep(300);
  check('pastille Volume visible', await ev(`document.querySelector('.timeline-track .auto-chip')?.textContent`) !== undefined && /Volume/.test(await ev(`document.querySelector('.timeline-track .auto-chip')?.textContent||''`)));
  // autosélection : toucher le gauche/droite de la tranche
  await ev(`document.querySelector('#inspector .insp-strip:first-child .insp-pan-input').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  check('toucher le pan affiche sa courbe', await ev(`state.project.tracks[0].autoParam`) === 'pan' && /Gauche/.test(await ev(`document.querySelector('.timeline-track .auto-chip')?.textContent||''`)));
  // poser un point sur la courbe
  const r = await ev(`(()=>{const b=document.querySelector('.timeline-track .vol-curve').getBoundingClientRect(); return {x:b.left+120,y:b.top+10};})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await sleep(200);
  check('le point est rangé dans l’automation du pan (pas du volume)', await ev(`((state.project.tracks[0].automation||{}).pan||{points:[]}).points.length`) >= 1 && !(await ev(`((state.project.tracks[0].automation||{}).volume||{points:[]}).points.length`)));
  // menu de réglage : un envoi vers un groupe
  await ev(`state.project.tracks[0].busSends={g1:40}; renderInspector(); renderTimelineTracks()`); await sleep(200);
  await ev(`document.querySelector('.timeline-track .auto-chip').click()`); await sleep(150);
  const menu = await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item, .track-ctx-menu .ctx-head')].map(e=>e.textContent).join('|')`);
  check('menu : Volume, Gauche/droite, Envois, Parallèle', /Volume/.test(menu) && /Gauche/.test(menu) && /Envois/.test(menu) && /Parallèle/.test(menu), menu);
  // autosélection d'un plugin : curseur du compresseur
  await ev(`state.project.tracks[0].effects=['comp']; renderInspector(); openEffectPanel(0,'comp',document.querySelector('#inspector .insp-fx-row[data-fx="comp"]'))`); await sleep(300);
  await ev(`document.querySelector('.fx-panel .fx-slider[data-key="threshold"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  check('toucher le seuil du compresseur affiche sa courbe', await ev(`state.project.tracks[0].autoParam`) === 'fx:comp:threshold');
  // export avec automation : pas d'erreur
  const ok = await ev(`(async()=>{ try { await PulseAudio.exportWav(state.project); return true; } catch(e){ return String(e); } })()`);
  check('export avec courbes sans erreur', ok === true, String(ok));
};
