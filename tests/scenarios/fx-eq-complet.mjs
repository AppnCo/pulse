// EQ de l'écho / de la reverb : mêmes réglages que le grand EQ (formes en icônes, champs à taper, pente, pause, + Point, Agrandir)
import fs from 'fs';
import { boot, J, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false });
  await instru(ev, 8, 0, 0); await sleep(300);
  for (const fx of ['reverb', 'delay']) {
    await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); state.project.tracks[2].effects=['${fx}']; delete (state.project.tracks[2].effectParams||{}).${fx}; openEffectPanel(2,'${fx}',document.body)`); await sleep(400);
    const P = `document.querySelector('.plug-win[data-fx="${fx}"]')`, EQ = `((state.project.tracks[2].effectParams||{}).${fx}||{}).eq`;
    await ev(`${P}.querySelector('.rv-eq-add').click()`); await sleep(150);
    let st = await J(ev, `const d=${P}.querySelector('.rv-eq-detail'); return { n: (${EQ}||[]).length, shown: !d.hidden, types: d.querySelectorAll('.eq-types [data-type]').length, f: d.querySelector('.eq-f')?.value }`);
    check(fx + ' : + Point pose un point et ouvre ses réglages', st.n === 1 && st.shown && st.types === 7 && st.f === '1000', JSON.stringify(st));
    await ev(`{ const d=${P}.querySelector('.rv-eq-detail'); const f=d.querySelector('.eq-f'); f.focus(); f.value='2,5k'; f.dispatchEvent(new Event('change',{bubbles:true})) }`); await sleep(150);
    await ev(`{ const d=${P}.querySelector('.rv-eq-detail'); const g=d.querySelector('.eq-g'); g.focus(); g.value='-4,5'; g.dispatchEvent(new Event('change',{bubbles:true})) }`); await sleep(150);
    st = await J(ev, `return ${EQ}[0]`);
    check(fx + ' : fréquence et gain tapés au clavier', st.freq === 2500 && st.gain === -4.5, JSON.stringify(st));
    await ev(`${P}.querySelector('.rv-eq-detail [data-type="hpf"]').click()`); await sleep(150);
    await ev(`{ const s=${P}.querySelector('.rv-eq-detail .eq-slope'); s.value='36'; s.dispatchEvent(new Event('change',{bubbles:true})) }`); await sleep(150);
    st = await J(ev, `return ${EQ}[0]`);
    check(fx + ' : forme Coupe-bas + pente 36 dB/oct', st.type === 'hpf' && st.slope === 36, JSON.stringify(st));
    await ev(`${P}.querySelector('.rv-eq-detail [data-type="tilt"]').click()`); await sleep(150);
    st = await J(ev, `return ${EQ}[0]`);
    check(fx + ' : forme Pente (comme le grand EQ)', st.type === 'tilt' && st.slope === undefined, JSON.stringify(st));
    await ev(`${P}.querySelector('.rv-eq-detail .eq-onoff').click()`); await sleep(150);
    st = await J(ev, `return ${EQ}[0]`);
    check(fx + ' : point en pause', st.on === false, JSON.stringify(st));
    const w0 = await J(ev, `return ${P}.querySelector('.rv-eq-host svg').getBoundingClientRect().width`);
    await ev(`${P}.querySelector('.rv-eq-big').click()`); await sleep(200);
    const w1 = await J(ev, `return ${P}.querySelector('.rv-eq-host svg').getBoundingClientRect().width`);
    check(fx + ' : Agrandir double la largeur de l\'EQ', w1 > w0 * 1.8, `${Math.round(w0)} → ${Math.round(w1)} px`);
    if (process.env.VISU_DIR) { const r = await J(ev, `const r=${P}.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}`); const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: Math.min(860 - r.y, r.h), scale: 1.4 } }); fs.writeFileSync(`${process.env.VISU_DIR}/fxeq-${fx}.png`, Buffer.from(shot.result.data, 'base64')); }
    await ev(`${P}.querySelector('.rv-eq-big').click()`); await sleep(150);
    await ev(`${P}.querySelector('.rv-eq-detail .eq-del').click()`); await sleep(150);
    st = await J(ev, `return { n: (${EQ}||[]).length, hidden: ${P}.querySelector('.rv-eq-detail').hidden }`);
    check(fx + ' : ✕ retire le point, réglages refermés', st.n === 0 && st.hidden, JSON.stringify(st));
  }
};
