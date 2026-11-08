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
        scanning = core().invoke('ext_scan', { force }).then(l => { list = l || []; return list; }).finally(() => { scanning = null; });
        return scanning;
    }
    // Plugins à montrer dans le menu « + Effet » : sans ceux que l'utilisateur a décochés (licence expirée, doublons…)
    function visible() { const h = hidden(); return (list || []).filter(p => !h.has(keyOf(p))); }

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
        await Promise.all(jobs);
    }
    // Range les réglages actuels de chaque plugin dans le projet (avant d'enregistrer le fichier)
    async function saveStates(project) {
        if (!available()) return;
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
        return [...new Set([...used, ...(touched[id] || [])])];
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
        catch (err) { flashSafe(`« ${info.name} » n'a pas pu s'ouvrir : ${err}`); return null; }
        x.effects = x.effects || [];
        x.effectParams = x.effectParams || {};
        x.effectParams[id] = { path: info.path, name: info.name, vendor: info.vendor };
        const chain = typeof chainOf === 'function' ? chainOf(x) : [...x.effects];
        x.effects.push(id);
        if (typeof FX_ORDER !== 'undefined') x.fxOrder = [...chain, id, ...FX_ORDER.filter(k => !chain.includes(k))];
        openEditor(id);
        return id;
    }
    async function openEditor(id) {
        if (!available()) { flashSafe('Les plugins externes s\'ouvrent dans l\'appli Pulse (pas dans le navigateur)'); return; }
        // projet rouvert : le plugin n'est peut-être pas encore chargé (il l'est d'habitude au lancement de la lecture)
        if (!loaded.has(id) && typeof state !== 'undefined' && state.project) await ensure(state.project);
        core().invoke('ext_editor', { id }).catch(err => flashSafe('Fenêtre du plugin : ' + err));
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
            const l = await scan(force).catch(() => []);
            const h = hidden();
            el.innerHTML = '';
            if (!l.length) { el.textContent = 'Aucun plugin VST3 trouvé.'; return; }
            let vendor = null;
            l.forEach(p => {
                if (p.vendor !== vendor) { vendor = p.vendor; const v = document.createElement('div'); v.className = 'ext-man-vendor'; v.textContent = vendor || 'Autres'; el.appendChild(v); }
                const row = document.createElement('label'); row.className = 'ext-man-row';
                row.innerHTML = `<input type="checkbox" ${h.has(keyOf(p)) ? '' : 'checked'}><span></span>`;
                row.querySelector('span').textContent = p.name;
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
        setTimeout(() => scan(false).catch(() => {}), 2500);
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
    return { available, scan, visible, nameOf, has, isExt, ensure, saveStates, add, openEditor, openManager, names, paramName, paramValue, autoPids, loadParams };
})();
