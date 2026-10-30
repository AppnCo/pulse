// Nouvelle version (pulse://) : import puis vérification à l'octet près
(async()=>{ const inv=window.__TAURI__.core.invoke; const log=t=>inv('test_log',{text:t});
 try {
  document.body.innerHTML='<div id=m></div><div class=bar><i id=b></i></div><div id=d></div>';
  const done=await window.PulseMigrate.importAll(false);
  const db=await new Promise((r,j)=>{const q=indexedDB.open('pulse',2); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error);});
  const all=(st)=>new Promise((r,j)=>{const x=db.transaction(st).objectStore(st).getAll(); x.onsuccess=()=>r(x.result); x.onerror=()=>j(x.error);});
  const clips=await all('clips'), projects=await all('projects'); const sizes=[3e7,1e6,12345]; let ok=0;
  for (let i=0;i<3;i++){ const c=clips.find(x=>x.id==='c'+i); if(!c) continue; const u=new Uint8Array(await c.blob.arrayBuffer()); let good=u.length===sizes[i]&&c.blob.type==='audio/wav'&&c.kind==='import'&&c.savedAt===123; for(let k=0;k<u.length&&good;k+=101) if(u[k]!==(k*7+i)%256) good=false; if(good) ok++; }
  await log('transfert: fini='+done+' sons_identiques='+ok+'/3 secours='+!!clips.find(x=>x.id==='rescue_x_0')+' projets='+projects.length+' projet_courant='+JSON.parse(localStorage.getItem('pulse_current_project')||'{}').name+' session_copiée='+(localStorage.getItem('pulse_session')!==null)+' etat='+await inv('migration_state'));
 } catch(e){ await log('ERREUR import '+e); }
 await log('FIN'); await inv('test_exit'); })();
