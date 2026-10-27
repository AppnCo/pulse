// Effet sur une région (planche A) : clic droit → effet rapide, pastille sur la région, réglage, retrait ; le son ne change que sur ce passage
import { boot, instru } from './qa-lib.mjs';
const HOV = (n) => `{const r=[...document.querySelectorAll('.clip-ctx-menu .ctx-has-sub')].find(e=>new RegExp('^\\s*${n}').test(e.textContent)); if(r) r.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));}`;   // les entrées sont rangées en sous-menus : on survole d'abord le bon
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [], buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }] });
  await instru(ev, 6, 0, 0); await sleep(500);
  // couper en deux régions
  await ev(`splitClipAt(0, 0, 3)`); await sleep(200);
  check('deux régions', await ev(`state.project.tracks[0].clips.length`) === 2);
  // clic droit sur la 2e → Effet sur cette région → Pitch −
  await ev(`openClipContextMenu(300, 300, 0, 1)`); await sleep(150);
  await ev(`${HOV('Effets')} [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/Effet sur cette région/.test(e.textContent)).click()`); await sleep(150);
  const items = await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent).join('|')`);
  check('menu rapide : écho, pitch, phone, autre', /Écho 1\/8/.test(items) && /Pitch −/.test(items) && /Phone/.test(items) && /Autre effet/.test(items), items);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent==='Pitch −').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  check('effet posé sur la 2e région seulement', await ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>(c.fx||{}).effects||[]))`) === '[[],["pitch"]]');
  check('pastille visible sur la région', /Pitch/.test(await ev(`document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="1"] .clip-fx-pill')?.textContent||''`)));
  // clic sur la pastille : la fenêtre du plug s'ouvre
  await ev(`document.querySelector('.clip[data-ci="1"] .clip-fx-pill').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`); await sleep(300);
  check('clic sur la pastille : réglages de l’effet', await ev(`!!document.querySelector('.fx-panel.plug-win[data-fx="pitch"]')`));
  // export : la 1re moitié est intacte, la 2e change
  const diff = await ev(`(async()=>{ const ctx=PulseAudio.getContext(); const sr=48000;
    const go=async(p)=>(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
    const a=await go(state.project); const p2=JSON.parse(JSON.stringify(state.project)); p2.tracks[0].clips.forEach(c=>delete c.fx); const b=await go(p2);
    const d=(x,y)=>{let s=0; for(let i=Math.floor(x*sr);i<Math.floor(y*sr);i++) s+=Math.abs(a[i]-b[i]); return s/((y-x)*sr);};
    return JSON.stringify([d(0.5,2.5), d(3.5,5.5)]); })()`);
  const [avant, apres] = JSON.parse(diff);
  check('son : 1re région inchangée, 2e région changée', avant < 1e-4 && apres > 0.01, diff);
  // × sur la pastille : retiré, ⌘Z le remet
  await ev(`document.querySelector('.clip[data-ci="1"] .clip-fx-pill i').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`); await sleep(200);
  check('× : effet retiré de la région', await ev(`!state.project.tracks[0].clips[1].fx`));
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : il revient', await ev(`JSON.stringify((state.project.tracks[0].clips[1].fx||{}).effects||[])`) === '["pitch"]');
};
