// Contrôle visuel (ne se lance pas seul) : textes coupés sans « … », textes recouverts par un autre élément,
// menus / fenêtres qui sortent de l'écran. Renvoie une liste de défauts lisibles + capture d'écran.
export const DETECT = `(()=>{
  const out = [], W = innerWidth, H = innerHeight;
  const vis = (e) => { const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const name = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const c = [...e.classList].slice(0, 2).join('.'); if (c) s += '.' + c; const p = e.parentElement; if (p && !e.id) { const pc = [...p.classList].slice(0, 1).join('.'); if (pc) s = p.tagName.toLowerCase() + '.' + pc + ' > ' + s; } return s; };
  const seen = new Set();
  const add = (k, e, txt, info) => { const key = k + name(e) + txt; if (seen.has(key)) return; seen.add(key); out.push(k + ' | ' + name(e) + ' | « ' + txt.slice(0, 40) + ' »' + (info ? ' | ' + info : '')); };
  const all = document.querySelectorAll('body *');
  for (const e of all) {
    if (['SCRIPT','STYLE','SVG','PATH','CANVAS','OPTION','INPUT','TEXTAREA','SELECT'].includes(e.tagName.toUpperCase())) continue;
    const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own || !vis(e)) continue;
    // 0. émoji affiché (doit être une icône Pulse dessinée, pas un émoji du système)
    if (/[\u{1F300}-\u{1FAFF}\u2600-\u26FF\u2702\u2B06\u23F1\u23FA\u23EA]/u.test(own) && !e.closest('kbd')) add('ÉMOJI', e, own);
    const r = e.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
    const s = getComputedStyle(e);
    // 1. texte coupé : le texte sort de la boîte qui le rogne (sans « … »), ou déborde de sa case
    const tn0 = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    const rg0 = document.createRange(); rg0.selectNodeContents(tn0); const t0 = rg0.getBoundingClientRect();
    let clip = null; for (let a = e; a && a !== document.body; a = a.parentElement) { const as = getComputedStyle(a); if (as.overflowX !== 'visible' || as.overflowY !== 'visible') { clip = a; break; } }
    if (clip && t0.width > 0) { const cr = clip.getBoundingClientRect(); const ell = getComputedStyle(clip).textOverflow === 'ellipsis' || s.textOverflow === 'ellipsis';
      if (!ell && (t0.right > cr.right + 1.5 || t0.left < cr.left - 1.5) && clip.scrollWidth <= clip.clientWidth + 2) add('COUPÉ', e, own, 'texte ' + Math.round(t0.left) + '→' + Math.round(t0.right) + ' dans ' + name(clip) + ' ' + Math.round(cr.left) + '→' + Math.round(cr.right));
      if (!ell && (t0.bottom > cr.bottom + 2 || t0.top < cr.top - 2) && clip.scrollHeight <= clip.clientHeight + 2 && t0.top < cr.bottom && t0.bottom > cr.top) add('COUPÉ HAUT/BAS', e, own, 'dans ' + name(clip)); }
    if (t0.width > 0 && /^(BUTTON|A)$/.test(e.tagName) && rg0.getClientRects().length > 1 && s.textOverflow !== 'ellipsis' && !e.closest('.ctx-item,.help,.modal-body')) add('SUR 2 LIGNES', e, own, Math.round(r.width) + ' px de large');
    if (t0.width > 0 && s.textOverflow !== 'ellipsis' && s.display !== 'inline' && (t0.right > r.right + 3 || t0.left < r.left - 3)) add('DÉBORDE', e, own, 'texte ' + Math.round(t0.width) + ' px, case ' + Math.round(r.width) + ' px');
    // 2. texte qui sort de l'écran
    if (t0.right > W + 1 || (t0.left < -1 && t0.width)) add('HORS ÉCRAN', e, own, Math.round(t0.left) + '→' + Math.round(t0.right));
    // 3. texte recouvert par un autre élément (on sonde le début, le milieu et la fin du texte)
    const tn = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); if (!tn) continue;
    const rg = document.createRange(); rg.selectNodeContents(tn); const tr = rg.getBoundingClientRect();
    if (tr.width < 4) continue;
    const vr = { l: Math.max(tr.left, r.left), r: Math.min(tr.right, r.right) };
    const y = tr.top + tr.height / 2; if (y < 0 || y > H) continue;
    for (const fx of [0.08, 0.5, 0.92]) {
      const x = vr.l + (vr.r - vr.l) * fx; if (x < 0 || x > W) continue;
      const t = document.elementFromPoint(x, y);
      if (!t || t === e || e.contains(t) || t.contains(e)) continue;
      if (t.closest('.db-tip,.tooltip,[class*=tooltip],.flash,.toast')) continue;
      if (e.closest('#flash')) continue;
      { const FL = '.fx-panel,.track-ctx-menu,.ctx-subpanel,[class*=modal],[class*=overlay],.plug-win,.pianoroll,.midi-editor'; const lt = t.closest(FL); if (lt && lt !== e.closest(FL)) continue; }
      if (t.closest('svg') && t.closest('svg') === e.closest('svg')) continue;
      { const ts0 = getComputedStyle(t); const bg = ts0.backgroundColor; const plain = (!bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg)) && ts0.backgroundImage === 'none' && !ts0.borderTopWidth.startsWith('1') && ![...t.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !['svg','img','canvas','rect','path'].includes(t.tagName.toLowerCase()); if (plain) continue; }
      const ts = getComputedStyle(t); if (ts.pointerEvents === 'none') continue;
      add('RECOUVERT', e, own, 'par ' + name(t) + ' (' + Math.round(fx * 100) + ' %)'); break;
    }
  }
  // 4. menus et fenêtres flottantes hors de l'écran
  document.querySelectorAll('.track-ctx-menu,.ctx-subpanel,.fx-panel,[class*=-panel]:not([class*=spacer]):not(aside),[class*=modal]').forEach(m => { if (!vis(m)) return; const r = m.getBoundingClientRect(); if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1) out.push('FENÊTRE HORS ÉCRAN | ' + name(m) + ' | ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',')); });
  return out;
})()`;
export async function look(c, label, dir) {
  const issues = JSON.parse(await c.ev('JSON.stringify(' + DETECT + ')'));
  const f = dir + '/' + label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.jpg';
  const r = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); (await import('fs')).writeFileSync(f, Buffer.from(r.data || r.result?.data || '', 'base64'));
  console.log('### ' + label + ' — ' + issues.length + ' défaut(s)' + (issues.length ? '\n    ' + issues.join('\n    ') : ''));
  return issues;
}
