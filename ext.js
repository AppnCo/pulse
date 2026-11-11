// Plugins externes (VST3 : FabFilter, Waves, Soundtoys…) dans l'appli de bureau.
// Un plugin externe posé sur une piste = un effet « vst#xxxx » ; effectParams[id] = { path, name, vendor, state }.
// Le son passe par le moteur natif (Rust), qui garde chaque instance vivante ; sa vraie fenêtre s'ouvre par l'appli.
// Dans un navigateur : rien n'est disponible, un plugin externe d'un projet laisse simplement passer le son.
window.PulseExt = (function () {
    const core = () => window.__TAURI__ && window.__TAURI__.core;
    const available = () => !!(core() && core().invoke);
    const HIDE_KEY = 'pulse_ext_hidden';
    let list = null, scanning = null;
    const names = {};   // id → nom affiché (rempli à l'ajout et à l'ouverture d'un projet)
    const loaded = new Set();   // instances créées dans l'appli pendant cette séance

    const isExt = (id) => String(id).split('#')[0] === 'vst';
    function hidden() { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch { return new Set(); } }
    function setHidden(set) { try { localStorage.setItem(HIDE_KEY, JSON.stringify([...set])); } catch {} }
    const keyOf = (p) => p.path + '|' + p.name;

    // Liste des plugins installés (recherche la première fois, puis gardée par l'appli)
    async function scan(force = false) {
        if (!available()) return [];
        if (list && !force) return list;
        if (scanning) return scanning;
        scanning = core().invoke('ext_scan', { force }).then(async l => { list = l || []; await loadBad(); return list; }).finally(() => { scanning = null; });
        return scanning;
    }
    // Plugins à montrer dans le menu « + Effet » : sans ceux que l'utilisateur a décochés (licence expirée, doublons…)
    // Plugins mis de côté par la vérification (plantent ou restent bloqués au chargement — licence iLok absente de cet ordi, par exemple) :
    // ils ne sont plus proposés dans le menu ; le gestionnaire les montre avec leur étiquette, « Rechercher à nouveau » les revérifie.
    let bad = {};
    async function loadBad() { try { bad = (await core().invoke('ext_verdicts')) || {}; } catch { bad = {}; } }
    const isBad = (p) => !!(bad[p.path] && bad[p.path] !== 'ok');
    function visible() { const h = hidden(); return (list || []).filter(p => !p.instrument && !h.has(keyOf(p)) && !isBad(p)); }
    // Instruments externes (synthés, pianos, samplers) à proposer pour les pistes de notes
    function instruments() { const h = hidden(); return (list || []).filter(p => p.instrument && !h.has(keyOf(p)) && !isBad(p)); }

    function nameOf(id, owner) {
        let p = owner && owner.effectParams && owner.effectParams[id];
        if (!p && !names[id] && typeof state !== 'undefined' && state.project) { const hit = allExt(state.project).find(([, i]) => i === id); if (hit) p = (hit[0].effectParams || {})[id]; }
        return (p && p.name) || names[id] || 'Plugin externe';
    }
    function allExt(project) {
        const out = [];
        const scanO = (o) => [...(o.effects || []), ...(o.fxOff || [])].forEach(id => { if (isExt(id)) out.push([o, id]); });
        (project.tracks || []).forEach(t => { scanO(t); (t.clips || []).forEach(c => c.fx && scanO(c.fx)); });
        (project.buses || []).forEach(scanO);
        return out;
    }
    // une piste gelée est déjà pré-calculée : son plugin ne tourne plus (ni moteur natif imposé, ni chargement)
    const has = (project) => allExt(project).some(([o]) => !o.frozen);

    // Crée dans l'appli toutes les instances du projet (avec leurs réglages) : à l'ouverture et avant la lecture
    async function ensure(project) {
        if (!available()) return;
        // même plugin sur deux pistes (piste dupliquée, réglages collés…) : chaque copie reçoit sa propre instance,
        // avec les mêmes réglages (sinon les deux pistes passeraient dans le même plugin et le son serait faux)
        const seen = new Set();
        for (const [o, id] of allExt(project)) {
            if (!seen.has(id)) { seen.add(id); continue; }
            const nid = newId(), p = (o.effectParams || {})[id];
            const sw = (arr) => Array.isArray(arr) ? arr.map(x => x === id ? nid : x) : arr;
            o.effects = sw(o.effects); o.fxOff = sw(o.fxOff); o.fxOrder = sw(o.fxOrder);
            if (p) { o.effectParams[nid] = JSON.parse(JSON.stringify(p)); delete o.effectParams[id]; }
            if (loaded.has(id)) { try { const st = await core().invoke('ext_state', { id }); if (st && o.effectParams[nid]) o.effectParams[nid].state = st; } catch {} }
            seen.add(nid);
        }
        const jobs = [];
        for (const [o, id] of allExt(project)) {
            const p = (o.effectParams || {})[id]; if (!p || !p.path) continue;
            names[id] = p.name || names[id];
            if (loaded.has(id)) continue;
            jobs.push(core().invoke('ext_create', { id, path: p.path, state: p.state || null })
                .then(r => { loaded.add(id); if (r && r.latency) p.latency = r.latency; })
                .catch(err => flashSafe(`« ${p.name || 'Plugin'} » n'a pas pu s'ouvrir : ${err}`)));
        }
        // instruments externes des pistes de notes
        // même instrument sur deux pistes (piste dupliquée) : la copie reçoit sa propre instance, avec les mêmes réglages
        const seenI = new Set();
        for (const t of (project.tracks || [])) {
            const x = t.extInst; if (!x || !x.path) continue;
            if (!seenI.has(x.id)) { seenI.add(x.id); continue; }
            const old = x.id, nid = newId(), nx = { ...x, id: nid };
            if (loaded.has(old)) { try { const st = await core().invoke('ext_state', { id: old }); if (st) nx.state = st; } catch {} }
            t.extInst = nx; seenI.add(nid);
            if (t.midiInst === 'ext:' + old) t.midiInst = 'ext:' + nid;
            for (const c of (t.clips || [])) if (c.midi && c.midi.inst === 'ext:' + old) c.midi.inst = 'ext:' + nid;
        }
        for (const t of (project.tracks || [])) {
            const x = t.extInst; if (!x || !x.path) continue;
            names[x.id] = x.name || names[x.id];
            if (loaded.has(x.id)) continue;
            jobs.push(core().invoke('ext_create', { id: x.id, path: x.path, state: x.state || null, instrument: true })
                .then(() => { loaded.add(x.id); })
                .catch(err => flashSafe(`L'instrument « ${x.name || 'externe'} » n'a pas pu s'ouvrir : ${err}`)));
        }
        await Promise.all(jobs);
    }
    // === Instruments externes ===
    // Une piste de notes garde son instrument dans track.extInst { id, path, name, vendor, state } ; ses régions portent
    // midi.inst = 'ext:<id>'. Le son d'une région est calculé par l'instrument (hors temps réel) puis traité comme une prise.
    const instOf = (midi) => (midi && typeof midi.inst === 'string' && midi.inst.startsWith('ext:')) ? midi.inst.slice(4) : null;
    async function addInstrument(track, info, quiet = false) {   // quiet : sans ouvrir la fenêtre (tests)
        if (!available() || !info) return null;
        if (track.extInst && track.extInst.path === info.path && loaded.has(track.extInst.id)) { openEditor(track.extInst.id); return track.extInst.id; }
        const id = newId();
        names[id] = info.name;
        try { await core().invoke('ext_create', { id, path: info.path, state: null, instrument: true }); loaded.add(id); }
        catch (err) { flashSafe(`« ${info.name} » n'a pas pu s'ouvrir : ${err}`); loadBad(); return null; }
        track.extInst = { id, path: info.path, name: info.name, vendor: info.vendor };
        if (!quiet) openEditor(id);
        return id;
    }
    // Notes d'une région (temps en noires) → son stéréo calculé par l'instrument. Renvoie un AudioBuffer, ou null.
    async function renderNotes(midi, bpm, seconds) {
        const id = instOf(midi); if (!id || !available()) return null;
        if (!loaded.has(id) && typeof state !== 'undefined' && state.project) await ensure(state.project);
        if (!loaded.has(id)) return null;
        const spb = 60 / bpm, swing = Math.max(0, Math.min(1, midi.swing || 0));
        const notes = (midi.notes || []).slice(0, 4000).map(n => {
            let st = n.s; if (swing > 0) { const k = Math.round(st * 4); if (k % 2 === 1 && Math.abs(st * 4 - k) < 0.02) st += swing * (1 / 12); }
            return { t: st * spb, d: Math.max(0.02, n.d * spb), p: Math.max(0, Math.min(127, Math.round(n.p))), v: Math.max(1, Math.min(127, Math.round(n.v || 100))) };
        });
        const raw = await core().invoke('ext_render_notes', { id, notes, seconds: Math.max(0.05, seconds || (midi.beats || 4) * spb) });
        const buf = raw instanceof ArrayBuffer ? raw : (raw && raw.buffer) ? raw.buffer.slice(raw.byteOffset || 0, (raw.byteOffset || 0) + raw.byteLength) : new Uint8Array(raw).buffer;
        const dv = new DataView(buf), rate = dv.getUint32(0, true), n = dv.getUint32(4, true);
        if (!n) return null;
        const out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: rate });
        out.copyToChannel(new Float32Array(buf, 8, n), 0);
        out.copyToChannel(new Float32Array(buf, 8 + 4 * n, n), 1);
        return out;
    }
    // Range les réglages actuels de chaque plugin dans le projet (avant d'enregistrer le fichier)
    async function saveStates(project) {
        if (!available()) return;
        for (const t of (project.tracks || [])) {   // instruments externes des pistes de notes
            const x = t.extInst; if (!x || !loaded.has(x.id)) continue;
            try { const st = await core().invoke('ext_state', { id: x.id }); if (st) x.state = st; } catch {}
        }
        for (const [o, id] of allExt(project)) {
            if (!loaded.has(id)) continue;
            try { const st = await core().invoke('ext_state', { id }); if (st) { o.effectParams[id].state = st; } } catch {}
        }
    }
    // === Automation des plugins externes ===
    // Réglages du plugin (n° → nom, valeur 0..1) ; réglages touchés récemment dans sa fenêtre (les plus récents d'abord)
    const paramCache = {}, touched = {};
    async function loadParams(id) {
        if (!available()) return;
        try { const l = await core().invoke('ext_params', { id }); paramCache[id] = new Map(l.map(p => [p.id, { name: p.name, value: p.value }])); } catch {}
    }
    const paramName = (id, pid) => { const p = paramCache[id] && paramCache[id].get(pid); if (!p && !paramCache[id]) loadParams(id); return p ? p.name : null; };
    const paramValue = (id, pid) => { const p = paramCache[id] && paramCache[id].get(pid); return p ? p.value : 0.5; };
    // réglages proposés dans le menu des courbes : déjà automatisés + touchés récemment (713 réglages dans un Pro-Q : on ne les liste pas tous)
    function autoPids(o, id) {
        const pre = 'fx:' + id + ':';
        const used = Object.keys(o.automation || {}).filter(k => k.startsWith(pre)).map(k => +k.slice(pre.length));
        // peu de réglages (Audio Unit, petit plugin) : on les propose tous
        if (!paramCache[id]) loadParams(id);
        const all = paramCache[id] && paramCache[id].size <= 80 ? [...paramCache[id].keys()] : [];
        return [...new Set([...used, ...(touched[id] || []), ...all])];
    }
    // En mode automation (A) : toucher un bouton dans la fenêtre du plugin affiche sa courbe et l'écriture suit le geste
    function ownerOf(id) { const hit = (typeof state !== 'undefined' && state.project) ? allExt(state.project).find(([, i]) => i === id) : null; return hit ? hit[0] : null; }
    if (available()) setInterval(async () => {
        if (typeof state === 'undefined' || !state.project || !state.automationMode) return;
        for (const id of loaded) {
            let ed; try { ed = await core().invoke('ext_edits', { id }); } catch { continue; }
            if (!ed || !ed.length) continue;
            if (!paramCache[id]) await loadParams(id);
            const o = ownerOf(id); if (!o) continue;
            for (const [pid, v] of ed) {
                // réglage qui bouge parce que sa courbe joue (Audio Unit : valeurs comparées) : ce n'est pas un geste
                if (state.playing && o.automation && o.automation['fx:' + id + ':' + pid] && !/^\//.test((o.effectParams[id] || {}).path || '') && String((o.effectParams[id] || {}).path || '').startsWith('au:')) continue;
                const c = paramCache[id] && paramCache[id].get(pid); if (c) c.value = v;
                touched[id] = [pid, ...(touched[id] || []).filter(x => x !== pid)].slice(0, 12);
                if (typeof autoTouch === 'function') autoTouch(o, 'fx:' + id + ':' + pid);
            }
        }
    }, 200);
    function newId() { return 'vst#' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    // Pose un plugin externe sur une piste / un groupe (à la fin de sa chaîne) puis ouvre sa fenêtre
    async function add(x, info) {
        const id = newId();
        names[id] = info.name;
        try { await core().invoke('ext_create', { id, path: info.path, state: null }); loaded.add(id); }
        catch (err) { flashSafe(`« ${info.name} » n'a pas pu s'ouvrir : ${err}`); loadBad(); return null; }
        x.effects = x.effects || [];
        x.effectParams = x.effectParams || {};
        x.effectParams[id] = { path: info.path, name: info.name, vendor: info.vendor };
        const chain = typeof chainOf === 'function' ? chainOf(x) : [...x.effects];
        x.effects.push(id);
        if (typeof FX_ORDER !== 'undefined') x.fxOrder = [...chain, id, ...FX_ORDER.filter(k => !chain.includes(k))];
        openEditor(id);
        return id;
    }
    async function openEditor(id, toggle) {
        if (!available()) { flashSafe('Les plugins externes s\'ouvrent dans l\'appli Pulse (pas dans le navigateur)'); return; }
        // projet rouvert : le plugin n'est peut-être pas encore chargé (il l'est d'habitude au lancement de la lecture)
        if (!loaded.has(id) && typeof state !== 'undefined' && state.project) await ensure(state.project);
        core().invoke('ext_editor', { id, title: nameOf(id), toggle: !!toggle }).catch(err => flashSafe('Fenêtre du plugin : ' + err));
    }
    function flashSafe(m) { if (typeof flash === 'function') flash(m); else console.warn(m); }

    // Gestionnaire (comme celui de Logic) : cocher / décocher les plugins à montrer, relancer la recherche
    async function openManager() {
        if (!available()) return;
        document.querySelectorAll('.ext-manager').forEach(m => m.remove());
        const box = document.createElement('div');
        box.className = 'ext-manager';
        box.innerHTML = `<div class="ext-man-card"><div class="ext-man-head"><b>Plugins externes</b><span class="ext-man-hint">Décoche ceux que tu n'as plus (licence) : ils disparaissent du menu.</span><button class="ext-man-rescan">Rechercher à nouveau</button><button class="ext-man-close">×</button></div><div class="ext-man-list">Recherche des plugins…</div></div>`;
        document.body.appendChild(box);
        const close = () => box.remove();
        box.querySelector('.ext-man-close').addEventListener('click', close);
        box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
        const fill = async (force) => {
            const el = box.querySelector('.ext-man-list');
            el.textContent = 'Recherche des plugins…';
            // une marque = un seul titre, même écrite autrement selon le format (« antares » / « Antares »)
            const vKey = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const l = (await scan(force).catch(() => [])).slice().sort((a, b) => vKey(a.vendor).localeCompare(vKey(b.vendor)) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
            const nice = {}; l.forEach(p => { const k = vKey(p.vendor), c = nice[k]; if (!c || (/[A-Z]/.test(p.vendor || '') && !/[A-Z]/.test(c)) || (/\s/.test(p.vendor || '') && !/\s/.test(c))) nice[k] = p.vendor; });
            const h = hidden();
            // plugins mis de côté par la vérification (ils plantent ou restent bloqués au chargement)
            const bad = await core().invoke('ext_verdicts').catch(() => ({}));
            el.innerHTML = '';
            if (!l.length) { el.textContent = 'Aucun plugin VST3 trouvé.'; return; }
            let vendor = null;
            l.forEach(p => {
                if (vKey(p.vendor) !== vendor) { vendor = vKey(p.vendor); const v = document.createElement('div'); v.className = 'ext-man-vendor'; v.textContent = nice[vendor] || 'Autres'; el.appendChild(v); }
                const row = document.createElement('label'); row.className = 'ext-man-row';
                row.innerHTML = `<input type="checkbox" ${h.has(keyOf(p)) ? '' : 'checked'}><span></span>`;
                row.querySelector('span').textContent = p.name;
                const vd = bad && bad[p.path];
                if (vd && vd !== 'ok') { const t = document.createElement('em'); t.className = 'ext-man-bad'; t.style.cssText = 'margin-left:8px;font-style:normal;font-size:11px;color:#FBBF24'; t.textContent = vd === 'bloque' ? '⚠ mis de côté : reste bloqué au chargement' : '⚠ mis de côté : plante au chargement'; t.title = '« Rechercher à nouveau » lui redonne sa chance (après une mise à jour ou une activation de licence)'; row.appendChild(t); }
                row.querySelector('input').addEventListener('change', (e) => { const s = hidden(); if (e.target.checked) s.delete(keyOf(p)); else s.add(keyOf(p)); setHidden(s); });
                el.appendChild(row);
            });
        };
        box.querySelector('.ext-man-rescan').addEventListener('click', () => fill(true));
        fill(false);
    }

    // Dans l'appli : liste des plugins prête avant le premier « + Effet », et réglages des plugins rangés
    // dans le projet toutes les 20 s (ils survivent ainsi à une fermeture sans enregistrer)
    if (available()) {
        // nouvelle version de la recherche (Audio Units ajoutées le 08/11) : on refait la liste une fois
        const SV = 'pulse_ext_scan_v', v = 3;   // 3 : instruments ajoutés à la liste (10/11)
        setTimeout(() => { let force = false; try { force = +localStorage.getItem(SV) !== v; localStorage.setItem(SV, String(v)); } catch {} scan(force).catch(() => {}); }, 2500);
        setInterval(() => {
            if (typeof state === 'undefined' || !state.project || !has(state.project)) return;
            saveStates(state.project).then(() => { if (typeof saveProject === 'function') saveProject(); }).catch(() => {});
        }, 20000);
        // latence d'un plugin changée dans sa fenêtre (EQ en phase linéaire…) : notée dans le projet → le mix se recale
        setInterval(async () => {
            if (typeof state === 'undefined' || !state.project || !state.playing || !has(state.project)) return;
            let lat; try { lat = await core().invoke('ext_latencies'); } catch { return; }
            let changed = false;
            for (const [o, id] of allExt(state.project)) { const p = (o.effectParams || {})[id]; if (p && lat[id] !== undefined && (p.latency || 0) !== lat[id]) { p.latency = lat[id]; changed = true; } }
            if (changed && typeof refreshPlaybackSoon === 'function') refreshPlaybackSoon();
        }, 1500);
    }
    return { available, scan, visible, instruments, instOf, addInstrument, renderNotes, nameOf, has, isExt, ensure, saveStates, add, openEditor, openManager, names, paramName, paramValue, autoPids, loadParams };
})();
