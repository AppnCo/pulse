// Fuzz n°2 : éditeur de pas / piano roll + texte + mixeur + inspecteur. QA_SEED, QA_N, QA_MODE = drums|piano|mix
import { boot, instru, RAP, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot, logs } = c;
  const seed0 = parseInt(process.env.QA_SEED || '3'), mode = process.env.QA_MODE || 'drums';
  const proj = JSON.parse(JSON.stringify(RAP));
  proj.lyrics = 'Ligne un\nLigne deux\nLigne trois';
  proj.tracks.push({ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', output: 'master', clips: [] }, { name: 'Drums', type: 'drums', midiInst: 'drums', color: '#F59E0B', output: 'master', clips: [] });
  await boot(c, proj, { w: 1280, h: 800 });
  await instru(ev, 8, 0, 0); await sleep(300);
  await ev(`createMidiClip(5,0,true)`); await sleep(500); await ev(`PulsePianoRoll.close(true)`);
  await ev(`createMidiClip(6,0,true)`); await sleep(500); await ev(`PulsePianoRoll.close(true)`);
  await ev(`setLyricsOpen(true); setInspectorOpen(true)`);
  if (mode === 'mix') await ev(`toggleMixer()`); else await ev(`openMidiEditor(${mode === 'piano' ? 5 : 6},0,false)`);
  await sleep(700);
  let seed = seed0; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const W = 1280, H = 800;
  const M = (type, x, y, button = 'left', buttons = 1, clickCount = 1, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount, modifiers });
  const keys = [' ', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'w', 'e', 't', 'y', 'u', 'o', 'z', 'x', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Delete', 'Backspace', 'Tab', 'm', 'r'];
  const N = parseInt(process.env.QA_N || '250'); let bad = 0;
  const CHECK = `(()=>{ const out=[]; ${INVARIANTS.replace(/^\(\(\)=>\{/, 'const base=(()=>{').replace(/\}\)\(\)$/, '})();')} out.push(...base);
    state.project.tracks.forEach(t=>(t.clips||[]).forEach(c=>{ if(c.midi){ const m=c.midi; if(!(m.beats>0)) out.push('beats '+m.beats); (m.notes||[]).forEach(n=>{ for(const k of ['s','d','p','v']) if(!Number.isFinite(n[k])) out.push('note '+k+'='+n[k]); if(n.p<0||n.p>127) out.push('hauteur '+n.p); if(n.s<0) out.push('début<0'); if(n.d<=0) out.push('durée<=0'); if(n.v<1||n.v>127) out.push('vélocité '+n.v); }); if(Math.abs(c.duration-m.beats*60/(m.bpm||state.project.bpm))>0.02 && !c.loopEnd && !c.offset) out.push('durée région '+c.duration+' vs '+(m.beats*60/(m.bpm||state.project.bpm))); } }));
    const txt=document.body.innerText; for (const w of ['NaN','undefined','Infinity','[object','null dB','NaN dB']) if (txt.includes(w)) out.push('texte contient « '+w+' »');
    return out; })()`;
  for (let i = 0; i < N; i++) {
    const kind = rnd(), x = 5 + rnd() * (W - 10), y = 5 + rnd() * (H - 10), mod = [0, 0, 0, 4, 8, 1][Math.floor(rnd() * 6)];
    if (kind < 0.3) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1, mod); await M('mouseReleased', x, y, 'left', 0, 1, mod); }
    else if (kind < 0.5) { const x2 = x + (rnd() - .5) * 400, y2 = y + (rnd() - .5) * 200; await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1, mod); await M('mouseMoved', x2, y2, 'left', 1, 1, mod); await M('mouseReleased', x2, y2, 'left', 0, 1, mod); }
    else if (kind < 0.56) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'right', 2); await M('mouseReleased', x, y, 'right', 0); }
    else if (kind < 0.6) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 2, mod); await M('mouseReleased', x, y, 'left', 0, 2, mod); }
    else if (kind < 0.66) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: (rnd() - .5) * 200, deltaY: (rnd() - .5) * 400, modifiers: mod }); }
    else {
      const k = keys[Math.floor(rnd() * keys.length)]; const m = [0, 0, 0, 4, 8, 4 | 8][Math.floor(rnd() * 6)];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Enter: 13, Escape: 27, Delete: 46, Backspace: 8, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[k] || 0), modifiers: m, text: m ? undefined : (k.length === 1 ? k : undefined) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, modifiers: m });
    }
    if (i % 12 === 0) { await sleep(120);
      const inv = await ev(`JSON.stringify(${CHECK})`); if (inv !== '[]') { console.log('étape', i, 'anomalies:', inv.slice(0, 400)); bad++; if (bad > 6) break; } }
  }
  await sleep(500);
  console.log('anomalies finales:', (await ev(`JSON.stringify(${CHECK})`)).slice(0, 600));
  console.log('état final:', await ev(`'pistes='+state.project.tracks.length+' rec='+state.recording+' lecture='+state.playing+' éditeur='+(window.PulsePianoRoll&&PulsePianoRoll.isOpen())`));
  await shot(`/private/tmp/claude-501/qa/fuzz2-${mode}-${seed0}.jpg`);
};
