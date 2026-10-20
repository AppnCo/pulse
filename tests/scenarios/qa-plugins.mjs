import { boot, instru, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  for (const [w, h] of [[1440, 860], [1000, 700]]) {
    await boot(c, RAP, { w, h });
    const Ms = mouse(send);
    await instru(ev, 6, 0, 0); await ev(`toggleMixer()`); await sleep(500);
    // EQ du groupe All Vocal (à droite)
    for (const [sel, nm] of [['.mixer-strips .strip[data-kind="track"][data-i="4"] .strip-fx-slot[data-fx="eq"]', 'eqAmb'], ['.mixer-strips .strip[data-kind="bus"][data-i="3"] .strip-fx-slot[data-fx="comp"]', 'compAV'], ['.mixer-strips .strip[data-kind="track"][data-i="0"] .strip-fx-slot[data-fx="comp"]', 'compInstru']]) {
      const p = await pos(ev, sel);
      if (!p) { console.log('absent', sel); continue; }
      await Ms.click(p.x, p.y); await sleep(500);
      const r = await ev(`JSON.stringify([...document.querySelectorAll('.fx-panel')].map(e=>{const r=e.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),cls:e.className.slice(0,40)}}))`);
      console.log(w, nm, r, 'fenêtre', w + 'x' + h);
      await shot(`/private/tmp/claude-501/qa/plug-${w}-${nm}.jpg`);
      await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
    }
  }
};
