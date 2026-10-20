// QA3 n°4 : ligne de piste (vu-mètre, fader, bouton rond) pour toutes les hauteurs
import { boot, instru, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  const hs = [44, 52, 60, 69, 70, 71, 90, 120, 240];
  const tracks = hs.map((h, i) => ({ name: 'Piste ' + h, type: 'audio', color: '#A855F7', height: h, volume: i === 3 ? 0 : (i === 4 ? 50 : undefined), pan: i === 5 ? -60 : 0, clips: [] }));
  await boot(c, { id: 'li', name: 'LI', bpm: 120, buses: [], tracks });
  await instru(ev, 4, 1, 0); await sleep(300);
  await ev(`PulseAudio.registerBuffer && 0`);
  const info = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#tracksList .track-item')].map(el=>{ const r=el.getBoundingClientRect(); const q=(s)=>{const e=el.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); const cs=getComputedStyle(e); return {t:+(b.top-r.top).toFixed(0), b:+(b.bottom-r.top).toFixed(0), l:+(b.left-r.left).toFixed(0), r:+(b.right-r.left).toFixed(0), vis: cs.display!=='none'&&b.width>0}};
      return {h:Math.round(r.height), short:el.classList.contains('is-short'), name:q('.track-name'), btns:q('.track-buttons'), vol:q('.t-vol'), meter:q('.t-meter'), knob:q('.t-knob'), mono: el.querySelector('.t-meter')?.classList.contains('is-mono'), del:q('.m-del'), m:q('.m-m'), i:q('.m-i')}; }))`));
  for (const r of info) console.log(JSON.stringify(r));
  // chevauchements : fader vs boutons / nom / bouton rond ; meter vs fader
  const ov = (a, b) => a && b && a.vis && b.vis && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  info.forEach(r => { for (const [x, y] of [['vol', 'btns'], ['vol', 'knob'], ['meter', 'vol'], ['name', 'vol'], ['knob', 'btns'], ['knob', 'name'], ['vol','i'], ['vol','m']]) if (ov(r[x], r[y])) console.log('CHEVAUCHE h=' + r.h, x, 'x', y, JSON.stringify(r[x]), JSON.stringify(r[y])); });
  await shot('/private/tmp/claude-501/qa/ligne.jpg');
  // fader rempli : variable --fill suit-elle la valeur ?
  console.log('fill:', await ev(`JSON.stringify([...document.querySelectorAll('#tracksList .t-vol')].map(e=>[e.value, e.style.getPropertyValue('--fill')||getComputedStyle(e).getPropertyValue('--fill')]))`));
  // changer le volume au clavier / molette met-il à jour --fill ?
  await ev(`(()=>{ const e=document.querySelector('#tracksList .t-vol'); e.value=20; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  console.log('après input 20 :', await ev(`(()=>{const e=document.querySelector('#tracksList .t-vol'); return e.value+' fill='+(e.style.getPropertyValue('--fill')||'(vide)')+' vol='+state.project.tracks[0].volume})()`));
  // via l'inspecteur / undo : le fader de la ligne suit ?
  await ev(`pushUndo(); state.project.tracks[0].volume=100; renderTracksPanel(); bindTrackEvents();`);
  console.log('fill après re-rendu vol=100 :', await ev(`(()=>{const e=document.querySelector('#tracksList .t-vol'); return e.value+' fill='+(e.style.getPropertyValue('--fill')||'(vide)')})()`));
};
