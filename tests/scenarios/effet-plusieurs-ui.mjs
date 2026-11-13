// Le même effet plusieurs fois, à la souris : menu « + » → Compresseur une 2e fois → « Compresseur 2 » avec ses propres réglages,
// sa fenêtre, sa courbe d'automation ; suppression = il part avec ses réglages ; le 1er ne bouge pas
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'eu1', name: 'EU', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['comp'], effectParams: { comp: { threshold: -20, ratio: 3 } } }] }, { mic: false });
  const click = async (sel, text) => { const r = JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.offsetParent); const el=${text ? `els.find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}; if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`)); if (!r) return false; for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(300); return true; };
  await click('.track-item');
  await click('#inspector .insp-add-fx');
  await click('.track-ctx-menu .fam-cat', 'Dynamique'); await sleep(100);
  const ok = await click('.track-ctx-menu .fam-fx', 'Compresseur');
  const st = JSON.parse(await ev(`JSON.stringify({fx: state.project.tracks[0].effects, p: state.project.tracks[0].effectParams, rows: [...document.querySelectorAll('#inspector .insp-fx-row span')].map(s=>s.textContent), win: [...document.querySelectorAll('.fx-panel.plug-win')].map(p=>p.dataset.fx + '|' + (p._plugT && p._plugT.__fxId || '') + '|' + p.querySelector('.fx-title').textContent.trim())})`));
  console.log(JSON.stringify(st));
  check('menu : Compresseur cliqué', ok);
  check('2e compresseur ajouté (comp#2)', JSON.stringify(st.fx) === '["comp","comp#2"]', JSON.stringify(st.fx));
  check('affiché « Compresseur 2 »', st.rows.includes('Compresseur 2'), st.rows.join(','));
  check('sa fenêtre s\'ouvre, numérotée', st.win.some(w => w.startsWith('comp|comp#2|') && /Compresseur 2( —|$)/.test(w)), st.win.join(' / '));
  // réglage dans la fenêtre du 2e (comme un bouton tourné) : seul comp#2 change
  await ev(`(()=>{ const p=[...document.querySelectorAll('.fx-panel.plug-win')].find(p=>p._plugT && p._plugT.__fxId==='comp#2'); const t=p._plugT; t.effectParams.comp = {...(t.effectParams.comp||{}), threshold: -35}; })()`);
  const p2 = JSON.parse(await J(ev, `return JSON.stringify(state.project.tracks[0].effectParams)`));
  check('réglage du 2e rangé à part', p2['comp#2'] && p2['comp#2'].threshold === -35 && p2.comp.threshold === -20, JSON.stringify(p2));
  // bouton marche / arrêt de la fenêtre du 2e : n'éteint que lui
  await ev(`(()=>{ const p=[...document.querySelectorAll('.fx-panel.plug-win')].find(p=>p._plugT && p._plugT.__fxId==='comp#2'); const b=p.querySelector('.fx-bypass'); b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(150);
  check('éteindre le 2e garde le 1er', JSON.stringify(await J(ev, `return state.project.tracks[0].effects`)) === '["comp"]', JSON.stringify(await J(ev, `return state.project.tracks[0].effects`)));
  await ev(`(()=>{ const p=[...document.querySelectorAll('.fx-panel.plug-win')].find(p=>p._plugT && p._plugT.__fxId==='comp#2'); const b=p.querySelector('.fx-bypass'); b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true})); })()`); await sleep(150);
  check('le rallumer le remet', JSON.stringify(await J(ev, `return state.project.tracks[0].effects`)) === '["comp","comp#2"]');
  // automation : la liste propose « Compresseur 2 · … » et une courbe touchée va dans fx:comp#2
  const groups = await J(ev, `return autoParamGroups(state.project.tracks[0]).map(g=>g[0]).join(',')`);
  check('automation : « Compresseur 2 » dans la liste', groups.includes('Compresseur 2'), groups);
  const lab = await J(ev, `return (autoInfo(state.project.tracks[0], 'fx:comp#2:threshold')||{}).label`);
  check('automation : nom de la courbe', lab === 'Compresseur 2 · Seuil', lab);
  console.log('touch :', await J(ev, `try { state.automationMode=true; const p=[...document.querySelectorAll('.fx-panel.plug-win')].find(p=>p._plugT && p._plugT.__fxId==='comp#2'); autoTouch(p._plugT, 'fx:comp:threshold'); return 'ok'; } catch(e) { return String(e) }`));
  check('toucher un bouton du 2e choisit sa courbe', await J(ev, `return state.project.tracks[0].autoParam`) === 'fx:comp#2:threshold', await J(ev, `return state.project.tracks[0].autoParam`));
  await ev(`state.automationMode=false`);
  // suppression du 2e : la croix de sa ligne
  await ev(`(()=>{ const r=[...document.querySelectorAll('#inspector .insp-fx-row')].find(r=>r.dataset.fx==='comp#2'); r.querySelector('.insp-del').click(); })()`); await sleep(300);
  const after = JSON.parse(await J(ev, `return JSON.stringify({fx: state.project.tracks[0].effects, p: Object.keys(state.project.tracks[0].effectParams), win: document.querySelectorAll('.fx-panel.plug-win').length})`));
  check('2e supprimé avec ses réglages, le 1er reste', JSON.stringify(after.fx) === '["comp"]' && !after.p.includes('comp#2'), JSON.stringify(after));
  // ⌘Z : il revient
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(300);
  check('⌘Z le ramène', JSON.stringify(await J(ev, `return state.project.tracks[0].effects`)) === '["comp","comp#2"]');
};
