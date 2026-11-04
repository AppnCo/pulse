// EQ Horizon : la fenêtre (gamme Pulse). En haut la courbe, avec les 5 bandes à attraper à la souris (glisser = fréquence et gain,
// molette = largeur, double-clic = allumer / éteindre) et le son de la piste derrière pendant la lecture ; en dessous la bande choisie
// (type, zone centre / côtés, fréquence, gain, largeur), Terre et Ciel, Caractère (Eau ← Neutre → Feu), Force, filtres, entrée / sortie.
// La courbe est calculée avec les mêmes filtres que le son (PulseAudio.horizonCoefs).
const HZ_COLORS = ['#F472B6', '#FB923C', '#FACC15', '#34D399', '#60A5FA'];
const HZ_DEF = { g1: 0, g2: 0, g3: 0, g4: 0, g5: 0, f1: 60, f2: 250, f3: 1000, f4: 4000, f5: 12000, q1: 0.7, q2: 0.7, q3: 0.7, q4: 0.7, q5: 0.7,
    typ1: 2, typ2: 0, typ3: 0, typ4: 0, typ5: 2, ch1: 0, ch2: 0, ch3: 0, ch4: 0, ch5: 0, on1: 1, on2: 1, on3: 1, on4: 1, on5: 1,
    hpOn: 0, hpF: 30, hpS: 1, lpOn: 0, lpF: 20000, lpS: 1, earth: 0, air: 0, char: 0, strength: 100, input: 0, output: 0 };

function openHorizonPanel(trackIdx, anchorEl) {
    closeTransientPanels();
    const t = typeof trackIdx === 'number' ? state.project.tracks[trackIdx] : trackIdx;
    if (!t) return;
    const already = findPlugWin(t, 'horizon');
    if (already) { plugFront(already); return; }
    t.effectParams = t.effectParams || {};
    if (!t.effectParams.horizon) t.effectParams.horizon = { ...HZ_DEF };
    const P = () => t.effectParams.horizon, V = (k) => P()[k] ?? HZ_DEF[k];
    let armed = false;
    const start = () => { if (!armed) { pushUndo(); armed = true; } };
    const end = () => { t.effects = t.effects || []; if (!t.effects.includes('horizon')) t.effects.push('horizon'); refreshPlaybackSoon(); saveProject(); armed = false; };
    const W = 1000, H = 300, PL = W, T = 14, B = H - 22, Y0 = (T + B) / 2, DBK = (B - T) / 2 / 18;
    const X = (f) => Math.log(f / 20) / Math.log(1000) * PL, F = (x) => 20 * Math.pow(1000, x / PL), Y = (db) => Y0 - db * DBK;
    let sel = 2;
    const panel = document.createElement('div');
    panel.className = 'fx-panel lim-panel hz-panel';
    panel.innerHTML = `
        <div class="fx-panel-header">
            <label class="fx-bypass-label fx-power" data-tooltip="Allumer ou éteindre l'effet"><input type="checkbox" class="fx-bypass" ${t.effects?.includes('horizon') ? 'checked' : ''}><span class="fx-power-btn">⏻</span></label>
            <span class="fx-title lim-title">EQ Horizon <i>— ${esc(t.name || '')}</i></span>
            <button class="fx-panel-close">×</button>
        </div>
        <div class="lim-face"><svg class="lim-svg hz-svg" viewBox="0 0 ${W} ${H}"></svg><div class="lim-fp hz-fp"></div></div>
        <div class="lim-sb"><span>Glisser un point = fréquence et gain · molette = largeur · double-clic = allumer / éteindre la bande</span><span class="lim-spacer"></span><span class="hz-read"></span></div>`;
    document.body.appendChild(panel);
    const svg = panel.querySelector('.hz-svg'), fp = panel.querySelector('.hz-fp'), read = panel.querySelector('.hz-read');
    // réponse en dB d'une liste de filtres à la fréquence f (|H(e^jw)|)
    const sr = (PulseAudio.getContext && PulseAudio.getContext() ? PulseAudio.getContext().sampleRate : 48000);
    const respDb = (list, f) => {
        const w = 2 * Math.PI * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
        let db = 0;
        for (const { k } of list) { const nr = k[0] + k[1] * c1 + k[2] * c2, ni = -k[1] * s1 - k[2] * s2, dr = 1 + k[3] * c1 + k[4] * c2, di = -k[3] * s1 - k[4] * s2; db += 10 * Math.log10((nr * nr + ni * ni) / Math.max(dr * dr + di * di, 1e-30)); }
        return db;
    };
    let bins = null;
    const draw = () => {
        const p = { ...HZ_DEF, ...P() }, all = PulseAudio.horizonCoefs(p, sr);
        const mid = all.filter(x => x.ch !== 2), side = all.filter(x => x.ch !== 1), hasSide = all.some(x => x.ch !== 0);   // une bande sur le centre ou les côtés : les deux courbes
        let g = '';
        for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) g += `<line x1="${X(f).toFixed(1)}" x2="${X(f).toFixed(1)}" y1="${T}" y2="${B}" class="lim-grid"/><text x="${(X(f) + 3).toFixed(1)}" y="${H - 6}" class="lim-txt">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
        for (const d of [12, 6, 0, -6, -12]) g += `<line x1="0" x2="${PL}" y1="${Y(d)}" y2="${Y(d)}" class="lim-grid ${d === 0 ? 'z' : ''}"/><text x="${PL - 4}" y="${Y(d) - 3}" class="lim-txt" text-anchor="end">${d > 0 ? '+' : ''}${d}</text>`;
        const an = (state.playing || state.recording) && PulseAudio.getTrackSpectrum ? (typeof trackIdx === 'number' ? PulseAudio.getTrackSpectrum(trackIdx) : (t.id && PulseAudio.getBusSpectrum ? PulseAudio.getBusSpectrum(t.id) : null)) : null;
        if (an && an.getFloatFrequencyData) {
            if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(an.frequencyBinCount);
            an.getFloatFrequencyData(bins);
            let d = `M0 ${B}`;
            for (let x = 0; x <= PL; x += 4) { const k = Math.min(bins.length - 1, Math.max(0, Math.round(F(x) / (sr / 2) * (bins.length - 1)))); const v = Number.isFinite(bins[k]) ? bins[k] : -120; d += ` L${x} ${(B - Math.max(0, (v + 100) / 100) * (B - T)).toFixed(1)}`; }
            g += `<path d="${d} L${PL} ${B} Z" class="mb-spec"/>`;
        }
        // chaque bande (sa forme, en couleur), puis la courbe totale
        for (let i = 0; i < 5; i++) {
            const n = i + 1; if (!(V('on' + n) >= 0.5) || Math.abs(V('g' + n)) < 1e-6) continue;
            const one = PulseAudio.horizonCoefs({ ...p, ...Object.fromEntries([1, 2, 3, 4, 5].filter(k => k !== n).map(k => ['g' + k, 0])), earth: 0, air: 0, hpOn: 0, lpOn: 0 }, sr);
            let a = ''; for (let x = 0; x <= PL; x += 5) a += `${x ? 'L' : 'M'}${x} ${Y(respDb(one, F(x))).toFixed(1)}`;
            g += `<path d="${a} L${PL} ${Y0} L0 ${Y0} Z" fill="${HZ_COLORS[i]}" fill-opacity="${i === sel ? 0.22 : 0.1}" stroke="none"/>`;
        }
        let tot = '', st = '';
        for (let x = 0; x <= PL; x += 3) { tot += `${x ? 'L' : 'M'}${x} ${Y(respDb(mid, F(x))).toFixed(1)}`; if (hasSide) st += `${x ? 'L' : 'M'}${x} ${Y(respDb(side, F(x))).toFixed(1)}`; }
        if (hasSide) g += `<path d="${st}" fill="none" stroke="#93C5FD" stroke-width="1.6" stroke-dasharray="5 4"/><text x="8" y="${T + 12}" class="lim-txt" fill="#93C5FD">— — côtés · ── centre</text>`;
        g += `<path d="${tot}" fill="none" stroke="#fff" stroke-width="2.4" style="filter:drop-shadow(0 0 6px #A855F7)"/>`;
        if (V('earth') > 0) g += `<text x="${X(32)}" y="${Y(V('earth') * 0.9) - 8}" class="lim-txt" fill="#FBBF24">TERRE</text>`;
        if (V('air') > 0) g += `<text x="${X(14000) - 20}" y="${Y(V('air') * 0.8) - 8}" class="lim-txt" fill="#A5F3FC">CIEL</text>`;
        for (let i = 0; i < 5; i++) {
            const n = i + 1, on = V('on' + n) >= 0.5, x = X(Math.max(20, Math.min(20000, V('f' + n)))), y = Y(V('g' + n) * V('strength') / 100);
            g += `<circle class="hz-dot" data-i="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === sel ? 11 : 9}" fill="${on ? HZ_COLORS[i] : '#2a2038'}" stroke="${i === sel ? '#fff' : '#0008'}" stroke-width="2" style="${on ? `filter:drop-shadow(0 0 6px ${HZ_COLORS[i]})` : ''}"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" class="hz-n">${n}</text>`;
        }
        svg.innerHTML = g;
        const fmtF = (f) => f >= 1000 ? (Math.round(f / 100) / 10).toString().replace('.', ',') + ' kHz' : Math.round(f) + ' Hz';
        const n = sel + 1;
        read.innerHTML = `Bande ${n} : <b>${V('g' + n) > 0 ? '+' : ''}${Math.round(V('g' + n) * 10) / 10} dB</b> à ${fmtF(V('f' + n))} · Terre <b>${V('earth')}</b> · Ciel <b>${V('air')}</b> · Force <b>${Math.round(V('strength'))} %</b>`;
    };
    // souris sur la courbe
    const at = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    svg.addEventListener('mousedown', (e) => {
        const dot = e.target.closest('.hz-dot'); if (!dot || e.button !== 0) return;
        e.preventDefault(); sel = +dot.dataset.i; buildFp(); const n = sel + 1;
        let moved = false;
        const mv = (ev) => { const [x, y] = at(ev); if (!moved) { start(); moved = true; P()['on' + n] = 1; }
            P()['f' + n] = Math.round(Math.max(10, Math.min(30000, F(Math.max(0, Math.min(PL, x))))));
            P()['g' + n] = Math.round(Math.max(-18, Math.min(18, (Y0 - y) / DBK / (V('strength') / 100 || 1))) * 10) / 10;
            autoTouch(t, 'fx:horizon:g' + n); draw(); syncKnobs(); };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (moved) end(); draw(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        draw();
    });
    svg.addEventListener('dblclick', (e) => { const dot = e.target.closest('.hz-dot'); if (!dot) return; const n = +dot.dataset.i + 1; start(); P()['on' + n] = V('on' + n) >= 0.5 ? 0 : 1; end(); draw(); });
    svg.addEventListener('wheel', (e) => { const dot = e.target.closest('.hz-dot'); if (!dot) return; e.preventDefault(); const n = +dot.dataset.i + 1; start(); P()['q' + n] = Math.round(Math.max(0.1, Math.min(7, V('q' + n) * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) * 100) / 100; end(); draw(); syncKnobs(); }, { passive: false });
    // panneau du bas
    let knobs = {};
    const syncKnobs = () => { const n = sel + 1; knobs.f && knobs.f.set(V('f' + n)); knobs.g && knobs.g.set(V('g' + n)); knobs.q && knobs.q.set(V('q' + n)); };
    const chips = (title, items, cur, onPick, cls = '') => {
        const c = document.createElement('div'); c.className = 'lim-col';
        c.innerHTML = `<span class="lim-t">${title}</span><div class="ms-stys ${cls}">${items.map(([v, txt, tip]) => `<button class="ms-sty${v === cur ? ' on' : ''}" data-v="${v}" data-tooltip="${tip || ''}">${txt}</button>`).join('')}</div>`;
        c.querySelectorAll('.ms-sty').forEach(b => b.addEventListener('click', () => { start(); onPick(+b.dataset.v); end(); buildFp(); draw(); }));
        fp.appendChild(c);
    };
    const sep = () => { const s = document.createElement('div'); s.className = 'lim-sep'; fp.appendChild(s); };
    const buildFp = () => {
        fp.innerHTML = ''; knobs = {};
        const n = sel + 1, edge = sel === 0 || sel === 4;
        chips('Bande', [1, 2, 3, 4, 5].map(k => [k - 1, String(k)]), sel, (v) => { sel = v; }, 'hz-bands');
        chips('Type', [[0, 'Cloche', 'Cloche classique'], [1, 'Serrée', 'Cloche très étroite : pour corriger une résonance'], ...(edge ? [[2, 'Plateau', 'Plateau (grave ou aigu)']] : [])], V('typ' + n), (v) => { P()['typ' + n] = v; });
        chips('Zone', [[0, 'Tout'], [1, 'Centre', 'Seulement le centre (la voix, la grosse caisse…)'], [2, 'Côtés', 'Seulement les côtés (l\'espace, la largeur)']], V('ch' + n), (v) => { P()['ch' + n] = v; });
        knobs.f = proKnob(fp, { key: 'f' + n, label: 'Fréquence', min: 10, max: 30000, log: true, val: V('f' + n), color: HZ_COLORS[sel], fmt: (v) => v >= 1000 ? (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k' : Math.round(v) + ' Hz', onChange: (v) => { start(); P()['f' + n] = Math.round(v); draw(); }, onEnd: end });
        knobs.g = proKnob(fp, { key: 'g' + n, label: 'Gain', min: -18, max: 18, val: V('g' + n), color: HZ_COLORS[sel], fmt: (v) => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toString().replace('.', ',') + ' dB', onChange: (v) => { start(); P()['g' + n] = Math.round(v * 10) / 10; draw(); }, onEnd: end });
        knobs.q = proKnob(fp, { key: 'q' + n, label: 'Largeur', min: 0.1, max: 7, log: true, val: V('q' + n), color: HZ_COLORS[sel], fmt: (v) => 'Q ' + (Math.round(v * 100) / 100).toString().replace('.', ','), onChange: (v) => { start(); P()['q' + n] = Math.round(v * 100) / 100; draw(); }, onEnd: end });
        sep();
        proKnob(fp, { key: 'earth', label: 'Terre', min: 0, max: 10, val: V('earth'), big: true, color: '#FBBF24', fmt: (v) => (Math.round(v * 10) / 10).toString().replace('.', ','), onChange: (v) => { start(); P().earth = Math.round(v * 10) / 10; draw(); }, onEnd: end });
        proKnob(fp, { key: 'air', label: 'Ciel', min: 0, max: 10, val: V('air'), big: true, color: '#A5F3FC', fmt: (v) => (Math.round(v * 10) / 10).toString().replace('.', ','), onChange: (v) => { start(); P().air = Math.round(v * 10) / 10; draw(); }, onEnd: end });
        sep();
        proKnob(fp, { key: 'char', label: 'Caractère', min: -1, max: 1, val: V('char'), color: '#F472B6', fmt: (v) => Math.abs(v) < 0.05 ? 'Neutre' : v < 0 ? 'Eau ' + Math.round(-v * 100) + ' %' : 'Feu ' + Math.round(v * 100) + ' %', onChange: (v) => { start(); P().char = Math.abs(v) < 0.05 ? 0 : Math.round(v * 100) / 100; draw(); }, onEnd: end });
        proKnob(fp, { key: 'strength', label: 'Force', min: 0, max: 150, val: V('strength'), color: '#A855F7', fmt: (v) => Math.round(v) + ' %', onChange: (v) => { start(); P().strength = Math.round(v); draw(); }, onEnd: end });
        sep();
        const SL = [[0, '6'], [1, '12'], [2, '18'], [3, '24'], [4, '36']];
        chips('Coupe-bas', [[0, 'Arrêt'], [1, 'Marche']], V('hpOn') >= 0.5 ? 1 : 0, (v) => { P().hpOn = v; });
        proKnob(fp, { key: 'hpF', label: 'C.-bas', min: 10, max: 1000, log: true, val: V('hpF'), color: '#9CA3AF', fmt: (v) => Math.round(v) + ' Hz', onChange: (v) => { start(); P().hpF = Math.round(v); P().hpOn = 1; draw(); }, onEnd: () => { end(); buildFp(); } });
        chips('Pente bas', SL, V('hpS'), (v) => { P().hpS = v; });
        chips('Coupe-haut', [[0, 'Arrêt'], [1, 'Marche']], V('lpOn') >= 0.5 ? 1 : 0, (v) => { P().lpOn = v; });
        proKnob(fp, { key: 'lpF', label: 'C.-haut', min: 1000, max: 30000, log: true, val: V('lpF'), color: '#9CA3AF', fmt: (v) => (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k', onChange: (v) => { start(); P().lpF = Math.round(v); P().lpOn = 1; draw(); }, onEnd: () => { end(); buildFp(); } });
        chips('Pente haut', SL, V('lpS'), (v) => { P().lpS = v; });
        sep();
        proKnob(fp, { key: 'input', label: 'Entrée', min: -18, max: 18, val: V('input'), fmt: (v) => (v > 0 ? '+' : '') + Math.round(v * 2) / 2 + ' dB', onChange: (v) => { start(); P().input = Math.round(v * 2) / 2; draw(); }, onEnd: end });
        proKnob(fp, { key: 'output', label: 'Sortie', min: -18, max: 18, val: V('output'), fmt: (v) => (v > 0 ? '+' : '') + Math.round(v * 2) / 2 + ' dB', onChange: (v) => { start(); P().output = Math.round(v * 2) / 2; draw(); }, onEnd: end });
    };
    panel.querySelector('.fx-panel-close').addEventListener('click', () => panel.remove());
    panel.querySelector('.fx-bypass').addEventListener('change', (e) => { pushUndo(); setFxOn(t, 'horizon', e.target.checked); refreshPlaybackSoon(); saveProject(); refreshStrips(); });
    buildFp(); draw();
    // le son derrière la courbe pendant la lecture
    const loop = () => { if (!panel.isConnected) return; if (state.playing || state.recording) draw(); setTimeout(() => requestAnimationFrame(loop), 80); };
    loop();
    const rect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : { left: 80, right: 80, top: 80 };
    const pw = Math.min(1000, window.innerWidth - 16);
    panel.style.width = pw + 'px';
    let left = rect.right + 8; if (left + pw > window.innerWidth) left = Math.max(8, rect.left - pw - 8);
    panel.style.left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.top - 20, window.innerHeight - panel.offsetHeight - 8)) + 'px';
    makePlugWindow(panel, t, 'horizon', trackIdx);
}
(() => {
    const st = document.createElement('style');
    st.textContent = `.hz-svg .hz-dot { cursor: grab; } .hz-svg .hz-n { font: 700 10px -apple-system, system-ui, sans-serif; fill: #0d0915; pointer-events: none; }
        .hz-panel .lim-fp { position: static; flex-wrap: wrap; row-gap: 10px; margin: 0 10px 10px; justify-content: center; } .hz-panel .hz-read b { color: #fff; }`;
    document.head.appendChild(st);
})();
