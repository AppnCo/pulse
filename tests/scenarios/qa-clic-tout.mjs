// Clique sur CHAQUE bouton visible de l'interface (studio chargé avec un projet riche) : exceptions + invariants
import { boot, instru, RAP, mouse, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, logs, shot } = c;
  const proj = JSON.parse(JSON.stringify(RAP));
  proj.tracks.push({ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', output: 'master', clips: [] });
  await boot(c, proj, { w: parseInt(process.env.QA_W || '1440'), h: parseInt(process.env.QA_H || '860') });
  const Ms = mouse(send);
  await instru(ev, 8, 0, 0); await instru(ev, 4, 2, 1); await ev(`createMidiClip(5, 0)`); await sleep(900); await ev(`PulsePianoRoll.close(true)`);
  if (process.env.QA_MIXER) await ev(`toggleMixer()`);
  await sleep(400);
  const snap = await ev(`JSON.stringify(state.project)`);
  const SEL = `button, [role=button], .strip-fx-slot, .tune-key-btn, .group-toggle, .g-m, .g-s, .g-son, summary, .tab, .chip, .sound-chip`;
  const total = await ev(`[...document.querySelectorAll(${JSON.stringify(SEL)})].length`);
  console.log('éléments cliquables au départ:', total);
  const seen = new Set();
  for (let k = 0; k < total + 20; k++) {
    await ev(`document.querySelectorAll('.fx-panel,.track-ctx-menu,.modal-backdrop,#exportModal,.cheat-sheet,.pulse-select-menu').forEach(e=>e.remove()); if(window.PulsePianoRoll&&PulsePianoRoll.isOpen()) PulsePianoRoll.close(true); state.project=JSON.parse(${JSON.stringify(snap)}); state.playing&&togglePlay(); renderAll(); 0`);
    await sleep(80);
    const el = JSON.parse(await ev(`JSON.stringify((()=>{ const all=[...document.querySelectorAll(${JSON.stringify(SEL)})].filter(e=>{const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); return r.width>2&&r.height>2&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&cs.visibility!=='hidden'&&cs.pointerEvents!=='none'});
      const e=all[${k}]; if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,id:e.id,cls:String(e.className).slice(0,40),txt:(e.textContent||'').trim().slice(0,25),n:all.length}})())`));
    if (!el) break;
    const key = el.id + el.cls + el.txt;
    const l0 = logs.length;
    const p0 = await ev(`JSON.stringify(${INVARIANTS})`);
    await Ms.click(el.x, el.y); await sleep(220);
    const inv = await ev(`JSON.stringify(${INVARIANTS})`);
    const st = await ev(`'rec='+state.recording+' play='+state.playing`);
    const bad = logs.length > l0 || inv !== '[]';
    if (bad || process.env.QA_VERBOSE) console.log(`[${k}/${el.n}] ${el.id || el.cls} « ${el.txt} »`, logs.length > l0 ? 'EXC ' + logs.slice(l0).join(' / ').slice(0, 200) : '', inv !== '[]' ? 'INV ' + inv : '', st);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await ev(`state.recording&&punchOut&&punchOut(); 0`);
  }
  console.log('fini');
};
