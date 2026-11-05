// EQ comme Pro-Q : chaque point sur SA courbe (un coupe-bas ne bouge pas quand un autre point monte), réglages seulement au clic
// (en bas du graphique), petite bulle au survol, clic dans le vide = fermé, ↶ ↷, molette = pente sur les coupe-bas, icône du point dynamique
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'epq', name: 'EPQ', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], effects: ['eq'],
    effectParams: { eq: { bands: [{ type: 'hpf', freq: 80, gain: 0, q: 0.71, slope: 24 }] } } }] }, { mic: false });
  await ev(`(() => { openEqPanel(0, document.body); const p = document.querySelector('.eq-panel'); p.style.left = '20px'; p.style.top = '40px'; })()`); await sleep(300);
  const ptY = (i) => J(ev, `const e = document.querySelector('.eq-pt[data-i="${i}"]'); return e ? +e.getAttribute('cy') : null`);
  const y0 = await ptY(0);
  check('réglages fermés à l\'ouverture', await J(ev, `return document.querySelector('.eq-detail').hidden`));
  // un 2e point qui monte fort juste à côté du coupe-bas
  await ev(`(() => { const t = state.project.tracks[0]; t.effectParams.eq = { bands: [...t.effectParams.eq.bands, { type: 'bell', freq: 100, gain: 9, q: 0.7 }] }; t.eqBands = t.effectParams.eq.bands;
    document.querySelector('.eq-panel').remove(); openEqPanel(0, document.body); const p = document.querySelector('.eq-panel'); p.style.left = '20px'; p.style.top = '40px'; })()`); await sleep(300);
  const y1 = await ptY(0);
  check('le coupe-bas reste où il est quand un autre point monte', y0 != null && Math.abs(y1 - y0) < 0.5, JSON.stringify([y0, y1]));
  check('une fine courbe par point', await J(ev, `return document.querySelectorAll('.eq-panel .eq-own').length`) === 2);
  const at = async (sel) => J(ev, `const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
  const M = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 });
  // survol : petite bulle
  const p1 = await at('.eq-pt[data-i="1"]');
  await M('mouseMoved', p1.x - 40, p1.y - 40); await M('mouseMoved', p1.x, p1.y); await sleep(150);
  const hv = await J(ev, `const h = document.querySelector('.eq-hover'); return h && !h.hidden ? h.textContent : null`);
  check('survol : petite bulle fréquence / gain / Q', !!hv && hv.includes('100 Hz') && hv.includes('+9,0 dB') && hv.includes('Q'), String(hv));
  check('survol : les réglages restent fermés', await J(ev, `return document.querySelector('.eq-detail').hidden`));
  // clic sur le point : réglages ouverts, en bas du graphique
  await M('mousePressed', p1.x, p1.y, 1); await M('mouseReleased', p1.x, p1.y); await sleep(200);
  const d = await J(ev, `const d = document.querySelector('.eq-detail'), g = document.querySelector('.eq-graph').getBoundingClientRect(), r = d.getBoundingClientRect(); return { open: !d.hidden, low: r.top > g.top + g.height * 0.55, h: Math.round(r.height), hover: document.querySelector('.eq-hover').hidden }`);
  check('clic sur le point : réglages ouverts en bas, compacts', d.open && d.low && d.h <= 60 && d.hover, JSON.stringify(d));
  // clic dans le vide : fermés
  const g = await at('.eq-graph svg');
  await M('mouseMoved', g.x + 200, g.y - 80); await M('mousePressed', g.x + 200, g.y - 80, 1); await M('mouseReleased', g.x + 200, g.y - 80); await sleep(200);
  check('clic dans le vide : réglages fermés', await J(ev, `return document.querySelector('.eq-detail').hidden`));
  // molette sur le coupe-bas : la pente
  const p0 = await at('.eq-pt[data-i="0"]');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p0.x, y: p0.y, deltaX: 0, deltaY: -100 }); await sleep(200);
  const sl = await J(ev, `const b = state.project.tracks[0].effectParams.eq.bands[0]; return { slope: b.slope, q: b.q }`);
  check('molette sur le coupe-bas : la pente monte (24 → 36), le Q ne bouge pas', sl.slope === 36 && sl.q === 0.71, JSON.stringify(sl));
  const p1b = await at('.eq-pt[data-i="1"]');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p1b.x, y: p1b.y, deltaX: 0, deltaY: -100 }); await sleep(200);
  check('molette sur une cloche : le Q', await J(ev, `return state.project.tracks[0].effectParams.eq.bands[1].q > 0.7`));
  // ↶ ↷
  await ev(`document.querySelector('.eq-undo').click()`); await sleep(150);
  check('↶ : le Q revient', await J(ev, `return Math.abs(state.project.tracks[0].effectParams.eq.bands[1].q - 0.7) < 1e-6`));
  await ev(`document.querySelector('.eq-undo').click()`); await sleep(150);
  check('↶ encore : la pente revient', await J(ev, `return state.project.tracks[0].effectParams.eq.bands[0].slope === 24`));
  await ev(`document.querySelector('.eq-redo').click()`); await sleep(150);
  check('↷ : la pente repart à 36', await J(ev, `return state.project.tracks[0].effectParams.eq.bands[0].slope === 36`));
  check('la fenêtre reste ouverte après ↶ ↷', await J(ev, `return !!document.querySelector('.eq-panel')`));
  // icône du point dynamique : plus d'éclair
  const p1c = await at('.eq-pt[data-i="1"]');
  await M('mouseMoved', p1c.x, p1c.y); await M('mousePressed', p1c.x, p1c.y, 1); await M('mouseReleased', p1c.x, p1c.y); await sleep(200);
  check('point dynamique : icône dessinée, pas d\'éclair', await J(ev, `const b = document.querySelector('.eq-dyn'); return !!b && !!b.querySelector('svg') && !b.textContent.includes('⚡')`));
};
