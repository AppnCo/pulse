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
    'black-big': { n: 61, px: 200, a0: -150, a1: 150, span: 2.4 }, sel7: { n: 7, px: 128, a0: -90, a1: 90, span: 2.4 }, sel3: { n: 3, px: 128, a0: -45, a1: 45, span: 2.4 }, sel4: { n: 4, px: 128, a0: -60, a1: 60, span: 2.4 }, sel5: { n: 5, px: 128, a0: -90, a1: 90, span: 2.4 }, sel6: { n: 6, px: 128, a0: -100, a1: 100, span: 2.4 }, sel8: { n: 8, px: 128, a0: -105, a1: 105, span: 2.4 }, k550: { n: 13, px: 200, a0: -150, a1: 150, span: 2.4 }, k550f5: { n: 5, px: 200, a0: -100, a1: 100, span: 2.4 }, k550f6: { n: 6, px: 200, a0: -100, a1: 100, span: 2.4 }, reel: { n: 1, px: 360, span: 2.1 }, 'tog-up': { n: 1, px: 128, span: 3.2 }, 'tog-down': { n: 1, px: 128, span: 3.2 }
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
function anaKnob(parent, { strip, cx, cy, d, key, min, max, def, steps, get, set, fmt, onStart, onEnd, tip, hitR, log }) {
    const g = anaEl('g', { class: 'pk ana-k', 'data-key': key }, parent);
    const sp = anaSprite(g, strip, cx, cy, d);
    // bouton concentrique : le petit bouton du centre n'attrape que le centre (le grand autour reste accessible)
    if (!hitR && /^(midf73|lowf73|k550f\d)$/.test(strip)) hitR = d * 0.22;
    const hit = anaEl('circle', { cx, cy, r: hitR || d / 2 + 4, fill: 'transparent' }, g);
    if (tip) anaEl('title', {}, hit).textContent = tip;
    const frac = (v) => steps ? Math.max(0, steps.indexOf(steps.reduce((b, s) => Math.abs(s - v) < Math.abs(b - v) ? s : b, steps[0]))) / (steps.length - 1) : log ? Math.log(Math.max(min, v) / min) / Math.log(max / min) : (v - min) / (max - min);
    const draw = (v = get()) => sp.frame(frac(v) * (sp.n - 1));
    const quant = (v) => steps ? steps.reduce((b, s) => Math.abs(s - v) < Math.abs(b - v) ? s : b, steps[0]) : Math.max(min, Math.min(max, v));
    const fromFrac = (f) => { f = Math.max(0, Math.min(1, f)); return steps ? steps[Math.round(f * (steps.length - 1))] : log ? min * Math.pow(max / min, f) : min + f * (max - min); };
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


// ===== Tranche E : voie de console complète (esprit « E ») : filtres, EQ 4 bandes, dynamique, sortie =====
function openStripEPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'stripe');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.stripe) t.effectParams.stripe = { hpf: 0, lpf: 22, lf: 0, lfF: 100, lfBell: 0, lmf: 0, lmfF: 600, lmfQ: 1, hmf: 0, hmfF: 2500, hmfQ: 1, hf: 0, hfF: 8000, hfBell: 0, eq: 1, variant: 0, cthr: 10, cratio: 1, crel: 0.3, cfast: 0, gthr: -80, grange: 20, grel: 0.3, dynPre: 0, output: 0 };
    const P = () => t.effectParams.stripe, ed = anaEdit(t, 'stripe');
    const W = 1000, H = 330, SK = ['gris', 'noir'], NM = ['Brun', 'Noir'];
    const { panel, svg } = anaWindow(t, 'stripe', 'Tranche E', W, H, anchorEl, trackIdx, 1000, SK[Math.round(P().variant ?? 0)]);
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 36, 'PULSE · TRANCHE E', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const sub = anaText(svg, 44, 52, '', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    const read = panel.querySelector('.ana-read');
    const fmtF = (f) => f >= 1000 ? (Math.round(f / 100) / 10).toString().replace('.', ',') + ' k' : Math.round(f) + ' Hz';
    const say = () => { const p = P(); read.innerHTML = `${NM[Math.round(p.variant ?? 0)]} · Graves <b>${p.lf}</b> · Bas-méd. <b>${p.lmf}</b> · Hauts-méd. <b>${p.hmf}</b> · Aigus <b>${p.hf}</b>${p.cratio > 1 ? ` · Comp ${Math.round(p.cratio * 10) / 10}:1 à ${p.cthr} dB` : ''}${p.gthr > -79.9 ? ` · Gate ${p.gthr} dB` : ''}`; };
    // bouton linéaire (gain, seuil…) ou en fréquence (logarithmique)
    const lin = (cx, cy, key, mn, mx, def, lab, tip, strip = 'hf73', d = 34) => {
        anaTicks(svg, cx, cy, d / 2 + 6, 11, -150, 150, null);
        anaKnob(svg, { strip, cx, cy, d, key, min: mn, max: mx, def, tip, get: () => P()[key] ?? def, set: (v) => { P()[key] = Math.round(v * 10) / 10; ed.touch(key); say(); }, onStart: ed.start, onEnd: ed.end });
        anaText(svg, cx, cy + d / 2 + 15, lab, { ...L, 'font-size': 7, 'letter-spacing': .8 });
    };
    const freq = (cx, cy, key, fmin, fmax, def, lab, tip, off) => {
        anaTicks(svg, cx, cy, 23, 11, -150, 150, null);
        const toN = (f) => Math.log(Math.max(fmin, f) / fmin) / Math.log(fmax / fmin);
        anaKnob(svg, { strip: 'bakelite', cx, cy, d: 30, key, min: 0, max: 1, def: toN(def), tip, get: () => toN(P()[key] ?? def),
            set: (v) => { let f = fmin * Math.pow(fmax / fmin, v); f = f >= 1000 ? Math.round(f / 10) * 10 : Math.round(f); P()[key] = f; say(); }, onStart: ed.start, onEnd: ed.end }).g.classList.remove('pk');
        anaText(svg, cx, cy + 30, lab, { ...L, 'font-size': 7, 'letter-spacing': .8 });
    };
    const push = (g, x, y, w, txt, on, tip) => { anaEl('rect', { x: x - w / 2, y: y - 8, width: w, height: 16, rx: 3, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g); anaText(g, x, y + 3, txt, { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .5, class: '' }); anaEl('title', {}, g).textContent = tip; };
    const sep = (x) => anaEl('line', { x1: x, y1: 66, x2: x, y2: 312, stroke: '#00000044' }, svg);
    const section = (x, txt) => anaText(svg, x, 76, txt, { class: 'ana-sub', 'font-size': 8, 'letter-spacing': 2 });
    // filtres
    section(70, 'FILTRES');
    freq(70, 125, 'hpf', 16, 350, 16, 'COUPE-BAS', 'Coupe-bas 18 dB/oct : tout à gauche = éteint, jusqu\'à 350 Hz');
    freq(70, 215, 'lpf', 3, 22, 22, 'COUPE-HAUT', 'Coupe-haut 12 dB/oct : tout à droite = éteint, jusqu\'à 3 kHz');
    sep(130);
    // EQ 4 bandes
    section(395, 'ÉGALISEUR');
    const bands = [['lf', 'lfF', 30, 450, 'GRAVES', 'lfBell'], ['lmf', 'lmfF', 200, 2500, 'BAS-MÉD.', 'lmfQ'], ['hmf', 'hmfF', 600, 7000, 'HAUTS-MÉD.', 'hmfQ'], ['hf', 'hfF', 1500, 16000, 'AIGUS', 'hfBell']];
    const pushes = anaEl('g', {}, svg);
    bands.forEach(([g, f, fmin, fmax, lab, extra], i) => {
        const x = 190 + i * 70, lim = (g === 'lf' || g === 'hf') ? 16.5 : 15;
        lin(x, 120, g, -lim, lim, 0, lab, `${lab.toLowerCase()} : gain (dB)`);
        freq(x, 195, f, fmin, fmax, ({ lf: 100, lmf: 600, hmf: 2500, hf: 8000 })[g], 'FRÉQ.', `Fréquence (${fmin} Hz à ${fmax >= 1000 ? fmax / 1000 + ' kHz' : fmax + ' Hz'})`);
        if (extra.endsWith('Q')) lin(x, 262, extra, 0.5, 2.5, 1, 'LARGEUR', 'Largeur : 0,5 large … 2,5 serrée', 'bakelite', 26);
    });
    const drawPush = () => {
        pushes.innerHTML = '';
        [['lfBell', 190, 'CLOCHE', 'Graves en cloche (sinon plateau)'], ['hfBell', 400, 'CLOCHE', 'Aigus en cloche (sinon plateau)'], ['eq', 470, 'EQ', 'EQ en service']].forEach(([k, x, txt, tip]) => {
            const g = anaEl('g', { class: 'ana-push', 'data-k': k }, pushes); push(g, x, 262, 44, txt, (P()[k] ?? (k === 'eq' ? 1 : 0)) >= 0.5, tip); });
        [0, 1].forEach(i => { const g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, pushes); push(g, 445 + i * 50, 296, 44, NM[i].toUpperCase(), Math.round(P().variant ?? 0) === i, i ? 'Noir : les cloches se resserrent quand on pousse (précis, plus agressif)' : 'Brun : largeur fixe, l\'EQ doux et musical'); });
        [['cfast', 600, 262, 'RAPIDE', 'Attaque rapide (1 ms au lieu de 3 ms)'], ['dynPre', 690, 296, 'DYN. AVANT EQ', 'La dynamique avant l\'EQ (sinon après)']].forEach(([k, x, y, txt, tip]) => {
            const g = anaEl('g', { class: 'ana-push', 'data-k': k }, pushes); push(g, x, y, k === 'dynPre' ? 84 : 50, txt, (P()[k] ?? 0) >= 0.5, tip); });
        sub.textContent = 'VOIE DE CONSOLE · ' + NM[Math.round(P().variant ?? 0)].toUpperCase();
        anaSkin(svg, SK[Math.round(P().variant ?? 0)]);
    };
    pushes.addEventListener('click', (e) => {
        const v = e.target.closest('.ana-var'), b = e.target.closest('[data-k]');
        if (!v && !b) return;
        ed.start();
        if (v) P().variant = +v.dataset.v; else { const k = b.dataset.k; P()[k] = (P()[k] ?? (k === 'eq' ? 1 : 0)) >= 0.5 ? 0 : 1; }
        ed.end(); drawPush(); say();
    });
    sep(525);
    // dynamique
    section(650, 'DYNAMIQUE');
    lin(560, 120, 'cthr', -30, 10, 10, 'SEUIL', 'Compresseur : seuil (dBFS) ; tout à droite = éteint');
    lin(620, 120, 'cratio', 1, 20, 1, 'RATIO', 'Ratio : 1 (rien) … 20 (l\'infini)');
    lin(560, 195, 'crel', 0.1, 4, 0.3, 'RELÂCHE', 'Relâchement : 0,1 à 4 s', 'bakelite', 28);
    lin(700, 120, 'gthr', -80, 0, -80, 'GATE SEUIL', 'Gate : seuil (dBFS) ; tout à gauche = éteint');
    lin(760, 120, 'grange', 0, 40, 20, 'PROFONDEUR', 'Gate : de combien il baisse (dB)', 'bakelite', 28);
    lin(730, 195, 'grel', 0.1, 4, 0.3, 'G. RELÂCHE', 'Gate : relâchement (s)', 'bakelite', 28);
    const leds = [1, 3, 6, 10, 14, 20].map((db, i) => { anaText(svg, 640, 182 + i * 13 + 3, String(db), { 'font-size': 6.5, 'letter-spacing': 0, 'text-anchor': 'end' }); return anaEl('circle', { cx: 652, cy: 182 + i * 13, r: 4, fill: '#1c1426', stroke: '#000' }, svg); });
    sep(800);
    section(900, 'SORTIE');
    anaTicks(svg, 900, 150, 38, 9, -150, 150, ['−20', '', '', '', '0', '', '', '', '+20'], 7);
    anaKnob(svg, { strip: 'alu-big', cx: 900, cy: 150, d: 62, key: 'output', min: -20, max: 20, def: 0, tip: 'Sortie (dB)', get: () => P().output ?? 0, set: (v) => { P().output = Math.round(v * 2) / 2; ed.touch('output'); say(); }, onStart: ed.start, onEnd: ed.end });
    anaText(svg, 900, 214, 'SORTIE', { ...L, 'font-size': 9 });
    drawPush();
    const key = 'stripe|' + fxKeyOf(trackIdx, t);
    const tick = () => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('stripe');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const gr = m ? (m.gr || 0) : 0;
        [1, 3, 6, 10, 14, 20].forEach((db, i) => leds[i].setAttribute('fill', gr >= db ? (db >= 14 ? '#f0abfc' : '#a855f7') : '#1c1426'));
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'stripe', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'stripe', trackIdx);
}


// ===== EQ 550 : égaliseur à crans 3 bandes (esprit « 550 ») : module vertical, boutons doubles (gain autour, fréquence au centre) =====
function openEq550Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'eq550');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.eq550) t.effectParams.eq550 = { lf: 0, lfF: 1, lfPeak: 0, mf: 0, mfF: 2, hf: 0, hfF: 3, hfPeak: 0, band: 0, on: 1, output: 0 };
    const P = () => t.effectParams.eq550, ed = anaEdit(t, 'eq550');
    const W = 340, H = 560;
    const { panel, svg } = anaWindow(t, 'eq550', 'EQ 550', W, H, anchorEl, trackIdx, 400, 'noir');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.5', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, W / 2, 38, 'PULSE · EQ 550', { ...L, 'font-size': 13, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, W / 2, 52, 'ÉGALISEUR À CRANS', { fill: '#a78bfa', 'font-size': 8, class: '' });
    const LF = ['50', '100', '200', '300', '400'], MF = ['400', '800', '1,5k', '3k', '5k'], HF = ['2,5k', '5k', '7,5k', '10k', '12,5k', '15k'];
    const read = panel.querySelector('.ana-read');
    const sg = (v) => (v > 0 ? '+' : '') + v;
    const say = () => { const p = P();
        svg.querySelectorAll('.e550f').forEach(e => { const on = +e.dataset.i === (p[e.dataset.fk] ?? 0); e.setAttribute('fill', on ? '#fff' : '#7c6aa0'); e.setAttribute('font-weight', on ? 700 : 400); if (on) e.setAttribute('filter', 'url(#anaGlow)'); else e.removeAttribute('filter'); });
        read.innerHTML = `Aigus <b>${sg(p.hf)}</b> à ${HF[p.hfF ?? 3]} · Médiums <b>${sg(p.mf)}</b> à ${MF[p.mfF ?? 2]} · Graves <b>${sg(p.lf)}</b> à ${LF[p.lfF ?? 1]}`; };
    const GAINS = [-12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12];
    const band = (cy, gk, fk, fl, inner, lab) => {
        anaTicks(svg, W / 2 - 40, cy, 38, 13, -150, 150, ['−12', '', '', '', '', '', '0', '', '', '', '', '', '+12'], 6.5);
        anaKnob(svg, { strip: 'k550', cx: W / 2 - 40, cy, d: 64, key: gk, min: -12, max: 12, def: 0, steps: GAINS, get: () => P()[gk] ?? 0, set: (v) => { P()[gk] = v; ed.touch(gk); say(); }, onStart: ed.start, onEnd: ed.end, tip: `${lab} : gain par crans de 2 dB` });
        anaKnob(svg, { strip: inner, cx: W / 2 - 40, cy, d: 64, key: fk, min: 0, max: fl.length - 1, def: 0, steps: fl.map((_, i) => i), get: () => P()[fk] ?? 0, set: (v) => { P()[fk] = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: `${lab} : fréquence (au centre)` }).g.classList.remove('pk');
        // la liste des fréquences, celle choisie allumée
        fl.forEach((tx, i) => { anaText(svg, W / 2 + 62, cy - 34 + i * 12, tx, { fill: '#a78bfa', 'font-size': 7.5, 'letter-spacing': 0, 'text-anchor': 'start', class: 'e550f', 'data-fk': fk, 'data-i': i }); });
        anaText(svg, W / 2 - 40, cy + 54, lab, { ...L, 'font-size': 9 });
    };
    band(130, 'hf', 'hfF', HF, 'k550f6', 'AIGUS');
    band(270, 'mf', 'mfF', MF, 'k550f5', 'MÉDIUMS');
    band(410, 'lf', 'lfF', LF, 'k550f5', 'GRAVES');
    const pg = anaEl('g', {}, svg);
    const push = (g, x, y, w, txt, on, tip) => { anaEl('rect', { x: x - w / 2, y: y - 8, width: w, height: 16, rx: 3, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g); anaText(g, x, y + 3, txt, { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .5, class: '' }); anaEl('title', {}, g).textContent = tip; };
    const drawP = () => {
        pg.innerHTML = '';
        [['hfPeak', 252, 175, 'CLOCHE', 'Aigus en cloche (sinon plateau)'], ['lfPeak', 252, 455, 'CLOCHE', 'Graves en cloche (sinon plateau)'], ['band', 110, 500, 'FILTRE', 'Filtre de bande : coupe sous 50 Hz et au-dessus de 15 kHz'], ['on', 230, 500, 'EN SERVICE', 'EQ en service']].forEach(([k, x, y, txt, tip]) => {
            const g = anaEl('g', { class: 'ana-push', 'data-k': k }, pg); push(g, x, y, 70, txt, (P()[k] ?? (k === 'on' ? 1 : 0)) >= 0.5, tip); });
    };
    pg.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; ed.start(); P()[k] = (P()[k] ?? (k === 'on' ? 1 : 0)) >= 0.5 ? 0 : 1; ed.end(); drawP(); });
    drawP();
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'eq550', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'eq550', trackIdx);
}


// ===== Comp 25 : compresseur de bus « américain » (esprit « 25 ») : façade graphite, sélecteurs à crans, vumètre =====
function openComp25Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'comp25');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.comp25) t.effectParams.comp25 = { thr: -10, ratio: 3, attack: 3, release: 3, relVar: 0.3, knee: 1, thrust: 1, feedback: 0, makeup: 0, mix: 100 };
    const P = () => t.effectParams.comp25, ed = anaEdit(t, 'comp25');
    const W = 1000, H = 260;
    const { panel, svg } = anaWindow(t, 'comp25', 'Comp 25', W, H, anchorEl, trackIdx, 1000, 'graphite');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.5', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · COMP 25', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 56, 'COMPRESSEUR DE BUS', { fill: '#c4b5fd', 'text-anchor': 'start', 'letter-spacing': 2.5, class: '' });
    const RAT = ['1,5', '2', '3', '4', '6', '10', '∞'], ATT = [',03', ',1', ',3', '1', '3', '10', '30'], REL = [',05', ',1', ',2', ',5', '1', '2', 'VAR'], KNEE = ['FRANC', 'MOYEN', 'DOUX'], THR = ['NORM.', 'MOY.', 'FORTE'];
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Seuil <b>${p.thr} dB</b> · Ratio <b>${RAT[p.ratio ?? 3]}:1</b> · Attaque <b>${ATT[p.attack ?? 3]} ms</b> · Relâche <b>${REL[p.release ?? 3]}</b> · Genou ${KNEE[p.knee ?? 1].toLowerCase()} · Poussée ${THR[p.thrust ?? 1].toLowerCase()} · ${(p.feedback ?? 0) >= 0.5 ? 'contre-réaction' : 'en avant'}`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 10) / 10; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const CY = 140;
    const pick = (cx, key, strip, labels, a0, a1, def, lab, tip, d = 42) => {
        labels.forEach((tx, i) => { const a = (a0 + (a1 - a0) * i / (labels.length - 1)) * Math.PI / 180; anaText(svg, cx + Math.sin(a) * (d / 2 + 16), CY - Math.cos(a) * (d / 2 + 16) + 3, tx, { 'font-size': 7, 'letter-spacing': 0 }); });
        anaKnob(svg, { strip, cx, cy: CY, d, key, min: 0, max: labels.length - 1, def, steps: labels.map((_, i) => i), get: () => P()[key] ?? def, set: (v) => { P()[key] = v; say(); }, onStart: ed.start, onEnd: ed.end, tip }).g.classList.remove('pk');
        anaText(svg, cx, CY + 66, lab, { ...L, 'font-size': 8.5 });
    };
    anaTicks(svg, 95, CY, 36, 7, -150, 150, ['−20', '', '', '−5', '', '', '+10'], 7);
    knob({ strip: 'hf73', cx: 95, cy: CY, d: 54, key: 'thr', min: -20, max: 10, def: -10, tip: 'Seuil (dBFS)' });
    anaText(svg, 95, CY + 66, 'SEUIL', { ...L, 'font-size': 8.5 });
    pick(200, 'ratio', 'sel7', RAT, -90, 90, 3, 'RATIO', 'Ratio : 1,5 à l\'infini');
    pick(305, 'attack', 'sel7', ATT, -90, 90, 3, 'ATTAQUE ms', 'Attaque : 0,03 à 30 ms');
    pick(410, 'release', 'sel7', REL, -90, 90, 3, 'RELÂCHE s', 'Relâchement : 0,05 à 2 s, ou VAR (le petit bouton dessous)');
    anaTicks(svg, 410, CY + 96, 12, 5, -135, 135, null);
    anaKnob(svg, { strip: 'bakelite', cx: 410, cy: CY + 96, d: 18, key: 'relVar', min: 0.05, max: 3, def: 0.3, get: () => P().relVar ?? 0.3, set: (v) => { P().relVar = Math.round(v * 100) / 100; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Relâchement variable (s), quand le sélecteur est sur VAR' }).g.classList.remove('pk');
    pick(510, 'knee', 'sel3', KNEE, -45, 45, 1, 'GENOU', 'Genou : franc, moyen ou doux');
    pick(600, 'thrust', 'sel3', THR, -45, 45, 1, 'POUSSÉE', 'Poussée : le grave fait de moins en moins réagir le compresseur (le mix garde son poids)');
    // type : levier en avant / contre-réaction
    const tg = anaEl('g', { class: 'ana-push' }, svg);
    const drawTog = () => { tg.innerHTML = ''; const fb = (P().feedback ?? 0) >= 0.5; anaSprite(tg, fb ? 'tog-down' : 'tog-up', 680, CY, 30).frame(0); anaEl('rect', { x: 664, y: CY - 24, width: 32, height: 48, fill: 'transparent' }, tg); anaEl('title', {}, tg).textContent = 'En avant (en haut : moderne, net) ou contre-réaction (en bas : ancien, plus doux)'; };
    anaText(svg, 680, CY - 32, 'EN AVANT', { ...L, 'font-size': 6.5, 'letter-spacing': .5 }); anaText(svg, 680, CY + 40, 'RÉTRO', { ...L, 'font-size': 6.5, 'letter-spacing': .5 });
    tg.addEventListener('click', () => { ed.start(); P().feedback = (P().feedback ?? 0) >= 0.5 ? 0 : 1; ed.end(); drawTog(); say(); });
    drawTog();
    // vumètre de réduction
    const vx = 730, vy = 70, vw = 160, vh = 110, cx = vx + vw / 2, cy = vy + vh + 14, R = 90;
    anaEl('rect', { x: vx - 5, y: vy - 5, width: vw + 10, height: vh + 10, rx: 7, fill: '#050407', stroke: '#2a2733' }, svg);
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaVu)' }, svg);
    const clip = anaEl('clipPath', { id: 'anaVuClip25' }, svg); anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4 }, clip);
    const vu = anaEl('g', { 'clip-path': 'url(#anaVuClip25)' }, svg);
    const grA = (g) => -45 + 90 * Math.max(0, Math.min(1, 1 - g / 20));
    [20, 10, 6, 3, 0].forEach((g) => { const a = grA(g) * Math.PI / 180; anaEl('line', { x1: cx + Math.sin(a) * R, y1: cy - Math.cos(a) * R, x2: cx + Math.sin(a) * (R + 7), y2: cy - Math.cos(a) * (R + 7), stroke: '#e9d5ff', 'stroke-width': 1.2 }, vu);
        anaText(vu, cx + Math.sin(a) * (R + 15), cy - Math.cos(a) * (R + 15) + 3, String(g), { fill: '#e9d5ff', 'font-size': 7.5, 'letter-spacing': 0, class: '' }); });
    const needle = anaEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - R - 3, stroke: '#fff', 'stroke-width': 1.5, filter: 'url(#anaGlow)' }, vu);
    anaEl('rect', { x: vx, y: vy, width: vw, height: vh, rx: 4, fill: 'url(#anaGlass)', 'pointer-events': 'none' }, svg);
    anaTicks(svg, 940, 110, 24, 7, -150, 150, ['0', '', '', '10', '', '', '20'], 6.5);
    knob({ strip: 'hf73', cx: 940, cy: 110, d: 38, key: 'makeup', min: 0, max: 20, def: 0, tip: 'Gain de compensation (dB)' });
    anaText(svg, 940, 148, 'GAIN', { ...L, 'font-size': 8 });
    anaTicks(svg, 940, 196, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 940, cy: 196, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine (compression parallèle)' });
    anaText(svg, 940, 224, 'MÉLANGE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    let ang = grA(0), last = performance.now();
    const key = 'comp25|' + fxKeyOf(trackIdx, t);
    const tick = (now) => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('comp25');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const target = grA(m ? (m.gr || 0) : 0);
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        ang += (target - ang) * (1 - Math.exp(-dt / 0.05));
        needle.setAttribute('transform', `rotate(${ang.toFixed(2)} ${cx} ${cy})`);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'comp25', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'comp25', trackIdx);
}


// ===== Bus 33 : compresseur-limiteur de bus à pont de diodes (esprit « 33 ») : façade gris-bleu, deux sections =====
function openBus33Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'bus33');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.bus33) t.effectParams.bus33 = { con: 1, cthr: -10, cratio: 1, crec: 4, lon: 0, lthr: -2, lrec: 1, makeup: 0, mix: 100 };
    const P = () => t.effectParams.bus33, ed = anaEdit(t, 'bus33');
    const W = 900, H = 270;
    const { panel, svg } = anaWindow(t, 'bus33', 'Bus 33', W, H, anchorEl, trackIdx, 900, 'grisbleu');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.5', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 40, 'PULSE · BUS 33', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 56, 'COMPRESSEUR · LIMITEUR DE BUS', { fill: '#e0d4ff', 'text-anchor': 'start', 'letter-spacing': 2.5, class: '' });
    const RAT = ['1,5', '2', '3', '4', '6'], REC = ['0,1', '0,4', '0,8', '1,5', 'A1', 'A2'], LREC = ['50', '100', '200', '800', 'A1', 'A2'];
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${(p.con ?? 1) >= 0.5 ? `Comp ${RAT[p.cratio ?? 1]}:1 à <b>${p.cthr} dB</b>, retour ${REC[p.crec ?? 4]}` : 'Comp éteint'} · ${(p.lon ?? 0) >= 0.5 ? `Limiteur à <b>${p.lthr} dB</b>` : 'Limiteur éteint'} · Gain <b>+${p.makeup} dB</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * 2) / 2; ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    const CY = 140;
    const pick = (cx, key, strip, labels, a0, a1, def, lab, tip) => {
        labels.forEach((tx, i) => { const a = (a0 + (a1 - a0) * i / (labels.length - 1)) * Math.PI / 180; anaText(svg, cx + Math.sin(a) * 37, CY - Math.cos(a) * 37 + 3, tx, { 'font-size': 7, 'letter-spacing': 0 }); });
        anaKnob(svg, { strip, cx, cy: CY, d: 42, key, min: 0, max: labels.length - 1, def, steps: labels.map((_, i) => i), get: () => P()[key] ?? def, set: (v) => { P()[key] = v; say(); }, onStart: ed.start, onEnd: ed.end, tip }).g.classList.remove('pk');
        anaText(svg, cx, CY + 62, lab, { ...L, 'font-size': 8.5 });
    };
    const sec = (x, txt) => anaText(svg, x, 82, txt, { fill: '#e0d4ff', 'font-size': 8, 'letter-spacing': 2, class: '' });
    sec(200, 'COMPRESSEUR');
    anaTicks(svg, 90, CY, 36, 7, -150, 150, ['−20', '', '', '−5', '', '', '+10'], 7);
    knob({ strip: 'black-big', cx: 90, cy: CY, d: 56, key: 'cthr', min: -20, max: 10, def: -10, tip: 'Seuil du compresseur (dBFS)' });
    anaText(svg, 90, CY + 62, 'SEUIL', { ...L, 'font-size': 8.5 });
    pick(195, 'cratio', 'sel5', RAT, -90, 90, 1, 'RATIO', 'Ratio : 1,5 à 6');
    pick(300, 'crec', 'sel6', REC, -100, 100, 4, 'RETOUR s', 'Retour : 0,1 à 1,5 s, ou automatique (A1 rapide, A2 lent)');
    anaEl('line', { x1: 380, y1: 74, x2: 380, y2: 246, stroke: '#00000044' }, svg);
    sec(500, 'LIMITEUR');
    anaTicks(svg, 450, CY, 36, 7, -150, 150, ['−12', '', '', '−6', '', '', '0'], 7);
    knob({ strip: 'black-big', cx: 450, cy: CY, d: 56, key: 'lthr', min: -12, max: 0, def: -2, tip: 'Seuil du limiteur (dBFS)' });
    anaText(svg, 450, CY + 62, 'SEUIL', { ...L, 'font-size': 8.5 });
    pick(555, 'lrec', 'sel6', LREC, -100, 100, 1, 'RETOUR ms', 'Retour du limiteur : 50 à 800 ms, ou automatique');
    anaEl('line', { x1: 630, y1: 74, x2: 630, y2: 246, stroke: '#00000044' }, svg);
    // en service, réduction, gain, mélange
    const pg = anaEl('g', {}, svg);
    const drawP = () => { pg.innerHTML = '';
        [['con', 300, 232, 'COMP EN SERVICE'], ['lon', 555, 232, 'LIM. EN SERVICE']].forEach(([k, x, y, txt]) => { const on = (P()[k] ?? (k === 'con' ? 1 : 0)) >= 0.5, g = anaEl('g', { class: 'ana-push', 'data-k': k }, pg);
            anaEl('rect', { x: x - 48, y: y - 8, width: 96, height: 16, rx: 3, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, y + 3, txt, { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .5, class: '' }); }); };
    pg.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; ed.start(); P()[k] = (P()[k] ?? (k === 'con' ? 1 : 0)) >= 0.5 ? 0 : 1; ed.end(); drawP(); say(); });
    drawP();
    const leds = [1, 2, 4, 6, 8, 12, 16, 20].map((db, i) => { anaText(svg, 668, 92 + i * 15 + 3, String(db), { 'font-size': 6.5, 'letter-spacing': 0, 'text-anchor': 'end', fill: '#e0d4ff', class: '' }); return anaEl('circle', { cx: 680, cy: 92 + i * 15, r: 4.5, fill: '#1c1426', stroke: '#000' }, svg); });
    anaText(svg, 680, 226, 'RÉDUCTION', { ...L, 'font-size': 7, 'letter-spacing': .8 });
    anaTicks(svg, 780, 130, 34, 7, -150, 150, ['0', '', '', '10', '', '', '20'], 7);
    knob({ strip: 'alu-big', cx: 780, cy: 130, d: 52, key: 'makeup', min: 0, max: 20, def: 0, tip: 'Gain (dB)' });
    anaText(svg, 780, 186, 'GAIN', { ...L, 'font-size': 8.5 });
    anaTicks(svg, 780, 222, 15, 5, -135, 135, null);
    knob({ strip: 'bakelite', cx: 780, cy: 222, d: 22, key: 'mix', min: 0, max: 100, def: 100, tip: 'Mélange avec le son d\'origine' });
    anaText(svg, 820, 225, 'MÉLANGE', { ...L, 'font-size': 7, 'letter-spacing': 1, 'text-anchor': 'start' });
    const key = 'bus33|' + fxKeyOf(trackIdx, t);
    const tick = () => {
        if (!panel.isConnected) return;
        const on = (t.effects || []).includes('bus33');
        const m = on && (state.playing || state.recording) && PulseAudio.getCompReduction ? PulseAudio.getCompReduction(key) : null;
        const gr = m ? (m.gr || 0) : 0;
        [1, 2, 4, 6, 8, 12, 16, 20].forEach((db, i) => leds[i].setAttribute('fill', gr >= db ? (db >= 12 ? '#f0abfc' : '#a855f7') : '#1c1426'));
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'bus33', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'bus33', trackIdx);
}


// ===== EQ Massif : égaliseur à lampes de mastering (esprit « Massif ») : 4 bandes en colonnes, filtres, sortie =====
function openMassifPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'massif');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.massif) t.effectParams.massif = { g1: 0, g2: 0, g3: 0, g4: 0, f1: 100, f2: 500, f3: 2500, f4: 12000, bw1: 5, bw2: 5, bw3: 5, bw4: 5, shelf1: 1, shelf4: 1, hpf: -1, lpf: -1, on: 1, output: 0 };
    const P = () => t.effectParams.massif, ed = anaEdit(t, 'massif');
    const W = 1000, H = 320;
    const { panel, svg } = anaWindow(t, 'massif', 'EQ Massif', W, H, anchorEl, trackIdx, 1000, 'noir');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.5', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 38, 'PULSE · EQ MASSIF', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 54, 'ÉGALISEUR À LAMPES DE MASTERING', { fill: '#a78bfa', 'text-anchor': 'start', 'letter-spacing': 2.5, class: '' });
    const RANGE = [[22, 1000], [82, 3900], [220, 10000], [560, 27000]];
    const fmtF = (f) => f >= 1000 ? (Math.round(f / 100) / 10).toString().replace('.', ',') + ' k' : Math.round(f) + ' Hz';
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = [1, 2, 3, 4].map(i => `B${i} <b>${p['g' + i] > 0 ? '+' : ''}${p['g' + i]}</b> à ${fmtF(p['f' + i])}`).join(' · '); };
    const push = (g, x, y, w, txt, on, tip) => { anaEl('rect', { x: x - w / 2, y: y - 8, width: w, height: 16, rx: 3, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g); anaText(g, x, y + 3, txt, { fill: on ? '#fff' : '#a78bfa', 'font-size': 7, 'letter-spacing': .5, class: '' }); anaEl('title', {}, g).textContent = tip; };
    [0, 1, 2, 3].forEach(i => {
        const x = 110 + i * 170, n = i + 1, [lo, hi] = RANGE[i];
        // le nom de la bande au-dessus, bien séparé du « 0 » de la graduation
        anaText(svg, x, 76, 'BANDE ' + n, { fill: '#a78bfa', 'font-size': 8, 'letter-spacing': 2, class: '' });
        anaTicks(svg, x, 140, 36, 9, -150, 150, ['−20', '', '', '', '0', '', '', '', '+20'], 7);
        anaKnob(svg, { strip: 'black-big', cx: x, cy: 140, d: 56, key: 'g' + n, min: -20, max: 20, def: 0, tip: `Bande ${n} : gain (dB)`, get: () => P()['g' + n] ?? 0, set: (v) => { P()['g' + n] = Math.round(v * 2) / 2; ed.touch('g' + n); say(); }, onStart: ed.start, onEnd: ed.end });
        const toN = (f) => Math.log(Math.max(lo, f) / lo) / Math.log(hi / lo);
        anaTicks(svg, x - 34, 222, 18, 9, -150, 150, null);
        anaKnob(svg, { strip: 'bakelite', cx: x - 34, cy: 222, d: 28, key: 'f' + n, min: 0, max: 1, def: toN(([100, 500, 2500, 12000])[i]), tip: `Bande ${n} : fréquence (${fmtF(lo)} à ${fmtF(hi)})`, get: () => toN(P()['f' + n]),
            set: (v) => { let f = lo * Math.pow(hi / lo, v); f = f >= 1000 ? Math.round(f / 10) * 10 : Math.round(f); P()['f' + n] = f; say(); }, onStart: ed.start, onEnd: ed.end }).g.classList.remove('pk');
        anaText(svg, x - 34, 252, 'FRÉQ.', { ...L, 'font-size': 7, 'letter-spacing': .8 });
        anaTicks(svg, x + 34, 222, 18, 9, -150, 150, null);
        anaKnob(svg, { strip: 'bakelite', cx: x + 34, cy: 222, d: 28, key: 'bw' + n, min: 0, max: 10, def: 5, tip: `Bande ${n} : largeur (0 large, 10 serrée)`, get: () => P()['bw' + n] ?? 5, set: (v) => { P()['bw' + n] = Math.round(v * 10) / 10; say(); }, onStart: ed.start, onEnd: ed.end }).g.classList.remove('pk');
        anaText(svg, x + 34, 252, 'LARGEUR', { ...L, 'font-size': 7, 'letter-spacing': .8 });
        if (i < 3) anaEl('line', { x1: x + 85, y1: 74, x2: x + 85, y2: 296, stroke: '#ffffff12' }, svg);
    });
    const pg = anaEl('g', {}, svg);
    const drawP = () => { pg.innerHTML = '';
        [['shelf1', 110, 'PLATEAU', 'Bande 1 en plateau (sinon cloche)'], ['shelf4', 620, 'PLATEAU', 'Bande 4 en plateau (sinon cloche)'], ['on', 900, 'EN SERVICE', 'EQ en service']].forEach(([k, x, txt, tip]) => {
            const g = anaEl('g', { class: 'ana-push', 'data-k': k }, pg); push(g, x, 284, k === 'on' ? 72 : 60, txt, (P()[k] ?? 1) >= 0.5, tip); }); };
    pg.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; ed.start(); P()[k] = (P()[k] ?? 1) >= 0.5 ? 0 : 1; ed.end(); drawP(); });
    drawP();
    // filtres et sortie
    const HP = ['ARRÊT', '22', '39', '68', '120'], LP = ['ARRÊT', '18k', '12k', '8,2k', '6,8k'];
    const sel = (cx, cy, key, labels, tip, lab) => {
        labels.forEach((tx, i) => { const a = (-90 + 45 * i) * Math.PI / 180; anaText(svg, cx + Math.sin(a) * 30, cy - Math.cos(a) * 30 + 3, tx, { 'font-size': 6.5, 'letter-spacing': 0 }); });
        anaKnob(svg, { strip: 'sel5', cx, cy, d: 34, key, min: -1, max: 3, def: -1, steps: [-1, 0, 1, 2, 3], get: () => P()[key] ?? -1, set: (v) => { P()[key] = v; say(); }, onStart: ed.start, onEnd: ed.end, tip }).g.classList.remove('pk');
        anaText(svg, cx, cy + 34, lab, { ...L, 'font-size': 7, 'letter-spacing': .8 });
    };
    sel(845, 110, 'hpf', HP, 'Coupe-bas : arrêt, 22, 39, 68, 120 Hz', 'COUPE-BAS Hz');
    sel(950, 110, 'lpf', LP, 'Coupe-haut : arrêt, 18, 12, 8,2, 6,8 kHz', 'COUPE-HAUT');
    anaTicks(svg, 905, 210, 22, 7, -150, 150, ['−12', '', '', '0', '', '', '+12'], 6.5);
    anaKnob(svg, { strip: 'alu-big', cx: 905, cy: 210, d: 36, key: 'output', min: -12, max: 12, def: 0, tip: 'Sortie (dB)', get: () => P().output ?? 0, set: (v) => { P().output = Math.round(v * 2) / 2; ed.touch('output'); say(); }, onStart: ed.start, onEnd: ed.end });
    anaText(svg, 905, 248, 'SORTIE', { ...L, 'font-size': 7.5 });
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'massif', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'massif', trackIdx);
}


// ===== Plaque 140 : réverbe à plaque (esprit « 140 ») : la plaque d'acier dans son cadre, qui ondule pendant la lecture =====
function openPlatePanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'plate');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.plate) t.effectParams.plate = { decay: 2, pre: 20, bright: 60, lowcut: 100, width: 100, mix: 25, variant: 0 };
    const P = () => t.effectParams.plate, ed = anaEdit(t, 'plate');
    const W = 900, H = 340, NM = ['Claire', 'Chaude'];
    const { panel, svg } = anaWindow(t, 'plate', 'Plaque 140', W, H, anchorEl, trackIdx, 900, 'gris');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#fff' };
    anaText(svg, 44, 38, 'PULSE · PLAQUE 140', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const sub = anaText(svg, 44, 54, '', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    // la plaque : tôle d'acier tendue par des ressorts dans son cadre, les deux capteurs ; elle ondule pendant la lecture
    const px = 60, py = 72, pw = 500, ph = 170;
    const defs = svg.querySelector('defs');
    defs.insertAdjacentHTML('beforeend', `<linearGradient id="plSteel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dbe0"/><stop offset=".45" stop-color="#9da1a8"/><stop offset=".55" stop-color="#c3c6cc"/><stop offset="1" stop-color="#7f838a"/></linearGradient>
        <filter id="plBrush" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.9" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .12 0"/></filter>`);
    anaEl('rect', { x: px - 14, y: py - 14, width: pw + 28, height: ph + 28, rx: 6, fill: '#1b1a20', stroke: '#000' }, svg);
    for (let k = 0; k <= 10; k++) { const x = px + k * pw / 10; anaEl('line', { x1: x, y1: py - 12, x2: x, y2: py - 2, stroke: '#888', 'stroke-width': 1.4 }, svg); anaEl('line', { x1: x, y1: py + ph + 2, x2: x, y2: py + ph + 12, stroke: '#888', 'stroke-width': 1.4 }, svg); }
    const sheet = anaEl('g', {}, svg);
    anaEl('rect', { x: px, y: py, width: pw, height: ph, fill: 'url(#plSteel)' }, sheet);
    anaEl('rect', { x: px, y: py, width: pw, height: ph, filter: 'url(#plBrush)' }, sheet);
    const waves = anaEl('g', { opacity: 0 }, sheet);
    [0, 1, 2, 3].forEach(i => anaEl('ellipse', { class: 'pl-w', cx: px + pw * 0.3, cy: py + ph * 0.45, rx: 10, ry: 6, fill: 'none', stroke: '#7c3aed', 'stroke-width': 1.4, opacity: 0.6 }, waves));
    [[px + pw * 0.3, py + ph * 0.45, 'EXCITATEUR'], [px + pw * 0.72, py + ph * 0.3, 'CAPTEUR G'], [px + pw * 0.78, py + ph * 0.7, 'CAPTEUR D']].forEach(([x, y, lab], i) => {
        anaEl('circle', { cx: x, cy: y, r: 7, fill: i ? '#2b2a31' : '#7c3aed', stroke: '#000', ...(i ? {} : { filter: 'url(#anaGlow)' }) }, sheet);
        anaText(sheet, x, y + 20, lab, { fill: '#2b2a31', 'font-size': 6.5, 'letter-spacing': 1, class: '' }); });
    // le registre (amortisseur) : la grosse molette de la durée
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `${NM[Math.round(p.variant ?? 0)]} · Durée <b>${(Math.round(p.decay * 10) / 10).toString().replace('.', ',')} s</b> · Pré-délai <b>${Math.round(p.pre)} ms</b> · Mélange <b>${Math.round(p.mix)} %</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * (o.r || 1)) / (o.r || 1); ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    anaTicks(svg, 700, 150, 56, 11, -150, 150, ['0,4', '', '', '', '', '3', '', '', '', '', '6'], 7.5);
    knob({ strip: 'black-big', cx: 700, cy: 150, d: 92, key: 'decay', min: 0.4, max: 6, def: 2, r: 10, tip: 'Durée (le registre de la plaque) : 0,4 à 6 s' });
    anaText(svg, 700, 228, 'DURÉE · s', { ...L, 'font-size': 10 });
    const small = [['pre', 'PRÉ-DÉLAI', 0, 200, 20, 'Pré-délai (ms) : la voix sort avant la réverbe'], ['bright', 'BRILLANCE', 0, 100, 60, 'Brillance : la plaque garde plus ou moins ses aigus'],
        ['lowcut', 'COUPE-BAS', 20, 500, 100, 'Coupe-bas à l\'entrée (Hz) : pas de grave qui bave'], ['width', 'LARGEUR', 0, 150, 100, 'Largeur stéréo (100 % = la plaque)'], ['mix', 'MÉLANGE', 0, 100, 25, 'Mélange (en bus : 100 %)']];
    small.forEach(([key, lab, mn, mx, def, tip], i) => { const x = 80 + i * 105; anaTicks(svg, x, 292, 18, 7, -150, 150, null); knob({ strip: 'bakelite', cx: x, cy: 292, d: 30, key, min: mn, max: mx, def, tip }); anaText(svg, x, 322, lab, { ...L, 'font-size': 7.5, 'letter-spacing': 1 }); });
    const vg = anaEl('g', {}, svg);
    const drawVar = () => { vg.innerHTML = ''; const cur = Math.round(P().variant ?? 0);
        NM.forEach((nm, i) => { const x = 660 + i * 80, on = i === cur, g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg);
            anaEl('rect', { x: x - 34, y: 284, width: 68, height: 18, rx: 4, fill: on ? '#7c3aed' : '#1c1426', stroke: '#3a2b52', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, 296.5, nm.toUpperCase(), { fill: on ? '#fff' : '#a78bfa', 'font-size': 7.5, 'letter-spacing': 1, class: '' });
            anaEl('title', {}, g).textContent = i ? 'Chaude : plaque ancienne, aigus plus amortis' : 'Claire : plaque neuve, brillante'; });
        sub.textContent = 'RÉVERBE À PLAQUE · ' + NM[cur].toUpperCase(); anaSkin(svg, 'gris'); };
    vg.addEventListener('click', (e) => { const b = e.target.closest('.ana-var'); if (!b) return; ed.start(); P().variant = +b.dataset.v; ed.end(); drawVar(); say(); });
    anaText(svg, 700, 318, 'PLAQUE', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    drawVar();
    // ondes sur la plaque pendant la lecture
    let ph0 = 0, last = performance.now();
    const anim = (now) => {
        if (!panel.isConnected) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const on = (t.effects || []).includes('plate') && (state.playing || state.recording);
        waves.setAttribute('opacity', on ? 1 : 0);
        if (on) { ph0 = (ph0 + dt / Math.max(0.4, P().decay ?? 2) * 1.2) % 1;
            waves.querySelectorAll('.pl-w').forEach((e, i) => { const f = (ph0 + i / 4) % 1; e.setAttribute('rx', 10 + f * 260); e.setAttribute('ry', 6 + f * 110); e.setAttribute('opacity', (0.7 * (1 - f)).toFixed(2)); }); }
        requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'plate', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'plate', trackIdx);
}


// ===== Salle 80 : réverbe numérique des années 80 (esprit « 224 / 480 ») : l'écran à LED rouges qui dessine la décroissance =====
function openHall80Panel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'hall80');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.hall80) t.effectParams.hall80 = { decay: 2.5, pre: 30, size: 100, bass: 1.2, xover: 400, treble: 6000, diffusion: 70, spin: 40, width: 100, mix: 25, variant: 0 };
    const P = () => t.effectParams.hall80, ed = anaEdit(t, 'hall80');
    const W = 900, H = 340, NM = ['Salle', 'Chambre', 'Riche'], SK = ['brun', 'graphite', 'noir'];
    const TIP = ['Salle : grande salle de concert, la queue classique des années 80', 'Chambre : petite pièce dense, départ serré', 'Riche : plus grande, plus de mouvement, plus sombre'];
    const { panel, svg } = anaWindow(t, 'hall80', 'Salle 80', W, H, anchorEl, trackIdx, 900, SK[Math.round(P().variant ?? 0)] || 'brun');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.35', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 38, 'PULSE · SALLE 80', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    const sub = anaText(svg, 44, 54, '', { class: 'ana-sub', 'text-anchor': 'start', 'letter-spacing': 2.5 });
    // l'écran : verre fumé, chiffres rouges, et la courbe de décroissance (graves / médiums / aigus) qui suit les réglages
    const sx = 44, sy = 70, sw = 380, sh = 168;
    const defs = svg.querySelector('defs');
    defs.insertAdjacentHTML('beforeend', `<linearGradient id="h8Glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0606"/><stop offset="1" stop-color="#070202"/></linearGradient>
        <filter id="h8Led" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    anaEl('rect', { x: sx - 6, y: sy - 6, width: sw + 12, height: sh + 12, rx: 5, fill: '#0a0a0c', stroke: '#000' }, svg);
    anaEl('rect', { x: sx, y: sy, width: sw, height: sh, rx: 3, fill: 'url(#h8Glass)' }, svg);
    for (let k = 1; k < 6; k++) anaEl('line', { x1: sx + 10, y1: sy + 40 + k * 20, x2: sx + sw - 10, y2: sy + 40 + k * 20, stroke: '#3a0c0c', 'stroke-width': 0.6 }, svg);
    const led = (x, y, size, anchor = 'start') => anaText(svg, x, y, '', { fill: '#ff2a2a', 'font-size': size, 'font-family': 'ui-monospace, Menlo, monospace', 'font-weight': 700, 'text-anchor': anchor, filter: 'url(#h8Led)', class: '' });
    const ledProg = led(sx + 12, sy + 26, 18), ledDec = led(sx + sw - 12, sy + 26, 18, 'end'), ledInfo = led(sx + 12, sy + sh - 8, 8.5);
    const curves = anaEl('g', { filter: 'url(#h8Led)' }, svg);
    const tail = anaEl('rect', { x: sx + 10, y: sy + 40, width: 0, height: sh - 62, fill: '#ff2a2a', opacity: 0.08 }, svg);
    const drawCurves = () => {
        const p = P(), rt = Math.max(0.3, p.decay ?? 2.5), span = Math.min(20, Math.max(2, rt * 1.6)), x0 = sx + 10, x1 = sx + sw - 10, y0 = sy + 44, y1 = sy + sh - 22;
        const hiRt = rt * Math.max(0.25, Math.min(1, (p.treble ?? 6000) / 9000));
        curves.innerHTML = '';
        [[rt * (p.bass ?? 1.2), '#ff7a3a', 'GRAVES'], [rt, '#ff2a2a', 'MÉDIUMS'], [hiRt, '#ff9a9a', 'AIGUS']].forEach(([r, col, lab], i) => {
            const pts = []; for (let k = 0; k <= 60; k++) { const s = k / 60 * span, db = Math.max(-60, -60 * s / r); pts.push(`${(x0 + (x1 - x0) * k / 60).toFixed(1)},${(y0 + (y1 - y0) * (-db / 60)).toFixed(1)}`); }
            anaEl('polyline', { points: pts.join(' '), fill: 'none', stroke: col, 'stroke-width': i === 1 ? 1.8 : 1.1, opacity: i === 2 ? 0.7 : 1 }, curves);
            anaText(curves, x1 - 4, y0 + 10 + i * 11, lab, { fill: col, 'font-size': 7, 'text-anchor': 'end', 'letter-spacing': 1, class: '' }); });
        ledProg.textContent = NM[Math.round(p.variant ?? 0)].toUpperCase();
        ledDec.textContent = (Math.round(rt * 10) / 10).toFixed(1) + ' s';
        ledInfo.textContent = `PRÉ ${Math.round(p.pre ?? 30)} MS · TAILLE ${Math.round(p.size ?? 100)} % · GRAVES ×${(p.bass ?? 1.2).toFixed(1)}`;
    };
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); drawCurves(); read.innerHTML = `${NM[Math.round(p.variant ?? 0)]} · Durée <b>${(Math.round(p.decay * 10) / 10).toString().replace('.', ',')} s</b> · Pré-délai <b>${Math.round(p.pre)} ms</b> · Mélange <b>${Math.round(p.mix)} %</b>`; };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * (o.r || 1)) / (o.r || 1); ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    anaTicks(svg, 530, 150, 56, 11, -150, 150, ['0,3', '', '', '', '', '', '', '', '', '', '20'], 7.5);
    knob({ strip: 'black-big', cx: 530, cy: 150, d: 92, key: 'decay', min: 0.3, max: 20, def: 2.5, r: 10, log: true, tip: 'Durée de la queue (médiums) : 0,3 à 20 s' });
    anaText(svg, 530, 228, 'DURÉE · s', { ...L, 'font-size': 10 });
    const mid = [['pre', 'PRÉ-DÉLAI', 0, 200, 30, 1, 'Pré-délai (ms) : la voix sort avant la salle'], ['size', 'TAILLE', 50, 150, 100, 1, 'Taille de la salle (%) : espacement des échos'],
        ['bass', 'GRAVES ×', 0.5, 2.5, 1.2, 10, 'Multiplicateur de graves : les graves durent × plus (ou moins) que les médiums'], ['treble', 'AIGUS', 1000, 16000, 6000, 1, 'Aigus (Hz) : au-dessus, la queue s\'éteint plus vite']];
    mid.forEach(([key, lab, mn, mx, def, r, tip], i) => { const x = 660 + (i % 2) * 110, y = 108 + Math.floor(i / 2) * 92;
        anaTicks(svg, x, y, 24, 9, -150, 150, null); knob({ strip: 'bakelite', cx: x, cy: y, d: 40, key, min: mn, max: mx, def, r, log: key === 'treble', tip }); anaText(svg, x, y + 38, lab, { ...L, 'font-size': 8, 'letter-spacing': 1 }); });
    const small = [['xover', 'CROISEMENT', 100, 1500, 400, 'Croisement (Hz) : où commencent les graves ×'], ['diffusion', 'DIFFUSION', 0, 100, 70, 'Diffusion : départ plus ou moins dense'],
        ['spin', 'MOUVEMENT', 0, 100, 40, 'Mouvement : les retards flottent doucement, la queue vit'], ['width', 'LARGEUR', 0, 150, 100, 'Largeur stéréo (100 % = la salle)'], ['mix', 'MÉLANGE', 0, 100, 25, 'Mélange (en bus : 100 %)']];
    small.forEach(([key, lab, mn, mx, def, tip], i) => { const x = 70 + i * 92; anaTicks(svg, x, 288, 18, 7, -150, 150, null); knob({ strip: 'bakelite', cx: x, cy: 288, d: 30, key, min: mn, max: mx, def, log: key === 'xover', tip }); anaText(svg, x, 318, lab, { ...L, 'font-size': 7.5, 'letter-spacing': 1 }); });
    const vg = anaEl('g', {}, svg);
    const drawVar = () => { vg.innerHTML = ''; const cur = Math.round(P().variant ?? 0);
        NM.forEach((nm, i) => { const x = 610 + i * 82, on = i === cur, g = anaEl('g', { class: 'ana-push ana-var', 'data-v': i }, vg);
            anaEl('rect', { x: x - 36, y: 280, width: 72, height: 18, rx: 4, fill: on ? '#b91c1c' : '#1a0d0d', stroke: '#4a1a1a', ...(on ? { filter: 'url(#anaGlow)' } : {}) }, g);
            anaText(g, x, 292.5, nm.toUpperCase(), { fill: on ? '#fff' : '#fca5a5', 'font-size': 7.5, 'letter-spacing': 1, class: '' });
            anaEl('title', {}, g).textContent = TIP[i]; });
        sub.textContent = 'RÉVERBE NUMÉRIQUE · ' + NM[cur].toUpperCase(); anaSkin(svg, SK[cur]); };
    vg.addEventListener('click', (e) => { const b = e.target.closest('.ana-var'); if (!b) return; ed.start(); P().variant = +b.dataset.v; ed.end(); drawVar(); say(); });
    anaText(svg, 692, 316, 'PROGRAMME', { ...L, 'font-size': 7, 'letter-spacing': 1 });
    drawVar();
    // pendant la lecture, une lueur balaie l'écran au rythme de la queue
    let ph0 = 0, last = performance.now();
    const anim = (now) => {
        if (!panel.isConnected) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const on = (t.effects || []).includes('hall80') && (state.playing || state.recording);
        if (on) { ph0 = (ph0 + dt / Math.max(0.3, P().decay ?? 2.5)) % 1; tail.setAttribute('width', ((sw - 20) * ph0).toFixed(1)); tail.setAttribute('opacity', (0.12 * (1 - ph0)).toFixed(3)); }
        else tail.setAttribute('width', 0);
        requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'hall80', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'hall80', trackIdx);
}


// ===== Écho à bande (esprit « 201 ») : la boucle de bande et ses trois têtes qui s'allument selon le mode =====
function openTapeEchoPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'techo');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.techo) t.effectParams.techo = { mode: 1, rate: 1, intensity: 40, bass: 0, treble: 0, echo: 40, spring: 0, input: 0, wow: 50 };
    const P = () => t.effectParams.techo, ed = anaEdit(t, 'techo');
    const W = 940, H = 320, MODES = ['1', '2', '3', '1+2', '2+3', '1+3', '1+2+3'], HEADS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]];
    const { panel, svg } = anaWindow(t, 'techo', 'Écho à bande', W, H, anchorEl, trackIdx, 940, 'graphite');
    const L = { style: 'paint-order:stroke', 'stroke-opacity': '.5', 'stroke-width': '.6', stroke: '#000' };
    anaText(svg, 44, 38, 'PULSE · ÉCHO À BANDE', { ...L, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700, 'letter-spacing': 3 });
    anaText(svg, 44, 54, 'TROIS TÊTES · RESSORT', { fill: '#c4b5fd', 'text-anchor': 'start', 'letter-spacing': 2.5, class: '' });
    // la boucle de bande : un ovale brun qui défile, la tête d'enregistrement et les trois têtes de lecture
    const tx = 70, ty = 80, tw = 420, th = 110;
    anaEl('rect', { x: tx - 12, y: ty - 12, width: tw + 24, height: th + 24, rx: 14, fill: '#0b0a0e', stroke: '#2a2733' }, svg);
    const loop = anaEl('rect', { x: tx, y: ty + 18, width: tw, height: th - 36, rx: 37, fill: 'none', stroke: '#4a2e1a', 'stroke-width': 9, 'stroke-dasharray': '14 5' }, svg);
    const heads = [];
    [['ENREG.', tx + 60], ['1', tx + 170], ['2', tx + 260], ['3', tx + 350]].forEach(([lab, x], i) => {
        anaEl('rect', { x: x - 13, y: ty + 4, width: 26, height: 22, rx: 3, fill: '#9a9ca3', stroke: '#000' }, svg);
        const led = anaEl('circle', { cx: x, cy: ty + th + 2, r: 4.5, fill: i ? '#1c1426' : '#7c3aed', ...(i ? {} : { filter: 'url(#anaGlow)' }) }, svg);
        anaText(svg, x, ty - 1, lab, { fill: '#c4b5fd', 'font-size': 7, 'letter-spacing': 1, class: '' });
        if (i) heads.push(led);
    });
    const read = panel.querySelector('.ana-read');
    const say = () => { const p = P(); read.innerHTML = `Têtes <b>${MODES[p.mode ?? 1]}</b> · Vitesse <b>${(Math.round(p.rate * 100) / 100).toString().replace('.', ',')}</b> · Intensité <b>${Math.round(p.intensity)}</b> · Écho <b>${Math.round(p.echo)}</b> · Ressort <b>${Math.round(p.spring)}</b>`;
        HEADS[p.mode ?? 1].forEach((on, i) => { heads[i].setAttribute('fill', on ? '#c084fc' : '#1c1426'); if (on) heads[i].setAttribute('filter', 'url(#anaGlow)'); else heads[i].removeAttribute('filter'); }); };
    const knob = (o) => anaKnob(svg, { ...o, get: () => P()[o.key] ?? o.def, set: (v) => { P()[o.key] = Math.round(v * (o.r || 1)) / (o.r || 1); ed.touch(o.key); say(); }, onStart: ed.start, onEnd: ed.end });
    // sélecteur de mode (7 crans) et vitesse (gros bouton)
    MODES.forEach((m, i) => { const a = (-90 + 30 * i) * Math.PI / 180; anaText(svg, 600 + Math.sin(a) * 44, 136 - Math.cos(a) * 44 + 3, m, { fill: '#c4b5fd', 'font-size': 7.5, 'letter-spacing': 0, class: '' }); });
    anaKnob(svg, { strip: 'sel7', cx: 600, cy: 136, d: 54, key: 'mode', min: 0, max: 6, def: 1, steps: [0, 1, 2, 3, 4, 5, 6], get: () => P().mode ?? 1, set: (v) => { P().mode = v; say(); }, onStart: ed.start, onEnd: ed.end, tip: 'Mode : quelles têtes lisent la bande' }).g.classList.remove('pk');
    anaText(svg, 600, 198, 'MODE', { ...L, 'font-size': 9 });
    anaTicks(svg, 740, 136, 44, 7, -150, 150, ['0,5', '', '', '1', '', '', '2'], 7);
    knob({ strip: 'black-big', cx: 740, cy: 136, d: 72, key: 'rate', min: 0.5, max: 2, def: 1, r: 100, tip: 'Vitesse de la bande : lente = répétitions espacées ; tourner pendant que ça joue fait « pleurer » le son' });
    anaText(svg, 740, 198, 'VITESSE', { ...L, 'font-size': 9 });
    anaTicks(svg, 870, 136, 30, 7, -150, 150, ['0', '', '', '', '', '', '120'], 7);
    knob({ strip: 'alu-big', cx: 870, cy: 136, d: 48, key: 'intensity', min: 0, max: 120, def: 40, tip: 'Intensité : combien les répétitions reviennent ; au-delà de 100 ça s\'emballe' });
    anaText(svg, 870, 198, 'INTENSITÉ', { ...L, 'font-size': 9 });
    // rangée du bas
    [['input', 'ENTRÉE', -12, 12, 0, 'Entrée : pousse la bande (plus de saturation)'], ['bass', 'GRAVE', -12, 12, 0, 'Grave des répétitions'], ['treble', 'AIGU', -12, 12, 0, 'Aigu des répétitions'],
     ['wow', 'PLEURAGE', 0, 100, 50, 'Pleurage de la bande (50 = la machine)'], ['echo', 'ÉCHO', 0, 100, 40, 'Niveau de l\'écho'], ['spring', 'RESSORT', 0, 100, 0, 'Niveau de la réverbe à ressort']].forEach(([key, lab, mn, mx, def, tip], i) => {
        const x = 90 + i * 140; anaTicks(svg, x, 262, 20, 7, -150, 150, null); knob({ strip: 'bakelite', cx: x, cy: 262, d: 32, key, min: mn, max: mx, def, tip }); anaText(svg, x, 296, lab, { ...L, 'font-size': 8, 'letter-spacing': 1 }); });
    // la bande défile pendant la lecture (plus vite si la vitesse monte)
    let off = 0, last = performance.now();
    const anim = (now) => { if (!panel.isConnected) return; const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if ((t.effects || []).includes('techo') && (state.playing || state.recording)) { off -= dt * 60 * (P().rate ?? 1); loop.setAttribute('stroke-dashoffset', off.toFixed(1)); }
        requestAnimationFrame(anim); };
    requestAnimationFrame(anim);
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'techo', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    say();
    makePlugWindow(panel, t, 'techo', trackIdx);
}

// Styles de la façade (ici pour garder la gamme dans un seul fichier)
(() => {
    const st = document.createElement('style');
    st.textContent = `.ana-panel { padding-bottom: 0; } .ana-face { padding: 8px 10px 4px; } .ana-svg { display: block; width: 100%; height: auto; user-select: none; }
        .ana-svg .ana-k, .ana-svg .ana-sel { cursor: ns-resize; } .ana-svg .ana-push, .ana-svg .ana-sel { cursor: pointer; } .ana-svg text { font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; pointer-events: none; }
        .ana-svg .ana-img { pointer-events: none; } .ana-panel .ana-read b { color: #fff; }`;
    document.head.appendChild(st);
})();
