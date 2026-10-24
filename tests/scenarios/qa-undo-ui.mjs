// Annuler après des gestes faits à la souris dans le mixeur / la liste : chaque geste ajoute-t-il une étape d'annulation ?
import { boot, instru, RAP, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, RAP);
  const Ms = mouse(send);
  await instru(ev, 6, 0, 0); await ev(`toggleMixer()`); await sleep(500);
  const U = () => ev(`_undoStack.length`);
  const test = async (label, fn) => { const u0 = await U(); const s0 = await ev(`JSON.stringify(state.project)`); await fn(); await sleep(250); const u1 = await U(); const s1 = await ev(`JSON.stringify(state.project)`);
    let r = `changé=${s0 !== s1} étapes+${u1 - u0}`;
    if (u1 > u0) { await ev(`undoAction()`); await sleep(150); r += ` retour exact=${(await ev(`JSON.stringify(state.project)`)) === s0}`; await ev(`redoAction()`); }
    else if (s0 !== s1) r += '  <-- PAS ANNULABLE';
    console.log(label.padEnd(46), r); };
  // piste Lead = strip index 2
  await test('mixeur : + puis EQ sur une piste (activer)', async () => { const p = await pos(ev, '.mixer-strips .strip[data-kind="track"][data-i="2"] .slot-plus[data-plus="fx"]'); await Ms.click(p.x, p.y); await sleep(200); await ev(`[...document.querySelectorAll('.fx-add-menu .fam-fx[data-fx="eq"]')].forEach(e=>e.click())`); await sleep(200); await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`); });
  await test('mixeur : croix EQ (retirer)', async () => { const p = await pos(ev, '.mixer-strips .strip[data-kind="track"][data-i="2"] .insp-fx-row[data-fx="eq"] .insp-del'); await Ms.click(p.x, p.y); await sleep(200); });
  await test('mixeur : bouton de gauche/droite (glisser)', async () => { const p = await pos(ev, '.mixer-strips .strip[data-kind="track"][data-i="2"] .strip-pan-knob'); await Ms.drag(p.x, p.y, p.x + 20, p.y, 4); });
  await test('mixeur : fader de retour (Rev Long)', async () => { await ev(`(()=>{const f=document.querySelector('.strip-return .return-fader'); f.value=40; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true}));})()`); });
  await test('liste : fader de groupe (en-tête)', async () => { await ev(`(()=>{const f=document.querySelector('.group-header .group-vol'); f.value=30; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true}));})()`); });
  await test('liste : muet de groupe', async () => { await ev(`document.querySelector('.group-header .g-m').click()`); });
  await test('liste : renommer un groupe', async () => { await ev(`(()=>{const n=document.querySelector('.group-header .group-name'); n.classList.add('editing'); n.textContent='Autre'; n.dispatchEvent(new Event('blur'));})()`); });
  await test('liste : renommer une piste', async () => { await ev(`(()=>{const n=document.querySelector('.track-item[data-i="2"] .track-name'); n.textContent='Renommée'; n.dispatchEvent(new Event('blur'));})()`); });
  await test('BPM : bouton x2', async () => { await ev(`document.querySelector('[data-bpm-mul="2"], #btnBpmDouble, .bpm-x2')?.click()`); });
  await test('couleur de piste (menu)', async () => { await ev(`1`); });
  await test('cacher/replier un groupe', async () => { await ev(`document.querySelector('.group-header .group-toggle').click()`); });
};
