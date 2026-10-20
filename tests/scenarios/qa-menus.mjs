// Balayage : clic droit sur chaque type d'objet, puis clic sur CHAQUE entrée du menu ; exceptions + invariants après chaque
import { boot, instru, RAP, mouse, pos, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, logs } = c;
  const proj = JSON.parse(JSON.stringify(RAP));
  proj.tracks.push({ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', output: 'master', clips: [] }, { name: 'Voix 2', type: 'audio', color: '#A855F7', output: 'vocal1', clips: [] });
  proj.markers = [{ time: 3, name: 'M1' }];
  await boot(c, proj);
  const Ms = mouse(send);
  await instru(ev, 8, 0, 0); await instru(ev, 4, 2, 1); await instru(ev, 3, 3, 4);
  await ev(`createMidiClip(5, 0)`); await sleep(900); await ev(`PulsePianoRoll.close(true)`);
  await ev(`document.querySelector('.fx-panel')?.remove()`);
  await ev(`state.pxPerSecond=48; renderAll()`);
  await sleep(400);
  const snap = await ev(`JSON.stringify(state.project)`);
  const targets = [
    ['clip audio (Instru)', `.timeline-track[data-i="0"] .clip`],
    ['clip Lead', `.timeline-track[data-i="2"] .clip`],
    ['clip midi', `.timeline-track[data-i="5"] .clip`],
    ['piste Lead (liste)', `.track-item[data-i="2"]`],
    ['piste Rec (capture)', `.track-item[data-i="1"]`],
    ['piste Piano (liste)', `.track-item[data-i="5"]`],
    ['groupe Vocal 1', `.group-header[data-bus="vocal1"]`],
    ['groupe All Vocal', `.group-header[data-bus="allvocal"]`],
    ['vide timeline (Lead)', `.timeline-track[data-i="3"]`, 0.9, 0.5],
    ['règle', `.timeline-ruler`, 0.3, 0.5],
    ['piste Back sans clip', `.timeline-track[data-i="4"]`, 0.5, 0.5],
  ];
  for (const [label, sel, fx = 0.5, fy = 0.5] of targets.filter(t => !process.env.QA_ONLY || t[0].includes(process.env.QA_ONLY))) {
    let n = 0;
    for (let k = 0; k < 40; k++) {
      await ev(`state.project=JSON.parse(${JSON.stringify(snap)}); document.querySelectorAll('.fx-panel,.track-ctx-menu,.ctx-menu').forEach(e=>e.remove()); if(window.PulsePianoRoll&&PulsePianoRoll.isOpen()) PulsePianoRoll.close(true); renderAll(); state.selectedClip=null; state.selectedClips=new Set(); state.selectedTrack=0; 0`);
      await sleep(120);
      await ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'center',inline:'nearest'})`); await sleep(60);
      let p = await pos(ev, sel, fx, fy);
      if (!p) { console.log(label, 'introuvable'); break; }
      if (p.x < 460 && sel.startsWith('.timeline-track')) p.x = 700;
      if (process.env.QA_DEBUG) console.log('pos', JSON.stringify(p), await ev(`(()=>{const e=document.elementFromPoint(${p.x},${p.y}); return e? e.className+' / '+e.parentElement.className : 'null'})()`));
      await Ms.rclick(Math.min(p.x, 1400), p.y);
      await sleep(120);
      let items = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item:not(.ctx-colors), .ctx-menu .ctx-item')].map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent.trim().slice(0,60)}}))`));
      if (!items.length && k === 0) { await sleep(500); await Ms.rclick(Math.min(p.x, 1400), p.y); await sleep(300); items = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item:not(.ctx-colors), .ctx-menu .ctx-item')].map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent.trim().slice(0,60)}}))`)); }
      if (k === 0) console.log(`\n## ${label} : ${items.length} entrées`);
      if (k >= items.length) break;
      const it = items[k];
      const l0 = logs.length;
      await Ms.click(it.x, it.y);
      await sleep(250);
      // dialogues éventuels (pulseAsk) : Échap
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(100);
      const inv = await ev(`JSON.stringify(${INVARIANTS})`);
      const fl = await ev(`document.getElementById('flash')?.style.opacity==='1' ? document.getElementById('flash').textContent : ''`);
      console.log(`  [${k}] ${it.t.padEnd(52)} ${logs.length > l0 ? 'EXC ' + logs.slice(l0).join(' / ').slice(0, 160) : 'ok'} ${inv !== '[]' ? 'INV ' + inv : ''} ${fl ? '→ ' + fl.slice(0, 80) : ''}`);
    }
  }
};
