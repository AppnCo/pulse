// EQ Horizon (gamme Pulse) : dans « Égaliseur et filtre », fenêtre avec sa courbe et ses 5 points ; un point glissé = fréquence et gain ;
// Terre et Ciel ; Caractère ; zone Centre ; ⌘Z.
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, check } = c;
  await boot(c, { id: 'hz1', name: 'HZ', bpm: 120, sends: [], tracks: [{ name: 'Mix', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const pos = async (sel, text) => JSON.parse(await ev(`JSON.stringify((()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0); const el=${text ? `els.find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}; if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})())`));
  const mouse = async (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (sel, text) => { const r = await pos(sel, text); if (!r) return false; await mouse('mouseMoved', r, { buttons: 0 }); await mouse('mousePressed', r); await mouse('mouseReleased', r); await sleep(300); return true; };
  await click('.track-item');
  await click('#inspector .insp-add-fx');
  await click('.fx-add-menu .fam-cat', 'Égaliseur'); await sleep(100);
  check('menu Pulse : EQ Horizon cliqué', await click('.fx-add-menu .fam-fx', 'EQ Horizon')); await sleep(500);
  const st = JSON.parse(await J(ev, `const p=document.querySelector('.fx-panel.plug-win[data-fx="horizon"]'); return JSON.stringify({ fx: state.project.tracks[0].effects, dots: p ? p.querySelectorAll('.hz-dot').length : 0, curve: p ? p.querySelectorAll('.hz-svg path').length : 0 })`));
  check('ajouté, fenêtre avec 5 points et sa courbe', JSON.stringify(st.fx) === '["horizon"]' && st.dots === 5 && st.curve >= 1, JSON.stringify(st));
  // glisser le point 3 vers le haut et à droite
  const d = await pos('.fx-panel.plug-win[data-fx="horizon"] .hz-dot[data-i="2"]');
  await mouse('mouseMoved', d, { buttons: 0 }); await mouse('mousePressed', d);
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', { x: d.x + i * 8, y: d.y - i * 8 }); await sleep(20); }
  await mouse('mouseReleased', { x: d.x + 48, y: d.y - 48 }); await sleep(200);
  const b3 = JSON.parse(await J(ev, `const p=state.project.tracks[0].effectParams.horizon; return JSON.stringify({ g: p.g3, f: p.f3 })`));
  check('point 3 glissé : gain monté, fréquence montée', b3.g > 2 && b3.f > 1000, JSON.stringify(b3));
  // Terre (bouton) : la valeur s'écrit
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effectParams.horizon.earth=6; t.effectParams.horizon.char=0.8; })()`);
  const coefs = await J(ev, `return PulseAudio.horizonCoefs(state.project.tracks[0].effectParams.horizon, 48000).length`);
  check('Terre + bande 3 = des filtres', coefs >= 2, String(coefs));
  await click('.fx-panel.plug-win[data-fx="horizon"] .ms-sty', 'Centre');
  check('zone Centre pour la bande choisie', await J(ev, `return state.project.tracks[0].effectParams.horizon.ch3`) === 1);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true}))`); await sleep(300);
  check('⌘Z : zone revenue', await J(ev, `return state.project.tracks[0].effectParams.horizon.ch3`) === 0);
};
