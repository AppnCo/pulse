// Groupes de groupes (14/11) : pistes de 2 groupes choisies en entier → « Nouveau groupe » garde les 2 bus et les range dans un grand groupe ;
// clic droit sur une tranche de groupe du mixeur = mêmes rangements ; rond de pan et vumètre sur les groupes ; le voile « Dépose ton audio » ne reste jamais
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  const G = (id, name) => ({ id, name, isGroup: true, output: 'master', color: '#A855F7', volume: 100 });
  const T = (name, out) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [] });
  await boot(c, { id: 'gdg', name: 'GDG', bpm: 120, sends: [],
    buses: [G('va', 'Voix A'), G('vb', 'Voix B'), G('dr', 'Drums')],
    tracks: [T('A1', 'va'), T('A2', 'va'), T('B1', 'vb'), T('B2', 'vb'), T('K', 'dr'), T('S', 'dr'), T('Solo', 'master')] }, { mic: false });
  await sleep(400);
  // 1. les 4 pistes des 2 groupes + une piste seule
  await ev(`createGroupFromTracks([0,1,2,3,6])`); await sleep(400);
  const r = await J(ev, `const nb = state.project.buses.find(b => !['va','vb','dr'].includes(b.id)); return nb && { kids: state.project.buses.filter(b => b.output === nb.id).map(b => b.id).sort().join(), a: busById('va').output === nb.id, solo: state.project.tracks.find(t => t.name === 'Solo').output === nb.id, a1: state.project.tracks[0].output }`);
  check('groupes choisis en entier : gardés et rangés dans le nouveau', r && r.kids === 'va,vb' && r.solo && r.a1 === 'va', JSON.stringify(r));
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : retour', await J(ev, `return state.project.buses.length === 3 && state.project.tracks[0].output === 'va'`));
  // une partie seulement d'un groupe : comme avant (les pistes en sortent)
  await ev(`createGroupFromTracks([0])`); await sleep(300);
  check('une piste d\'un groupe : elle seule change de groupe', await J(ev, `return state.project.tracks[0].output !== 'va' && state.project.tracks[1].output === 'va' && busById('va').output === 'master'`));
  await ev(`undoAction()`); await sleep(300);
  // 2. mixeur : clic droit sur une tranche de groupe
  await ev(`toggleMixer()`); await sleep(600);
  await ev(`state.mixBuses = new Set(['va','vb'])`);
  const lab = await J(ev, `const s = [...document.querySelectorAll('.mixer-strips .strip[data-kind="bus"]')].find(x => state.project.buses[+x.dataset.i].id === 'vb'); const r = s.getBoundingClientRect();
    s.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
    const it = [...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(x => x.textContent.startsWith('Ranger les 2')); if (it) it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return it ? it.textContent : [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(x => x.textContent).join('|')`);
  await sleep(400);
  check('mixeur : « Ranger les 2 groupes choisis… »', /^Ranger les 2/.test(lab || ''), String(lab));
  check('mixeur : les 2 groupes dans un Mix Bus', await J(ev, `const m = state.project.buses.find(b => /^Bus [0-9]/.test(b.name)); return !!m && busById('va').output === m.id && busById('vb').output === m.id`));
  // 3. rond de pan + vumètre sur chaque tranche de groupe, même longueur de fader que les pistes
  const ui = await J(ev, `const s = document.querySelector('.mixer-strips .strip[data-kind="bus"]'), t = document.querySelector('.mixer-strips .strip[data-kind="track"]');
    const h = (x, q) => Math.round(x.querySelector(q).getBoundingClientRect().height);
    return { knob: !!s.querySelector('.strip-pan-knob'), vu: !!s.querySelector('.vu-rail'), fb: h(s, '.fader'), ft: h(t, '.fader'), vb: h(s, '.vu-rail'), vt: h(t, '.vu-rail') }`);
  check('groupe : rond de pan + vumètre, mêmes hauteurs que la piste', ui.knob && ui.vu && ui.fb === ui.ft && ui.vb === ui.vt, JSON.stringify(ui));
  const k = await J(ev, `const s = [...document.querySelectorAll('.mixer-strips .strip[data-kind="bus"]')].find(x => state.project.buses[+x.dataset.i].id === 'dr'); const r = s.querySelector('.strip-pan-knob').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: k.x, y: k.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: k.x, y: k.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: k.x + 30, y: k.y, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: k.x + 30, y: k.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
  check('glisser le rond du groupe : pan à droite', await J(ev, `return busById('dr').pan`) === 30, String(await J(ev, `return busById('dr').pan`)));
  // 4. voile de dépôt : un fichier qui passe sans être lâché ne bloque pas la fenêtre
  await ev(`(()=>{ const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.wav', { type: 'audio/wav' })); document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt })); })()`);
  await sleep(100);
  check('voile affiché au survol', await J(ev, `return document.querySelector('.global-drop-overlay').classList.contains('visible')`));
  await sleep(900);
  check('voile retiré tout seul quand le fichier ne survole plus', await J(ev, `return !document.querySelector('.global-drop-overlay').classList.contains('visible')`));
  // 5. ⌘ enfoncé : le curseur des pistes montre l'outil du ⌘ + clic (Mute par défaut → badge « M »)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifiers: 4 }); await sleep(150);
  const cur = await J(ev, `return document.getElementById('cmdToolCursor').textContent`);
  check('⌘ enfoncé : curseur avec badge M', /timeline-tracks/.test(cur) && decodeURIComponent(cur).includes('>M</text>'), cur.slice(0, 80));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifiers: 0 }); await sleep(150);
  check('⌘ relâché : curseur normal', await J(ev, `return document.getElementById('cmdToolCursor').textContent`) === '');
  // 6. ⇧⌘D avec des groupes choisis (en-têtes), plusieurs fois de suite : un niveau de plus à chaque fois, sans limite
  await ev(`(()=>{ document.querySelectorAll('.track-ctx-menu').forEach(m=>m.remove()); if (state.mixerOpen) toggleMixer(); })()`); await sleep(300);
  const lvl = async () => J(ev, `return Math.max(...state.project.buses.map(b => groupChain(b).length))`);
  const l0 = await lvl();
  for (let round = 0; round < 3; round++) {
    await ev(`(()=>{ const tops = state.project.buses.filter(b => isVisibleGroup(b) && !groupParent(b)); state.selectedTracks = new Set(); state.mixBuses = new Set(tops.map(b => b.id)); openStackMenu(); const it=[...document.querySelectorAll('.stack-menu .ctx-item')].find(x=>x.textContent.startsWith('Nouveau groupe')); it && it.click(); })()`); await sleep(400);
  }
  const l3 = await lvl();
  check('⇧⌘D trois fois sur les groupes : trois niveaux de plus', l3 === l0 + 3, l0 + ' → ' + l3);
  check('les pistes gardent leurs groupes d\'origine', await J(ev, `return state.project.tracks.filter(t => t.name==='A1' || t.name==='A2').every(t => t.output === 'va')`));
};
