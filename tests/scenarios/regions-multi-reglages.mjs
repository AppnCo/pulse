// 31/10 : plusieurs régions choisies → le gain (clic droit tiré), le fondu tiré, son arrondi, le mute,
// et le menu du clic droit (volume, normaliser, couleur, retirer un fondu, effets) s'appliquent à toutes, comme dans Logic
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  const P = { id: 'rm', name: 'RM', bpm: 120, buses: [], tracks: ['A', 'B', 'C'].map(n => ({ name: n, type: 'audio', color: '#A855F7', output: 'master', clips: [] })) };
  await boot(c, P, { mic: false });
  for (let i = 0; i < 3; i++) await instru(ev, 4, i, 1);
  await sleep(400);
  const J = async (code) => JSON.parse(await ev(`JSON.stringify((()=>{${code}})())`));
  const R = (code) => ev(`(async()=>{${code}})()`);
  const clips = `state.project.tracks.map(t=>t.clips[0])`;
  const db = (g) => g == null ? 0 : (g > 0 ? Math.round(20 * Math.log10(g) * 10) / 10 : -99);
  await R(`const cs=${clips}; cs[0].gain=0.5; state.selectedClips=new Set(['0:0','1:0','2:0']); state.selectedClip={trackIdx:1,clipIdx:0}; renderTimelineTracks(); return 1`);
  check('3 régions présentes', (await J(`return ${clips}.filter(Boolean).length`)) === 3);
  // 1. outil gain : clic droit tiré vers le haut sur B
  const p = await J(`const r=document.querySelector('.timeline-track[data-i="1"] .clip[data-ci="0"]').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height*0.7}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
  for (let k = 1; k <= 5; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y - k * 6, buttons: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y - 30, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(300); await ev(`closeAllMenus()`);
  let g = (await J(`return ${clips}.map(c=>c.gain ?? null)`)).map(db);
  check('gain tiré : les 3 régions montent de +6 dB, chacune garde son écart', g[1] === 6 && g[2] === 6 && g[0] === 0, JSON.stringify(g));
  await R(`undoAction(); return 1`); await sleep(200);
  g = (await J(`return ${clips}.map(c=>c.gain ?? null)`)).map(db);
  check('⌘Z : un seul retour remet les 3', g[0] === -6 && g[1] === 0 && g[2] === 0, JSON.stringify(g));
  await R(`state.selectedClips=new Set(['0:0','1:0','2:0']); renderTimelineTracks(); return 1`);
  // 2. fondu tiré sur A
  await R(`const el=document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="0"]'); const r=el.getBoundingClientRect();
    startFadeDrag({clientX:r.left+2, clientY:r.top+4, preventDefault(){}, stopPropagation(){}}, 'in', 0, 0);
    document.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+2+state.pxPerSecond*0.5, clientY:r.top+4, bubbles:true}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return 1`);
  await sleep(200);
  let f = await J(`return ${clips}.map(c=>Math.round((c.fadeIn||0)*100)/100)`);
  check('fondu tiré : même fondu d\'entrée (0,5 s) sur les 3', f.every(v => v === 0.5), JSON.stringify(f));
  // arrondi du fondu
  await R(`const el=document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="0"]'); const r=el.getBoundingClientRect();
    startFadeCurveDrag({clientX:r.left+10, clientY:r.top+20, preventDefault(){}, stopPropagation(){}}, 'in', 0, 0);
    document.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+10, clientY:r.top-10, bubbles:true}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return 1`);
  await sleep(200);
  const k = await J(`return ${clips}.map(c=>c.fadeInCurve ?? 1)`);
  check('arrondi du fondu : le même sur les 3', k[0] !== 1 && k.every(v => v === k[0]), JSON.stringify(k));
  // 3. outil mute (⌘ + clic)
  await R(`runClipTool('mute', {clientX:0,clientY:0}, 2, 0, ()=>0); return 1`);
  check('mute : les 3 régions coupées', (await J(`return ${clips}.map(c=>!!c.muted).join()`)) === 'true,true,true');
  await R(`runClipTool('mute', {clientX:0,clientY:0}, 2, 0, ()=>0); return 1`);
  // 4. menu du clic droit
  const menu = async (path) => {
    await ev(`closeAllMenus(); state.selectedClips=new Set(['0:0','1:0','2:0']); openClipContextMenu(300, 300, 1, 0)`); await sleep(150);
    for (const label of path) {
      const ok = await ev(`(()=>{ const it=[...document.querySelectorAll('.clip-ctx-menu .ctx-item, .clip-ctx-menu .ctx-swatch')].reverse().find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)})); if(!it) return false; it.click(); return true; })()`);
      if (!ok) return false; await sleep(200);
    }
    return true;
  };
  check('menu : Normaliser à −3 dB', await menu(['Son', 'Normaliser à −3 dB']));
  g = (await J(`return ${clips}.map(c=>c.gain ?? null)`)).map(db);
  check('normaliser : les 3 régions ont un gain (le même son → le même gain)', g.every(v => v !== 0 && v === g[0]), JSON.stringify(g));
  check('menu : remettre le volume d\'origine', await menu(['Son', 'Remettre le volume d']));
  check('volume d\'origine sur les 3', (await J(`return ${clips}.every(c=>c.gain==null)`)));
  check('menu : retirer le fondu d\'entrée', await menu(['Fondus', 'Supprimer le fondu d\'entrée']));
  check('fondu retiré sur les 3', (await J(`return ${clips}.every(c=>!c.fadeIn)`)));
  await ev(`closeAllMenus(); state.selectedClips=new Set(['0:0','1:0','2:0']); openClipContextMenu(300, 300, 1, 0)`); await sleep(150);
  await ev(`document.querySelectorAll('.clip-ctx-menu .ctx-swatch')[3].click()`); await sleep(150);
  const col = await J(`return ${clips}.map(c=>c.color||'')`);
  check('couleur : la même sur les 3', col[0] && col.every(v => v === col[0]), JSON.stringify(col));
  await R(`addClipFx(1, 0, 'chorus'); return 1`);
  check('effet de région : posé sur les 3', (await J(`return ${clips}.every(c=>c.fx && c.fx.effects.includes('chorus'))`)));
  // une seule région choisie : seulement elle
  await R(`state.selectedClips=new Set(); state.selectedClip={trackIdx:0,clipIdx:0}; renderTimelineTracks(); return 1`);
  await R(`runClipTool('mute', {clientX:0,clientY:0}, 0, 0, ()=>0); return 1`);
  check('une seule région : seulement elle', (await J(`return ${clips}.map(c=>!!c.muted).join()`)) === 'true,false,false');
};
