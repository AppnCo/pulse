// Gamme Analogique : façades des machines (planche validée le 03/11, docs-planche-analogique-v3.html).
// Les boutons sont des images 3D rendues à chaque angle (outils/boutons-3d → assets/analog/), comme les plugins du commerce :
// tourner un bouton = afficher l'image de son angle. Façade noire brossée, gravures et lumières violettes (touche Pulse).
// Le son : engine/src/analog.rs (Rust) et les worklets pulse-fet76 / pulse-pre73 (audio.js), mêmes chiffres.

// Bandes d'images (assets/analog/index.json) : nombre d'images, taille d'une image, angles du premier et du dernier, marge autour du bouton
const ANA_STRIPS = {
    'alu-big': { n: 61, px: 176, a0: -150, a1: 150, span: 2.35 }, bakelite: { n: 61, px: 112, a0: -150, a1: 150, span: 2.2 },
    chicken: { n: 4, px: 128, a0: -45, a1: 75, span: 2.4 }, 'push-on': { n: 1, px: 112, span: 2.4 }, 'push-off': { n: 1, px: 112, span: 2.4 },
    screw: { n: 1, px: 48, span: 2.3 }, gain73: { n: 7, px: 200, a0: -140, a1: 140, span: 2.4 }, trim73: { n: 61, px: 200, a0: -150, a1: 150, span: 2.4 },
    hf73: { n: 61, px: 144, a0: -150, a1: 150, span: 2.4 }, mid73: { n: 61, px: 160, a0: -150, a1: 150, span: 2.4 },
    midf73: { n: 6, px: 160, a0: -100, a1: 100, span: 2.4 }, low73: { n: 61, px: 160, a0: -150, a1: 150, span: 2.4 },
    lowf73: { n: 4, px: 160, a0: -90, a1: 90, span: 2.4 }, hpf73: { n: 5, px: 112, a0: -120, a1: 120, span: 2.4 }
};
const ANA_NS = 'http://www.w3.org/2000/svg';
const anaEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(ANA_NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

// Une image de la bande, posée centrée sur (cx, cy) pour un bouton de diamètre d ; renvoie de quoi changer d'image
function anaSprite(parent, strip, cx, cy, d) {
    const s = ANA_STRIPS[strip], w = d * s.span / 2;
    const box = anaEl('svg', { x: cx - w / 2, y: cy - w / 2 + d * 0.03, width: w, height: w, viewBox: `0 0 ${s.px} ${s.px}`, class: 'ana-img' }, parent);
    anaEl('image', { href: `assets/analog/${strip}.webp`, width: s.px * s.n, height: s.px, preserveAspectRatio: 'none' }, box);
    let cur = -1;
    return { frame(i) { i = Math.max(0, Math.min(s.n - 1, Math.round(i))); if (i !== cur) { cur = i; box.setAttribute('viewBox', `${i * s.px} 0 ${s.px} ${s.px}`); } }, n: s.n, box };
}

// Graduations gravées autour d'un bouton (angles en degrés, 0 = midi)
function anaTicks(parent, cx, cy, r, n, a0, a1, labels, fs = 8, col = '#c4b5fd') {
    const g = anaEl('g', { class: 'ana-ticks' }, parent);
    for (let i = 0; i < n; i++) {
        const a = (a0 + (a1 - a0) * i / (n - 1)) * Math.PI / 180, L = (i === 0 || i === n - 1 || i === (n - 1) / 2) ? 5 : 3;
        anaEl('line', { x1: cx + Math.sin(a) * r, y1: cy - Math.cos(a) * r, x2: cx + Math.sin(a) * (r + L), y2: cy - Math.cos(a) * (r + L), stroke: col, 'stroke-width': 1.1, 'stroke-linecap': 'round' }, g);
    }
    (labels || []).forEach((t, i, all) => {
        if (t === '') return;
        const a = (a0 + (a1 - a0) * i / (all.length - 1)) * Math.PI / 180;
        const tx = anaEl('text', { x: cx + Math.sin(a) * (r + 13), y: cy - Math.cos(a) * (r + 13) + fs * 0.35, fill: col, 'font-size': fs, 'text-anchor': 'middle' }, g);
        tx.textContent = t;
    });
}
const anaText = (parent, x, y, txt, attrs = {}) => { const e = anaEl('text', { x, y, fill: '#d8c8f5', 'font-size': 9, 'text-anchor': 'middle', 'letter-spacing': 2, class: 'ana-lbl', ...attrs }, parent); e.textContent = txt; return e; };

// Bouton tournant : glisser vers le haut / le bas (Maj = fin), molette, double-clic = valeur de départ.
// `steps` = valeurs permises (bouton à crans) ; sinon continu entre min et max. Le bouton porte la classe .pk + data-key :
// en mode automation, le toucher affiche sa courbe sur la piste (autoTargetOf), et il suit la courbe pendant la lecture (_pkShow).
function anaKnob(parent, { strip, cx, cy, d, key, min, max, def, steps, get, set, fmt, onStart, onEnd, tip }) {
    const g = anaEl('g', { class: 'pk ana-k', 'data-key': key }, parent);
    const sp = anaSprite(g, strip, cx, cy, d);
    const hit = anaEl('circle', { cx, cy, r: d / 2 + 4, fill: 'transparent' }, g);
    if (tip) anaEl('title', {}, hit).textContent = tip;
    const frac = (v) => steps ? Math.max(0, steps.indexOf(steps.reduce((b, s) => Math.abs(s - v) < Math.abs(b - v) ? s : b, steps[0]))) / (steps.length - 1) : (v - min) / (max - min);
    const draw = (v = get()) => sp.frame(frac(v) * (sp.n - 1));
    const quant = (v) => steps ? steps.reduce((b, s) => Math.abs(s - v) < Math.abs(b - v) ? s : b, steps[0]) : Math.max(min, Math.min(max, v));
    const fromFrac = (f) => { f = Math.max(0, Math.min(1, f)); return steps ? steps[Math.round(f * (steps.length - 1))] : min + f * (max - min); };
    g.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const y0 = e.clientY, f0 = frac(get()); let moved = false;
        const mv = (ev) => {
            const v = fromFrac(f0 + (y0 - ev.clientY) / (ev.shiftKey ? 700 : (steps ? 25 * (steps.length - 1) : 160)));
            if (v === get()) return;
            if (!moved) { moved = true; onStart && onStart(); }
            set(v); draw(); g.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) onEnd && onEnd(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    g.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1, v = steps ? steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(quant(get())) + dir))] : quant(get() + dir * (max - min) / 60);
        if (v === get()) return;
        onStart && onStart(); set(v); draw(); onEnd && onEnd();
    }, { passive: false });
    g.addEventListener('dblclick', (e) => { e.stopPropagation(); onStart && onStart(); set(def); draw(); onEnd && onEnd(); });
    g._pkShow = (v) => draw(v);
    g._pkRestore = () => draw();
    draw();
    return { draw, g, fmt };
}

// Fenêtre d'une machine : bandeau Pulse (allumer, titre, fermer), façade en SVG qui s'adapte à la largeur
function anaWindow(t, fx, title, W, H, anchorEl, trackIdx, pw) {
    const panel = document.createElement('div');
    panel.className = 'fx-panel ana-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre la machine"><input type="checkbox" class="fx-bypass" ${t.effects?.includes(fx) ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">${title} <i>— ${esc(t.name || '')}</i></span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="ana-face"></div>
        <div class="lim-sb"><span>Glisser un bouton vers le haut / le bas (Maj = fin), molette, double-clic = départ</span><span class="lim-spacer"></span><span class="ana-read"></span></div>`;
    document.body.appendChild(panel);
    const svg = anaEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ana-svg' }, panel.querySelector('.ana-face'));
    // façade : biseau, alu anodisé noir brossé, vis aux coins
    const defs = anaEl('defs', {}, svg);
    defs.innerHTML = `<filter id="anaBrush" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9 0.012" numOctaves="2" seed="4" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .055 0"/></filter>
        <linearGradient id="anaPanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1a1f"/><stop offset=".5" stop-color="#121116"/><stop offset="1" stop-color="#0b0a0e"/></linearGradient>
        <linearGradient id="anaBevel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3842"/><stop offset=".08" stop-color="#16151a"/><stop offset=".92" stop-color="#0d0c10"/><stop offset="1" stop-color="#000"/></linearGradient>
        <radialGradient id="anaVu" cx=".5" cy="1.1" r="1.1"><stop offset="0" stop-color="#3b1d6e"/><stop offset=".55" stop-color="#1d1033"/><stop offset="1" stop-color="#0c0716"/></radialGradient>
        <linearGradient id="anaGlass" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".35" stop-color="#fff" stop-opacity=".05"/><stop offset=".36" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".03"/></linearGradient>
        <filter id="anaGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <radialGradient id="anaLamp" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#e9d5ff"/><stop offset=".7" stop-color="#9333ea"/><stop offset="1" stop-color="#4c1d95"/></radialGradient>`;
    anaEl('rect', { x: 1, y: 1, width: W - 2, height: H - 2, rx: 6, fill: 'url(#anaBevel)' }, svg);
    anaEl('rect', { x: 5, y: 5, width: W - 10, height: H - 10, rx: 3, fill: 'url(#anaPanel)' }, svg);
    anaEl('rect', { x: 5, y: 5, width: W - 10, height: H - 10, rx: 3, filter: 'url(#anaBrush)' }, svg);
    const m = 18; [[m, m], [W - m, m], [m, H - m], [W - m, H - m]].forEach(([x, y]) => anaSprite(svg, 'screw', x, y, 14).frame(0));
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    const rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 80, right: 80, top: 80 };
    pw = Math.min(pw, window.innerWidth - 16);
    panel.style.width = pw + 'px';
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    return { panel, svg };
}

// Réglages communs : annuler en un pas, rallumer l'effet, relancer la lecture, enregistrer
function anaEdit(t, fx) {
    let armed = false;
    return {
        start() { if (!armed) { pushUndo(); armed = true; } },
        end() { t.effects = t.effects || []; if (!t.effects.includes(fx)) t.effects.push(fx); refreshPlaybackSoon(); saveProject(); armed = false; },
        touch(key) { autoTouch(t, `fx:${fx}:${key}`); }
    };
}

// ===== Éclair 76 : compresseur FET (esprit « 76 », le WA76 du studio) =====
function openFet76Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'fet76');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.fet76) t.effectParams.fet76 = { input: 24, output: 24, attack: 3, release: 5, ratio: 4, mix: 100 };
    const P = () => t.effectParams.fet76, ed = anaEdit(t, 'fet76');
    const W = 960, H = 220;
    const { panel, svg } = anaWindow(t, 'fet76', 'Éclair 76', W, H, anchorEl, trackIdx, 960);
    const L = { fill: '#d8c8f5', style: 'paint-order:stroke', stroke: '#000', 'stroke-opacity': '.5', 'stroke-width': '.6' };
    anaText(svg, 44, 42, 'PULSE · ÉCLAIR 76', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 58, 'COMPRESSEUR FET', { fill: '#a78bfa', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Entrée <b>${Math.round(p.input)}</b> · Sortie <b>${Math.round(p.output)}</b> · Ratio <b>${p.ratio > 0 ? p.ratio + ':1' : 'tous'}</b>${(p.mix ?? 100) < 100 ? ` · Mélange <b>${Math.round(p.mix)} %</b>` : ''}`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 10) / 10; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const io = [['input', 110, 'ENTRÉE', 'Pousser l\'Entrée = plus de compression (pas de seuil, comme la machine)'], ['output', 220, 'SORTIE', 'Remet le niveau après la compression']];
    for (const [key, cx, lab, tip] of io) {
        anaTicks(svg, cx, 128, 40, 11, -150, 150, ['0', '', '', '', '', '24', '', '', '', '', '48'], 7);
        knob({ strip: 'alu-big', cx, cy: 128, d: 70, key, min: 0, max: 48, def: 24, tip });
        anaText(svg, cx, 196, lab, { ...L, 'font-size': 10 });
    }
    for (const [key, cy, lab, def, tip] of [['attack', 96, 'ATTAQUE', 3, '1 = lente, 7 = la plus rapide (20 µs)'], ['release', 166, 'RELÂCHE', 5, '1 = lent (1,1 s), 7 = le plus rapide (50 ms)']]) {
        anaTicks(svg, 318, cy, 21, 7, -135, 135, ['1', '', '', '', '', '', '7'], 7);
        knob({ strip: 'bakelite', cx: 318, cy, d: 32, key, min: 1, max: 7, def, tip });
        anaText(svg, 350, cy + 3, lab, { ...L, 'text-anchor': 'start', 'letter-spacing': 1 });
    }
    // Ratios : poussoirs (un seul enfoncé) ; « TOUS » = tous enfoncés, le son qui écrase et grogne
    anaText(svg, 452, 58, 'RATIO', L);
    const rat = anaEl('g', { class: 'ana-ratio' }, svg);
    const drawRatio = () => {
        rat.innerHTML = '';
        [[20, 82], [12, 112], [8, 142], [4, 172]].forEach(([r, y]) => {
            const on = P().ratio === r || P().ratio <= 0, g = anaEl('g', { class: 'ana-push', 'data-r': r }, rat);
            anaSprite(g, on ? 'push-on' : 'push-off', 452, y, 52).frame(0);
            anaEl('rect', { x: 426, y: y - 13, width: 52, height: 26, fill: 'transparent' }, g);
            anaText(g, 452, y + 4, String(r), { fill: on ? '#fff' : '#a78bfa', 'font-size': 11, 'font-weight': 700, 'letter-spacing': 0, ...(on ? { filter: 'url(#anaGlow)' } : {}) });
            anaEl('title', {}, g).textContent = `Ratio ${r}:1 (Maj + clic = tous les boutons enfoncés)`;
        });
        const all = P().ratio <= 0, g = anaEl('g', { class: 'ana-push', 'data-r': 0 }, rat);
        anaEl('rect', { x: 432, y: 192, width: 40, height: 13, rx: 3, fill: all ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(all ? { filter: 'url(#anaGlow)' } : {}) }, g);
        anaText(g, 452, 202, 'TOUS', { fill: all ? '#fff' : '#a78bfa', 'font-size': 7.5, 'letter-spacing': 1.5 });
        anaEl('title', {}, g).textContent = 'Tous les boutons enfoncés : écrase, pompe et grogne (le son des batteries et des voix agressives)';
    };
    rat.addEventListener('click', (e) => {
        const b = e.target.closest('.ana-push'); if (!b) return;
        ed.start(); P().ratio = e.shiftKey ? 0 : +b.dataset.r; ed.end(); drawRatio(); say();
    });
    drawRatio();
    // Vumètre sous verre : réduction (GR) ou niveau de sortie (+8 / +4), au choix du sélecteur
    const vx = 520, vy = 40, vw = 250, vh = 146, cx = vx + vw / 2, cy = vy + vh + 20, R = 118;
    anaEl('rect', { x: vx - 6, y: vy - 6, width: vw + 12, height: vh + 12, rx: 8, fill: '#050407', stroke: '#2a2733' }, svg);
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaVu)' }, svg);
    const clip = anaEl('clipPath', { id: 'anaVuClip' }, svg); anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4 }, clip);
    const vu = anaEl('g', { 'clip-path': 'url(#anaVuClip)' }, svg);
    const VU = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3], vuA = (db) => { let i = VU.findIndex(v => v >= db); if (i < 0) return 48; if (i === 0) return -48; const f = (db - VU[i - 1]) / (VU[i] - VU[i - 1]); return -48 + 96 * (i - 1 + f) / 10; };
    VU.forEach((v, i) => {
        const a = (-48 + 96 * i / 10) * Math.PI / 180, col = v >= 0 ? '#f0abfc' : '#e9d5ff';
        anaEl('line', { x1: cx + Math.sin(a) * R, y1: cy - Math.cos(a) * R, x2: cx + Math.sin(a) * (R + 8), y2: cy - Math.cos(a) * (R + 8), stroke: col, 'stroke-width': 1.3 }, vu);
        if (i % 2 === 0 || i === 7) anaText(vu, cx + Math.sin(a) * (R + 18), cy - Math.cos(a) * (R + 18) + 3, (v > 0 ? '+' : '') + v, { fill: col, 'font-size': 8.5, 'letter-spacing': 0 });
    });
    const a7 = (-48 + 96 * 7 / 10) * Math.PI / 180, a10 = 48 * Math.PI / 180;
    anaEl('path', { d: `M${cx + Math.sin(a7) * R} ${cy - Math.cos(a7) * R} A${R} ${R} 0 0 1 ${cx + Math.sin(a10) * R} ${cy - Math.cos(a10) * R}`, fill: 'none', stroke: '#f0abfc', 'stroke-width': 3, filter: 'url(#anaGlow)' }, vu);
    const needle = anaEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - R - 4, stroke: '#fff', 'stroke-width': 1.6, filter: 'url(#anaGlow)' }, vu);
    const vuLbl = anaText(svg, vx + 14, vy + vh - 12, 'RÉDUCTION · dB', { fill: '#a78bfa', 'text-anchor': 'start' });
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaGlass)', 'pointer-events': 'none' }, svg);
    // Sélecteur « tête de poulet » : GR, +8, +4, OFF (réglage d'affichage, pas de son : gardé dans le projet comme sur la machine)
    const MODES = ['gr', '+8', '+4', 'off'];
    [['GR', 812, 84], ['+8', 842, 66], ['+4', 874, 84], ['OFF', 880, 136]].forEach(([s, x, y]) => anaText(svg, x, y, s, { fill: '#c4b5fd', 'letter-spacing': 0 }));
    const selG = anaEl('g', { class: 'ana-sel' }, svg), sel = anaSprite(selG, 'chicken', 842, 108, 46);
    anaEl('circle', { cx: 842, cy: 108, r: 26, fill: 'transparent' }, selG);
    anaEl('title', {}, selG).textContent = 'Ce que montre l\'aiguille : la réduction (GR) ou le niveau de sortie (+8 / +4)';
    const mode = () => MODES.indexOf(P().meter || 'gr');
    const drawSel = () => { sel.frame(mode()); vuLbl.textContent = mode() === 0 ? 'RÉDUCTION · dB' : mode() === 3 ? 'ÉTEINT' : 'SORTIE · VU'; };
    selG.addEventListener('click', (e) => { ed.start(); P().meter = MODES[(mode() + (e.shiftKey ? 3 : 1)) % 4]; ed.end(); drawSel(); });
    drawSel();
    // Lampe de marche + bouton Mélange (la touche Pulse : compression parallèle sans bus)
    anaEl('circle', { cx: 905, cy: 176, r: 9, fill: '#050407' }, svg);
    const lamp = anaEl('circle', { cx: 905, cy: 176, r: 6.5, fill: 'url(#anaLamp)', filter: 'url(#anaGlow)' }, svg);
    anaText(svg, 880, 180, 'MARCHE', { fill: '#c4b5fd', 'text-anchor': 'end', 'letter-spacing': 1 });
    anaTicks(svg, 812, 176, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 812, cy: 176, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine (compression parallèle) : 100 % = la machine seule' });
    anaText(svg, 812, 206, 'MÉLANGE', { fill: '#c4b5fd', 'font-size': 7, 'letter-spacing': 1 });
    // Aiguille : réduction ou sortie mesurées par la machine en lecture, avec l'inertie d'un vrai vumètre (300 ms)
    let ang = -48, last = performance.now();
    const key = 'fet76|' + fxKeyOf(trackIdx, t);
    const tick = (now) => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('fet76');
        lamp.setAttribute('opacity', on ? 1 : 0.15);
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const md = mode();
        const target = md === 3 || !m ? (md === 0 ? vuA(0) : -48) : md === 0 ? vuA(-Math.min(20, m.gr || 0)) : vuA((m.out ?? -60) + (md === 1 ? 8 : 4) + 14);
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        ang += (target - ang) * (1 - Math.exp(-dt / 0.065));
        needle.setAttribute('transform', `rotate(${ang.toFixed(2)} ${cx} ${cy})`);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'fet76', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'fet76', trackIdx);
}

// ===== Pulse 73 : préampli + EQ de console (esprit « 73 », le WA73 du studio) =====
function openPre73Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'pre73');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.pre73) t.effectParams.pre73 = { gain: 0, output: 0, high: 0, mid: 0, midF: 2, low: 0, lowF: 1, hpf: -1, eq: 1 };
    const P = () => t.effectParams.pre73, ed = anaEdit(t, 'pre73');
    const W = 460, H = 520;
    const { panel, svg } = anaWindow(t, 'pre73', 'Pulse 73', W, H, anchorEl, trackIdx, 540);
    const L = { fill: '#d8c8f5', style: 'paint-order:stroke', stroke: '#000', 'stroke-opacity': '.5', 'stroke-width': '.6' };
    const MID = [360, 700, 1600, 3200, 4800, 7200], LOW = [35, 60, 110, 220], HPF = [-1, 0, 1, 2, 3], HPFL = ['', '50', '80', '160', '300'];
    const khz = (f) => f >= 1000 ? String(f / 1000).replace('.', ',') + ' k' : String(f);
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Gain <b>+${p.gain}</b> · Aigus <b>${p.high > 0 ? '+' : ''}${p.high}</b> · Médiums <b>${p.mid > 0 ? '+' : ''}${p.mid}</b> à ${khz(MID[p.midF ?? 2])}Hz · Graves <b>${p.low > 0 ? '+' : ''}${p.low}</b> à ${LOW[p.lowF ?? 1]} Hz${p.hpf >= 0 ? ` · coupe-bas ${HPFL[p.hpf + 1]} Hz` : ''}`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    anaText(svg, W / 2, 40, 'PULSE 73', { ...L, 'font-size': 13, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, W / 2, 54, 'PRÉAMPLI · EQ', { fill: '#a78bfa', 'font-size': 8 });
    // colonne gauche : préampli (gain à crans + sortie) ; colonne droite : l'EQ et le coupe-bas
    const X1 = 125, X2 = 335;
    anaTicks(svg, X1, 150, 47, 7, -140, 140, ['0', '5', '10', '15', '20', '25', '30'], 7);
    knob({ strip: 'gain73', cx: X1, cy: 150, d: 82, key: 'gain', min: 0, max: 30, def: 0, steps: [0, 5, 10, 15, 20, 25, 30], tip: 'Gain du préampli : plus on pousse, plus les transfos colorent' });
    anaText(svg, X1, 222, 'GAIN · dB', L);
    anaTicks(svg, X1, 300, 26, 9, -150, 150, ['−24', '', '', '', '', '', '', '', '+12'], 7);
    knob({ strip: 'trim73', cx: X1, cy: 300, d: 36, key: 'output', min: -24, max: 12, def: 0, tip: 'Sortie : remet le niveau après le gain' });
    anaText(svg, X1, 346, 'SORTIE', L);
    // EQ en service (poussoir) — comme l'interrupteur EQ de la machine
    const eqG = anaEl('g', { class: 'ana-push' }, svg);
    const drawEq = () => {
        eqG.innerHTML = ''; const on = (P().eq ?? 1) >= 0.5;
        anaSprite(eqG, on ? 'push-on' : 'push-off', X1, 420, 48).frame(0);
        anaEl('rect', { x: X1 - 24, y: 408, width: 48, height: 24, fill: 'transparent' }, eqG);
        anaText(eqG, X1, 424, 'EQ', { fill: on ? '#fff' : '#a78bfa', 'font-size': 10, 'font-weight': 700, ...(on ? { filter: 'url(#anaGlow)' } : {}) });
        anaEl('title', {}, eqG).textContent = 'EQ en service ou contourné (le préampli reste)';
    };
    eqG.addEventListener('click', () => { ed.start(); P().eq = (P().eq ?? 1) >= 0.5 ? 0 : 1; ed.end(); drawEq(); });
    drawEq();
    anaText(svg, X1, 450, 'EN SERVICE', { fill: '#c4b5fd', 'font-size': 7, 'letter-spacing': 1 });
    // EQ : aigus (12 kHz), médiums et graves concentriques (niveau autour, fréquence au centre), coupe-bas
    const eqK = (cy, d, strip, key, lim, lab) => { anaTicks(svg, X2, cy, d / 2 + 6, 11, -150, 150, null); knob({ strip, cx: X2, cy, d, key, min: -lim, max: lim, def: 0, tip: lab }); };
    eqK(100, 50, 'hf73', 'high', 16, 'Aigus 12 kHz (plateau)');
    anaText(svg, X2, 150, 'AIGUS 12 kHz', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    eqK(205, 58, 'mid73', 'mid', 18, 'Médiums : niveau (bague) — fréquence au centre');
    anaKnob(svg, { strip: 'midf73', cx: X2, cy: 205, d: 58, key: 'midF', min: 0, max: 5, def: 2, steps: [0, 1, 2, 3, 4, 5], get: () => P().midF ?? 2, set: (v) => { P().midF = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Fréquence des médiums : 360 Hz, 700 Hz, 1,6 · 3,2 · 4,8 · 7,2 kHz' }).g.classList.remove('pk');
    MID.forEach((f, i) => { const a = (-100 + 40 * i) * Math.PI / 180; anaText(svg, X2 + Math.sin(a) * 48, 205 - Math.cos(a) * 48 + 3, khz(f).replace(' k', 'k'), { fill: '#a78bfa', 'font-size': 6.5, 'letter-spacing': 0 }); });
    anaText(svg, X2, 260, 'MÉDIUMS', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    eqK(318, 58, 'low73', 'low', 16, 'Graves : niveau (bague) — fréquence au centre');
    anaKnob(svg, { strip: 'lowf73', cx: X2, cy: 318, d: 58, key: 'lowF', min: 0, max: 3, def: 1, steps: [0, 1, 2, 3], get: () => P().lowF ?? 1, set: (v) => { P().lowF = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Fréquence des graves : 35, 60, 110, 220 Hz' }).g.classList.remove('pk');
    LOW.forEach((f, i) => { const a = (-90 + 60 * i) * Math.PI / 180; anaText(svg, X2 + Math.sin(a) * 48, 318 - Math.cos(a) * 48 + 3, String(f), { fill: '#a78bfa', 'font-size': 6.5, 'letter-spacing': 0 }); });
    anaText(svg, X2, 373, 'GRAVES', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    anaTicks(svg, X2, 430, 26, 5, -120, 120, ['ARRÊT', '50', '80', '160', '300'], 6.5);
    anaKnob(svg, { strip: 'hpf73', cx: X2, cy: 430, d: 40, key: 'hpf', min: -1, max: 3, def: -1, steps: HPF, get: () => P().hpf ?? -1, set: (v) => { P().hpf = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Coupe-bas 18 dB/octave : arrêt, 50, 80, 160, 300 Hz' }).g.classList.remove('pk');
    anaText(svg, X2, 482, 'COUPE-BAS', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'pre73', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'pre73', trackIdx);
}

// Styles de la façade (ici pour garder la gamme dans un seul fichier)
(() => {
    const st = document.createElement('style');
    st.textContent = `.ana-panel { padding-bottom: 0; } .ana-face { padding: 8px 10px 4px; } .ana-svg { display: block; width: 100%; height: auto; user-select: none; }
        .ana-svg .ana-k, .ana-svg .ana-sel { cursor: ns-resize; } .ana-svg .ana-push, .ana-svg .ana-sel { cursor: pointer; } .ana-svg text { font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; pointer-events: none; }
        .ana-svg .ana-img { pointer-events: none; } .ana-panel .ana-read b { color: #fff; }`;
    document.head.appendChild(st);
})();
