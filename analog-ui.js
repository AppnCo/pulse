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
    lowf73: { n: 4, px: 160, a0: -90, a1: 90, span: 2.4 }, hpf73: { n: 5, px: 112, a0: -120, a1: 120, span: 2.4 },
    'black-big': { n: 61, px: 200, a0: -150, a1: 150, span: 2.4 }, sel7: { n: 7, px: 128, a0: -90, a1: 90, span: 2.4 }, sel3: { n: 3, px: 128, a0: -45, a1: 45, span: 2.4 }, sel4: { n: 4, px: 128, a0: -60, a1: 60, span: 2.4 }, sel5: { n: 5, px: 128, a0: -90, a1: 90, span: 2.4 }, sel6: { n: 6, px: 128, a0: -100, a1: 100, span: 2.4 }, sel8: { n: 8, px: 128, a0: -105, a1: 105, span: 2.4 }, reel: { n: 1, px: 360, span: 2.1 }, 'tog-up': { n: 1, px: 128, span: 3.2 }, 'tog-down': { n: 1, px: 128, span: 3.2 }
};
// Couleurs de façade (variantes) : dégradé du panneau, gravures, sous-titres, grain du brossé
const ANA_SKINS = {
    noir:   { stops: ['#1b1a1f', '#121116', '#0b0a0e'], txt: '#d8c8f5', sub: '#a78bfa', tick: '#c4b5fd', grain: '.055', stroke: '#000' },
    gris:   { stops: ['#878b90', '#71757a', '#575b60'], txt: '#1a1426', sub: '#3b0764', tick: '#2e1065', grain: '.07', stroke: '#fff' },
    argent: { stops: ['#eceef1', '#d5d7dc', '#aeb1b8'], txt: '#1a1426', sub: '#5b21b6', tick: '#4c1d95', grain: '.09', stroke: '#fff' },
    bleugris: { stops: ['#647f90', '#4f6878', '#3a4f5c'], txt: '#eef4ff', sub: '#e0d4ff', tick: '#e8f0ff', grain: '.07', stroke: '#000' },
    grisbleu: { stops: ['#617281', '#4d5b68', '#37424c'], txt: '#eef0ff', sub: '#d8c8f5', tick: '#e4dcff', grain: '.07', stroke: '#000' },
    brun:     { stops: ['#6d5a4a', '#57473b', '#3e322a'], txt: '#f6ece2', sub: '#e9d5ff', tick: '#efdccd', grain: '.08', stroke: '#000' },
    graphite: { stops: ['#3d3c44', '#2c2b32', '#1d1c22'], txt: '#e4dcf5', sub: '#c4b5fd', tick: '#d8c8f5', grain: '.08', stroke: '#000' }
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
    const g = anaEl('g', { class: 'ana-ticks ana-tk' }, parent);
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
    return g;
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
function anaWindow(t, fx, title, W, H, anchorEl, trackIdx, pw, skin = 'noir') {
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
    anaSkin(svg, skin);
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

// Change la couleur de la façade (variante) : panneau, grain, gravures (.ana-lbl) et sous-titres (.ana-sub)
function anaSkin(svg, name) {
    const k = ANA_SKINS[name] || ANA_SKINS.noir;
    svg.querySelectorAll('#anaPanel stop').forEach((st, i) => st.setAttribute('stop-color', k.stops[i]));
    const cm = svg.querySelector('#anaBrush feColorMatrix'); if (cm) cm.setAttribute('values', `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${k.grain} 0`);
    svg.querySelectorAll('.ana-lbl').forEach(e => { e.setAttribute('fill', k.txt); if (e.getAttribute('stroke')) e.setAttribute('stroke', k.stroke); });
    svg.querySelectorAll('.ana-sub').forEach(e => e.setAttribute('fill', k.sub));
    svg.querySelectorAll('.ana-tk line').forEach(e => e.setAttribute('stroke', k.tick));
    svg.querySelectorAll('.ana-tk text').forEach(e => e.setAttribute('fill', k.tick));
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
    if (!t.effectParams.fet76) t.effectParams.fet76 = { input: 24, output: 24, attack: 3, release: 5, ratio: 4, mix: 100, variant: 0 };
    const P = () => t.effectParams.fet76, ed = anaEdit(t, 'fet76');
    const W = 960, H = 240;
    const FSK = ['noir', 'argent', 'graphite'], FNM = ['Noir', 'Argent', 'Graphite'], FTIP = ['moderne, propre, rapide', 'le premier modèle « bande bleue » : plus de grain, aigus plus doux', 'version mastering : encore plus propre'];
    const { panel, svg } = anaWindow(t, 'fet76', 'Éclair 76', W, H, anchorEl, trackIdx, 960, FSK[Math.round(P().variant ?? 0)]);
    const L = { fill: '#d8c8f5', style: 'paint-order:stroke', stroke: '#000', 'stroke-opacity': '.5', 'stroke-width': '.6' };
    anaText(svg, 44, 42, 'PULSE · ÉCLAIR 76', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const fsub = anaText(svg, 44, 58, 'COMPRESSEUR FET', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    // variantes : on passe de l'une à l'autre en gardant les réglages (la façade change de couleur)
    const vg = anaEl('g', {}, svg);
    const drawVar = () => {
        vg.innerHTML = ''; const cur = Math.round(P().variant ?? 0);
        FNM.forEach((nm, i) => {
            const x = 64 + i * 50, on = i === cur, g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg);
            anaEl('rect', { x: x - 22, y: 216, width: 44, height: 15, rx: 4, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, 226.5, nm.toUpperCase(), { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .8, class: '' });
            anaEl('title', {}, g).textContent = `${nm} : ${FTIP[i]}`;
        });
        fsub.textContent = 'COMPRESSEUR FET · ' + FNM[cur].toUpperCase();
        anaSkin(svg, FSK[cur]);
    };
    vg.addEventListener('click', (e) => { const b = e.target.closest('.ana-var'); if (!b) return; ed.start(); P().variant = +b.dataset.v; ed.end(); drawVar(); say(); });
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${FNM[Math.round(p.variant ?? 0)]} · Entrée <b>${Math.round(p.input)}</b> · Sortie <b>${Math.round(p.output)}</b> · Ratio <b>${p.ratio > 0 ? p.ratio + ':1' : 'tous'}</b>${(p.mix ?? 100) < 100 ? ` · Mélange <b>${Math.round(p.mix)} %</b>` : ''}`; };
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
            anaText(g, 452, y + 4, String(r), { fill: on ? '#fff' : '#a78bfa', 'font-size': 11, 'font-weight': 700, 'letter-spacing': 0, class: '', ...(on ? { filter: 'url(#anaGlow)' } : {}) });
            anaEl('title', {}, g).textContent = `Ratio ${r}:1 (Maj + clic = tous les boutons enfoncés)`;
        });
        const all = P().ratio <= 0, g = anaEl('g', { class: 'ana-push', 'data-r': 0 }, rat);
        anaEl('rect', { x: 432, y: 192, width: 40, height: 13, rx: 3, fill: all ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(all ? { filter: 'url(#anaGlow)' } : {}) }, g);
        anaText(g, 452, 202, 'TOUS', { fill: all ? '#fff' : '#a78bfa', 'font-size': 7.5, 'letter-spacing': 1.5, class: '' });
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
        if (i % 2 === 0 || i === 7) anaText(vu, cx + Math.sin(a) * (R + 18), cy - Math.cos(a) * (R + 18) + 3, (v > 0 ? '+' : '') + v, { fill: col, 'font-size': 8.5, 'letter-spacing': 0, class: '' });
    });
    const a7 = (-48 + 96 * 7 / 10) * Math.PI / 180, a10 = 48 * Math.PI / 180;
    anaEl('path', { d: `M${cx + Math.sin(a7) * R} ${cy - Math.cos(a7) * R} A${R} ${R} 0 0 1 ${cx + Math.sin(a10) * R} ${cy - Math.cos(a10) * R}`, fill: 'none', stroke: '#f0abfc', 'stroke-width': 3, filter: 'url(#anaGlow)' }, vu);
    const needle = anaEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - R - 4, stroke: '#fff', 'stroke-width': 1.6, filter: 'url(#anaGlow)' }, vu);
    const vuLbl = anaText(svg, vx + 14, vy + vh - 12, 'RÉDUCTION · dB', { fill: '#a78bfa', 'text-anchor': 'start', class: '' });
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
    drawVar();
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
    if (!t.effectParams.pre73) t.effectParams.pre73 = { gain: 0, output: 0, high: 0, mid: 0, midF: 2, low: 0, lowF: 1, hpf: -1, eq: 1, variant: 0 };
    const P = () => t.effectParams.pre73, ed = anaEdit(t, 'pre73');
    // variantes : 73 (noir), 84 (gris-bleu, 4 bandes), 73 Vintage (brun, transfos fatigués) — la façade se redessine
    const V = Math.round(P().variant ?? 0), v84 = V === 1, yy = (a, b) => v84 ? b : a;
    const VNM = ['73', '84', 'Vintage'], VSK = ['noir', 'grisbleu', 'brun'], VTIP = ['le classique : 3 bandes aux fréquences de la machine', 'la grande sœur : 4 bandes, aigus 10 / 12 / 16 kHz, médiums « Q serré »', 'transfos fatigués : grave plus rond, aigus adoucis, plus de grain'];
    const W = 460, H = yy(560, 600);
    const { panel, svg } = anaWindow(t, 'pre73', 'Pulse ' + (v84 ? '84' : '73'), W, H, anchorEl, trackIdx, 540, VSK[V]);
    const L = { fill: '#d8c8f5', style: 'paint-order:stroke', stroke: '#000', 'stroke-opacity': '.5', 'stroke-width': '.6' };
    const MID = [360, 700, 1600, 3200, 4800, 7200], LOW = [35, 60, 110, 220], HPF = [-1, 0, 1, 2, 3], HPFL = ['', '50', '80', '160', '300'];
    const khz = (f) => f >= 1000 ? String(f / 1000).replace('.', ',') + ' k' : String(f);
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${['73', '84', 'Vintage'][Math.round(p.variant ?? 0)]} · Gain <b>+${p.gain}</b> · Aigus <b>${p.high > 0 ? '+' : ''}${p.high}</b> · Médiums <b>${p.mid > 0 ? '+' : ''}${p.mid}</b> à ${khz(MID[p.midF ?? 2])}Hz · Graves <b>${p.low > 0 ? '+' : ''}${p.low}</b> à ${LOW[p.lowF ?? 1]} Hz${p.hpf >= 0 ? ` · coupe-bas ${HPFL[p.hpf + 1]} Hz` : ''}`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    anaText(svg, W / 2, 40, 'PULSE ' + (v84 ? '84' : '73'), { ...L, 'font-size': 13, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, W / 2, 54, 'PRÉAMPLI · EQ' + (V === 2 ? ' · VINTAGE' : v84 ? ' · 4 BANDES' : ''), { fill: '#a78bfa', 'font-size': 8 });
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
    const HFL = ['10', '12', '16'];
    const YM = yy(205, 300), YL = yy(318, 400), YH = yy(430, 492);
    eqK(100, 50, 'hf73', 'high', 16, v84 ? 'Aigus (plateau) : 10, 12 ou 16 kHz au choix' : 'Aigus 12 kHz (plateau)');
    anaText(svg, X2, 150, v84 ? 'AIGUS kHz' : 'AIGUS 12 kHz', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    // 84 : petits poussoirs de fréquence des aigus, bande des bas-médiums, médiums « Q serré »
    const smallPush = (g, x, y, w, txt, on, tip) => { anaEl('rect', { x: x - w / 2, y: y - 7, width: w, height: 14, rx: 3, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g); anaText(g, x, y + 3, txt, { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .5, class: '' }); anaEl('title', {}, g).textContent = tip; };
    if (v84) {
        const hg = anaEl('g', {}, svg);
        const drawHf = () => { hg.innerHTML = ''; HFL.forEach((h, i) => { const g = anaEl('g', { class: 'ana-push', 'data-h': i }, hg); smallPush(g, X2 + 58, 82 + i * 18, 26, h, (P().highF ?? 1) === i, `Aigus à ${h} kHz`); }); };
        hg.addEventListener('click', (e) => { const b = e.target.closest('[data-h]'); if (!b) return; ed.start(); P().highF = +b.dataset.h; ed.end(); drawHf(); say(); });
        drawHf();
        const LM = [220, 360, 700, 1600];
        eqK(200, 54, 'mid73', 'lmid', 16, 'Bas-médiums : niveau (bague) — fréquence au centre');
        anaKnob(svg, { strip: 'lowf73', cx: X2, cy: 200, d: 54, key: 'lmidF', min: 0, max: 3, def: 1, steps: [0, 1, 2, 3], get: () => P().lmidF ?? 1, set: (v) => { P().lmidF = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Fréquence des bas-médiums : 220, 360, 700 Hz, 1,6 kHz' }).g.classList.remove('pk');
        LM.forEach((f, i) => { const a = (-90 + 60 * i) * Math.PI / 180; anaText(svg, X2 + Math.sin(a) * 45, 200 - Math.cos(a) * 45 + 3, khz(f).replace(' k', 'k'), { fill: '#a78bfa', 'font-size': 6.5, 'letter-spacing': 0 }); });
        anaText(svg, X2, 252, 'BAS-MÉDIUMS', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
        const qg = anaEl('g', { class: 'ana-push' }, svg);
        const drawQ = () => { qg.innerHTML = ''; smallPush(qg, X2 + 76, YM + 42, 40, 'Q SERRÉ', (P().hiq ?? 0) >= 0.5, 'Médiums deux fois plus étroits (pour corriger précisément)'); };
        qg.addEventListener('click', () => { ed.start(); P().hiq = (P().hiq ?? 0) >= 0.5 ? 0 : 1; ed.end(); drawQ(); });
        drawQ();
    }
    eqK(YM, 58, 'mid73', 'mid', 18, 'Médiums : niveau (bague) — fréquence au centre');
    anaKnob(svg, { strip: 'midf73', cx: X2, cy: YM, d: 58, key: 'midF', min: 0, max: 5, def: 2, steps: [0, 1, 2, 3, 4, 5], get: () => P().midF ?? 2, set: (v) => { P().midF = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Fréquence des médiums : 360 Hz, 700 Hz, 1,6 · 3,2 · 4,8 · 7,2 kHz' }).g.classList.remove('pk');
    MID.forEach((f, i) => { const a = (-100 + 40 * i) * Math.PI / 180; anaText(svg, X2 + Math.sin(a) * 48, YM - Math.cos(a) * 48 + 3, khz(f).replace(' k', 'k'), { fill: '#a78bfa', 'font-size': 6.5, 'letter-spacing': 0 }); });
    anaText(svg, X2, YM + 55, 'MÉDIUMS', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    eqK(YL, 58, 'low73', 'low', 16, 'Graves : niveau (bague) — fréquence au centre');
    anaKnob(svg, { strip: 'lowf73', cx: X2, cy: YL, d: 58, key: 'lowF', min: 0, max: 3, def: 1, steps: [0, 1, 2, 3], get: () => P().lowF ?? 1, set: (v) => { P().lowF = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Fréquence des graves : 35, 60, 110, 220 Hz' }).g.classList.remove('pk');
    LOW.forEach((f, i) => { const a = (-90 + 60 * i) * Math.PI / 180; anaText(svg, X2 + Math.sin(a) * 48, YL - Math.cos(a) * 48 + 3, String(f), { fill: '#a78bfa', 'font-size': 6.5, 'letter-spacing': 0 }); });
    anaText(svg, X2, YL + 55, 'GRAVES', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    anaTicks(svg, X2, YH, 26, 5, -120, 120, ['ARRÊT', '50', '80', '160', '300'], 6.5);
    anaKnob(svg, { strip: 'hpf73', cx: X2, cy: YH, d: 40, key: 'hpf', min: -1, max: 3, def: -1, steps: HPF, get: () => P().hpf ?? -1, set: (v) => { P().hpf = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Coupe-bas 18 dB/octave : arrêt, 50, 80, 160, 300 Hz' }).g.classList.remove('pk');
    anaText(svg, X2, YH + 52, 'COUPE-BAS', { ...L, 'font-size': 8.5, 'letter-spacing': 1 });
    // choix de la variante (en bas à gauche) : les réglages restent, la façade se redessine à la même place
    const vg = anaEl('g', {}, svg);
    VNM.forEach((nm, i) => { const g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg); smallPush(g, X1 - 52 + i * 52, H - 50, 48, nm.toUpperCase(), i === V, `${nm} : ${VTIP[i]}`); });
    anaText(svg, X1, H - 30, 'VARIANTE', { fill: '#c4b5fd', 'font-size': 7, 'letter-spacing': 1 });
    vg.addEventListener('click', (e) => {
        const b = e.target.closest('.ana-var'); if (!b || +b.dataset.v === V) return;
        ed.start(); P().variant = +b.dataset.v; ed.end();
        const { left, top } = panel.style; panel.remove();
        openPre73Panel(trackIdx, anchorEl);
        const np = findPlugWin(t, 'pre73'); if (np) { np.style.left = left; np.style.top = top; }
    });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'pre73', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'pre73', trackIdx);
}


// ===== Optique 2A : compresseur optique à lampes (esprit « 2A »), trois variantes Gris / Argent / Noir =====
const OPTO_SKINS = ['gris', 'argent', 'noir'], OPTO_NAMES = ['Gris', 'Argent', 'Noir'];
const OPTO_TIPS = ['la plus ancienne : sombre, lente, grasse', 'la classique : lisse, la voix se pose toute seule', 'plus claire, plus rapide, plus de mordant'];
function openOpto2APanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'opto2a');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.opto2a) t.effectParams.opto2a = { gain: 40, peak: 40, limit: 0, emph: 0, variant: 1, mix: 100 };
    const P = () => t.effectParams.opto2a, ed = anaEdit(t, 'opto2a');
    const W = 820, H = 320, v0 = Math.round(P().variant ?? 1);
    const { panel, svg } = anaWindow(t, 'opto2a', 'Optique 2A', W, H, anchorEl, trackIdx, 860, OPTO_SKINS[v0]);
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 42, 'PULSE · OPTIQUE 2A', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const sub = anaText(svg, 44, 58, '', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${OPTO_NAMES[Math.round(p.variant ?? 1)]} · Gain <b>${Math.round(p.gain)}</b> · Réduction <b>${Math.round(p.peak)}</b> · ${(p.limit ?? 0) >= 0.5 ? 'Limitation' : 'Compression'}${(p.mix ?? 100) < 100 ? ` · Mélange <b>${Math.round(p.mix)} %</b>` : ''}`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v); ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const labels = ['0', '', '20', '', '40', '', '60', '', '80', '', '100'];
    anaTicks(svg, 135, 160, 60, 11, -150, 150, labels, 8, '#c4b5fd').classList.add('ana-tk');
    knob({ strip: 'black-big', cx: 135, cy: 160, d: 104, key: 'gain', min: 0, max: 100, def: 40, tip: 'Gain de sortie (40 = niveau d\'origine) : il passe avant la lampe, plus il monte plus ça colore' });
    anaText(svg, 135, 252, 'GAIN', { ...L, 'font-size': 11 });
    anaTicks(svg, 685, 160, 60, 11, -150, 150, labels, 8, '#c4b5fd').classList.add('ana-tk');
    knob({ strip: 'black-big', cx: 685, cy: 160, d: 104, key: 'peak', min: 0, max: 100, def: 40, tip: 'Réduction : plus on tourne, plus la cellule optique compresse' });
    anaText(svg, 685, 252, 'RÉDUCTION', { ...L, 'font-size': 11 });
    // vumètre au centre
    const vx = 290, vy = 52, vw = 240, vh = 150, cx = vx + vw / 2, cy = vy + vh + 22, R = 116;
    anaEl('rect', { x: vx - 6, y: vy - 6, width: vw + 12, height: vh + 12, rx: 8, fill: '#050407', stroke: '#2a2733' }, svg);
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaVu)' }, svg);
    const clip = anaEl('clipPath', { id: 'anaVuClip2' }, svg); anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4 }, clip);
    const vu = anaEl('g', { 'clip-path': 'url(#anaVuClip2)' }, svg);
    const VU = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3], vuA = (db) => { let i = VU.findIndex(v => v >= db); if (i < 0) return 48; if (i === 0) return -48; const f = (db - VU[i - 1]) / (VU[i] - VU[i - 1]); return -48 + 96 * (i - 1 + f) / 10; };
    VU.forEach((v, i) => {
        const a = (-48 + 96 * i / 10) * Math.PI / 180, col = v >= 0 ? '#f0abfc' : '#e9d5ff';
        anaEl('line', { x1: cx + Math.sin(a) * R, y1: cy - Math.cos(a) * R, x2: cx + Math.sin(a) * (R + 8), y2: cy - Math.cos(a) * (R + 8), stroke: col, 'stroke-width': 1.3 }, vu);
        if (i % 2 === 0 || i === 7) anaText(vu, cx + Math.sin(a) * (R + 18), cy - Math.cos(a) * (R + 18) + 3, (v > 0 ? '+' : '') + v, { fill: col, 'font-size': 8.5, 'letter-spacing': 0, class: '' });
    });
    const needle = anaEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - R - 4, stroke: '#fff', 'stroke-width': 1.6, filter: 'url(#anaGlow)' }, vu);
    const vuLbl = anaText(svg, vx + 12, vy + vh - 12, '', { fill: '#a78bfa', 'text-anchor': 'start', class: '' });
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaGlass)', 'pointer-events': 'none' }, svg);
    // rangée du bas : Compression / Limitation, accentuation des aigus, sélecteur du vumètre, variantes, mélange
    const by = 272;
    const tg = anaEl('g', { class: 'ana-push' }, svg);
    const drawTog = () => { tg.innerHTML = ''; const lim = (P().limit ?? 0) >= 0.5; anaSprite(tg, lim ? 'tog-down' : 'tog-up', 300, by, 30).frame(0); anaEl('rect', { x: 284, y: by - 24, width: 32, height: 48, fill: 'transparent' }, tg); anaEl('title', {}, tg).textContent = 'Compression (en haut) ou Limitation (en bas)'; };
    anaText(svg, 300, by - 30, 'COMPRESSION', { ...L, 'font-size': 7.5, 'letter-spacing': 1 });
    anaText(svg, 300, by + 38, 'LIMITATION', { ...L, 'font-size': 7.5, 'letter-spacing': 1 });
    tg.addEventListener('click', () => { ed.start(); P().limit = (P().limit ?? 0) >= 0.5 ? 0 : 1; ed.end(); drawTog(); say(); });
    drawTog();
    anaTicks(svg, 385, by, 17, 5, -135, 135, null, 8, '#c4b5fd').classList.add('ana-tk');
    knob({ strip: 'bakelite', cx: 385, cy: by, d: 26, key: 'emph', min: 0, max: 100, def: 0, tip: 'Accentuation des aigus du détecteur : les « s » et les aigus font plus réagir la cellule (plat = 0)' });
    anaText(svg, 385, by + 32, 'AIGUS DÉTECTEUR', { ...L, 'font-size': 7, 'letter-spacing': .8 });
    const MODES = ['gr', '+10', '+4'];
    [['GR', 452, by - 16], ['+10', 478, by - 26], ['+4', 504, by - 16]].forEach(([tx, x, y]) => anaText(svg, x, y, tx, { 'font-size': 8, 'letter-spacing': 0 }));
    const selG = anaEl('g', { class: 'ana-sel' }, svg), sel = anaSprite(selG, 'chicken', 478, by + 4, 30);
    anaEl('circle', { cx: 478, cy: by + 4, r: 18, fill: 'transparent' }, selG);
    anaEl('title', {}, selG).textContent = 'Ce que montre l\'aiguille : la réduction (GR) ou le niveau de sortie (+10 / +4)';
    const mode = () => Math.max(0, MODES.indexOf(P().meter || 'gr'));
    const drawSel = () => { sel.frame(mode()); vuLbl.textContent = mode() === 0 ? 'RÉDUCTION · dB' : 'SORTIE · VU'; };
    selG.addEventListener('click', () => { ed.start(); P().meter = MODES[(mode() + 1) % 3]; ed.end(); drawSel(); });
    drawSel();
    // variantes : on passe de l'une à l'autre en gardant les réglages (la façade change de couleur)
    const vg = anaEl('g', {}, svg);
    const drawVar = () => {
        vg.innerHTML = ''; const cur = Math.round(P().variant ?? 1);
        OPTO_NAMES.forEach((nm, i) => {
            const x = 560 + i * 48, on = i === cur, g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg);
            anaEl('rect', { x: x - 21, y: by - 9, width: 42, height: 18, rx: 4, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, by + 4, nm.toUpperCase(), { fill: on ? '#fff' : '#a78bfa', 'font-size': 7.5, 'letter-spacing': 1, class: '' });
            anaEl('title', {}, g).textContent = `${nm} : ${OPTO_TIPS[i]}`;
        });
        sub.textContent = 'COMPRESSEUR OPTIQUE · ' + OPTO_NAMES[cur].toUpperCase();
        anaSkin(svg, OPTO_SKINS[cur]);
    };
    vg.addEventListener('click', (e) => { const b = e.target.closest('.ana-var'); if (!b) return; ed.start(); P().variant = +b.dataset.v; ed.end(); drawVar(); say(); });
    anaText(svg, 608, by + 26, 'VARIANTE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    drawVar();
    anaTicks(svg, 760, by, 15, 5, -135, 135, null, 8, '#c4b5fd').classList.add('ana-tk');
    knob({ strip: 'bakelite', cx: 760, cy: by, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine (compression parallèle)' });
    anaText(svg, 760, by + 30, 'MÉLANGE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    // aiguille (lente comme un vrai vumètre)
    let ang = -48, last = performance.now();
    const key = 'opto2a|' + fxKeyOf(trackIdx, t);
    const tick = (now) => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('opto2a');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const md = mode();
        const target = !m ? (md === 0 ? vuA(0) : -48) : md === 0 ? vuA(-Math.min(20, m.gr || 0)) : vuA((m.out ?? -60) + (md === 1 ? 10 : 4) + 14);
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        ang += (target - ang) * (1 - Math.exp(-dt / 0.065));
        needle.setAttribute('transform', `rotate(${ang.toFixed(2)} ${cx} ${cy})`);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'opto2a', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    anaSkin(svg, OPTO_SKINS[Math.round(P().variant ?? 1)]);
    say();
    makePlugWindow(panel, t, 'opto2a', trackIdx);
}


// ===== Égaliseur passif P1 (esprit « P1 », l'égaliseur passif à lampes) : façade bleu-gris, en largeur comme la machine =====
function openEqP1Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'eqp1');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.eqp1) t.effectParams.eqp1 = { lowF: 2, lowBoost: 0, lowAtten: 0, highF: 4, highBoost: 0, bw: 5, attenF: 1, highAtten: 0, output: 0, on: 1 };
    const P = () => t.effectParams.eqp1, ed = anaEdit(t, 'eqp1');
    const W = 1000, H = 250;
    const { panel, svg } = anaWindow(t, 'eqp1', 'Égaliseur P1', W, H, anchorEl, trackIdx, 1000, 'bleugris');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · ÉGALISEUR P1', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 56, 'ÉGALISEUR PASSIF À LAMPES', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const LF = [20, 30, 60, 100], HFB = ['3', '4', '5', '8', '10', '12', '16'], HFA = ['5', '10', '20'];
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Grave ${LF[p.lowF ?? 2]} Hz : pousser <b>${p.lowBoost}</b>, atténuer <b>${p.lowAtten}</b> · Aigus ${HFB[p.highF ?? 4]} kHz <b>${p.highBoost}</b> · atténués ${HFA[p.attenF ?? 1]} kHz <b>${p.highAtten}</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const sel = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = v; say(); }, onStart: ed.start, onEnd: ed.end }).g.classList.remove('pk');
    const CY = 140, ten = ['0', '', '', '', '', '5', '', '', '', '', '10'];
    const big = (cx, key, lab, tip) => { anaTicks(svg, cx, CY, 40, 11, -150, 150, ten, 7.5); knob({ strip: 'black-big', cx, cy: CY, d: 64, key, min: 0, max: 10, def: 0, tip }); anaText(svg, cx, CY + 70, lab, { ...L, 'font-size': 9 }); };
    const pick = (cx, key, strip, labels, a0, a1, def, lab, tip) => {
        labels.forEach((tx, i) => { const a = (a0 + (a1 - a0) * i / (labels.length - 1)) * Math.PI / 180; anaText(svg, cx + Math.sin(a) * 34, CY - Math.cos(a) * 34 + 3, tx, { 'font-size': 8, 'letter-spacing': 0 }); });
        sel({ strip, cx, cy: CY, d: 40, key, min: 0, max: labels.length - 1, def, steps: labels.map((_, i) => i), tip });
        anaText(svg, cx, CY + 70, lab, { ...L, 'font-size': 9 });
    };
    // grave
    pick(90, 'lowF', 'sel4', ['20', '30', '60', '100'], -60, 60, 2, 'GRAVE Hz', 'Fréquence du grave : 20, 30, 60 ou 100 Hz');
    big(190, 'lowBoost', 'POUSSER', 'Pousse le grave (le plateau gonfle un peu à la fréquence)');
    big(290, 'lowAtten', 'ATTÉNUER', 'Atténue le grave, plus haut que là où il pousse : les deux ensemble = grave plein, bas serré (le « truc » de la machine)');
    anaEl('line', { x1: 352, y1: 78, x2: 352, y2: 222, stroke: '#00000044', 'stroke-width': 1 }, svg);
    // aigus poussés
    pick(420, 'highF', 'sel7', HFB, -90, 90, 4, 'AIGUS kHz', 'Fréquence des aigus poussés : 3 à 16 kHz');
    big(520, 'highBoost', 'POUSSER', 'Pousse les aigus en cloche');
    big(620, 'bw', 'LARGE ← → SERRÉ', 'Largeur de la cloche des aigus : 0 = large et douce, 10 = serrée');
    anaEl('line', { x1: 682, y1: 78, x2: 682, y2: 222, stroke: '#00000044', 'stroke-width': 1 }, svg);
    // aigus atténués
    big(750, 'highAtten', 'ATTÉNUER', 'Atténue les aigus en plateau');
    pick(850, 'attenF', 'sel3', HFA, -45, 45, 1, 'ATTÉN. kHz', 'Où commence l\'atténuation des aigus : 5, 10 ou 20 kHz');
    // en service + sortie
    const tg = anaEl('g', { class: 'ana-push' }, svg);
    const drawTog = () => { tg.innerHTML = ''; const on = (P().on ?? 1) >= 0.5; anaSprite(tg, on ? 'tog-up' : 'tog-down', 945, 110, 30).frame(0); anaEl('rect', { x: 929, y: 86, width: 32, height: 48, fill: 'transparent' }, tg); anaEl('title', {}, tg).textContent = 'EQ en service (en haut) ou contourné (en bas) : la lampe reste'; };
    tg.addEventListener('click', () => { ed.start(); P().on = (P().on ?? 1) >= 0.5 ? 0 : 1; ed.end(); drawTog(); });
    drawTog();
    anaText(svg, 945, 78, 'EN SERVICE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    anaTicks(svg, 945, 186, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 945, cy: 186, d: 22, key: 'output', min: -12, max: 12, def: 0, tip: 'Sortie (dB)' });
    anaText(svg, 945, 214, 'SORTIE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'eqp1', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    anaSkin(svg, 'bleugris');
    say();
    makePlugWindow(panel, t, 'eqp1', trackIdx);
}


// ===== Bus G : compresseur de bus de console (esprit « G »), variantes Gris / Noir =====
function openBusGPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'busg');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.busg) t.effectParams.busg = { thr: -10, ratio: 4, attack: 3, release: 4, makeup: 0, scHpf: 0, mix: 100, variant: 0 };
    const P = () => t.effectParams.busg, ed = anaEdit(t, 'busg');
    const W = 900, H = 240, SK = ['gris', 'noir'], NM = ['Gris', 'Noir'], TIP = ['la classique : propre, elle « colle » le mix', 'plus agressive : genou plus franc, la sortie qui chauffe'];
    const { panel, svg } = anaWindow(t, 'busg', 'Bus G', W, H, anchorEl, trackIdx, 900, SK[Math.round(P().variant ?? 0)]);
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · BUS G', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const sub = anaText(svg, 44, 56, '', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const ATT = ['0,1', '0,3', '1', '3', '10', '30'], REL = ['0,1', '0,3', '0,6', '1,2', 'AUTO'], RAT = [2, 4, 10], HPF = ['ARRÊT', '60', '90', '150'];
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${NM[Math.round(p.variant ?? 0)]} · Seuil <b>${Math.round(p.thr)} dB</b> · Ratio <b>${p.ratio}:1</b> · Attaque <b>${ATT[p.attack ?? 3]} ms</b> · Relâche <b>${REL[p.release ?? 4]}${(p.release ?? 4) < 4 ? ' s' : ''}</b> · Gain <b>+${Math.round(p.makeup)} dB</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const sel = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = v; say(); }, onStart: ed.start, onEnd: ed.end }).g.classList.remove('pk');
    const CY = 130;
    const pick = (cx, key, strip, labels, a0, a1, def, lab, tip, vals) => {
        labels.forEach((tx, i) => { const a = (a0 + (a1 - a0) * i / (labels.length - 1)) * Math.PI / 180; anaText(svg, cx + Math.sin(a) * 36, CY - Math.cos(a) * 36 + 3, tx, { 'font-size': 7.5, 'letter-spacing': 0 }); });
        sel({ strip, cx, cy: CY, d: 42, key, min: 0, max: labels.length - 1, def, steps: vals || labels.map((_, i) => i), tip });
        anaText(svg, cx, CY + 62, lab, { ...L, 'font-size': 9 });
    };
    anaTicks(svg, 100, CY, 34, 7, -150, 150, ['−30', '', '', '−15', '', '', '0'], 7);
    knob({ strip: 'hf73', cx: 100, cy: CY, d: 50, key: 'thr', min: -30, max: 0, def: -10, tip: 'Seuil : plus bas = plus de compression' });
    anaText(svg, 100, CY + 62, 'SEUIL', { ...L, 'font-size': 9 });
    pick(205, 'ratio', 'sel3', ['2', '4', '10'], -45, 45, 4, 'RATIO', 'Ratio : 2, 4 ou 10', RAT);
    pick(305, 'attack', 'sel6', ATT, -100, 100, 3, 'ATTAQUE ms', 'Attaque : de 0,1 ms (écrase les coups) à 30 ms (laisse passer le claquant)');
    pick(405, 'release', 'sel5', REL, -90, 90, 4, 'RELÂCHE s', 'Relâchement : 0,1 à 1,2 s, ou Auto (vite sur les coups, lent quand ça dure)');
    anaTicks(svg, 505, CY, 34, 7, -150, 150, ['0', '', '', '', '', '', '15'], 7);
    knob({ strip: 'hf73', cx: 505, cy: CY, d: 50, key: 'makeup', min: 0, max: 15, def: 0, tip: 'Gain de compensation' });
    anaText(svg, 505, CY + 62, 'GAIN', { ...L, 'font-size': 9 });
    // vumètre de réduction (comme la machine : l'aiguille part de 0 vers la gauche)
    const vx = 580, vy = 66, vw = 170, vh = 110, cx = vx + vw / 2, cy = vy + vh + 14, R = 92;
    anaEl('rect', { x: vx - 5, y: vy - 5, width: vw + 10, height: vh + 10, rx: 7, fill: '#050407', stroke: '#2a2733' }, svg);
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaVu)' }, svg);
    const clip = anaEl('clipPath', { id: 'anaVuClipG' }, svg); anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4 }, clip);
    const vu = anaEl('g', { 'clip-path': 'url(#anaVuClipG)' }, svg);
    const GR = [20, 15, 10, 8, 6, 4, 2, 0], grA = (g) => -45 + 90 * Math.max(0, Math.min(1, 1 - g / 20));
    GR.forEach((g) => { const a = grA(g) * Math.PI / 180; anaEl('line', { x1: cx + Math.sin(a) * R, y1: cy - Math.cos(a) * R, x2: cx + Math.sin(a) * (R + 7), y2: cy - Math.cos(a) * (R + 7), stroke: '#e9d5ff', 'stroke-width': 1.2 }, vu);
        anaText(vu, cx + Math.sin(a) * (R + 15), cy - Math.cos(a) * (R + 15) + 3, String(g), { fill: '#e9d5ff', 'font-size': 7.5, 'letter-spacing': 0, class: '' }); });
    const needle = anaEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - R - 3, stroke: '#fff', 'stroke-width': 1.5, filter: 'url(#anaGlow)' }, vu);
    anaText(svg, vx + 10, vy + vh - 9, 'RÉDUCTION · dB', { fill: '#a78bfa', 'text-anchor': 'start', 'font-size': 7.5, class: '' });
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaGlass)', 'pointer-events': 'none' }, svg);
    // coupe-bas du détecteur, mélange, variantes
    const by = 212;
    anaText(svg, 800, 52, 'DÉTECTEUR', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    ['ARRÊT', '60', '90', '150'].forEach((tx, i) => { const a = (-60 + 40 * i) * Math.PI / 180; anaText(svg, 800 + Math.sin(a) * 26, 92 - Math.cos(a) * 26 + 3, tx, { 'font-size': 6.5, 'letter-spacing': 0 }); });
    sel({ strip: 'sel4', cx: 800, cy: 92, d: 28, key: 'scHpf', min: 0, max: 3, def: 0, steps: [0, 1, 2, 3], tip: 'Coupe-bas du détecteur : le grave ne fait plus pomper le mix (arrêt, 60, 90, 150 Hz)' });
    anaText(svg, 800, 124, 'COUPE-BAS Hz', { ...L, 'font-size': 7, 'letter-spacing': .8 });
    anaTicks(svg, 860, 92, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 860, cy: 92, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine (compression parallèle)' });
    anaText(svg, 860, 124, 'MÉLANGE', { ...L, 'font-size': 7, 'letter-spacing': .8 });
    const vg = anaEl('g', {}, svg);
    const drawVar = () => {
        vg.innerHTML = ''; const cur = Math.round(P().variant ?? 0);
        NM.forEach((nm, i) => { const x = 800 + (i - 0.5) * 50, on = i === cur, g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg);
            anaEl('rect', { x: x - 22, y: 168, width: 44, height: 15, rx: 4, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, 178.5, nm.toUpperCase(), { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .8, class: '' });
            anaEl('title', {}, g).textContent = `${nm} : ${TIP[i]}`; });
        sub.textContent = 'COMPRESSEUR DE BUS · ' + NM[cur].toUpperCase();
        anaSkin(svg, SK[cur]);
    };
    vg.addEventListener('click', (e) => { const b = e.target.closest('.ana-var'); if (!b) return; ed.start(); P().variant = +b.dataset.v; ed.end(); drawVar(); say(); });
    anaText(svg, 800, by - 14, 'VARIANTE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    let ang = grA(0), last = performance.now();
    const key = 'busg|' + fxKeyOf(trackIdx, t);
    const tick = (now) => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('busg');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const target = grA(m ? (m.gr || 0) : 0);
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        ang += (target - ang) * (1 - Math.exp(-dt / 0.05));
        needle.setAttribute('transform', `rotate(${ang.toFixed(2)} ${cx} ${cy})`);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'busg', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    drawVar();
    say();
    makePlugWindow(panel, t, 'busg', trackIdx);
}


// ===== Bande 80 : magnétophone à bande (½ pouce, 2 pouces, cassette) — les bobines tournent pendant la lecture =====
function openTapePanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'tape');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.tape) t.effectParams.tape = { input: 0, output: 0, speed: 0, machine: 0, bias: 0, noise: 20, wow: 50, mix: 100 };
    const P = () => t.effectParams.tape, ed = anaEdit(t, 'tape');
    const W = 900, H = 360, SK = ['argent', 'noir', 'graphite'], NM = ['½ pouce', '2 pouces', 'Cassette'], TIP = ['brillante et nette', 'grasse, la grosse bosse dans le grave', 'lo-fi : bande étroite, souffle, pleurage'];
    const { panel, svg } = anaWindow(t, 'tape', 'Bande 80', W, H, anchorEl, trackIdx, 900, SK[Math.round(P().machine ?? 0)]);
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · BANDE 80', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const sub = anaText(svg, 44, 56, '', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${NM[Math.round(p.machine ?? 0)]} · ${(p.speed ?? 0) >= 1 && (p.machine ?? 0) < 2 ? '30' : '15'} · Entrée <b>${p.input > 0 ? '+' : ''}${p.input} dB</b> · Polarisation <b>${Math.round(p.bias)}</b> · Souffle <b>${Math.round(p.noise)}</b> · Pleurage <b>${Math.round(p.wow)}</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    // les deux bobines, la bande entre elles qui passe sur le bloc des têtes
    const R1 = { x: 240, y: 150 }, R2 = { x: 660, y: 150 }, RR = 92;
    anaEl('path', { d: `M${R1.x - 70} ${R1.y + 60} L 400 232 L 500 232 L ${R2.x + 70} ${R2.y + 60}`, stroke: '#2b1a10', 'stroke-width': 3, fill: 'none' }, svg);
    anaEl('rect', { x: 395, y: 214, width: 110, height: 30, rx: 5, fill: '#16151b', stroke: '#3a3842' }, svg);
    [415, 450, 485].forEach((x, i) => { anaEl('rect', { x: x - 9, y: 220, width: 18, height: 18, rx: 3, fill: i === 1 ? '#7c3aed' : '#9a9ca3', ...(i === 1 ? { filter: 'url(#anaGlow)' } : {}) }, svg); });
    anaText(svg, 450, 258, 'EFFACE · ENREG. · LECTURE', { 'font-size': 6.5, 'letter-spacing': .8 });
    const reels = [R1, R2].map(r => { const g = anaEl('g', {}, svg); anaSprite(g, 'reel', r.x, r.y, RR * 2).frame(0); return g; });
    // rangée du bas
    const by = 310;
    [['input', 70, 'ENTRÉE', -12, 18, 'Entrée : plus on pousse, plus la bande sature (la couleur)'], ['output', 160, 'SORTIE', -12, 12, 'Sortie : remet le niveau']].forEach(([key, cx, lab, mn, mx, tip]) => {
        anaTicks(svg, cx, by - 18, 28, 7, -150, 150, [String(mn), '', '', '0', '', '', '+' + mx], 6.5);
        knob({ strip: 'alu-big', cx, cy: by - 18, d: 44, key, min: mn, max: mx, def: 0, tip });
        anaText(svg, cx, by + 26, lab, { ...L, 'font-size': 8 });
    });
    [['bias', 270, 'POLARISATION', -100, 100, 0, 'Polarisation : à gauche (sous) plus brillante et plus sale, à droite (sur) plus sombre et plus propre'],
     ['noise', 350, 'SOUFFLE', 0, 100, 20, 'Souffle de la bande (0 = aucun)'], ['wow', 430, 'PLEURAGE', 0, 100, 50, 'Pleurage et scintillement : la vitesse qui bouge (50 = la machine)'],
     ['mix', 510, 'MÉLANGE', 0, 100, 100, 'Mélange avec le son d\'origine']].forEach(([key, cx, lab, mn, mx, def, tip]) => {
        anaTicks(svg, cx, by - 14, 18, 5, -135, 135, null);
        knob({ strip: 'bakelite', cx, cy: by - 14, d: 28, key, min: mn, max: mx, def, tip });
        anaText(svg, cx, by + 16, lab, { ...L, 'font-size': 7, 'letter-spacing': 1 });
    });
    // vitesse (levier) et machine (poussoirs)
    const tg = anaEl('g', { class: 'ana-push' }, svg);
    const drawTog = () => { tg.innerHTML = ''; const fast = (P().speed ?? 0) >= 1; anaSprite(tg, fast ? 'tog-up' : 'tog-down', 600, by - 14, 30).frame(0); anaEl('rect', { x: 584, y: by - 38, width: 32, height: 48, fill: 'transparent' }, tg); anaEl('title', {}, tg).textContent = 'Vitesse : 30 (en haut, aigus plus étendus, bosse plus haute) ou 15 (en bas, plus de grave)'; };
    anaText(svg, 600, by - 44, '30', { ...L, 'font-size': 8 }); anaText(svg, 600, by + 26, '15', { ...L, 'font-size': 8 });
    tg.addEventListener('click', () => { ed.start(); P().speed = (P().speed ?? 0) >= 1 ? 0 : 1; ed.end(); drawTog(); say(); });
    drawTog();
    const vg = anaEl('g', {}, svg);
    const drawVar = () => {
        vg.innerHTML = ''; const cur = Math.round(P().machine ?? 0);
        NM.forEach((nm, i) => { const x = 720 + i * 62, on = i === cur, g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg);
            anaEl('rect', { x: x - 28, y: by - 22, width: 56, height: 16, rx: 4, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, by - 11, nm.toUpperCase(), { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .6, class: '' });
            anaEl('title', {}, g).textContent = `${nm} : ${TIP[i]}`; });
        sub.textContent = 'MAGNÉTOPHONE À BANDE · ' + NM[cur].toUpperCase();
        anaSkin(svg, SK[cur]);
    };
    vg.addEventListener('click', (e) => { const b = e.target.closest('.ana-var'); if (!b) return; ed.start(); P().machine = +b.dataset.v; ed.end(); drawVar(); say(); });
    anaText(svg, 782, by + 8, 'MACHINE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    // bobines qui tournent pendant la lecture (la droite plus vite : moins de bande dessus)
    let a1 = 0, last = performance.now();
    const spin = (now) => {
        if (!panel.isConnected) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if ((t.effects || []).includes('tape') && (state.playing || state.recording)) { const v = ((P().speed ?? 0) >= 1 && (P().machine ?? 0) < 2) ? 2 : 1; a1 += dt * 140 * v; }
        reels[0].setAttribute('transform', `rotate(${(-a1).toFixed(1)} ${R1.x} ${R1.y})`);
        reels[1].setAttribute('transform', `rotate(${(-a1 * 1.35).toFixed(1)} ${R2.x} ${R2.y})`);
        requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'tape', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    drawVar();
    say();
    makePlugWindow(panel, t, 'tape', trackIdx);
}


// ===== Lampe 670 : compresseur à lampes variable-mu (esprit « 670 ») : façade grise, gros boutons, vumètre =====
function openL670Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'l670');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.l670) t.effectParams.l670 = { input: 0, thr: 4, tc: 1, output: 0, mix: 100 };
    const P = () => t.effectParams.l670, ed = anaEdit(t, 'l670');
    const W = 860, H = 300;
    const { panel, svg } = anaWindow(t, 'l670', 'Lampe 670', W, H, anchorEl, trackIdx, 860, 'gris');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · LAMPE 670', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 56, 'COMPRESSEUR À LAMPES « VARIABLE-MU »', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Entrée <b>${p.input > 0 ? '+' : ''}${p.input} dB</b> · Seuil <b>${p.thr}</b> · Constante <b>${(p.tc ?? 1) + 1}</b> · Sortie <b>${p.output > 0 ? '+' : ''}${p.output} dB</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const CY = 160;
    anaTicks(svg, 110, CY, 50, 7, -150, 150, ['−10', '', '0', '', '10', '', '20'], 7.5);
    knob({ strip: 'black-big', cx: 110, cy: CY, d: 84, key: 'input', min: -10, max: 20, def: 0, tip: 'Entrée : pousse les lampes (plus de couleur, plus de compression)' });
    anaText(svg, 110, CY + 76, 'ENTRÉE', { ...L, 'font-size': 10 });
    anaTicks(svg, 240, CY, 50, 11, -150, 150, ['0', '', '2', '', '4', '', '6', '', '8', '', '10'], 7.5);
    knob({ strip: 'black-big', cx: 240, cy: CY, d: 84, key: 'thr', min: 0, max: 10, def: 4, tip: 'Seuil : 0 = rien, 10 = beaucoup de compression' });
    anaText(svg, 240, CY + 76, 'SEUIL', { ...L, 'font-size': 10 });
    // vumètre de réduction au centre
    const vx = 330, vy = 76, vw = 220, vh = 140, cx = vx + vw / 2, cy = vy + vh + 18, R = 108;
    anaEl('rect', { x: vx - 6, y: vy - 6, width: vw + 12, height: vh + 12, rx: 8, fill: '#050407', stroke: '#2a2733' }, svg);
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaVu)' }, svg);
    const clip = anaEl('clipPath', { id: 'anaVuClip670' }, svg); anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4 }, clip);
    const vu = anaEl('g', { 'clip-path': 'url(#anaVuClip670)' }, svg);
    const grA = (g) => -45 + 90 * Math.max(0, Math.min(1, 1 - g / 20));
    [20, 15, 10, 6, 4, 2, 0].forEach((g) => { const a = grA(g) * Math.PI / 180; anaEl('line', { x1: cx + Math.sin(a) * R, y1: cy - Math.cos(a) * R, x2: cx + Math.sin(a) * (R + 7), y2: cy - Math.cos(a) * (R + 7), stroke: '#e9d5ff', 'stroke-width': 1.2 }, vu);
        anaText(vu, cx + Math.sin(a) * (R + 15), cy - Math.cos(a) * (R + 15) + 3, String(g), { fill: '#e9d5ff', 'font-size': 7.5, 'letter-spacing': 0, class: '' }); });
    const needle = anaEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - R - 3, stroke: '#fff', 'stroke-width': 1.5, filter: 'url(#anaGlow)' }, vu);
    anaText(svg, vx + 10, vy + vh - 9, 'RÉDUCTION · dB', { fill: '#a78bfa', 'text-anchor': 'start', 'font-size': 7.5, class: '' });
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaGlass)', 'pointer-events': 'none' }, svg);
    // constante de temps (6 crans), sortie, mélange
    ['1', '2', '3', '4', '5', '6'].forEach((tx, i) => { const a = (-100 + 40 * i) * Math.PI / 180; anaText(svg, 640 + Math.sin(a) * 40, CY - Math.cos(a) * 40 + 3, tx, { 'font-size': 8, 'letter-spacing': 0 }); });
    anaKnob(svg, { strip: 'sel6', cx: 640, cy: CY, d: 48, key: 'tc', min: 0, max: 5, def: 1, steps: [0, 1, 2, 3, 4, 5], get: () => P().tc ?? 1, set: (v) => { P().tc = v; say(); }, onStart: ed.start, onEnd: ed.end,
        tip: 'Constante de temps : 1 rapide (0,3 s) … 4 lente (5 s) ; 5 et 6 = relâchement automatique (vite sur les coups, lent quand ça dure)' }).g.classList.remove('pk');
    anaText(svg, 640, CY + 76, 'CONSTANTE', { ...L, 'font-size': 10 });
    anaTicks(svg, 760, CY - 30, 24, 7, -150, 150, ['−20', '', '', '0', '', '', '+20'], 6.5);
    knob({ strip: 'alu-big', cx: 760, cy: CY - 30, d: 38, key: 'output', min: -20, max: 20, def: 0, tip: 'Sortie (dB)' });
    anaText(svg, 760, CY + 12, 'SORTIE', { ...L, 'font-size': 8 });
    anaTicks(svg, 760, CY + 50, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 760, cy: CY + 50, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine' });
    anaText(svg, 760, CY + 78, 'MÉLANGE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    let ang = grA(0), last = performance.now();
    const key = 'l670|' + fxKeyOf(trackIdx, t);
    const tick = (now) => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('l670');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const target = grA(m ? (m.gr || 0) : 0);
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        ang += (target - ang) * (1 - Math.exp(-dt / 0.08));
        needle.setAttribute('transform', `rotate(${ang.toFixed(2)} ${cx} ${cy})`);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'l670', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    anaSkin(svg, 'gris');
    say();
    makePlugWindow(panel, t, 'l670', trackIdx);
}


// ===== Détresse : le compresseur couteau suisse (esprit « Détresse ») : façade noire, LED de réduction =====
function openDtrPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'dtr');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.dtr) t.effectParams.dtr = { input: 5, output: 5, attack: 5, release: 5, ratio: 3, detHp: 0, detBand: 0, dist: 0, mix: 100 };
    const P = () => t.effectParams.dtr, ed = anaEdit(t, 'dtr');
    const W = 940, H = 230;
    const { panel, svg } = anaWindow(t, 'dtr', 'Détresse', W, H, anchorEl, trackIdx, 940, 'noir');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.5', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · DÉTRESSE', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 56, 'COMPRESSEUR À TOUT FAIRE', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const RAT = ['1:1', '2', '3', '4', '6', '10', '20', 'NUKE'];
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Ratio <b>${RAT[p.ratio ?? 3]}</b> · Entrée <b>${p.input}</b> · Attaque <b>${p.attack}</b> · Relâche <b>${p.release}</b> · Sortie <b>${p.output}</b>${(p.dist ?? 0) ? ` · Distorsion <b>${p.dist === 1 ? '2' : '3'}</b>` : ''}`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 10) / 10; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const CY = 130, ten = ['0', '', '', '', '', '5', '', '', '', '', '10'];
    [['input', 90, 'ENTRÉE', 'Entrée : pousse dans le compresseur (le seuil est fixe) et dans la distorsion'], ['output', 420, 'SORTIE', 'Sortie : remet le niveau']].forEach(([key, cx, lab, tip]) => {
        anaTicks(svg, cx, CY, 40, 11, -150, 150, ten, 7); knob({ strip: 'alu-big', cx, cy: CY, d: 66, key, min: 0, max: 10, def: 5, tip }); anaText(svg, cx, CY + 66, lab, { ...L, 'font-size': 9 }); });
    [['attack', 205, 'ATTAQUE', 'Attaque : 0 = 50 µs (écrase les coups) … 10 = 30 ms'], ['release', 300, 'RELÂCHE', 'Relâchement : 0 = 50 ms … 10 = 3,5 s']].forEach(([key, cx, lab, tip]) => {
        anaTicks(svg, cx, CY, 24, 11, -150, 150, ten, 6.5); knob({ strip: 'bakelite', cx, cy: CY, d: 36, key, min: 0, max: 10, def: 5, tip }); anaText(svg, cx, CY + 66, lab, { ...L, 'font-size': 9 }); });
    RAT.forEach((tx, i) => { const a = (-105 + 30 * i) * Math.PI / 180; anaText(svg, 540 + Math.sin(a) * 44, CY - Math.cos(a) * 44 + 3, tx, { 'font-size': 7.5, 'letter-spacing': 0 }); });
    anaKnob(svg, { strip: 'sel8', cx: 540, cy: CY, d: 50, key: 'ratio', min: 0, max: 7, def: 3, steps: [0, 1, 2, 3, 4, 5, 6, 7], get: () => P().ratio ?? 3, set: (v) => { P().ratio = v; say(); }, onStart: ed.start, onEnd: ed.end,
        tip: 'Ratio : 1:1 = pas de compression (juste la couleur), 2 et 3 doux, 10 et 20 francs, Nuke = tout écraser' }).g.classList.remove('pk');
    anaText(svg, 540, CY + 66, 'RATIO', { ...L, 'font-size': 9 });
    // réduction en LED (colonne de 10 diodes, comme la machine)
    const leds = [1, 2, 3, 4, 6, 8, 10, 14, 20, 30].map((db, i) => { anaText(svg, 640, 72 + i * 13 + 3, String(db), { 'font-size': 6.5, 'letter-spacing': 0, 'text-anchor': 'end' }); return anaEl('circle', { cx: 652, cy: 72 + i * 13, r: 4.2, fill: '#1c1426', stroke: '#000' }, svg); });
    anaText(svg, 652, 214, 'RÉDUCTION', { ...L, 'font-size': 7, 'letter-spacing': .8 });
    // boutons : détecteur et distorsion
    const pg = anaEl('g', {}, svg);
    const BTN = [['detHp', 'DÉT. COUPE-BAS', 'Le grave ne déclenche plus la compression'], ['detBand', 'DÉT. AIGUS', 'Les « s » et les aigus déclenchent plus : dé-esseur'], ['dist2', 'DISTO 2', 'Distorsion « 2 » : harmonique 2, façon lampe'], ['dist3', 'DISTO 3', 'Distorsion « 3 » : harmonique 3, façon bande']];
    const drawBtn = () => {
        pg.innerHTML = '';
        BTN.forEach(([k, txt, tip], i) => {
            const on = k === 'dist2' ? P().dist === 1 : k === 'dist3' ? P().dist === 2 : (P()[k] ?? 0) >= 0.5;
            const x = 720 + (i % 2) * 96, y = 92 + Math.floor(i / 2) * 44, g = anaEl('g', { class: 'ana-push', 'data-k': k }, pg);
            anaEl('rect', { x: x - 42, y: y - 10, width: 84, height: 20, rx: 4, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, y + 3.5, txt, { fill: on ? '#fff' : '#a78bfa', 'font-size': 7.5, 'letter-spacing': .6, class: '' });
            anaEl('title', {}, g).textContent = tip;
        });
    };
    pg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k, p = P();
        ed.start();
        if (k === 'dist2') p.dist = p.dist === 1 ? 0 : 1; else if (k === 'dist3') p.dist = p.dist === 2 ? 0 : 2; else p[k] = (p[k] ?? 0) >= 0.5 ? 0 : 1;
        ed.end(); drawBtn(); say();
    });
    drawBtn();
    anaTicks(svg, 768, 190, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 768, cy: 190, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine (compression parallèle)' });
    anaText(svg, 810, 193, 'MÉLANGE', { ...L, 'font-size': 7, 'letter-spacing': 1, 'text-anchor': 'start' });
    const key = 'dtr|' + fxKeyOf(trackIdx, t);
    const tick = () => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('dtr');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const gr = m ? (m.gr || 0) : 0;
        [1, 2, 3, 4, 6, 8, 10, 14, 20, 30].forEach((db, i) => leds[i].setAttribute('fill', gr >= db ? (db >= 14 ? '#f0abfc' : '#a855f7') : '#1c1426'));
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'dtr', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'dtr', trackIdx);
}

// Styles de la façade (ici pour garder la gamme dans un seul fichier)
(() => {
    const st = document.createElement('style');
    st.textContent = `.ana-panel { padding-bottom: 0; } .ana-face { padding: 8px 10px 4px; } .ana-svg { display: block; width: 100%; height: auto; user-select: none; }
        .ana-svg .ana-k, .ana-svg .ana-sel { cursor: ns-resize; } .ana-svg .ana-push, .ana-svg .ana-sel { cursor: pointer; } .ana-svg text { font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; pointer-events: none; }
        .ana-svg .ana-img { pointer-events: none; } .ana-panel .ana-read b { color: #fff; }`;
    document.head.appendChild(st);
})();
