// Captures ciblées de fenêtres d'effet : VISU_FX=comp,mband VISU_DIR=… bash tests/run.sh tests/scenarios/visu-fx.mjs
// (outil de travail pour la passe visuelle ; ne vérifie rien, écrit des PNG nets ×2 de chaque fenêtre)
import fs from 'fs';
import { boot, J, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  const DIR = process.env.VISU_DIR || '/private/tmp/claude-501/qa';
  const W = +(process.env.VISU_W || 1440), H = +(process.env.VISU_H || 860);
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: W, h: H });
  await instru(ev, 8, 0, 0); await sleep(300);
  const all = await J(ev, `return FX_ORDER`);
  const list = (process.env.VISU_FX ? process.env.VISU_FX.split(',') : all);
  await ev(`(()=>{ const t=state.project.tracks[2]; t.effects=${JSON.stringify(list)}.slice(); state.selectedTrack=2; renderInspector&&renderInspector(); })()`);
  if (process.env.VISU_PRE) await ev(process.env.VISU_PRE);
  for (const f of list) {
    await ev(`document.querySelectorAll('.fx-panel,.plug-win').forEach(p=>p.remove()); try { openEffectPanel(2, ${JSON.stringify(f)}, document.querySelector('.insp-fx-row')||document.body) } catch(e) { console.log('ERR '+e) }`);
    await sleep(450);
    const r = await J(ev, `const p=[...document.querySelectorAll('.fx-panel,.plug-win')].pop(); if(!p) return null; const r=p.getBoundingClientRect(); const pt=document.elementsFromPoint(Math.min(innerWidth-2,r.right+10), Math.min(innerHeight-2,r.bottom-8)).slice(0,3).map(e=>e.tagName+'.'+[...e.classList].join('.')); return {x:r.left,y:r.top,w:r.width,h:r.height,cls:p.className,zoom:getComputedStyle(p).zoom,pt}`);
    console.log(f, JSON.stringify(r));
    if (process.env.VISU_OUT) console.log('  dépasse :', JSON.stringify(await J(ev, `const p=[...document.querySelectorAll('.fx-panel,.plug-win')].pop(); const R=p.getBoundingClientRect(); return [...p.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0&&(r.right>R.right+2||r.bottom>R.bottom+2)}).slice(0,6).map(e=>{const r=e.getBoundingClientRect(); return e.tagName+'.'+[...e.classList].join('.')+' '+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height)})`)));
    if (!r) continue;
    const pad = 26, x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(W - x, r.w + 2 * pad), height: Math.min(H - y, r.h + 2 * pad), scale: +(process.env.VISU_SCALE || 1.5) } });
    fs.writeFileSync(`${DIR}/fx-${f}.png`, Buffer.from(shot.result.data, 'base64'));
  }
};
