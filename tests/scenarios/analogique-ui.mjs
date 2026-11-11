// Gamme Analogique dans l'interface : le menu « + » a deux gammes (Pulse / Analogique) ; Éclair 76 et Pulse 73 s'ajoutent,
// leur façade 3D s'ouvre (images des boutons chargées), un bouton tourné à la souris change le réglage, un poussoir de ratio
// se choisit, ⌘Z revient. Envois façon Logic : le menu propose « Bus 1 », l'envoi reste sur la piste à gauche,
// le bus s'affiche à droite ; clic sur l'envoi = son bus à droite ; clic sur la sortie = retour à la sortie.
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'au1', name: 'AU', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const pos = async (sel, text) => JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0); const el=${text ? `els.find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}; if(!el) return null; el.scrollIntoView({block:'nearest'}); const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`));
  const mouse = async (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (sel, text) => { const r = await pos(sel, text); if (!r) return false; await mouse('mouseMoved', r, { buttons: 0 }); await mouse('mousePressed', r); await mouse('mouseReleased', r); await sleep(300); return true; };
  await click('.track-item');
  await click('#inspector .insp-add-fx');
  const ranges = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-range')].map(b=>b.textContent).join(',')`);
  check('menu : onglet Pulse seul (Analogique dedans)', ranges === 'Pulse', ranges);
  const pulseCats = await J(ev, `return [...document.querySelectorAll('.fx-add-menu .fam-cat')].filter(e=>!e.hidden).map(e=>e.textContent.trim()).join(',')`);
  check('onglet Pulse : ses catégories puis « Analogique » et les siennes', pulseCats.includes('Dynamique') && pulseCats.endsWith('Compresseurs,Préamplis et EQ,Bandes et couleur,Espace'), pulseCats);
  check('sous-titre Analogique visible', await J(ev, `const h=document.querySelector('.fx-add-menu .fam-sub'); return !!h && !h.hidden && h.textContent==='Analogique'`));
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
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
  const s76 = await J(ev, `return document.querySelector('.fx-panel.plug-win[data-fx="fet76"] [id^="anaPanel"] stop').getAttribute('stop-color')`);
  await click('.fx-panel.plug-win[data-fx="fet76"] .ana-var[data-v="1"]');
  const v76 = JSON.parse(await J(ev, `return JSON.stringify({ v: state.project.tracks[0].effectParams.fet76.variant, stop: document.querySelector('.fx-panel.plug-win[data-fx="fet76"] [id^="anaPanel"] stop').getAttribute('stop-color') })`));
  check('76 Argent : variante + façade claire', v76.v === 1 && v76.stop !== s76, JSON.stringify(v76));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(300);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(300);
  check('⌘Z : ratio revenu à 4', await J(ev, `return state.project.tracks[0].effectParams.fet76.ratio`) === 4);
  // Pulse 73
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
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
  // bouton double du 73 : le bord attrape les médiums (niveau), le centre la fréquence
  const mid = await pos('.fx-panel.plug-win[data-fx="pre73"] .ana-k[data-key="mid"] circle');
  if (mid) { await mouse('mouseMoved', { x: mid.x + 24, y: mid.y }, { buttons: 0 }); await mouse('mousePressed', { x: mid.x + 24, y: mid.y }); for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', { x: mid.x + 24, y: mid.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: mid.x + 24, y: mid.y - 40 }); await sleep(200); }
  check('73 : le bord du bouton double règle les médiums', await J(ev, `return state.project.tracks[0].effectParams.pre73.mid`) > 0);
  const v84 = JSON.parse(await J(ev, `const p=document.querySelector('.fx-panel.plug-win[data-fx="pre73"]'); return JSON.stringify({ v: state.project.tracks[0].effectParams.pre73.variant, title: p && p.querySelector('.fx-title').textContent, lmid: !!(p && p.querySelector('.ana-k[data-key="lmid"]')), gain: state.project.tracks[0].effectParams.pre73.gain })`));
  check('variante 84 : façade redessinée avec les bas-médiums, réglages gardés', v84.v === 1 && /84/.test(v84.title) && v84.lmid && v84.gain === gain, JSON.stringify(v84));
  // Optique 2A : variantes (la façade change de couleur, réglages gardés), Compression / Limitation
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  check('menu : Optique 2A cliqué', await click('.fx-add-menu .fam-fx', 'Optique 2A')); await sleep(500);
  check('Optique 2A ajouté, façade ouverte', await J(ev, `return state.project.tracks[0].effects.includes('opto2a') && !!document.querySelector('.fx-panel.plug-win[data-fx="opto2a"]')`) === true);
  const stop0 = await J(ev, `return document.querySelector('.fx-panel.plug-win[data-fx="opto2a"] [id^="anaPanel"] stop').getAttribute('stop-color')`);
  await click('.fx-panel.plug-win[data-fx="opto2a"] .ana-var[data-v="0"]');
  const st2a = JSON.parse(await J(ev, `const p=document.querySelector('.fx-panel.plug-win[data-fx="opto2a"]'); return JSON.stringify({ v: state.project.tracks[0].effectParams.opto2a.variant, stop: p.querySelector('[id^="anaPanel"] stop').getAttribute('stop-color'), peak: state.project.tracks[0].effectParams.opto2a.peak })`));
  check('variante Gris : réglage + façade grise', st2a.v === 0 && st2a.stop !== stop0, JSON.stringify(st2a) + ' / ' + stop0);
  check('les réglages restent', st2a.peak === 40, String(st2a.peak));
  const tg = await pos('.fx-panel.plug-win[data-fx="opto2a"] .ana-push rect');
  await mouse('mouseMoved', tg, { buttons: 0 }); await mouse('mousePressed', tg); await mouse('mouseReleased', tg); await sleep(200);
  check('levier : Limitation', await J(ev, `return state.project.tracks[0].effectParams.opto2a.limit`) === 1);
  // Égaliseur P1 : dans « Préamplis et EQ », façade ouverte, un bouton tourné
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : Égaliseur P1 cliqué', await click('.fx-add-menu .fam-fx', 'Égaliseur P1')); await sleep(500);
  const pb = await pos('.fx-panel.plug-win[data-fx="eqp1"] .ana-k[data-key="lowBoost"] circle');
  check('P1 : façade ouverte', !!pb);
  if (pb) { await mouse('mouseMoved', pb, { buttons: 0 }); await mouse('mousePressed', pb); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: pb.x, y: pb.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: pb.x, y: pb.y - 60 }); await sleep(200); }
  check('P1 : grave poussé à la souris', await J(ev, `return state.project.tracks[0].effectParams.eqp1.lowBoost`) > 0);
  // Bus G : dans « Compresseurs », façade ouverte, variante Noir
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  check('menu : Bus G cliqué', await click('.fx-add-menu .fam-fx', 'Bus G')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="busg"] .ana-var[data-v="1"]');
  check('Bus G : variante Noir', await J(ev, `return state.project.tracks[0].effectParams.busg.variant`) === 1);
  // Bande 80 : dans « Bandes et couleur », façade avec ses bobines, machine Cassette
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Bandes'); await sleep(100);
  check('menu : Bande 80 cliquée', await click('.fx-add-menu .fam-fx', 'Bande 80')); await sleep(500);
  check('Bande 80 : bobines', await J(ev, `return [...document.querySelectorAll('.fx-panel.plug-win[data-fx="tape"] image')].filter(i=>/reel/.test(i.getAttribute('href'))).length`) === 2);
  await click('.fx-panel.plug-win[data-fx="tape"] .ana-var[data-v="2"]');
  check('Bande 80 : Cassette', await J(ev, `return state.project.tracks[0].effectParams.tape.machine`) === 2);
  // Lampe 670 : dans « Compresseurs », façade ouverte, constante de temps 6
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  check('menu : Lampe 670 cliquée', await click('.fx-add-menu .fam-fx', 'Lampe 670')); await sleep(500);
  check('Lampe 670 : façade', await J(ev, `return !!document.querySelector('.fx-panel.plug-win[data-fx="l670"] .ana-k[data-key="thr"]')`) === true);
  // Détresse : façade, ratio Nuke, distorsion « 3 »
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  check('menu : Détresse cliquée', await click('.fx-add-menu .fam-fx', 'Détresse')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="dtr"] [data-k="dist3"] rect');
  check('Détresse : distorsion « 3 »', await J(ev, `return state.project.tracks[0].effectParams.dtr.dist`) === 2);
  // Tranche E : façade, gain des hauts-médiums tourné, variante Noir
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : Tranche E cliquée', await click('.fx-add-menu .fam-fx', 'Tranche E')); await sleep(500);
  const hm = await pos('.fx-panel.plug-win[data-fx="stripe"] .ana-k[data-key="hmf"] circle');
  if (hm) { await mouse('mouseMoved', hm, { buttons: 0 }); await mouse('mousePressed', hm); for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', { x: hm.x, y: hm.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: hm.x, y: hm.y - 50 }); await sleep(200); }
  check('Tranche E : hauts-médiums poussés', await J(ev, `return state.project.tracks[0].effectParams.stripe.hmf`) > 0);
  await click('.fx-panel.plug-win[data-fx="stripe"] .ana-var[data-v="1"] rect');
  check('Tranche E : Noir', await J(ev, `return state.project.tracks[0].effectParams.stripe.variant`) === 1);
  // EQ 550 : façade, médiums par crans de 2
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : EQ 550 cliqué', await click('.fx-add-menu .fam-fx', 'EQ 550')); await sleep(500);
  const m5 = await pos('.fx-panel.plug-win[data-fx="eq550"] .ana-k[data-key="mf"] circle');
  if (m5) { await mouse('mouseMoved', { x: m5.x + 26, y: m5.y }, { buttons: 0 }); await mouse('mousePressed', { x: m5.x + 26, y: m5.y }); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: m5.x + 26, y: m5.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: m5.x + 26, y: m5.y - 60 }); await sleep(200); }
  const mfv = await J(ev, `return state.project.tracks[0].effectParams.eq550.mf`);
  check('EQ 550 : médiums montés, par crans de 2', mfv > 0 && mfv % 2 === 0, String(mfv));
  // Comp 25 : façade, type contre-réaction
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  check('menu : Comp 25 cliqué', await click('.fx-add-menu .fam-fx', 'Comp 25')); await sleep(500);
  const tg25 = await pos('.fx-panel.plug-win[data-fx="comp25"] .ana-push rect');
  if (tg25) { await mouse('mouseMoved', tg25, { buttons: 0 }); await mouse('mousePressed', tg25); await mouse('mouseReleased', tg25); await sleep(200); }
  check('Comp 25 : contre-réaction', await J(ev, `return state.project.tracks[0].effectParams.comp25.feedback`) === 1);
  // Bus 33 : façade, limiteur en service
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  check('menu : Bus 33 cliqué', await click('.fx-add-menu .fam-fx', 'Bus 33')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="bus33"] [data-k="lon"] rect');
  check('Bus 33 : limiteur en service', await J(ev, `return state.project.tracks[0].effectParams.bus33.lon`) === 1);
  // EQ Massif : façade, bande 4 en cloche
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : EQ Massif cliqué', await click('.fx-add-menu .fam-fx', 'EQ Massif')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="massif"] [data-k="shelf4"] rect');
  check('EQ Massif : bande 4 en cloche', await J(ev, `return state.project.tracks[0].effectParams.massif.shelf4`) === 0);
  // Plaque 140 : dans « Espace », façade avec la plaque, variante Chaude
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Espace'); await sleep(100);
  check('menu : Plaque 140 cliquée', await click('.fx-add-menu .fam-fx', 'Plaque 140')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="plate"] .ana-var[data-v="1"] rect');
  check('Plaque 140 : Chaude', await J(ev, `return state.project.tracks[0].effectParams.plate.variant`) === 1);
  // Écho à bande : façade, vitesse tournée
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Espace'); await sleep(100);
  check('menu : Écho à bande cliqué', await click('.fx-add-menu .fam-fx', 'Écho à bande')); await sleep(500);
  const rk = await pos('.fx-panel.plug-win[data-fx="techo"] .ana-k[data-key="rate"] circle');
  if (rk) { await mouse('mouseMoved', rk, { buttons: 0 }); await mouse('mousePressed', rk); for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', { x: rk.x, y: rk.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: rk.x, y: rk.y - 50 }); await sleep(200); }
  check('Écho à bande : vitesse montée', await J(ev, `return state.project.tracks[0].effectParams.techo.rate`) > 1);
  // Salle 80 : façade avec l'écran à LED, programme Chambre, durée tournée (bouton logarithmique)
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Espace'); await sleep(100);
  check('menu : Salle 80 cliquée', await click('.fx-add-menu .fam-fx', 'Salle 80')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="hall80"] .ana-var[data-v="1"] rect');
  check('Salle 80 : Chambre', await J(ev, `return state.project.tracks[0].effectParams.hall80.variant`) === 1);
  const hk = await pos('.fx-panel.plug-win[data-fx="hall80"] .ana-k[data-key="decay"] circle');
  if (hk) { await mouse('mouseMoved', hk, { buttons: 0 }); await mouse('mousePressed', hk); for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', { x: hk.x, y: hk.y - i * 10 }); await sleep(20); } await mouse('mouseReleased', { x: hk.x, y: hk.y - 50 }); await sleep(200); }
  const hd = await J(ev, `return state.project.tracks[0].effectParams.hall80.decay`);
  check('Salle 80 : durée montée', hd > 2.5 && hd < 20, String(hd));
  // Harmoniseur 910 : façade, préréglage Octave, modèle 949
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Espace'); await sleep(100);
  check('menu : Harmoniseur 910 cliqué', await click('.fx-add-menu .fam-fx', 'Harmoniseur 910')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="h910"] .h9-pre[data-i="2"] rect');
  check('Harmoniseur : préréglage Octave', await J(ev, `const p=state.project.tracks[0].effectParams.h910; return p.pitchL===12 && p.pitchR===-12`));
  await click('.fx-panel.plug-win[data-fx="h910"] .ana-var[data-v="1"] rect');
  check('Harmoniseur : modèle 949', await J(ev, `return state.project.tracks[0].effectParams.h910.variant`) === 1);
  // Dimension : façade, mode 4, Ensemble
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Espace'); await sleep(100);
  check('menu : Dimension cliquée', await click('.fx-add-menu .fam-fx', 'Dimension')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="dim"] .dim-mode[data-m="3"] rect');
  check('Dimension : mode 4', await J(ev, `return state.project.tracks[0].effectParams.dim.mode`) === 3);
  await click('.fx-panel.plug-win[data-fx="dim"] .ana-var[data-v="1"] rect');
  check('Dimension : Ensemble', await J(ev, `return state.project.tracks[0].effectParams.dim.variant`) === 1);
  // Préampli 76V : dans « Préamplis et EQ », tranche fine, variante Radio
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Préamplis'); await sleep(100);
  check('menu : Préampli 76V cliqué', await click('.fx-add-menu .fam-fx', 'Préampli 76V')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="prev76"] .ana-var[data-v="1"] rect'); await sleep(300);
  check('Préampli 76V : Radio', await J(ev, `return state.project.tracks[0].effectParams.prev76.variant`) === 1);
  // Éclat : dans « Bandes et couleur », variante Plein
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-cat', 'Compresseurs');
  await click('.fx-add-menu .fam-cat', 'Bandes'); await sleep(100);
  check('menu : Éclat cliqué', await click('.fx-add-menu .fam-fx', 'Éclat')); await sleep(500);
  await click('.fx-panel.plug-win[data-fx="eclat"] .ana-var[data-v="1"] rect');
  check('Éclat : Plein', await J(ev, `return state.project.tracks[0].effectParams.eclat.variant`) === 1);
  // Souffle : gamme Pulse, « Égaliseur et filtre »
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="fx"]');
  await click('.fx-add-menu .fam-range', 'Pulse');
  await click('.fx-add-menu .fam-cat', 'Égaliseur'); await sleep(100);
  check('menu : Souffle cliqué', await click('.fx-add-menu .fam-fx', 'Souffle')); await sleep(500);
  check('Souffle : fenêtre ouverte', await J(ev, `return !!document.querySelector('.fx-panel.plug-win[data-fx="souffle"]')`));
  // ---- Envois façon Logic
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await click('#inspector .slot-plus[data-plus="send"]');
  const items = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join('|')`);
  check('menu des envois : Bus 1, Bus 2…', /^Bus 1\|Bus 2\|/.test(items), items);
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
  // comme Logic : aller sur une autre piste puis revenir = la sortie à droite ; retoucher l'envoi = son bus
  await ev(`state.project.tracks.push({ name: 'Kick', type: 'audio', color: '#22D3EE', volume: 100, clips: [] }); state.selectedTrack=1; renderInspector()`); await sleep(100);
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(100);
  check('retour sur la piste : sa sortie à droite (plus le bus)', await J(ev, `return document.querySelectorAll('#inspector .insp-strip')[1].dataset.kind`) === 'master');
  await click('#inspector .insp-strip .send-bar-row .sb-name'); await sleep(200);
  check('retoucher l\'envoi : son bus revient à droite', await J(ev, `return document.querySelectorAll('#inspector .insp-strip')[1].querySelector('.strip-name').textContent`) === 'Bus 1');
  await click('#inspector .slot-plus[data-plus="send"]');
  const items2 = await J(ev, `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join('|')`);
  check('2e envoi : Bus 1 marqué utilisé, Bus 2 proposé', items2.startsWith('Bus 1 →') && items2.includes('|Bus 2|'), items2);
  await ev(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
};
