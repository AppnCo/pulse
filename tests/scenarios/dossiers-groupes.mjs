// 31/10 : clic droit avec plusieurs pistes choisies → groupe (bus) ou dossier (juste pour ranger) avec TOUTES les pistes
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  const P = { id: 'dg', name: 'DG', bpm: 120, buses: [], tracks: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ name: n, type: 'audio', color: '#A855F7', output: i === 4 ? 'mix' : 'master', clips: [] })) };
  P.buses = [{ id: 'mix', name: 'Mix', output: 'master', volume: 100 }];
  await boot(c, P, { mic: false });
  const J = async (code) => JSON.parse(await ev(`JSON.stringify((()=>{${code}})())`));
  const pick = async (label) => {
    const ok = await ev(`(()=>{ const it=[...document.querySelectorAll('.track-ctx-menu .ctx-item, .track-ctx-menu [class*=item]')].find(e=>e.textContent.includes(${JSON.stringify(label)})); if(!it) return false; it.click(); return true; })()`);
    await sleep(300); return ok;
  };
  const menuOn = async (i) => { await ev(`closeAllMenus(); openTrackContextMenu(200, 200, ${i}, state.project.tracks[${i}]); [...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e=>e.textContent==='Groupe').click()`); await sleep(200); };
  const labels = async () => J(`return [...document.querySelectorAll('.track-ctx-menu *')].filter(e=>!e.children.length).map(e=>e.textContent.trim()).filter(Boolean)`);

  // A, C, E choisies ; clic droit sur C
  await ev(`selectTrack(0); state.selectedTracks=new Set([0,2,4]); renderAll()`);
  await menuOn(2);
  const L = await labels();
  check('menu : groupe avec les 3 pistes', L.some(l => l.startsWith('Nouveau groupe avec les 3 pistes')), JSON.stringify(L.filter(l => l.includes('Nouveau'))));
  check('menu : dossier avec les 3 pistes', L.some(l => l.startsWith('Nouveau dossier avec les 3 pistes')));
  // Dossier
  const nbus = await J(`return state.project.buses.length`);
  check('dossier créé', await pick('Nouveau dossier avec les 3 pistes'));
  let s = await J(`return {names:state.project.tracks.map(t=>t.name), fold:state.project.tracks.map(t=>t.folder||''), out:state.project.tracks.map(t=>t.name+':'+t.output), folders:(state.project.folders||[]).length, buses:state.project.buses.length, heads:[...document.querySelectorAll('.group-header.is-folder')].length}`);
  check('les 3 pistes sont dans le dossier, rangées ensemble', s.names.join('') === 'ACEBD' && s.fold.slice(0, 3).every(Boolean) && !s.fold[3] && !s.fold[4], JSON.stringify(s));
  check('dossier : le son ne change pas (sorties identiques, pas de bus en plus)', s.buses === nbus && s.out.includes('E:mix') && s.out.includes('A:master'), JSON.stringify(s.out));
  check('un en-tête de dossier affiché', s.heads === 1);
  // Replier le dossier
  await ev(`document.querySelector('.group-header.is-folder .group-toggle').click()`); await sleep(200);
  check('dossier replié : ses pistes sont cachées', (await J(`return [...document.querySelectorAll('.track-item.is-group-collapsed')].length`)) === 3);
  await ev(`document.querySelector('.group-header.is-folder .group-toggle').click()`); await sleep(200);
  // M du dossier : coupe ses 3 pistes
  await ev(`document.querySelector('.group-header.is-folder .g-m').click()`); await sleep(200);
  check('M du dossier : ses 3 pistes coupées, pas les autres', (await J(`return state.project.tracks.map(t=>!!t.muted).join()`)) === 'true,true,true,false,false');
  await ev(`document.querySelector('.group-header.is-folder .g-m').click()`); await sleep(200);
  // ⌘Z
  await ev(`undoAction()`); await ev(`undoAction()`); await ev(`undoAction()`); await sleep(300);
  check('⌘Z : plus de dossier', (await J(`return (state.project.folders||[]).length + state.project.tracks.filter(t=>t.folder).length`)) === 0);
  // Groupe (bus) avec 2 pistes choisies
  await ev(`state.project.tracks.forEach(t=>{delete t.folder}); selectTrack(1); state.selectedTracks=new Set([1,3]); renderAll()`);
  await menuOn(3);
  check('groupe créé', await pick('Nouveau groupe avec les 2 pistes'));
  s = await J(`const g=state.project.buses.filter(b=>b.isGroup && b.id.startsWith('grp_')).pop(); return {g:!!g, members: g? state.project.tracks.filter(t=>t.output===g.id).map(t=>t.name).join(''):''}`);
  check('les 2 pistes passent par le nouveau groupe', s.g && s.members.length === 2, JSON.stringify(s));
  // Une seule piste : seulement elle
  await ev(`selectTrack(0); state.selectedTracks=new Set([0]); renderAll()`);
  await menuOn(0);
  check('une seule piste : « avec cette piste »', (await labels()).some(l => l.startsWith('Nouveau dossier avec cette piste')));
  await pick('Nouveau dossier avec cette piste');
  check('dossier d\'une piste', (await J(`return state.project.tracks.filter(t=>t.folder).length`)) === 1);
  // Défaire le dossier
  await ev(`dissolveFolder(state.project.folders[0].id)`); await sleep(200);
  check('dossier défait : pistes gardées, dossier retiré', (await J(`return state.project.tracks.length + ':' + (state.project.folders||[]).length + ':' + state.project.tracks.filter(t=>t.folder).length`)) === '5:0:0');
};
