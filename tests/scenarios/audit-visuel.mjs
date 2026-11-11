// Grand tour visuel : chaque écran / menu / fenêtre passe au détecteur (visu-lib) + capture dans $VISU_DIR
import { boot, J, instru, RAP, mouse } from './qa-lib.mjs';
import { look } from './visu-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const m = mouse(send);
  const DIR = process.env.VISU_DIR || '/tmp'; let total = 0;
  const L = async (label) => { await sleep(250); total += (await look(c, label, DIR)).length; };
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false, w: +(process.env.VISU_W || 1440), h: +(process.env.VISU_H || 860) });
  await instru(ev, 8, 0, 0); await sleep(300);
  await ev(`(()=>{ const t=state.project.tracks[2]; t.effects=['eq','comp','sat','deess','delay','reverb','fet76','opto2a']; state.selectedTrack=2; renderInspector&&renderInspector(); refreshStrips&&refreshStrips(); })()`);
  await L('01 studio');
  // survol de chaque case de plugin
  const rows = await J(ev, `return [...document.querySelectorAll('.insp-fx-row')].map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent.trim()}}).filter(o=>o.y>0)`);
  for (const [i, r] of rows.slice(0, 6).entries()) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }); await L('02 survol case ' + i + ' ' + r.t.slice(0, 12)); }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  // plugins externes (simulés : pas de moteur natif dans Chrome) : noms longs dans la tranche et dans l'onglet Externes
  await ev(`(()=>{ const t=state.project.tracks[3]; t.effects=['vst#1','vst#2','vst#3']; t.effectParams={'vst#1':{name:'FabFilter Pro-Q 4'},'vst#2':{name:'UAD Neve 1073 Preamp & EQ Collection'},'vst#3':{name:'Auto-Tune Pro X'}}; state.selectedTrack=3; renderInspector&&renderInspector(); refreshStrips&&refreshStrips();
    const fake=[['FabFilter','Pro-Q 4'],['FabFilter','Pro-C 2'],['Universal Audio (UADx)','UADx Neve 1073 Preamp and EQ Collection'],['Universal Audio (UADx)','UADx Teletronix LA-2A Tube Compressor'],['Soundtoys','EchoBoy Jr.'],['Antares Audio Technologies','Auto-Tune Pro X'],['Celemony','Melodyne'],['Valhalla DSP, LLC','ValhallaVintageVerb']].map(([v,n],i)=>({name:n,vendor:v,path:'/fake/'+i}));
    PulseExt.available=()=>true; PulseExt.visible=()=>fake; })()`);
  await L('02b externes tranche');
  const xr = await J(ev, `return [...document.querySelectorAll('.insp-fx-row')].filter(e=>e.dataset.fx&&e.dataset.fx.startsWith('vst')).map(e=>{const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})`);
  for (const [i, r] of xr.entries()) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y }); await L('02b survol externe ' + i); }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await ev(`closeAllMenus(); openAddEffectMenu(document.querySelector('.slot-plus')||document.body, 3, state.project.tracks[3])`);
  await ev(`const b=[...document.querySelectorAll('.fam-range')].find(b=>b.textContent==='Externes'); b&&b.click()`); await L('02c menu effet Externes');
  const vend = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-cat:not([hidden])')].length`);
  for (let i = 0; i < Math.min(vend, 6); i++) { await ev(`const c=[...document.querySelectorAll('.fx-add-menu .fam-cat:not([hidden])')][${i}]; c && (c.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})), c.click())`); await L('02c Externes categorie ' + i); }
  await ev(`closeAllMenus(); state.selectedTrack=2; renderInspector&&renderInspector();`);
  // menu + Effet, chaque onglet
  await ev(`closeAllMenus(); openAddEffectMenu(document.querySelector('.slot-plus')||document.body, 2, state.project.tracks[2])`);
  await L('03 menu effet');
  const tabs = await J(ev, `return [...document.querySelectorAll('.fam-range')].map(b=>b.textContent)`);
  for (const t of tabs) { await ev(`[...document.querySelectorAll('.fam-range')].find(b=>b.textContent===${JSON.stringify(t)}).click()`); await L('03 menu effet onglet ' + t); }
  // menu des envois + paquet de bus
  await ev(`closeAllMenus(); openSendTargetMenu(document.querySelector('.slot-plus')||document.body, 'track', state.project.tracks[2])`); await L('04 menu envois');
  await ev(`const r=[...document.querySelectorAll('.ctx-has-sub')].find(e=>e.textContent.includes('33')); r && r.dispatchEvent(new MouseEvent('mouseenter'))`); await L('04 menu envois 33-64');
  // clic droit piste + sous-menus
  await ev(`closeAllMenus(); openTrackContextMenu(300, 200, 2, state.project.tracks[2])`); await L('05 menu piste');
  const subs = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu > .ctx-has-sub')].map(e=>e.textContent)`);
  for (const [i, s] of subs.entries()) { await ev(`[...document.querySelectorAll('.track-ctx-menu > .ctx-has-sub')][${i}].dispatchEvent(new MouseEvent('mouseenter'))`); await L('05 menu piste > ' + s); }
  // clic droit région
  await ev(`closeAllMenus(); openClipContextMenu(500, 300, 0, 0)`); await L('06 menu region');
  const subs2 = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu > .ctx-has-sub')].map(e=>e.textContent)`);
  for (const [i, s] of subs2.entries()) { await ev(`[...document.querySelectorAll('.track-ctx-menu > .ctx-has-sub')][${i}].dispatchEvent(new MouseEvent('mouseenter'))`); await L('06 menu region > ' + s); }
  await ev(`closeAllMenus()`);
  // fenêtres de chaque effet
  const fx = await J(ev, `return FX_ORDER`);
  for (const f of fx) { await ev(`document.querySelectorAll('.fx-panel,.plug-win').forEach(p=>p.remove()); try { openEffectPanel(2, ${JSON.stringify(f)}, document.querySelector('.insp-fx-row')||document.body) } catch(e) { console.log('ERR '+e) }`); await L('07 effet ' + f); }
  await ev(`document.querySelectorAll('.fx-panel,.plug-win').forEach(p=>p.remove())`);
  // table de mixage, réglages, export, aide
  await ev(`toggleMixer()`); await L('08 table de mixage'); await ev(`toggleMixer()`);
  await ev(`openSettings()`); await L('09 reglages'); await ev(`document.querySelectorAll('.modal,.settings-modal,[class*=modal]').forEach(e=>e.remove())`);
  await ev(`openExportModal()`); await L('10 export'); await ev(`document.querySelectorAll('[class*=modal]').forEach(e=>e.remove())`);
  await ev(`openCheatSheet()`); await L('11 raccourcis'); await ev(`document.querySelectorAll('[class*=modal],[class*=cheat]').forEach(e=>e.remove())`);
  // piano roll
  await ev(`(()=>{ const t={name:'Piano',type:'keys',color:'#22D3EE',volume:100,clips:[{start:0,duration:2,midi:{inst:'piano',beats:4,notes:[{s:0,d:1,p:60,v:100}],bpm:120}}]}; state.project.tracks.push(t); renderAll(); openMidiEditor(state.project.tracks.length-1,0,true); })()`);
  await L('12 piano roll');
  console.log('=== TOTAL défauts relevés : ' + total);
};
