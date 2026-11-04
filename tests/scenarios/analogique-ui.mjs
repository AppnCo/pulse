// Gamme Analogique dans l'interface : le menu « + » a deux gammes (Pulse / Analogique) ; Éclair 76 et Pulse 73 s'ajoutent,
// leur façade 3D s'ouvre (images des boutons chargées), un bouton tourné à la souris change le réglage, un poussoir de ratio
// se choisit, ⌘Z revient. Envois façon Logic : le menu propose « Bus 1 », l'envoi reste sur la piste à gauche,
// le bus s'affiche à droite ; clic sur l'envoi = son bus à droite ; clic sur la sortie = retour à la sortie.
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'au1', name: 'AU', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const pos = async (sel, text) => JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0); const el=${text ? `els.find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}; if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`));
  const mouse = async (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (sel, text) => { const r = await pos(sel, text); if (!r) return false; await mouse('mouseMoved', r, { buttons: 0 }); await mouse('mousePressed', r); await mouse('mouseReleased', r); await sleep(300); return true; };
  await click('.track-item');
  await click('#inspector .insp-add-fx');
  const ranges = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-range')].map(b=>b.textContent).join(',')`);
  check('menu : deux gammes', ranges === 'Pulse,Analogique', ranges);
  const pulseCats = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-cat')].filter(e=>!e.hidden).map(e=>e.textContent.trim()).join(',')`);
  check('gamme Pulse : pas de machines analogiques dans ses catégories', pulseCats.includes('Dynamique') && !pulseCats.includes('Compresseurs'), pulseCats);
  await click('.fx-add-menu .fam-range', 'Analogique');
  const anaCats = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-cat')].filter(e=>!e.hidden).map(e=>e.textContent.trim()).join(',')`);
  check('gamme Analogique : ses catégories seules', anaCats === 'Compresseurs,Préamplis et EQ', anaCats);
  check('menu : Éclair 76 cliqué', await click('.fx-add-menu .fam-fx', 'Éclair 76'));
  await sleep(600);
  const f = JSON.parse(await J(ev, `const p=document.querySelector('.fx-panel.plug-win[data-fx="fet76"]'); const imgs=p?[...p.querySelectorAll('image')]:[];
    return JSON.stringify({ fx: state.project.tracks[0].effects, open: !!p, imgs: imgs.length, row: [...document.querySelectorAll('#inspector .insp-fx-row span')].map(s=>s.textContent) })`));
  check('Éclair 76 ajouté', JSON.stringify(f.fx) === '["fet76"]', JSON.stringify(f.fx));
  check('sa ligne dans les inserts', f.row.includes('Éclair 76'), f.row.join(','));
  check('sa façade s\'ouvre avec ses boutons 3D', f.open && f.imgs >= 8, String(f.imgs));
  const loaded = await ev(`(async()=>{ const a = await Promise.all(['alu-big','bakelite','chicken','push-on','screw','gain73','trim73','midf73'].map(n=>fetch('assets/analog/'+n+'.webp').then(r=>r.ok))); return a.every(Boolean) })()`);
  check('images des boutons servies', loaded === true || loaded === 'true', String(loaded));
  // tourner l'Entrée vers le haut
  const k = await pos('.fx-panel.plug-win[data-fx="fet76"] .ana-k[data-key="input"] circle');
  await mouse('mouseMoved', k, { buttons: 0 }); await mouse('mousePressed', k);
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: k.x, y: k.y - i * 10 }); await sleep(20); }
  await mouse('mouseReleased', { x: k.x, y: k.y - 60 }); await sleep(200);
  const inp = await J(ev, `return state.project.tracks[0].effectParams.fet76.input`);
  check('Entrée tournée à la souris (> 24)', inp > 24, String(inp));
  await click('.fx-panel.plug-win[data-fx="fet76"] .ana-push[data-r="20"]');
  check('poussoir ratio 20', await J(ev, `return state.project.tracks[0].effectParams.fet76.ratio`) === 20);
  const s76 = await J(ev, `return document.querySelector('.fx-panel.plug-win[data-fx="fet76"] #anaPanel stop').getAttribute('stop-color')`);
  await click('.fx-panel.plug-win[data-fx="fet76"] .ana-var[data-v="1"]');
  const v76 = JSON.parse(await J(ev, `return JSON.stringify({ v: state.project.tracks[0].effectParams.fet76.variant, stop: document.querySelector('.fx-panel.plug-win[data-fx="fet76"] #anaPanel stop').getAttribute('stop-color') })`));
  check('76 Argent : variante + façade claire', v76.v === 1 && v76.stop !== s76, JSON.stringify(v76));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(300);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(300);
  check('⌘Z : ratio revenu à 4', await J(ev, `return state.project.tracks[0].effectParams.fet76.ratio`) === 4);
  // Pulse 73
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-range', 'Analogique');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : Pulse 73 cliqué', await click('.fx-add-menu .fam-fx', 'Pulse 73')); await sleep(500);
  check('Pulse 73 ajouté', await J(ev, `return state.project.tracks[0].effects.includes('pre73') && !!document.querySelector('.fx-panel.plug-win[data-fx="pre73"]')`) === true);
  const g = await pos('.fx-panel.plug-win[data-fx="pre73"] .ana-k[data-key="gain"] circle');
  await mouse('mouseMoved', g, { buttons: 0 }); await mouse('mousePressed', g);
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', { x: g.x, y: g.y - i * 12 }); await sleep(20); }
  await mouse('mouseReleased', { x: g.x, y: g.y - 96 }); await sleep(200);
  const gain = await J(ev, `return state.project.tracks[0].effectParams.pre73.gain`);
  check('gain à crans (multiple de 5, > 0)', gain > 0 && gain % 5 === 0, String(gain));
  await click('.fx-panel.plug-win[data-fx="pre73"] .ana-var[data-v="1"]'); await sleep(300);
  const v84 = JSON.parse(await J(ev, `const p=document.querySelector('.fx-panel.plug-win[data-fx="pre73"]'); return JSON.stringify({ v: state.project.tracks[0].effectParams.pre73.variant, title: p && p.querySelector('.fx-title').textContent, lmid: !!(p && p.querySelector('.ana-k[data-key="lmid"]')), gain: state.project.tracks[0].effectParams.pre73.gain })`));
  check('variante 84 : façade redessinée avec les bas-médiums, réglages gardés', v84.v === 1 && /84/.test(v84.title) && v84.lmid && v84.gain === gain, JSON.stringify(v84));
  // Optique 2A : variantes (la façade change de couleur, réglages gardés), Compression / Limitation
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-range', 'Analogique');
  check('menu : Optique 2A cliqué', await click('.fx-add-menu .fam-fx', 'Optique 2A')); await sleep(500);
  check('Optique 2A ajouté, façade ouverte', await J(ev, `return state.project.tracks[0].effects.includes('opto2a') && !!document.querySelector('.fx-panel.plug-win[data-fx="opto2a"]')`) === true);
  const stop0 = await J(ev, `return document.querySelector('.fx-panel.plug-win[data-fx="opto2a"] #anaPanel stop').getAttribute('stop-color')`);
  await click('.fx-panel.plug-win[data-fx="opto2a"] .ana-var[data-v="0"]');
  const st2a = JSON.parse(await J(ev, `const p=document.querySelector('.fx-panel.plug-win[data-fx="opto2a"]'); return JSON.stringify({ v: state.project.tracks[0].effectParams.opto2a.variant, stop: p.querySelector('#anaPanel stop').getAttribute('stop-color'), peak: state.project.tracks[0].effectParams.opto2a.peak })`));
  check('variante Gris : réglage + façade grise', st2a.v === 0 && st2a.stop !== stop0, JSON.stringify(st2a) + ' / ' + stop0);
  check('les réglages restent', st2a.peak === 40, String(st2a.peak));
  const tg = await pos('.fx-panel.plug-win[data-fx="opto2a"] .ana-push rect');
  await mouse('mouseMoved', tg, { buttons: 0 }); await mouse('mousePressed', tg); await mouse('mouseReleased', tg); await sleep(200);
  check('levier : Limitation', await J(ev, `return state.project.tracks[0].effectParams.opto2a.limit`) === 1);
  // Égaliseur P1 : dans « Préamplis et EQ », façade ouverte, un bouton tourné
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-range', 'Analogique');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : Égaliseur P1 cliqué', await click('.fx-add-menu .fam-fx', 'Égaliseur P1')); await sleep(500);
  const pb = await pos('.fx-panel.plug-win[data-fx="eqp1"] .ana-k[data-key="lowBoost"] circle');
  check('P1 : façade ouverte', !!pb);
  if (pb) { await mouse('mouseMoved', pb, { buttons: 0 }); await mouse('mousePressed', pb); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: pb.x, y: pb.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: pb.x, y: pb.y - 60 }); await sleep(200); }
  check('P1 : grave poussé à la souris', await J(ev, `return state.project.tracks[0].effectParams.eqp1.lowBoost`) > 0);
  // Bus G : dans « Compresseurs », façade ouverte, variante Noir
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-range', 'Analogique');
  check('menu : Bus G cliqué', await click('.fx-add-menu .fam-fx', 'Bus G')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="busg"] .ana-var[data-v="1"]');
  check('Bus G : variante Noir', await J(ev, `return state.project.tracks[0].effectParams.busg.variant`) === 1);
  // ---- Envois façon Logic
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="send"]');
  const items = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join('|')`);
  check('menu des envois : Bus 1, Bus 2…', /^Bus 1 nouveau\|Bus 2 nouveau/.test(items), items);
  await click('.track-ctx-menu .ctx-item', 'Bus 1'); await sleep(300);
  const s1 = JSON.parse(await J(ev, `const st=[...document.querySelectorAll('#inspector .insp-strip')]; return JSON.stringify({ left: st[0].dataset.kind, sends: [...st[0].querySelectorAll('.send-bar-row .sb-name')].map(e=>e.textContent), right: st[1].querySelector('.strip-name').textContent, rightKind: st[1].dataset.kind, buses: state.project.buses.map(b=>b.name) })`));
  check('bus créé « Bus 1 »', s1.buses.includes('Bus 1'), JSON.stringify(s1.buses));
  check('la piste reste à gauche, avec son envoi', s1.left === 'track' && s1.sends.some(t => t.includes('Bus 1')), JSON.stringify(s1));
  check('le bus s\'affiche à droite', s1.rightKind === 'bus' && s1.right === 'Bus 1', JSON.stringify(s1));
  // retour à la sortie, puis clic sur l'envoi = son bus à droite
  await ev(`state._inspRight=null; renderInspector()`); await sleep(100);
  check('sans envoi choisi : la sortie à droite', await J(ev, `return document.querySelectorAll('#inspector .insp-strip')[1].dataset.kind`) === 'master');
  await click('#inspector .insp-strip .send-bar-row .sb-name'); await sleep(200);
  check('clic sur l\'envoi : son bus à droite', await J(ev, `return document.querySelectorAll('#inspector .insp-strip')[1].querySelector('.strip-name').textContent`) === 'Bus 1');
  const lvl = await J(ev, `return state.project.tracks[0].busSends[state.project.buses.find(b=>b.name==='Bus 1').id]`);
  check('un simple clic ne change pas le dosage', lvl === 50, String(lvl));
  await click('#inspector .slot-plus[data-plus="send"]');
  const items2 = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join('|')`);
  check('2e envoi : Bus 2 proposé (Bus 1 déjà utilisé)', items2.startsWith('Bus 2 nouveau'), items2);
  await ev(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
};
