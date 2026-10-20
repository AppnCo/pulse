// QA3 n°6 : groupe affiché à gauche comme une piste
import { boot, instru, mouse, pos, key, RAP, INVARIANTS, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const Ms = mouse(send); const K = key(send);
  const P = JSON.parse(JSON.stringify(RAP));
  await boot(c, P, { w: 1440, h: 900 });
  await ev(`setInspectorOpen(true)`); await sleep(300);
  const insp = () => ev(`JSON.stringify([...document.querySelectorAll('#inspector .insp-strip')].map(s=>({k:s.dataset.kind,id:s.dataset.id,name:s.querySelector('.strip-name')?.textContent,db:s.querySelector('.strip-db')?.textContent,out:s.querySelector('.strip-output')?.textContent.trim(),fx:[...s.querySelectorAll('.insp-fx-row')].map(r=>r.dataset.fx),pan:s.querySelector('.insp-pan-input')?.value, add:!!s.querySelector('.insp-add-fx'), sends:s.querySelectorAll('.insp-send').length})))`);
  const bus = (id) => ev(`JSON.stringify((()=>{const b=busById('${id}'); return {vol:b.volume,pan:b.pan,out:b.output,fx:b.effects,sends:b.sends}})())`);
  // a. clic sur l'en-tête
  console.log('en-tête :', await ev(`JSON.stringify([...document.querySelector('.group-header[data-bus="vocal1"]').children].map(e=>{const r=e.getBoundingClientRect(); return e.className+'@'+Math.round(r.left)+'-'+Math.round(r.right)})) + JSON.stringify(document.querySelector('.group-header[data-bus="vocal1"]').getBoundingClientRect())`));
  let p = await pos(ev, '.group-header[data-bus="vocal1"]', 0.5, 0.5);
  await Ms.click(p.x, p.y);
  await sleep(300);
  console.log('sel=', await ev('state.selectedBus'));
  console.log('a. inspecteur après clic sur l\'en-tête Vocal 1 :', await insp());
  // b. fader inspecteur -> en-tête
  await ev(`(()=>{ const f=document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-fader'); f.value=50; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(200);
  console.log('b. fader inspecteur → 50 : bus=', await bus('vocal1'), ' curseur en-tête=', await ev(`document.querySelector('.group-header[data-bus="vocal1"] .group-vol').value`), ' db affiché=', await ev(`document.querySelector('#inspector .insp-strip .strip-db').textContent`), ' db en-tête=', await ev(`document.querySelector('.group-header[data-bus="vocal1"] .group-vol').dataset.tooltip`));
  // c. curseur en-tête -> inspecteur
  await ev(`(()=>{ const f=document.querySelector('.group-header[data-bus="vocal1"] .group-vol'); f.value=30; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(200);
  console.log('c. curseur en-tête → 30 : bus=', await bus('vocal1'), ' fader inspecteur=', await ev(`document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-fader').value`), await ev(`document.querySelector('#inspector .insp-strip .strip-db').textContent`));
  // d. pan du groupe + annuler
  await ev(`(()=>{ const f=document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-pan-input'); f.value=-40; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  console.log('d. pan -40 :', await bus('vocal1'));
  await K('z', CMD); await sleep(250);
  console.log('d2. ⌘Z :', await bus('vocal1'), ' sélection=', await ev(`state.selectedBus`), ' inspecteur=', await insp());
  // e. direction : Vocal 1 -> Back via le menu
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-output').click()`); await sleep(150);
  console.log('e. choix du menu direction :', await ev(`JSON.stringify([...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent))`));
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/Back/.test(e.textContent)).click()`); await sleep(300);
  console.log('e2. après Vocal 1 → Back : bus=', await bus('vocal1'), ' invariants=', await ev(`JSON.stringify(${INVARIANTS})`), ' pistes=', await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+'>'+t.output))`));
  console.log('e3. inspecteur :', await insp());
  await K('z', CMD); await sleep(250);
  console.log('e4. ⌘Z :', await bus('vocal1'), await ev(`JSON.stringify(state.project.tracks.map(t=>t.name+'>'+t.output))`));
  // f. boucle de routage par appel direct (descendant)
  await ev(`moveGroupInto('allvocal','vocal1')`); await sleep(200);
  console.log('f. moveGroupInto(All Vocal → Vocal 1) (son propre enfant) :', await ev(`JSON.stringify(state.project.buses.map(b=>b.id+'>'+b.output))`), ' invariants=', await ev(`JSON.stringify(${INVARIANTS})`));
  await ev(`undoAction()`); await sleep(100);
  // g. + Effet sur le groupe, puis ⌘Z
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-add-fx').click()`); await sleep(150);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/Compresseur/.test(e.textContent)).click()`); await sleep(400);
  console.log('g. + Compresseur :', await bus('vocal1'), ' inspecteur fx=', JSON.parse(await insp())[0].fx);
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await K('z', CMD); await sleep(250);
  console.log('g2. ⌘Z :', await bus('vocal1'), JSON.parse(await insp())[0].fx);
  // h. envoi
  await ev(`(()=>{ const s=document.querySelector('#inspector .insp-strip[data-kind="bus"] .insp-send'); s.value=60; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  console.log('h. envoi 60 :', await bus('vocal1'));
  // i. groupe verrouillé / premaster
  await ev(`state.selectedBus='mixbus1'; state._selBusTrack=state.selectedTrack; renderInspector()`);
  console.log('i. Mix Bus 1 (premaster) :', await insp());
  // j. piste sélectionnée -> la sélection de groupe s'efface
  await ev(`selectTrack ? 0 : 0`);
  p = await pos(ev, '.track-item[data-i="2"] .track-name', 0.2, 0.5); await Ms.click(p.x, p.y + 8); await sleep(200);
  console.log('j. après clic sur la piste Lead :', await insp());
  await shot('/private/tmp/claude-501/qa/groupe.jpg');
};
