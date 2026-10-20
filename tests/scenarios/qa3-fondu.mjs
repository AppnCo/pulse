// QA3 n°3 : fondu enchaîné automatique / poignée tirée / Supprimer le fondu ; rendu réel via exportWav
import { boot, mouse, pos, key, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const Ms = mouse(send); const K = key(send);
  const dump = (t = 0) => ev(`JSON.stringify(state.project.tracks[${t}].clips.map(c=>[c.name,+c.start.toFixed(2),+c.duration.toFixed(2),c.loopEnd?+c.loopEnd.toFixed(2):null,+(c.offset||0).toFixed(2),+(c.fadeIn||0).toFixed(2),+(c.fadeOut||0).toFixed(2)]))`);
  const fresh = async (clips) => { await boot(c, { id: 'fd', name: 'FD', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips }] });
    await ev(`(async()=>{ const ctx=PulseAudio.getContext(); for (const [id,fr] of [['a',440],['b',660],['c',880]]) { const b=ctx.createBuffer(1,48000*8,48000); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.sin(2*Math.PI*fr*i/48000)*0.4; PulseAudio.registerBuffer(id,b); } })()`);
    await ev(`setSnapMode('off',true); renderTimelineTracks()`); await sleep(200); };
  // niveau RMS par fenêtre de 100 ms autour de t (rendu hors-ligne = export)
  const rms = async (times) => JSON.parse(await ev(`(async()=>{ const blob=await PulseAudio.exportWav(state.project); if(!blob) return '[]'; const ab=await PulseAudio.getContext().decodeAudioData(await blob.arrayBuffer()); const d=ab.getChannelData(0), sr=ab.sampleRate;
    return JSON.stringify(${JSON.stringify(times)}.map(t=>{ let s=0,n=0; for(let i=Math.floor((t-0.05)*sr); i<Math.floor((t+0.05)*sr); i++){ if(i>=0&&i<d.length){s+=d[i]*d[i];n++;} } return +(Math.sqrt(s/Math.max(1,n))).toFixed(3); })); })()`));
  const drag = async (sel, fx, fy, dxSec, steps = 8) => { const p = await pos(ev, sel, fx, fy); const px = +(await ev('state.pxPerSecond')); await Ms.drag(p.x, p.y, p.x + dxSec * px, p.y, steps); await sleep(200); };
  const fadeZone = '.timeline-track[data-i="0"] .clip[data-ci="1"] .clip-fade-zone';

  // 1. chevauchement simple A 0-4, B 3-7
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 3, duration: 4 }]);
  console.log('1. A 0-4 + B 3-7, RMS à 1,5 / 3,25 / 3,5 / 3,75 / 5 s :', await rms([1.5, 3.25, 3.5, 3.75, 5]));
  // 2. région tout entière sous une grande : A 0-6, B 2-3
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 6 }, { id: 'b', name: 'B', start: 2, duration: 1 }]);
  console.log('2. B (2-3) dans A (0-6), RMS à 1 / 2,5 / 4 / 5,5 s (A seule attendue 0.283 sauf 2-3) :', await rms([1, 2.5, 4, 5.5]));
  // 3. poignée du fondu d'entrée de B tirée à gauche de 1 s, B.offset=2
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 4, duration: 4, offset: 2 }]);
  const zones = await ev(`JSON.stringify([...document.querySelectorAll('.timeline-track[data-i="0"] .clip[data-ci="1"] > *')].map(e=>e.className))`);
  console.log('3. éléments de B :', zones);
  await drag('.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.04, 0.25, -1);
  console.log('3. après tirage -1 s du fondu d\'entrée de B :', await dump(), ' flash=', await ev(`document.querySelector('.toast,#flash,.flash')?.textContent||''`));
  // 4. pas de son disponible avant : B.offset = 0
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 4, duration: 4, offset: 0 }]);
  await drag('.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.04, 0.25, -1);
  console.log('4. même geste, B.offset = 0 :', await dump(), ' flash=', await ev(`document.querySelector('.toast,#flash,.flash')?.textContent||''`));
  // 5. fondu de sortie de A tiré à droite vers B (A a 4 s de buffer disponibles ... buffer 8 s, offset 0, duration 4)
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 4, duration: 4 }]);
  await drag('.timeline-track[data-i="0"] .clip[data-ci="0"]', 0.96, 0.25, +1);
  console.log('5. fondu de sortie de A tiré +1 s :', await dump());
  console.log('5. RMS à 3,25 / 3,5 / 4,25 / 4,75 / 6 :', await rms([3.25, 3.5, 4.25, 4.75, 6]));
  // 6. B plus courte que l'extension : A (0-4), B (4-4.3), C (4.3-8)
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 4, duration: 0.3 }, { id: 'c', name: 'C', start: 4.3, duration: 3.7 }]);
  await drag('.timeline-track[data-i="0"] .clip[data-ci="0"]', 0.96, 0.25, +1.5);
  console.log('6. A étendue sur B (0,3 s) et C :', await dump());
  // 7. annuler
  await K('z', CMD); await sleep(200);
  console.log('7. ⌘Z :', await dump());
  // 8. Supprimer le fondu (début) quand la région précédente est plus longue que celle-ci (imbriquée)
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 6 }, { id: 'b', name: 'B', start: 2, duration: 1 }]);
  { const p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.2, 0.5); await Ms.rclick(p.x, p.y); await sleep(200); }
  console.log('8. menu B (imbriquée) :', await ev(`JSON.stringify([...document.querySelectorAll('.clip-ctx-menu > *')].map(e=>e.textContent.trim()).filter(t=>/fondu/i.test(t)))`));
  await ev(`(()=>{ const it=[...document.querySelectorAll('.clip-ctx-menu > *')].find(e=>/fondu enchaîné \\(début\\)/.test(e.textContent)); it&&it.click(); })()`); await sleep(200);
  console.log('8. après « Supprimer le fondu enchaîné (début) » :', await dump());
  // 9. clic simple sur la poignée sans bouger : pile d'annulation
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 4, duration: 4, offset: 2 }]);
  const before = await ev(`(state.undoStack||[]).length`);
  { const p = await pos(ev, '.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.04, 0.25); await Ms.click(p.x, p.y); await sleep(200); }
  console.log('9. pile d\'annulation avant/après un simple clic sur la zone de fondu :', before, await ev(`(state.undoStack||[]).length`));
  // 10. fondu enchaîné puis changement de bpm / export : la zone commune reste cohérente après ⌘Z du fondu
  await fresh([{ id: 'a', name: 'A', start: 0, duration: 4 }, { id: 'b', name: 'B', start: 4, duration: 4, offset: 2 }]);
  await drag('.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.04, 0.25, -1.5);
  console.log('10a. B tirée -1,5 s :', await dump());
  await drag('.timeline-track[data-i="0"] .clip[data-ci="1"]', 0.04, 0.25, +2);
  console.log('10b. puis tirée +2 s dans le sens normal :', await dump());
};
