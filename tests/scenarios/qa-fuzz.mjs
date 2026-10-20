// Fuzz mixte (clavier + souris + clic droit + ⌘Z) sur un gros projet. Graine : QA_SEED
import { boot, instru, RAP, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  const seed0 = parseInt(process.env.QA_SEED || '5');
  const proj = JSON.parse(JSON.stringify(RAP));
  proj.tracks.push({ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', output: 'master', clips: [] }, { name: 'Drums', type: 'drums', midiInst: 'drums', color: '#F59E0B', output: 'master', clips: [] }, { name: 'Voix 2', type: 'audio', color: '#A855F7', output: 'vocal1', clips: [] });
  await boot(c, proj, { w: 1440, h: 860 });
  await instru(ev, 8, 0, 0); await instru(ev, 4, 2, 1); await instru(ev, 3, 3, 2); await ev(`createMidiClip(5, 0)`); await sleep(800);
  if (process.env.QA_ROLL) { await ev(`PulsePianoRoll.isOpen() && PulsePianoRoll.close(true); openMidiEditor(${process.env.QA_ROLL},0,false)`); await sleep(800); } else await ev(`PulsePianoRoll && PulsePianoRoll.isOpen() && PulsePianoRoll.close(true)`);
  let seed = seed0; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const W = 1440, H = 860; const Y0 = process.env.QA_ROLL ? 470 : 5;
  const M = (type, x, y, button = 'left', buttons = 1, clickCount = 1, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount, modifiers });
  const keys = [' ', 'r', 'k', 'l', 'm', 'q', 's', 'b', 'e', 'z', 'f', 'x', 'a', 'c', 'v', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Delete', 'Backspace', 'Tab', 'Home', 'End', 't', 'Z', '1', '2', '3'];
  const N = parseInt(process.env.QA_N || '300');
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const kind = rnd(), x = 5 + rnd() * (W - 10), y = Y0 + rnd() * (H - Y0 - 5), mod = [0, 0, 0, 4, 8, 1, 12][Math.floor(rnd() * 7)];
    if (kind < 0.25) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1, mod); await M('mouseReleased', x, y, 'left', 0, 1, mod); }
    else if (kind < 0.42) { const x2 = x + (rnd() - .5) * 500, y2 = y + (rnd() - .5) * 250; await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1, mod); await M('mouseMoved', (x + x2) / 2, (y + y2) / 2, 'left', 1, 1, mod); await M('mouseMoved', x2, y2, 'left', 1, 1, mod); await M('mouseReleased', x2, y2, 'left', 0, 1, mod); }
    else if (kind < 0.5) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'right', 2); await M('mouseReleased', x, y, 'right', 0);
      // choisit un item du menu au hasard
      if (rnd() < 0.7) { const items = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent.trim().slice(0,30)}}))`)); if (items.length) { const it = items[Math.floor(rnd() * items.length)]; if (!/Supprimer|Quitter/i.test(it.t) || true) { await M('mouseMoved', it.x, it.y); await M('mousePressed', it.x, it.y); await M('mouseReleased', it.x, it.y, 'left', 0); } } } }
    else if (kind < 0.55) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 2, mod); await M('mouseReleased', x, y, 'left', 0, 2, mod); }
    else if (kind < 0.62) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: (rnd() - .5) * 200, deltaY: (rnd() - .5) * 400, modifiers: mod }); }
    else {
      const k = keys[Math.floor(rnd() * keys.length)];
      const m = [0, 0, 0, 4, 8, 1, 4 | 8][Math.floor(rnd() * 7)];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Enter: 13, Escape: 27, Delete: 46, Backspace: 8, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 }[k] || 0), modifiers: m, text: m ? undefined : (k.length === 1 ? k : undefined) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, modifiers: m });
    }
    if (i % 15 === 0) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(60);
      const inv = await ev(`JSON.stringify(${INVARIANTS})`); if (inv !== '[]') { console.log('étape', i, 'anomalies:', inv); bad++; if (bad > 5) break; } }
  }
  await sleep(500);
  console.log('anomalies finales:', await ev(`JSON.stringify(${INVARIANTS})`));
  console.log('état final:', await ev(`'pistes='+state.project.tracks.length+' groupes='+state.project.buses.length+' rec='+state.recording+' lecture='+state.playing+' éditeur='+(window.PulsePianoRoll&&PulsePianoRoll.isOpen())`));
  await shot(`/private/tmp/claude-501/qa/fuzz-${seed0}.jpg`);
};
