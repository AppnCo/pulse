// S (et M) d'une piste qui n'est PAS choisie : un seul vrai clic souris suffit (avant : l'appui choisissait la piste,
// redessinait la liste, et le clic se perdait — retour de Ridwane 04/11).
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const tr = (n) => ({ name: n, type: 'audio', color: '#A855F7', volume: 100, clips: [] });
  await boot(c, { id: 'so1', name: 'SO', bpm: 120, sends: [], tracks: [tr('A'), tr('B'), tr('C')] }, { mic: false });
  await ev(`state.selectedTrack=0; renderTracksPanel(); bindTrackEvents()`); await sleep(200);
  const at = async (sel) => JSON.parse(await J(ev, `const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})`));
  const clickAt = async (p, mod = 0) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); await sleep(30); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); await sleep(150); };
  await clickAt(await at('.track-item[data-i="2"] .t-mini[data-flag="solo"]'));
  check('un clic sur S d\'une autre piste : solo allumé tout de suite', await J(ev, `return !!state.project.tracks[2].solo`));
  check('le bouton S est allumé', await J(ev, `return document.querySelector('.track-item[data-i="2"] .t-mini[data-flag="solo"]').classList.contains('active')`));
  await ev(`state.selectedTrack=0; renderTracksPanel(); bindTrackEvents()`); await sleep(150);
  await clickAt(await at('.track-item[data-i="2"] .t-mini[data-flag="solo"]'));
  check('un clic de plus : solo éteint, bouton éteint', await J(ev, `return !state.project.tracks[2].solo && !document.querySelector('.track-item[data-i="2"] .t-mini[data-flag="solo"]').classList.contains('active')`));
  await clickAt(await at('.track-item[data-i="1"] .t-mini[data-flag="mute"]'));
  check('M d\'une autre piste : un clic suffit', await J(ev, `return !!state.project.tracks[1].muted`));
  await ev(`document.querySelector('.track-item[data-i="1"] .t-mini[data-flag="mute"]').click()`); await sleep(100);
  check('clic programmé (clavier / accessibilité) : marche encore', await J(ev, `return !state.project.tracks[1].muted`));
  // plusieurs pistes choisies (⇧-clic) puis un vrai clic sur M de l'une d'elles : TOUTES changent, la sélection reste
  await ev(`state.project.tracks.forEach(t=>{t.muted=true; t.solo=false}); state.selectedTrack=0; state.selectedTracks=new Set([0,1,2]); renderTracksPanel(); bindTrackEvents()`); await sleep(150);
  await clickAt(await at('.track-item[data-i="1"] .t-mini[data-flag="mute"]'));
  check('3 pistes choisies, clic sur M : les 3 démutées', await J(ev, `return state.project.tracks.every(t=>!t.muted)`), await J(ev, `return JSON.stringify(state.project.tracks.map(t=>!!t.muted))`));
  check('les 3 boutons M éteints', await J(ev, `return [...document.querySelectorAll('.track-item .t-mini[data-flag="mute"]')].every(b=>!b.classList.contains('active'))`));
  check('la sélection des 3 pistes reste', await J(ev, `return selectedTrackIdxs().length`) === 3);
  await clickAt(await at('.track-item[data-i="2"] .t-mini[data-flag="solo"]'));
  check('clic sur S : les 3 en solo', await J(ev, `return state.project.tracks.every(t=>t.solo)`));
  await clickAt(await at('.track-item[data-i="0"] .t-mini[data-flag="solo"]'));
  check('re-clic sur S : les 3 sans solo', await J(ev, `return state.project.tracks.every(t=>!t.solo)`));
  // Solo de groupe comme Logic : le S du groupe s'allume, ceux de ses pistes restent éteints (juste « hérités »), le son suit
  await ev(`state.project.buses=[{id:'g',name:'Guitares',isGroup:true,volume:100}]; state.project.tracks.forEach((t,i)=>{t.solo=false;t.muted=false; if(i<2) t.output='g';}); state.selectedTracks=new Set(); renderTracksPanel(); bindTrackEvents()`); await sleep(200);
  await clickAt(await at('.group-header[data-bus="g"] .g-s'));
  const g1 = JSON.parse(await J(ev, `return JSON.stringify({ bus: !!state.project.buses[0].solo, trackSolo: state.project.tracks.map(t=>!!t.solo), gs: document.querySelector('.group-header[data-bus="g"] .g-s').classList.contains('active'), implied: [...document.querySelectorAll('.track-item .t-mini[data-flag="solo"]')].map(b=>b.classList.contains('implied')) })`));
  check('S du groupe : le groupe en solo, son bouton allumé', g1.bus && g1.gs, JSON.stringify(g1));
  check('les S des pistes restent éteints (solo hérité seulement)', g1.trackSolo.every(x => !x) && g1.implied[0] && g1.implied[1] && !g1.implied[2], JSON.stringify(g1));
  const wav = await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++) d[i]=0.3*Math.sin(i*0.05); PulseAudio.registerBuffer('so',b);
    const p=JSON.parse(JSON.stringify(state.project)); p.tracks.forEach((t,i)=>{ t.clips= i===2 ? [{id:'so',start:0,duration:1,offset:0}] : []; });
    const x=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer()); const L=x.getChannelData(0); let m=0; for(let i=0;i<L.length;i++) m=Math.max(m,Math.abs(L[i])); return String(m); })()`);
  check('la piste hors du groupe ne s\'entend plus', +wav < 1e-3, wav);
  await clickAt(await at('.group-header[data-bus="g"] .g-s'));
  check('re-clic : plus de solo nulle part', await J(ev, `return !state.project.buses[0].solo && document.querySelectorAll('.t-mini.implied').length===0`));
  // ---- Gestes Logic (manuel d'Apple)
  await ev(`state.project.buses=[]; state.project.tracks.forEach(t=>{t.solo=false;t.muted=false;t.output='master';t.pan=0}); state.selectedTrack=0; state.selectedTracks=new Set(); renderTracksPanel(); bindTrackEvents()`); await sleep(150);
  const down = async (p, mod = 0) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: mod }); };
  // glisser sur les M : appui sur le M de A, glisser jusqu'à C → les 3 coupées
  const m0 = await at('.track-item[data-i="0"] .t-mini[data-flag="mute"]'), m2 = await at('.track-item[data-i="2"] .t-mini[data-flag="mute"]');
  await down(m0); for (let k = 1; k <= 10; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: m0.x, y: m0.y + (m2.y - m0.y) * k / 10, buttons: 1 }); await sleep(25); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: m2.x, y: m2.y, button: 'left', clickCount: 1 }); await sleep(200);
  check('glisser sur les M : les 3 pistes coupées', await J(ev, `return state.project.tracks.every(t=>t.muted)`), await J(ev, `return JSON.stringify(state.project.tracks.map(t=>!!t.muted))`));
  // ⌘ + clic sur un M (tous coupés) : tous les M dans le même état basculent → tous rallumés
  await clickAt(await at('.track-item[data-i="1"] .t-mini[data-flag="mute"]'), 4);
  check('⌘ + clic sur un M : tous ceux dans le même état basculent', await J(ev, `return state.project.tracks.every(t=>!t.muted)`));
  // S sur A puis ⌥ + clic sur le S de C : C seule en solo
  await clickAt(await at('.track-item[data-i="0"] .t-mini[data-flag="solo"]'));
  await clickAt(await at('.track-item[data-i="2"] .t-mini[data-flag="solo"]'), 1);
  check('⌥ + clic sur un S éteint : cette piste seule en solo', await J(ev, `return JSON.stringify(state.project.tracks.map(t=>!!t.solo))`) === '[false,false,true]');
  check('les M des pistes coupées par le solo clignotent', await J(ev, `return JSON.stringify([...document.querySelectorAll('.track-item .t-mini[data-flag="mute"]')].map(b=>b.classList.contains('solo-off')))`) === '[true,true,false]');
  await clickAt(await at('.track-item[data-i="2"] .t-mini[data-flag="solo"]'), 1);
  check('⌥ + clic sur un S allumé : plus aucun solo, plus de clignotement', await J(ev, `return state.project.tracks.every(t=>!t.solo) && !document.querySelector('.solo-off')`));
  // ⌥ + clic sur le pan rond d'une piste : au centre
  await ev(`state.project.tracks[1].pan=40; renderTracksPanel(); bindTrackEvents()`); await sleep(100);
  await clickAt(await at('.track-item[data-i="1"] .t-knob'), 1);
  check('⌥ + clic sur un pan : au centre', await J(ev, `return state.project.tracks[1].pan`) === 0);
};
