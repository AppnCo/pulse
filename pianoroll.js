// === Pulse — Piano roll + séquenceur de pas ===
// Un éditeur posé en bas du studio (comme Logic) pour une région MIDI : { inst, beats, notes: [{ s, d, p, v }] }.
//  - Piano roll : cliquer / glisser pour dessiner, déplacer, étirer, vélocité en bas, gamme du morceau surlignée.
//  - Séquenceur de pas (batterie) : une grille de cases, un clic = un coup.
// L'éditeur ne touche jamais au projet : il appelle onCommit(midi) quand on a fini un geste.

(function(root) {
    const NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
    const BLACK = [1, 3, 6, 8, 10];
    const noteName = (p) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
    const SNAPS = [['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/8T', 1 / 3], ['1/16T', 1 / 6], ['Libre', 1 / 64]];
    const RULER = 22, KEYW = 66, VELH = 70, MINROW = 10, MAXROW = 34;
    const PATTERNS = {   // 16 pas (1/16) sur une mesure, répétés sur la longueur du motif
        trap:    { label: 'Trap', 36: [0, 7, 10], 38: [8], 39: [8], 42: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], 46: [] },
        boombap: { label: 'Boom bap', 36: [0, 7, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] },
        drill:   { label: 'Drill', 36: [0, 10], 38: [8], 37: [3, 6, 14], 42: [0, 2, 4, 5, 6, 8, 10, 12, 13, 14] },
        house:   { label: 'House', 36: [0, 4, 8, 12], 39: [4, 12], 46: [2, 6, 10, 14], 42: [0, 1, 3, 5, 7, 8, 9, 11, 13, 15] }
    };

    const CHORDS = [['Note seule', [0]], ['Majeur', [0, 4, 7]], ['Mineur', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['Mineur 7', [0, 3, 7, 10]], ['Majeur 7', [0, 4, 7, 11]], ['Sus 2', [0, 2, 7]], ['Sus 4', [0, 5, 7]], ['Quinte (power)', [0, 7]], ['Diminué', [0, 3, 6]]];
    const TOOLS = [['humanize', 'Humaniser (léger désordre)'], ['legato', 'Legato (chaque note jusqu\'à la suivante)'], ['reverse', 'Inverser dans le temps'], ['randvel', 'Force au hasard'], ['arp', 'Arpège (accords → notes une par une)'], ['octup', 'Monter d\'une octave'], ['octdown', 'Descendre d\'une octave'], ['double', 'Doubler la vitesse (motif ÷ 2)']];
    let el = null, cv = null, ctx = null, S = null, raf = 0, timer = 0, keyHandler = null, hover = false;

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function css(c, a) { return c; }

    function open(opts) {
        close(true);
        const midi = clone(opts.midi);
        const isDrums = midi.inst === 'drums';
        S = {
            o: opts, midi, notes: midi.notes, sel: new Set(), snap: 2,       // 1/16
            view: isDrums && opts.view !== 'roll' ? 'steps' : 'roll',
            stepDiv: 4,                                                       // pas par temps : 4 (1/16), 8 (1/32), 3 (triolets)
            pxBeat: 56, rowH: 16, sx: 0, sy: 0,                               // défilement (px)
            lastLen: 0.25, undo: [], redo: [], dirty: false, drag: null, w: 0, h: 0, playBeat: null, committed: false,
            color: opts.color || '#A855F7', baseOct: 4, bpb: Math.max(1, Math.min(12, opts.bpb || 4)),   // temps par mesure (3 = valse)
            scale: opts.key && opts.key.notes ? 'proj' : '', fold: !!(opts.key && opts.key.notes), lock: false, chord: 0, rec: false, recQ: true, held: {}, ghosts: opts.ghost || []
        };
        if (!S.notes.length && !isDrums) S.sy = null;                         // centré sur Do4 au premier dessin
        build();
        fit();
        autoZoom();
        centerOnNotes();
        draw();
        document.body.classList.add('midi-open');
        document.documentElement.style.setProperty('--midi-h', el.offsetHeight + 'px');
        startLoop();
        // Un clavier MIDI déjà autorisé répond tout de suite, sans rien cliquer (« je branche mon petit piano, boum »)
        if (!isDrums && navigator.permissions && navigator.permissions.query && navigator.requestMIDIAccess) {
            const SS = S;
            navigator.permissions.query({ name: 'midi' }).then(r => { if (S === SS && r.state === 'granted') attachMidi(true); }).catch(() => {});
        }
        keyHandler = onKey;
        document.addEventListener('keydown', keyHandler, true);
        document.addEventListener('keyup', onKeyUp, true);
        return api;
    }

    function close(silent) {
        if (!el) return;
        flush();
        if (!el) return;   // la région a disparu pendant l'enregistrement final : l'éditeur s'est déjà fermé
        clearInterval(timer); cancelAnimationFrame(raf);
        document.removeEventListener('keydown', keyHandler, true);
        document.removeEventListener('keyup', onKeyUp, true);
        el.remove(); el = null; cv = null; ctx = null;
        document.body.classList.remove('midi-open');
        const cb = S && S.o.onClose;
        S = null;
        if (!silent && cb) cb();
    }

    function isOpen() { return !!el; }

    // ---------- Interface ----------
    function build() {
        el = document.createElement('section');
        el.className = 'midi-editor';
        const isDrums = S.midi.inst === 'drums';
        const insts = Object.entries(root.PulseSynth.INSTRUMENTS).filter(([, v]) => isDrums ? v.kind === 'drums' : v.kind === 'keys');
        el.innerHTML = `
            <div class="me-grip" data-tooltip="Tire pour agrandir ou réduire l'éditeur (double-clic : taille normale)"></div>
            <div class="me-bar">
                <span class="me-title"></span>
                ${isDrums ? '' : `<select class="me-inst" data-tooltip="Le son de cette région">${insts.map(([k, v]) => `<option value="${k}" ${S.midi.inst === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`}
                ${isDrums ? `<div class="me-seg" role="group"><button data-view="steps" data-tooltip="Séquenceur de pas : une case = un coup">Pas</button><button data-view="roll" data-tooltip="Piano roll : placer les coups librement">Piano roll</button></div>` : ''}
                <label class="me-lbl me-adv">Grille <select class="me-snap">${SNAPS.map(([n], i) => `<option value="${i}" ${i === S.snap ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <label class="me-lbl me-steps-only me-adv">Pas <select class="me-div"><option value="4">1/16</option><option value="8">1/32</option><option value="3">1/8 triolet</option></select></label>
                <span class="me-len"><button class="me-btn me-shorter" data-tooltip="Raccourcir le motif d'une mesure">−</button><span class="me-len-n"></span><button class="me-btn me-longer" data-tooltip="Allonger le motif d'une mesure">+</button></span>
                ${isDrums ? `<label class="me-lbl">Modèle <select class="me-tpl"><option value="">…</option>${Object.entries(PATTERNS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>` : ''}
                ${isDrums ? '' : `<label class="me-lbl">Gamme <select class="me-scale"></select></label>
                <label class="me-lbl me-check" data-tooltip="Le clavier ne montre que les notes de la gamme : impossible de se tromper, et les accords suivent la gamme"><input type="checkbox" class="me-fold" ${S.fold ? 'checked' : ''}> Seulement la gamme</label>
                <label class="me-lbl me-check" data-tooltip="Les notes que tu poses ou déplaces se calent sur la gamme : impossible de jouer faux"><input type="checkbox" class="me-lock"> Caler sur la gamme</label>
                <label class="me-lbl me-adv">Accord <select class="me-chord" data-tooltip="Un clic pose tout l'accord">${CHORDS.map((c, i) => `<option value="${i}">${c[0]}</option>`).join('')}</select></label>`}
                <label class="me-lbl me-adv" data-tooltip="Décale un pas sur deux vers l'arrière, comme sur FL Studio"><span>Swing</span> <input type="range" class="me-swing" min="0" max="100" value="${Math.round((S.midi.swing || 0) * 100)}"></label>
                <select class="me-tools me-adv" data-tooltip="Outils sur la sélection (ou tout le motif si rien n'est choisi)"><option value="">Outils…</option>${TOOLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
                <button class="me-btn me-rec" data-tooltip="Lance la lecture (Espace) puis joue au clavier de l'ordi : les notes s'enregistrent dans le motif">● Jouer en direct</button>
                <label class="me-lbl me-check me-adv" data-tooltip="Coché : les notes jouées se calent sur la grille. Décoché : elles gardent ton jeu exact (plus humain)"><input type="checkbox" class="me-recq" checked> Caler en jouant</label>
                <button class="me-btn me-quant me-adv" data-tooltip="Remettre toutes les notes sur la grille">Aligner</button>
                <button class="me-btn me-clear" data-tooltip="Effacer toutes les notes de ce motif">Vider</button>
                <button class="me-btn me-more" data-tooltip="Afficher ou cacher les réglages avancés (grille, swing, outils…)">Plus d'options</button>
                <span class="me-grow"></span>
                <span class="me-hint"></span>
                <button class="me-btn me-close" data-tooltip="Fermer l'éditeur (Échap)" aria-label="Fermer">×</button>
            </div>
            ${isDrums ? '' : `<div class="me-pads" data-tooltip="Les accords de la gamme : un clic = l'accord est posé à la suite (Maj + clic = avec la 7e)">
                <span class="me-pads-title">Accords</span><span class="me-pads-row"></span>
                <label class="me-lbl">Durée <select class="me-pad-len"><option value="4">1 mesure</option><option value="2">2 temps</option><option value="8">2 mesures</option><option value="1">1 temps</option></select></label>
            </div>`}
            <div class="me-body"><canvas class="me-cv"></canvas></div>`;
        if (!isDrums) el.classList.add('has-pads');
        document.body.appendChild(el);
        cv = el.querySelector('.me-cv'); ctx = cv.getContext('2d');
        el.querySelector('.me-title').textContent = S.o.title || 'Région MIDI';
        const q = (s) => el.querySelector(s);
        q('.me-close').onclick = () => close();
        // Poignée du haut : agrandir / réduire l'éditeur (taille mémorisée)
        const HKEY = 'pulse_midi_h';
        const setH = (px, save) => {
            if (px == null) { el.style.removeProperty('--midi-h-set'); document.documentElement.style.removeProperty('--midi-h-set'); try { localStorage.removeItem(HKEY); } catch {} }
            else {
                px = Math.round(Math.max(220, Math.min(window.innerHeight * 0.8, px)));
                document.documentElement.style.setProperty('--midi-h-set', px + 'px');
                if (save) { try { localStorage.setItem(HKEY, String(px)); } catch {} }
            }
            document.documentElement.style.setProperty('--midi-h', el.offsetHeight + 'px');
        };
        try { const h = parseInt(localStorage.getItem(HKEY)); if (h) setH(h, false); } catch {}
        q('.me-grip').addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (e.detail >= 2) { setH(null); return; }
            const y0 = e.clientY, h0 = el.offsetHeight;
            const mv = (ev) => setH(h0 + (y0 - ev.clientY), false);
            const up = (ev) => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); setH(h0 + (y0 - ev.clientY), true); };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
        const advKey = 'pulse_roll_adv';
        const setAdv = (on) => { el.classList.toggle('adv', on); q('.me-more').textContent = on ? 'Moins d\'options' : 'Plus d\'options'; };
        try { setAdv(localStorage.getItem(advKey) === '1'); } catch { setAdv(false); }
        q('.me-more').onclick = () => { const on = !el.classList.contains('adv'); setAdv(on); try { localStorage.setItem(advKey, on ? '1' : '0'); } catch {} fit && fit(); draw(); };
        q('.me-snap').onchange = (e) => { S.snap = +e.target.value; draw(); };
        q('.me-div').onchange = (e) => { S.stepDiv = +e.target.value; draw(); };
        const inst = q('.me-inst');
        if (inst) inst.onchange = (e) => { S.midi.inst = e.target.value; changed('inst'); };
        el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; syncBar(); fit(); centerOnNotes(); draw(); });
        q('.me-longer').onclick = () => { snapshot(); S.midi.beats = Math.min(256, S.midi.beats + S.bpb); autoZoom(); changed('len'); };
        q('.me-shorter').onclick = () => {
            if (S.midi.beats <= 4) { S.o.flash && S.o.flash('Le motif fait déjà une mesure — c\'est le minimum'); return; }
            snapshot(); S.midi.beats -= 4;
            S.notes = S.midi.notes = S.notes.filter(n => n.s < S.midi.beats); S.sel.clear();
            autoZoom(); changed('len');
        };
        q('.me-quant').onclick = () => { snapshot(); const u = unit(); S.notes.forEach(n => { n.s = Math.max(0, Math.round(n.s / u) * u); if (S.midi.inst !== 'drums') n.d = Math.max(u, Math.round(n.d / u) * u); }); changed('quant'); };
        q('.me-clear').onclick = () => { if (!S.notes.length) return; snapshot(); S.notes = S.midi.notes = []; S.sel.clear(); changed('clear'); };
        const sc = q('.me-scale');
        if (sc) {
            const opt = [['', 'Aucune']];
            if (S.o.key && S.o.key.notes) opt.push(['proj', S.o.key.label || 'Celle du morceau']);
            for (let m = 0; m < 2; m++) for (let t = 0; t < 12; t++) opt.push([`t:${t}:${m}`, `${NAMES[t]} ${m ? 'mineur' : 'majeur'}`]);
            sc.innerHTML = opt.map(([v, l]) => `<option value="${v}" ${v === S.scale ? 'selected' : ''}>${l}</option>`).join('');
            sc.onchange = (e) => {
                S.scale = e.target.value;
                S.fold = !!scaleMask();                                   // choisir une gamme replie le clavier dessus
                q('.me-fold').checked = S.fold;
                buildPads();
                clampScroll(); centerOnNotes(); draw();
            };
            q('.me-fold').onchange = (e) => {
                if (e.target.checked && !scaleMask()) { e.target.checked = false; S.o.flash && S.o.flash('Choisis d\'abord une gamme dans la liste « Gamme »'); return; }
                S.fold = e.target.checked; clampScroll(); centerOnNotes(); draw();
            };
            q('.me-lock').onchange = (e) => {
                if (e.target.checked && !scaleMask()) { e.target.checked = false; S.o.flash && S.o.flash('Choisis d\'abord une gamme dans la liste « Gamme »'); return; }
                S.lock = e.target.checked;
            };
            q('.me-chord').onchange = (e) => { S.chord = +e.target.value; };
        }
        buildPads();
        q('.me-swing').oninput = (e) => { S.midi.swing = +e.target.value / 100; S.swingDirty = true; clearTimeout(S.sw); S.sw = setTimeout(() => { snapshot(); changed('swing'); }, 250); };
        q('.me-tools').onchange = (e) => { const k = e.target.value; e.target.value = ''; if (k) runTool(k); };
        q('.me-recq').onchange = (e) => { S.recQ = e.target.checked; };
        q('.me-rec').onclick = () => {
            S.rec = !S.rec; q('.me-rec').classList.toggle('on', S.rec);
            if (S.rec) attachMidi();
            if (S.rec) S.o.flash && S.o.flash(S.midi.inst === 'drums' || S.view === 'steps' ? 'Lance la lecture (Espace) puis joue : la rangée du milieu du clavier = kick, snare, clap, rim, hi-hat…' : 'Lance la lecture (Espace) puis joue avec le clavier de l\'ordi : rangée du milieu = notes blanches, rangée du dessus = noires');
        };
        const tpl = q('.me-tpl');
        if (tpl) tpl.onchange = (e) => {
            const P = PATTERNS[e.target.value]; e.target.value = ''; if (!P) return;
            snapshot();
            const out = [];
            for (let bar = 0; bar < S.midi.beats / S.bpb; bar++) for (const k of Object.keys(P)) {
                if (k === 'label') continue;
                P[k].filter(st => st / 4 < S.bpb).forEach(st => out.push({ s: bar * S.bpb + st / 4, d: 0.25, p: +k, v: (k === '42' && st % 4 !== 0) ? 78 : (k === '42' ? 105 : 110) }));
            }
            S.notes = S.midi.notes = out; S.sel.clear(); changed('tpl');
        };
        cv.addEventListener('mousedown', onDown);
        cv.addEventListener('contextmenu', (e) => e.preventDefault());
        cv.addEventListener('dblclick', onDbl);
        cv.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('mouseenter', () => hover = true);
        el.addEventListener('mouseleave', () => hover = false);
        cv.addEventListener('mousemove', onMoveHover);
        new ResizeObserver(() => { if (!el) return; fit(); draw(); }).observe(el.querySelector('.me-body'));
        syncBar();
    }

    function syncBar() {
        if (!el) return;
        el.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
        el.querySelectorAll('.me-steps-only').forEach(n => n.style.display = S.view === 'steps' ? '' : 'none');
        el.querySelector('.me-len-n').textContent = `${Math.round(S.midi.beats / S.bpb * 10) / 10} mes.`;
        const h = el.querySelector('.me-hint');
        h.textContent = S.view === 'steps'
            ? 'Clic : poser / retirer un coup · glisser : peindre · clic droit : changer la force'
            : 'Clic : poser une note · glisser : la déplacer · bord droit : l\'étirer · double-clic : l\'effacer';
    }

    function fit() {
        if (!el) return;
        const body = el.querySelector('.me-body'), dpr = window.devicePixelRatio || 1;
        S.w = body.clientWidth; S.h = body.clientHeight;
        cv.width = Math.round(S.w * dpr); cv.height = Math.round(S.h * dpr);
        cv.style.width = S.w + 'px'; cv.style.height = S.h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        clampScroll();
    }

    function centerOnNotes() {
        rebuildRows();
        if (S.view === 'steps') { S.sx = 0; return; }
        let lo = 127, hi = 0;
        S.notes.forEach(n => { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); });
        const mid = S.notes.length ? (lo + hi) / 2 : (S.midi.inst === 'bass808' || S.midi.inst === 'bass' ? 40 : 60);
        const gh = gridH();
        S.sy = rowOf(Math.round(mid)) * S.rowH - gh / 2;
        clampScroll();
    }

    // Le motif remplit la largeur de l'éditeur (jamais plus petit que 16 px par temps)
    function autoZoom() {
        const free = S.w - leftW() - 28;
        if (free > 0) S.pxBeat = Math.max(16, Math.min(S.view === "steps" ? 300 : 140, free / S.midi.beats));
        S.sx = 0;
    }
    function scaleMask() {
        const v = S.scale;
        if (!v) return null;
        if (v === 'proj') return S.o.key && S.o.key.notes ? { notes: S.o.key.notes, tonic: S.o.key.tonic } : null;
        const [, t, m] = v.split(':'), tonic = +t, minor = +m === 1, rel = minor ? (tonic + 3) % 12 : tonic;
        const MAJ = [0, 2, 4, 5, 7, 9, 11], notes = Array(12).fill(false);
        MAJ.forEach(i => notes[(rel + i) % 12] = true);
        return { notes, tonic };
    }
    function toScale(p) {
        const m = scaleMask();
        if (!S.lock || !m) return p;
        for (let d = 0; d < 7; d++) {
            if (p + d <= 127 && m.notes[(p + d) % 12]) return p + d;
            if (p - d >= 0 && m.notes[(p - d) % 12]) return p - d;
        }
        return p;
    }
    // Accord posé sur `root`. Avec « Seulement la gamme » : l'accord suit les notes de la gamme (Ré mineur dans Do majeur, etc.)
    const DEGREES = { 1: [0, 2, 4], 2: [0, 2, 4], 3: [0, 2, 4, 6], 4: [0, 2, 4, 6], 5: [0, 2, 4, 6], 6: [0, 1, 4], 7: [0, 3, 4], 8: [0, 4], 9: [0, 2, 4] };
    function chordPitches(root) {
        if (S.midi.inst === 'drums' || S.chord === 0) return [root];
        const m = scaleMask();
        if (S.fold && m && m.notes[root % 12]) {
            const pcs = []; for (let p = 0; p < 128; p++) if (m.notes[p % 12]) pcs.push(p);
            const i = pcs.indexOf(root);
            return DEGREES[S.chord].map(d => pcs[i + d]).filter(v => v !== undefined);
        }
        return CHORDS[S.chord][1].map(i => root + i).filter(v => v <= 127);
    }
    // --- Accords de la gamme : sept pavés, un clic = l'accord posé à la suite ---
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    function chordPads() {
        const m = scaleMask();
        if (!m) return [];
        const pcs = [];
        for (let k = 0; k < 12; k++) { const pc = (m.tonic + k) % 12; if (m.notes[pc]) pcs.push(pc); }
        if (pcs.length !== 7) return [];
        return pcs.map((root, i) => {
            const third = pcs[(i + 2) % 7], fifth = pcs[(i + 4) % 7], seventh = pcs[(i + 6) % 7];
            const t = (third - root + 12) % 12, f = (fifth - root + 12) % 12;
            const kind = t === 4 && f === 7 ? 'maj' : t === 3 && f === 7 ? 'min' : t === 3 && f === 6 ? 'dim' : 'aug';
            const low = 52 + (((root - 52) % 12) + 12) % 12;                  // fondamentale entre mi2 et si3 : un accord de piano naturel
            const up = (pc) => low + ((pc - root + 12) % 12);
            return {
                name: NAMES[root] + (kind === 'min' ? ' m' : kind === 'dim' ? '°' : kind === 'aug' ? ' +' : ''),
                roman: kind === 'maj' || kind === 'aug' ? ROMAN[i] : ROMAN[i].toLowerCase() + (kind === 'dim' ? '°' : ''),
                triad: [low, up(third), up(fifth)], seventh: up(seventh)
            };
        });
    }
    function buildPads() {
        const row = el && el.querySelector('.me-pads-row');
        if (!row) return;
        const pads = chordPads();
        row.innerHTML = pads.length
            ? pads.map((c, i) => `<button class="me-pad" data-i="${i}" data-tooltip="${c.name} — clic : poser l'accord à la suite · Maj + clic : avec la 7e">
                <b>${c.name}</b><em>${c.roman}</em></button>`).join('')
            : `<span class="me-hint">Choisis une gamme (liste « Gamme ») : ses accords apparaissent ici, un clic et c'est posé.</span>`;
        row.querySelectorAll('.me-pad').forEach(b => b.onclick = (e) => placePad(pads[+b.dataset.i], e.shiftKey));
    }
    // Pose l'accord après tout ce qui existe déjà (ou à l'endroit de la lecture en mode direct)
    function placePad(c, withSeventh) {
        if (!c || !S) return;
        const len = +el.querySelector('.me-pad-len').value || 4;
        const pitches = withSeventh ? [...c.triad, c.seventh] : c.triad;
        pitches.forEach((p, i) => audition(p, 92));
        let at = 0;
        const beat = S.rec && S.o.getBeat ? S.o.getBeat() : null;
        if (beat != null) at = Math.max(0, Math.round(beat * 4) / 4);
        else if (S.notes.length) {
            const end = Math.max(...S.notes.map(n => n.s + n.d));
            at = Math.ceil(end / len - 1e-6) * len;                          // le prochain emplacement net (mesure ou temps)
        }
        snapshot();
        while (at + len > S.midi.beats && S.midi.beats < 256) S.midi.beats += S.bpb;
        if (at >= S.midi.beats) { S.o.flash && S.o.flash('Le motif est plein (64 mesures maximum)'); return; }
        const added = pitches.map(p => ({ s: at, d: len * 0.98, p, v: 92 }));
        added.forEach(n => S.notes.push(n));
        S.midi.notes = S.notes;
        S.sel = new Set(added);
        autoZoom();
        changed('pad');
    }
    function gridH() { return Math.max(40, S.h - RULER - (S.view === 'roll' ? VELH : 0)); }
    function stepRows() { return root.PulseSynth.DRUM_LANES; }
    function clampScroll() {
        if (!S.rows) rebuildRows();
        if (S.view === 'steps') { S.sy = 0; }
        else S.sy = Math.max(0, Math.min(S.sy == null ? 0 : S.sy, S.rows.length * S.rowH - gridH()));
        const maxX = Math.max(0, S.midi.beats * S.pxBeat - (S.w - (S.view === 'steps' ? KEYW + 40 : KEYW)) + 40);
        S.sx = Math.max(0, Math.min(S.sx, maxX));
    }
    const leftW = () => S.view === 'steps' ? KEYW + 44 : KEYW;
    const unit = () => S.view === 'steps' ? 1 / S.stepDiv : SNAPS[S.snap][1];
    const bx = (beat) => leftW() + beat * S.pxBeat - S.sx;
    const xb = (x) => (x - leftW() + S.sx) / S.pxBeat;
    // Rangées visibles, de haut en bas. Avec « Seulement la gamme » : uniquement les notes de la gamme
    // (+ celles où il y a déjà une note, pour que rien ne disparaisse)
    function rebuildRows() {
        const m = scaleMask(), rows = [];
        const used = new Set(S.notes.map(n => n.p));
        for (let p = 127; p >= 0; p--) if (!S.fold || !m || m.notes[p % 12] || used.has(p)) rows.push(p);
        S.rows = rows; S.rowIdx = new Int16Array(128).fill(-1);
        rows.forEach((p, i) => S.rowIdx[p] = i);
    }
    const nearestRow = (p) => { for (let d = 0; d < 128; d++) { if (p + d <= 127 && S.rowIdx[p + d] >= 0) return S.rowIdx[p + d]; if (p - d >= 0 && S.rowIdx[p - d] >= 0) return S.rowIdx[p - d]; } return 0; };
    const rowOf = (p) => S.rowIdx[p] >= 0 ? S.rowIdx[p] : nearestRow(p);
    const rowAt = (y) => Math.max(0, Math.min(S.rows.length - 1, Math.floor((y - RULER + S.sy) / S.rowH)));
    const py = (p) => RULER + rowOf(p) * S.rowH - S.sy;
    const yp = (y) => S.rows[rowAt(y)];

    // ---------- Dessin ----------
    function draw() {
        if (!ctx) return;
        const W = S.w, H = S.h;
        rebuildRows();
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#150e20'; ctx.fillRect(0, 0, W, H);
        if (S.view === 'steps') drawSteps(); else drawRoll();
        drawRuler();
        if (S.playBeat != null && S.playBeat >= 0 && S.playBeat <= S.midi.beats) {
            const x = bx(S.playBeat);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, RULER); ctx.lineTo(x, H); ctx.stroke();
        }
    }

    function drawRuler() {
        const W = S.w, lw = leftW();
        ctx.fillStyle = '#251934'; ctx.fillRect(0, 0, W, RULER);
        ctx.fillStyle = '#B8A8D9'; ctx.font = '11px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle';
        const bars = Math.ceil(S.midi.beats / S.bpb);
        for (let b = 0; b < bars; b++) {
            const x = bx(b * S.bpb);
            if (x > W) break; if (x + S.bpb * S.pxBeat < lw) continue;
            ctx.fillText(String(b + 1), Math.max(lw + 4, x + 4), RULER / 2);
            ctx.fillStyle = 'rgba(168,85,247,.5)'; ctx.fillRect(x, 4, 1, RULER - 8); ctx.fillStyle = '#B8A8D9';
        }
        ctx.fillStyle = '#251934'; ctx.fillRect(0, 0, lw, RULER);
    }

    function gridLines(top, bottom) {
        const lw = leftW(), u = S.view === 'steps' ? 1 / S.stepDiv : 0.25;
        // un trait tous les `u` temps ; les traits trop serrés sont omis
        let step = u; while (step * S.pxBeat < 7) step *= 2;
        const a = Math.max(0, Math.floor(xb(lw) / step) * step), b = Math.min(S.midi.beats, xb(S.w) + step);
        for (let t = a; t <= b + 1e-6; t += step) {
            const x = Math.round(bx(t)) + 0.5, bar = Math.abs(t % S.bpb) < 1e-6, beat = Math.abs(t % 1) < 1e-6;
            ctx.strokeStyle = bar ? 'rgba(200,170,255,.45)' : beat ? 'rgba(168,85,247,.28)' : 'rgba(168,85,247,.11)';
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        }
        // fin du motif
        const xe = bx(S.midi.beats);
        if (xe < S.w) { ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(xe, top, S.w - xe, bottom - top); }
    }

    function drawRoll() {
        const lw = leftW(), gh = gridH();
        const r0 = rowAt(RULER), r1 = rowAt(RULER + gh);
        const key = scaleMask();
        ctx.save(); ctx.beginPath(); ctx.rect(lw, RULER, S.w - lw, gh); ctx.clip();
        for (let r = r0; r <= r1; r++) {
            const p = S.rows[r], y = RULER + r * S.rowH - S.sy, pc = p % 12, inKey = key && key.notes ? key.notes[pc] : false;
            ctx.fillStyle = BLACK.includes(pc) ? (inKey ? '#241838' : '#130c1d') : (inKey ? '#2d2044' : '#1b1228');
            ctx.fillRect(lw, y, S.w - lw, S.rowH);
            if (key && key.tonic === pc) { ctx.fillStyle = 'rgba(168,85,247,.16)'; ctx.fillRect(lw, y, S.w - lw, S.rowH); }
            ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(lw, y + S.rowH - 1, S.w - lw, 1);
        }
        gridLines(RULER, RULER + gh);
        // notes fantômes : les autres régions de la piste (pour se repérer), puis les notes de celle-ci
        ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff';
        for (const g of S.ghosts) for (const n of g) {
            const x = bx(n.s), w = Math.max(3, n.d * S.pxBeat - 1), y = py(n.p);
            if (x + w < lw || x > S.w || y < RULER || y > RULER + gh) continue;
            ctx.fillRect(x, y + 3, w, S.rowH - 6);
        }
        ctx.globalAlpha = 1;
        for (const n of S.notes) drawNote(n);
        // sélection au lasso
        if (S.drag && S.drag.kind === 'lasso') {
            const d = S.drag; ctx.fillStyle = 'rgba(168,85,247,.15)'; ctx.strokeStyle = '#C084FC';
            const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
            ctx.fillRect(x, y, w, h); ctx.strokeRect(x + .5, y + .5, w, h);
        }
        ctx.restore();
        // clavier
        ctx.save(); ctx.beginPath(); ctx.rect(0, RULER, lw, gh); ctx.clip();
        for (let r = r0; r <= r1; r++) {
            const p = S.rows[r], y = RULER + r * S.rowH - S.sy, blk = BLACK.includes(p % 12);
            ctx.fillStyle = blk ? '#14101c' : '#e9e2f5'; ctx.fillRect(0, y, blk ? lw * 0.62 : lw, S.rowH - 0.5);
            if (blk) { ctx.fillStyle = '#d8cfe8'; ctx.fillRect(lw * 0.62, y, lw * 0.38, S.rowH - 0.5); }
            if (p % 12 === 0 || S.rowH >= 20) {
                ctx.fillStyle = p % 12 === 0 ? '#3a2a55' : '#7a6b96'; ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle';
                ctx.fillText(noteName(p), lw - 34, y + S.rowH / 2);
            }
        }
        ctx.restore();
        // vélocités
        const vy = RULER + gh;
        ctx.fillStyle = '#1b1228'; ctx.fillRect(lw, vy, S.w - lw, VELH);
        ctx.fillStyle = '#251934'; ctx.fillRect(0, vy, lw, VELH);
        ctx.fillStyle = '#7A6B96'; ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.fillText('Force', 10, vy + 14);
        ctx.save(); ctx.beginPath(); ctx.rect(lw, vy, S.w - lw, VELH); ctx.clip();
        gridLines(vy, vy + VELH);
        for (const n of S.notes) {
            const x = bx(n.s), h = (n.v / 127) * (VELH - 10);
            ctx.fillStyle = S.sel.has(n) ? '#fff' : S.color;
            ctx.fillRect(x, vy + VELH - 4 - h, 3, h);
            ctx.beginPath(); ctx.arc(x + 1.5, vy + VELH - 4 - h, 3, 0, 7); ctx.fill();
        }
        ctx.restore();
        ctx.fillStyle = 'rgba(168,85,247,.3)'; ctx.fillRect(0, vy, S.w, 1);
    }

    function drawNote(n) {
        const x = bx(n.s), w = Math.max(3, n.d * S.pxBeat - 1), y = py(n.p);
        if (x + w < leftW() || x > S.w) return;
        const sel = S.sel.has(n);
        ctx.fillStyle = sel ? '#fff' : S.color;
        ctx.globalAlpha = sel ? 1 : 0.45 + 0.55 * (n.v / 127);
        roundRect(x, y + 1, w, S.rowH - 2, 3); ctx.fill();
        ctx.globalAlpha = 1;
        if (!sel) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; roundRect(x + .5, y + 1.5, w - 1, S.rowH - 3, 3); ctx.stroke(); }
        if (w > 30 && S.rowH >= 14) { ctx.fillStyle = sel ? '#251934' : 'rgba(0,0,0,.6)'; ctx.font = '9px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(noteName(n.p), x + 4, y + S.rowH / 2); }
    }
    function roundRect(x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    function stepNoteAt(p, t) { return S.notes.find(n => n.p === p && Math.abs(n.s - t) < 1e-4); }
    function drawSteps() {
        const lw = leftW(), rows = stepRows(), rh = Math.max(24, Math.min(46, (S.h - RULER) / rows.length));
        S.stepRowH = rh;
        const u = 1 / S.stepDiv, nSteps = Math.round(S.midi.beats * S.stepDiv);
        ctx.save(); ctx.beginPath(); ctx.rect(lw, RULER, S.w - lw, S.h - RULER); ctx.clip();
        rows.forEach((r, ri) => {
            const y = RULER + ri * rh;
            ctx.fillStyle = ri % 2 ? '#1b1228' : '#20162e'; ctx.fillRect(lw, y, S.w - lw, rh);
            for (let i = 0; i < nSteps; i++) {
                const x = bx(i * u), w = u * S.pxBeat;
                if (x + w < lw || x > S.w) continue;
                const t = i * u, on = stepNoteAt(r.p, t), group = Math.floor(i / S.stepDiv) % 2;
                ctx.fillStyle = on ? S.color : (group ? '#2a1d3d' : '#32234a');
                if (on) ctx.globalAlpha = 0.45 + 0.55 * (on.v / 127);
                roundRect(x + 1.5, y + 2, Math.max(2, w - 3), rh - 4, 4); ctx.fill(); ctx.globalAlpha = 1;
                if (on && on.v >= 120) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(x + 1.5, y + 2, Math.max(2, w - 3), 3); }
            }
        });
        const xe = bx(S.midi.beats);
        if (xe < S.w) { ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(xe, RULER, S.w - xe, S.h - RULER); }
        ctx.restore();
        ctx.fillStyle = '#251934'; ctx.fillRect(0, RULER, lw, S.h - RULER);
        rows.forEach((r, ri) => {
            const y = RULER + ri * rh;
            ctx.fillStyle = '#e9e2f5'; ctx.font = '12px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle';
            ctx.fillText(r.name, 10, y + rh / 2);
            ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, y + rh - 1, lw, 1);
        });
    }

    // ---------- Souris ----------
    function pos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    function noteAt(x, y) {
        const b = xb(x), p = yp(y);
        for (let i = S.notes.length - 1; i >= 0; i--) {
            const n = S.notes[i];
            if (n.p === p && b >= n.s - 0.001 && b <= n.s + n.d + 3 / S.pxBeat) return n;
        }
        return null;
    }
    function onMoveHover(e) {
        if (S.drag || !cv) return;
        const { x, y } = pos(e);
        let c = 'default';
        if (S.view === 'roll') {
            if (x < leftW()) c = 'pointer';
            else if (y > RULER && y < RULER + gridH()) {
                const n = noteAt(x, y);
                c = n ? (xb(x) > n.s + n.d - 7 / S.pxBeat ? 'ew-resize' : 'grab') : 'crosshair';
            }
        } else if (x > leftW() && y > RULER) c = 'pointer'; else if (x < leftW()) c = 'pointer';
        cv.style.cursor = c;
    }

    function onDown(e) {
        e.preventDefault();
        const { x, y } = pos(e), isRight = e.button === 2;
        if (S.view === 'steps') return downSteps(x, y, isRight);
        const gh = gridH(), lw = leftW();
        if (y < RULER) return;
        if (x < lw) {   // clavier : écouter la note
            if (y < RULER + gh) { const p = yp(y); audition(p); const up = () => document.removeEventListener('mouseup', up); document.addEventListener('mouseup', up); }
            return;
        }
        if (y >= RULER + gh) return downVel(x, y);                // zone de force
        const n = noteAt(x, y);
        if (isRight) { if (n) { snapshot(); remove(n); changed('del'); } return; }
        if (n) {
            const edge = xb(x) > n.s + n.d - 7 / S.pxBeat && n.d * S.pxBeat > 14;
            if (e.shiftKey) { S.sel.has(n) ? S.sel.delete(n) : S.sel.add(n); draw(); return; }
            if (!S.sel.has(n)) { S.sel.clear(); S.sel.add(n); }
            audition(n.p, n.v);
            snapshot();
            const group = [...S.sel].map(m => ({ n: m, s: m.s, p: m.p, d: m.d }));
            S.drag = { kind: edge ? 'resize' : 'move', x0: x, y0: y, b0: xb(x), r0: rowAt(y), group, moved: false, copy: e.altKey && !edge };
            if (S.drag.copy) {
                const copies = group.map(g => ({ s: g.s, d: g.d, p: g.p, v: g.n.v }));
                copies.forEach(c => S.notes.push(c));
                S.drag.group = copies.map((c, i) => ({ n: c, s: c.s, p: c.p, d: c.d }));
                S.sel = new Set(copies);
            }
        } else {
            if (e.metaKey || e.ctrlKey || e.shiftKey) {                         // ⌘/Maj + glisser : sélection au lasso
                if (!e.shiftKey) S.sel.clear();
                S.drag = { kind: 'lasso', x0: x, y0: y, x1: x, y1: y, base: new Set(S.sel) };
            } else {                                                            // clic : poser une note (glisser = l'étirer)
                S.sel.clear();
                const u = unit(), b = Math.max(0, Math.floor(xb(x) / u + 1e-6) * u), p = Math.max(0, Math.min(127, yp(y)));
                if (b >= S.midi.beats) return;
                snapshot();
                const root = toScale(p);
                const made = chordPitches(root).map(cp => ({ s: b, d: Math.max(u, S.lastLen), p: cp, v: 100 }));
                made.forEach(n => { S.notes.push(n); S.sel.add(n); });
                made.forEach(n => audition(n.p, 100));
                S.drag = { kind: 'draw', n: made[0], all: made, b0: b, moved: false };
            }
        }
        draw();
        window.addEventListener('mousemove', onDrag); window.addEventListener('mouseup', onUp, { once: true });
    }

    function onDrag(e) {
        const d = S.drag; if (!d) return;
        const { x, y } = pos(e), u = unit();
        if (d.kind === 'lasso') {
            d.x1 = x; d.y1 = y;
            const a = xb(Math.min(d.x0, x)), b = xb(Math.max(d.x0, x)), ra = rowAt(Math.min(d.y0, y)), rb = rowAt(Math.max(d.y0, y));
            S.sel = new Set(d.base);
            S.notes.forEach(n => { const r = rowOf(n.p); if (n.s + n.d >= a && n.s <= b && r >= ra && r <= rb) S.sel.add(n); });
        } else if (d.kind === 'draw') {
            const end = Math.max(d.b0 + u, Math.round(xb(x) / u) * u);
            (d.all || [d.n]).forEach(n => { n.d = Math.min(S.midi.beats - n.s, end - n.s); }); d.moved = true;
        } else if (d.kind === 'move') {
            let db = (xb(x) - d.b0), dp = rowAt(y) - d.r0;
            if (e.shiftKey) { if (Math.abs(x - d.x0) > Math.abs(y - d.y0)) dp = 0; else db = 0; }   // Maj : un seul axe
            db = Math.round(db / u) * u;
            const minS = Math.min(...d.group.map(g => g.s));
            const rs = d.group.map(g => rowOf(g.p)), maxR = S.rows.length - 1;
            db = Math.max(db, -minS); dp = Math.max(-Math.min(...rs), Math.min(maxR - Math.max(...rs), dp));
            d.group.forEach((g, i) => { g.n.s = g.s + db; g.n.p = toScale(S.rows[rs[i] + dp]); });
            if (dp !== d.lastDp && dp !== 0) audition(d.group[0].n.p, d.group[0].n.v);
            d.lastDp = dp; d.moved = true;
        } else if (d.kind === 'resize') {
            const db = Math.round((xb(x) - d.b0) / u) * u;
            d.group.forEach(g => { g.n.d = Math.max(u, Math.min(S.midi.beats - g.s, g.d + db)); });
            d.moved = true;
        } else if (d.kind === 'vel') {
            setVelAt(x, y, d);
        } else if (d.kind === 'paint') {
            paintAt(x, y);
        }
        draw();
    }

    function onUp() {
        window.removeEventListener('mousemove', onDrag);
        const d = S.drag; S.drag = null;
        if (!d) return;
        if (d.kind === 'draw') S.lastLen = d.n.d;
        if (d.kind === 'move' || d.kind === 'draw') S.notes = S.midi.notes = S.notes;
        if (d.kind === 'resize' && d.moved) S.lastLen = d.group[0].n.d;
        if (d.kind === 'lasso') { draw(); return; }
        if ((d.kind === 'move' || d.kind === 'resize' || d.kind === 'draw') && !d.moved && d.kind !== 'draw') { S.undo.pop(); draw(); return; }
        changed(d.kind);
    }

    function onDbl(e) {
        if (S.view !== 'roll') return;
        const { x, y } = pos(e);
        if (y < RULER || y > RULER + gridH() || x < leftW()) return;
        const n = noteAt(x, y);
        if (n) { S.undo.length && S.undo.pop(); snapshot(); remove(n); changed('del'); }
    }

    function remove(n) { S.notes.splice(S.notes.indexOf(n), 1); S.sel.delete(n); }

    // Zone de force : tirer une barre vers le haut / le bas
    function downVel(x, y) {
        const b = xb(x);
        let best = null, bd = 1e9;
        S.notes.forEach(n => { const dd = Math.abs(bx(n.s) - x); if (dd < bd) { bd = dd; best = n; } });
        if (!best || bd > 12) return;
        snapshot();
        const targets = S.sel.has(best) ? [...S.sel] : [best];
        S.drag = { kind: 'vel', targets, ref: best, moved: false };
        setVelAt(x, y, S.drag);
        draw();
        window.addEventListener('mousemove', onDrag); window.addEventListener('mouseup', onUp, { once: true });
    }
    function setVelAt(x, y, d) {
        const vy = RULER + gridH(), v = Math.round(Math.max(1, Math.min(127, (1 - (y - vy - 6) / (VELH - 14)) * 127)));
        const delta = v - d.ref.v;
        d.targets.forEach(n => n.v = Math.max(1, Math.min(127, d.targets.length === 1 ? v : n.v + delta)));
        d.moved = true;
    }

    // Séquenceur de pas
    function downSteps(x, y, isRight) {
        const lw = leftW(), rows = stepRows(), rh = S.stepRowH;
        if (y < RULER) return;
        const ri = Math.floor((y - RULER) / rh);
        if (ri < 0 || ri >= rows.length) return;
        if (x < lw) { audition(rows[ri].p, 105); return; }
        const t = Math.floor(xb(x) * S.stepDiv + 1e-6) / S.stepDiv;
        if (t < 0 || t >= S.midi.beats) return;
        const cur = stepNoteAt(rows[ri].p, t);
        snapshot();
        if (isRight) {                                         // clic droit : normal → fort → doux
            if (cur) { cur.v = cur.v >= 120 ? 60 : cur.v >= 90 ? 127 : 100; audition(cur.p, cur.v); }
            S.drag = { kind: 'none' };
            changed('vel'); S.drag = null; return;
        }
        const paintOn = !cur;
        S.drag = { kind: 'paint', on: paintOn, moved: true };
        paintAt(x, y);
        draw();
        window.addEventListener('mousemove', onDrag); window.addEventListener('mouseup', onUp, { once: true });
    }
    function paintAt(x, y) {
        const rows = stepRows(), ri = Math.floor((y - S.stepRowH * 0 - RULER) / S.stepRowH);
        if (ri < 0 || ri >= rows.length) return;
        const t = Math.floor(xb(x) * S.stepDiv + 1e-6) / S.stepDiv;
        if (t < 0 || t >= S.midi.beats - 1e-6 || x < leftW()) return;
        const p = rows[ri].p, cur = stepNoteAt(p, t), u = 1 / S.stepDiv;
        if (S.drag.on && !cur) { S.notes.push({ s: t, d: u, p, v: 100 }); if (!S.drag.heard) { audition(p, 100); S.drag.heard = true; } }
        else if (!S.drag.on && cur) remove(cur);
    }

    function onWheel(e) {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {                         // ⌘ + molette : zoom en largeur
            const { x } = pos(e), b = xb(x);
            S.pxBeat = Math.max(8, Math.min(600, S.pxBeat * Math.exp(-e.deltaY * 0.0025)));
            S.sx = b * S.pxBeat - (x - leftW());
        } else if (e.altKey && S.view === 'roll') {           // Alt + molette : zoom en hauteur
            S.rowH = Math.max(MINROW, Math.min(MAXROW, S.rowH * Math.exp(-e.deltaY * 0.0025)));
        } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) S.sx += (e.deltaX || e.deltaY);
        else if (S.view === 'roll') S.sy += e.deltaY;
        clampScroll(); draw();
    }

    // Une note jouée (clavier de l'ordi ou clavier MIDI) : on l'écoute et, en mode direct, on l'enregistre
    function playIn(id, pitch, vel) {
        audition(pitch, vel);
        if (!S.rec || S.held[id] != null) return;
        const isDr = S.midi.inst === 'drums' || S.view === 'steps';
        const b = S.o.getBeat ? S.o.getBeat() : null;
        if (b == null) { S.o.flash && S.o.flash('Lance d\'abord la lecture avec Espace, puis joue'); return; }
        const u = isDr ? 0.25 : unit(), free = !S.recQ && !isDr;
        const s = free ? Math.min(S.midi.beats - 0.05, Math.max(0, Math.round(b * 64) / 64)) : Math.min(S.midi.beats - u, Math.max(0, Math.round(b / u) * u));
        snapshot();
        const n = { s, d: u, p: pitch, v: vel, _t: b };
        S.notes.push(n); S.held[id] = n;
        if (!isDr && S.view === 'roll') S.sel = new Set([n]);
        changed('rec');
    }
    function stopIn(id) {
        const n = S.held[id];
        if (!n) return;
        delete S.held[id];
        const b = S.o.getBeat ? S.o.getBeat() : null;
        if (b != null && S.midi.inst !== 'drums') n.d = Math.max(S.recQ ? unit() : 0.05, Math.min(S.midi.beats - n.s, b - n._t));
        delete n._t;
        changed('rec');
    }
    // Clavier MIDI USB (Web MIDI) : branché au premier clic sur « Jouer en direct »
    function attachMidi(silent) {
        if (S.midiOk || !navigator.requestMIDIAccess) {
            if (!silent && !navigator.requestMIDIAccess) S.o.flash && S.o.flash('Ce navigateur ne gère pas les claviers MIDI — joue avec le clavier de l\'ordi (rangée du milieu)');
            return;
        }
        const SS = S;
        navigator.requestMIDIAccess().then((acc) => {
            if (S !== SS) return;
            S.midiOk = true;
            const hook = () => {
                let n = 0;
                acc.inputs.forEach((inp) => { inp.onmidimessage = onMidi; n++; });
                return n;
            };
            acc.onstatechange = hook;
            const n = hook();
            if (silent && !n) return;
            S.o.flash && S.o.flash(n ? (silent ? '🎹 Clavier MIDI branché : joue, tu l\'entends tout de suite' : `🎹 Clavier MIDI branché (${n}) — joue, ça s'enregistre pendant la lecture`) : 'Aucun clavier MIDI trouvé — branche-le puis recoche « Jouer en direct »');
        }).catch(() => { if (S !== SS || silent) return; S.o.flash && S.o.flash('Le navigateur a refusé l\'accès au clavier MIDI — autorise-le dans la barre d\'adresse, ou joue avec le clavier de l\'ordi'); });
    }
    function onMidi(m) {
        if (!S || !el) return;
        const [st, d1, d2] = m.data, cmd = st & 0xF0;
        let p = d1;
        if (S.midi.inst === 'drums' || S.view === 'steps') {
            const lanes = stepRows().map(l => l.p);
            if (!lanes.includes(p)) p = lanes[((p - 36) % lanes.length + lanes.length) % lanes.length];
        }
        const id = 'm' + d1;
        if (cmd === 0x90 && d2 > 0) playIn(id, p, Math.max(1, d2));
        else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) stopIn(id);
    }
    const DRUMKEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
    // Touches lues par leur POSITION sur le clavier (comme un piano) : sur AZERTY, la rangée du milieu reste les notes blanches
    const physKey = (e) => (e.code && /^Key[A-Z]$/.test(e.code)) ? e.code.slice(3).toLowerCase() : String(e.key || '').toLowerCase();
    function onKeyUp(e) {
        if (!S) return;
        stopIn(physKey(e));
    }
    // ---------- Clavier ----------
    const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
    function onKey(e) {
        if (!el) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
        if (!hover && !el.contains(e.target)) return;
        const mod = e.metaKey || e.ctrlKey, k = e.key;
        const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
        if (k === 'Escape') { eat(); close(); return; }
        if (mod && k.toLowerCase() === 'z') { eat(); e.shiftKey ? redo() : undoEd(); return; }
        if (mod && k.toLowerCase() === 'a') { eat(); S.sel = new Set(S.notes); draw(); return; }
        if (mod && k.toLowerCase() === 'd') {
            eat(); if (!S.sel.size) return; snapshot();
            const sel = [...S.sel], a = Math.min(...sel.map(n => n.s)), b = Math.max(...sel.map(n => n.s + n.d)), len = b - a;
            const copies = sel.map(n => ({ ...n, s: n.s + len })).filter(n => n.s < S.midi.beats);
            copies.forEach(c => S.notes.push(c)); S.sel = new Set(copies); changed('dup'); return;
        }
        if (k === 'Delete' || k === 'Backspace') {
            if (!S.sel.size) return; eat(); snapshot();
            S.notes = S.midi.notes = S.notes.filter(n => !S.sel.has(n)); S.sel.clear(); changed('del'); return;
        }
        if (k.startsWith('Arrow') && S.sel.size) {
            eat(); snapshot();
            const u = unit(), oct = e.shiftKey;
            S.sel.forEach(n => {
                if (k === 'ArrowLeft') n.s = Math.max(0, n.s - (oct ? 4 : u));
                if (k === 'ArrowRight') n.s = Math.min(S.midi.beats - u, n.s + (oct ? 4 : u));
                if (k === 'ArrowUp' || k === 'ArrowDown') {
                    const dirn = k === 'ArrowUp' ? -1 : 1;
                    if (S.midi.inst === 'drums' && S.view === 'steps') {
                        // Séquenceur de pas : on ne passe que d'une piste de la grille à l'autre (pas de note « fantôme »)
                        const lanes = root.PulseSynth.DRUM_LANES.map(l => l.p);
                        const i = lanes.indexOf(n.p);
                        if (i >= 0) n.p = lanes[Math.max(0, Math.min(lanes.length - 1, i + dirn))];
                    } else if (oct) n.p = Math.max(0, Math.min(127, n.p - dirn * 12));
                    else n.p = S.rows[Math.max(0, Math.min(S.rows.length - 1, rowOf(n.p) + dirn))];
                }
            });
            const f = [...S.sel][0]; if (k === 'ArrowUp' || k === 'ArrowDown') audition(f.p, f.v);
            changed('nudge'); return;
        }
        // Jouer en direct pendant la lecture : la note est enregistrée au moment où on appuie
        if (!mod && !e.altKey && S.rec) {
            const kc = physKey(e);
            const lane = DRUMKEYS.indexOf(kc);
            const isDr = S.midi.inst === 'drums' || S.view === 'steps';
            const pitch = isDr ? (lane >= 0 && lane < stepRows().length ? stepRows()[lane].p : null) : (KEYMAP[kc] !== undefined ? 12 * (S.baseOct + 1) + KEYMAP[kc] : null);
            if (pitch !== null) {
                eat();
                if (e.repeat) return;
                playIn(kc, pitch, 100);
                return;
            }
        }
        // Clavier de l'ordinateur : jouer les notes (comme le clavier de Logic)
        if (!mod && !e.altKey && !e.repeat && S.midi.inst !== 'drums' && S.view === 'roll' && KEYMAP[physKey(e)] !== undefined) {
            eat();
            audition(12 * (S.baseOct + 1) + KEYMAP[physKey(e)], 100);
            return;
        }
        if (!mod && S.midi.inst !== 'drums' && (physKey(e) === 'z' || physKey(e) === 'x') && S.view === 'roll') {
            eat(); S.baseOct = Math.max(0, Math.min(8, S.baseOct + (physKey(e) === 'x' ? 1 : -1)));
            S.o.flash && S.o.flash(`Clavier de l'ordinateur : octave ${S.baseOct}`); return;
        }
    }

    function runTool(k) {
        const targets = S.sel.size ? [...S.sel] : S.notes.slice();
        if (!targets.length) { S.o.flash && S.o.flash('Il n\'y a pas encore de notes'); return; }
        snapshot();
        const u = unit(), rnd = (a) => (Math.random() * 2 - 1) * a;
        if (k === 'humanize') targets.forEach(n => { n.s = Math.max(0, Math.min(S.midi.beats - 0.01, n.s + rnd(0.025))); n.v = Math.max(20, Math.min(127, Math.round(n.v + rnd(12)))); });
        else if (k === 'randvel') targets.forEach(n => n.v = 60 + Math.round(Math.random() * 67));
        else if (k === 'reverse') targets.forEach(n => { n.s = Math.max(0, S.midi.beats - (n.s + n.d)); });
        else if (k === 'octup') targets.forEach(n => n.p = Math.min(127, n.p + 12));
        else if (k === 'octdown') targets.forEach(n => n.p = Math.max(0, n.p - 12));
        else if (k === 'legato') {
            const o = targets.slice().sort((a, b) => a.s - b.s || a.p - b.p);
            for (let i = 0; i < o.length; i++) {
                const nx = o.slice(i + 1).find(m => m.s > o[i].s + 1e-6);
                o[i].d = nx ? Math.max(0.05, nx.s - o[i].s) : Math.max(0.05, S.midi.beats - o[i].s);
            }
        } else if (k === 'double') {
            targets.forEach(n => { n.s /= 2; n.d = Math.max(0.0625, n.d / 2); });
            if (S.midi.beats > 4) { /* la longueur du motif ne change pas */ }
        } else if (k === 'arp') {
            const groups = new Map();
            targets.forEach(n => { const key = n.s.toFixed(3); (groups.get(key) || groups.set(key, []).get(key)).push(n); });
            const out = [];
            groups.forEach(g => {
                if (g.length < 2) { out.push(...g); return; }
                g.sort((a, b) => a.p - b.p);
                const len = Math.max(...g.map(n => n.d)), start = g[0].s, steps = Math.max(g.length, Math.round(len / u));
                for (let i = 0; i < steps; i++) { const src = g[i % g.length]; out.push({ s: start + i * u, d: u, p: src.p, v: src.v }); }
            });
            const gone = new Set(targets);
            S.notes = S.midi.notes = S.notes.filter(n => !gone.has(n)).concat(out);
            S.sel = new Set(out);
        }
        changed(k);
    }

    // ---------- Données ----------
    function snapshot() {
        S.undo.push(JSON.stringify({ m: S.midi, notes: S.notes }));
        if (S.undo.length > 100) S.undo.shift();
        S.redo.length = 0;
    }
    function restore(str) {
        const o = JSON.parse(str);
        const keep = S.midi.inst;
        S.midi = Object.assign({}, S.midi, { beats: o.m.beats, inst: o.m.inst, swing: o.m.swing || 0 }); S.notes = S.midi.notes = o.notes; S.sel.clear();
        changed('undo', true);
    }
    function undoEd() { if (!S.undo.length) { S.o.flash && S.o.flash('Rien à annuler dans cette région'); return; } S.redo.push(JSON.stringify({ m: S.midi, notes: S.notes })); restore(S.undo.pop()); }
    function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify({ m: S.midi, notes: S.notes })); restore(S.redo.pop()); }

    function changed(kind, noSnap) {
        if (kind === 'undo') S.hist = true;   // retour en arrière dans l'éditeur : pas une nouvelle étape pour le projet
        S.midi.notes = S.notes;
        S.dirty = true;
        syncBar(); draw();
        clearTimeout(S.t); S.t = setTimeout(flush, 350);
    }
    function flush() {
        if (!S || !S.dirty) return;
        clearTimeout(S.t); S.dirty = false;
        const fromHistory = !!S.hist; S.hist = false;
        S.o.onCommit(clone({ inst: S.midi.inst, beats: S.midi.beats, swing: S.midi.swing || 0, notes: S.notes.map(n => ({ s: n.s, d: n.d, p: n.p, v: n.v })) }), !S.committed, fromHistory);
        if (S) S.committed = true; // l'éditeur a pu se fermer pendant onCommit
    }

    function audition(p, v = 100) { if (S && S.o.onPreview) S.o.onPreview(S.midi.inst, p, v); }

    function startLoop() {
        clearInterval(timer);
        timer = setInterval(() => {
            if (!S) return;
            const b = S.o.getBeat ? S.o.getBeat() : null;
            if (b !== S.playBeat) { S.playBeat = b; draw(); }
        }, 50);
    }

    const api = { close, isOpen, flush, update(midi) { if (S) { S.midi = clone(midi); S.notes = S.midi.notes; S.sel.clear(); syncBar(); draw(); } }, setTitle(t) { if (el) el.querySelector('.me-title').textContent = t; } };
    // Annuler / refaire note par note, depuis l'extérieur (⌘Z avec l'éditeur ouvert) : renvoie true si quelque chose a bougé
    function undoNote() { if (!S || !S.undo.length) return false; undoEd(); return true; }
    function redoNote() { if (!S || !S.redo.length) return false; redo(); return true; }
    root.PulsePianoRoll = { open, close, isOpen, flush, undoNote, redoNote, PATTERNS, noteName, _state: () => S };
})(typeof window !== 'undefined' ? window : globalThis);
