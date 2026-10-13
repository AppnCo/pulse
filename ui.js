// Pulse — listes déroulantes maison : plus aucun menu « système » dans l'appli.
// Les <select> restent la source de vérité (value, change, input) : on remplace seulement l'affichage de la liste.
(function () {
    let menu = null, owner = null, items = [], cur = -1;

    function close() {
        if (!menu) return;
        menu.remove(); menu = null;
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('resize', close);
        window.removeEventListener('blur', close);
        owner = null; items = []; cur = -1;
    }

    function choose(i) {
        const it = items[i]; if (!it || it.disabled || !owner) return;
        const sel = owner;
        close();
        if (sel.selectedIndex !== it.index) {
            sel.selectedIndex = it.index;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        try { sel.focus({ preventScroll: true }); } catch {}
    }

    function highlight(i) {
        if (!menu) return;
        const els = menu.querySelectorAll('.pulse-menu-item');
        cur = i;
        els.forEach((e, k) => e.classList.toggle('hot', k === i));
        const el = els[i]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }

    function step(d) {
        if (!items.length) return;
        let i = cur;
        for (let n = 0; n < items.length; n++) {
            i = (i + d + items.length) % items.length;
            if (!items[i].disabled) break;
        }
        highlight(i);
    }

    function onKey(e) {
        if (!menu) return;
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); step(1); return; }
        if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); step(-1); return; }
        if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); choose(cur); return; }
        e.stopPropagation();
    }

    function onOutside(e) {
        if (menu && !menu.contains(e.target)) { if (!(owner && owner.contains(e.target))) close(); }
    }

    function open(sel) {
        close();
        owner = sel;
        menu = document.createElement('div');
        menu.className = 'pulse-menu';
        menu.setAttribute('role', 'listbox');
        const opts = [...sel.querySelectorAll('option')];
        let lastGroup = null;
        opts.forEach((o) => {
            const g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement : null;
            if (g && g !== lastGroup) {
                const h = document.createElement('div'); h.className = 'pulse-menu-group'; h.textContent = g.label || ''; menu.appendChild(h);
            }
            lastGroup = g;
            const i = items.length;
            const d = document.createElement('div');
            d.className = 'pulse-menu-item' + (o.selected ? ' on' : '') + (o.disabled || (g && g.disabled) ? ' off' : '');
            d.textContent = o.textContent;
            d.setAttribute('role', 'option');
            d.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); choose(i); });
            d.addEventListener('mouseenter', () => highlight(i));
            menu.appendChild(d);
            items.push({ index: o.index, disabled: o.disabled || (g && g.disabled) });
        });
        // Le menu doit survivre à un clic « hors panneau » : il est fermé seulement par nos propres règles
        menu.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
        document.body.appendChild(menu);
        const r = sel.getBoundingClientRect();
        menu.style.minWidth = Math.max(r.width, 120) + 'px';
        const mh = menu.offsetHeight, below = window.innerHeight - r.bottom - 8, above = r.top - 8;
        const top = (mh <= below || below >= above) ? r.bottom + 4 : Math.max(8, r.top - mh - 4);
        menu.style.maxHeight = Math.max(120, (top === r.bottom + 4 ? below : above)) + 'px';
        menu.style.top = top + 'px';
        menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
        const start = Math.max(0, items.findIndex(it => it.index === sel.selectedIndex));
        highlight(start);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onOutside, true);
        window.addEventListener('resize', close);
        window.addEventListener('blur', close);
    }

    document.addEventListener('mousedown', (e) => {
        const sel = e.target && e.target.closest && e.target.closest('select');
        if (!sel || sel.disabled || sel.multiple || sel.size > 1) return;
        if (e.button !== 0) return;
        e.preventDefault();
        if (menu && owner === sel) { close(); return; }
        try { sel.focus({ preventScroll: true }); } catch {}
        open(sel);
    }, true);

    // Au clavier, sur une liste qui a le focus : Entrée / Espace / flèche bas ouvrent la liste Pulse
    document.addEventListener('keydown', (e) => {
        if (menu) return;
        const sel = document.activeElement;
        if (!sel || sel.tagName !== 'SELECT' || sel.multiple || sel.size > 1) return;
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault(); e.stopPropagation(); open(sel);
        }
    }, true);

    // Pas de menu « Recharger / Inspecter » du système : les clics droits sont ceux de Pulse (sauf dans les champs de texte : copier / coller)
    document.addEventListener('contextmenu', (e) => {
        if (e.target && e.target.closest && e.target.closest('input[type="text"], input[type="number"], input[type="url"], input:not([type]), textarea, [contenteditable="true"]')) return;
        e.preventDefault();
    });

    // Appli de bureau : barre de titre fondue dans l'interface (les boutons de la fenêtre flottent sur la barre du haut)
    if (window.__TAURI__) {
        document.documentElement.classList.add('is-app');
        const drag = () => {
            const tb = document.querySelectorAll('.topbar');
            tb.forEach(e => e.setAttribute('data-tauri-drag-region', ''));
            if (!tb.length) {   // accueil : une bande invisible en haut pour déplacer la fenêtre
                const d = document.createElement('div');
                d.setAttribute('data-tauri-drag-region', '');
                d.style.cssText = 'position:fixed;top:0;left:0;right:0;height:30px;z-index:50';
                document.body.appendChild(d);
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drag); else drag();
    }

    // Fenêtres d'effets (EQ, compresseur, envois…) : une poignée en bas à droite pour les agrandir / réduire (taille retenue par type)
    const grip = (panel) => {
        if (panel.querySelector('.fx-grip')) return;
        const kind = [...panel.classList].find(c => c !== 'fx-panel' && c !== 'sound-panel') || 'fx';
        const key = 'pulse_fxw_' + kind;
        const g = document.createElement('div');
        g.className = 'fx-grip';
        g.setAttribute('data-tooltip', 'Tire pour agrandir ou réduire (double-clic : taille normale)');
        panel.appendChild(g);
        panel.dataset.baseW = String(panel.offsetWidth);
        try { const w = parseInt(localStorage.getItem(key)); if (w) { panel.style.width = w + 'px'; keepOnScreen(panel); } } catch {}
        g.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.detail >= 2) { panel.style.width = ''; try { localStorage.removeItem(key); } catch {} return; }
            const x0 = e.clientX, w0 = panel.offsetWidth;
            const mv = (ev) => { panel.style.width = Math.round(Math.max(Math.min(240, w0), Math.min(window.innerWidth - 24, w0 + ev.clientX - x0))) + 'px'; };
            const up = () => {
                document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
                try { localStorage.setItem(key, String(panel.offsetWidth)); } catch {}
                keepOnScreen(panel);
            };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
    };
    const keepOnScreen = (panel) => {
        const r = panel.getBoundingClientRect();
        if (r.right > window.innerWidth - 8) panel.style.left = Math.max(8, window.innerWidth - 8 - r.width) + 'px';
    };
    new MutationObserver((muts) => {
        for (const m of muts) m.addedNodes.forEach(n => {
            if (n.nodeType === 1 && n.classList && n.classList.contains('fx-panel')) requestAnimationFrame(() => grip(n));
        });
    }).observe(document.body, { childList: true });

    window.PulseUI = { closeMenu: close };
})();
