// QA3 n°9 : fuzz souris+clavier sur la timeline, invariants (durées, NaN, cycles, chevauchements). QA_SEED, QA_N
import { boot, instru, RAP, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, logs } = c;
  const proj = JSON.parse(JSON.stringify(RAP));
  await boot(c, proj, { w: 1280, h: 800 });
  await instru(ev, 8, 0, 0); await sleep(300);
  await ev(`(()=>{ const t=state.project.tracks; t[2].clips=[{id:t[0].clips[0].id,name:'L1',start:1,duration:2,offset:0},{id:t[0].clips[0].id,name:'L2',start:4,duration:2,offset:1,loopEnd:9}]; t[3].clips=[{id:t[0].clips[0].id,name:'B1',start:0,duration:3,offset:0}]; renderAll(); })()`);
  await sleep(300);
  let seed = parseInt(process.env.QA_SEED || '5'); const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const M = (type, x, y, button = 'left', buttons = 1, cc = 1, mod = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: cc, modifiers: mod });
  const keys = [' ', 'a', 's', 'd', 'g', 'r', 'z', 'x', 'c', 'v', 'b', 'Escape', 'Delete', 'Backspace', 'Shift', 'ArrowLeft', 'ArrowRight', 'Tab'];
  const CHECK = `(()=>{ const out=${INVARIANTS}; const p=state.project;
    p.tracks.forEach(t=>{ const cl=(t.clips||[]).filter(c=>!c.recording).slice().sort((a,b)=>a.start-b.start);
      for(let i=0;i<cl.length;i++){ const c=cl[i]; if(c.loopEnd!==undefined && c.loopEnd<c.start) out.push('loopEnd<start '+t.name+' '+c.name+' '+c.loopEnd+'<'+c.start); if(c.duration<0.01) out.push('mini-région '+t.name+' '+c.name+' '+c.duration);
        if(i&&cl[i-1].start+cl[i-1].duration>c.start+0.01&&!t.isCapture) out.push('chevauchement '+t.name+' '+cl[i-1].name+'/'+c.name); } });
    const armed=p.tracks.filter(t=>t.armed).length; if(armed>1) out.push('pistes armées '+armed);
    const txt=document.body.innerText; for (const w of ['NaN','undefined','Infinity']) if (txt.includes(w)) out.push('texte « '+w+' »');
    return out; })()`;
  const seen = new Set(); const N = parseInt(process.env.QA_N || '300');
  for (let i = 0; i < N; i++) {
    const k = rnd(), x = 5 + rnd() * 1270, y = 90 + rnd() * 600, mod = [0, 0, 0, 4, 8, 1][Math.floor(rnd() * 6)];
    if (k < 0.35) { const x2 = x + (rnd() - .5) * 500, y2 = y + (rnd() - .5) * 250; await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1, mod); await M('mouseMoved', (x + x2) / 2, (y + y2) / 2, 'left', 1, 1, mod); await M('mouseMoved', x2, y2, 'left', 1, 1, mod); await M('mouseReleased', x2, y2, 'left', 0, 1, mod); }
    else if (k < 0.5) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1, mod); await M('mouseReleased', x, y, 'left', 0, 1, mod); }
    else if (k < 0.6) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'left', 1, 1); await M('mouseReleased', x, y, 'left', 0, 1); await M('mousePressed', x, y, 'left', 1, 2); if (rnd() < .5) await M('mouseMoved', x + 40, y, 'left', 1, 2); await M('mouseReleased', x + 10, y, 'left', 0, 2); }
    else if (k < 0.66) { await M('mouseMoved', x, y); await M('mousePressed', x, y, 'right', 2); await M('mouseReleased', x, y, 'right', 0); }
    else if (k < 0.72) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: (rnd() - .5) * 200, deltaY: (rnd() - .5) * 400, modifiers: mod }); }
    else { const kk = keys[Math.floor(rnd() * keys.length)]; const m = [0, 0, 0, 4, 8, 4 | 8][Math.floor(rnd() * 6)];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: kk, code: kk.length === 1 ? 'Key' + kk.toUpperCase() : kk, windowsVirtualKeyCode: kk.length === 1 ? kk.toUpperCase().charCodeAt(0) : ({ Escape: 27, Delete: 46, Backspace: 8, Tab: 9, Shift: 16, ArrowLeft: 37, ArrowRight: 39 }[kk] || 0), modifiers: m, text: m ? undefined : (kk.length === 1 ? kk : undefined) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: kk, code: kk.length === 1 ? 'Key' + kk.toUpperCase() : kk, modifiers: m }); }
    if (i % 10 === 0) { await sleep(80); const inv = JSON.parse(await ev(`JSON.stringify(${CHECK})`) || '[]'); for (const a of inv) if (!seen.has(a)) { seen.add(a); console.log('étape', i, a); } }
  }
  console.log('fin, lecture=', await ev('state.playing'), 'anomalies distinctes=', seen.size);
};
