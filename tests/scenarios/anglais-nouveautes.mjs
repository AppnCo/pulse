// Anglais : les menus ajoutés le 23/10 (envois, automation, effet sur une région) sont traduits
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Parallèle', output: 'master', volume: 100 }], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], busSends: { g1: 40 } }] }, { ls: { pulse_lang: 'en' } });
  await instru(ev, 4, 0, 0); await sleep(600);
  const fr = (txt) => txt.split('|').filter(t => /[àâçéèêëîïôûùœ«»]|\b(le|la|les|une|des|sur|cette|piste|région|courbe)\b/i.test(t) && !/Parallèle|Voix|instru/i.test(t));
  const menu = async () => { await sleep(250); return ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item, .track-ctx-menu .ctx-head')].map(e=>e.textContent.trim()).join('|')`); };
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(300);
  await ev(`document.querySelector('#inspector .insp-sends-box .insp-slot-empty').click()`);
  let m = await menu(); check('menu d’envoi en anglais', fr(m).length === 0, m);
  await ev(`closeAllMenus(); document.querySelector('#inspector .send-bar-row[data-bsend="g1"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:300}))`);
  m = await menu(); check('menu Pre / Post en anglais', fr(m).length === 0, m);
  await ev(`closeAllMenus(); toggleAutomationMode()`); await sleep(300);
  await ev(`document.querySelector('.track-item .auto-chip').click()`);
  m = await menu(); check('menu d’automation en anglais', fr(m).length === 0, m);
  await ev(`closeAllMenus(); openClipFxMenu(300, 300, 0, 0)`);
  m = await menu(); check('menu d’effet de région en anglais', fr(m).length === 0, m);
};
