// Vide le stockage de la page (stockage du build de test, jamais celui de l'utilisateur)
(async()=>{ const inv=window.__TAURI__.core.invoke; const log=t=>inv('test_log',{text:t});
  try { localStorage.clear(); for (const d of await indexedDB.databases()) await new Promise(r=>{ const q=indexedDB.deleteDatabase(d.name); q.onsuccess=q.onerror=q.onblocked=()=>r(); }); await log('nettoyé '+location.host); } catch(e){ await log('ERREUR nettoyage '+e); }
  await log('FIN'); await inv('test_exit'); })();
