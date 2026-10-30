// Ancienne version (page sur appnco.app) : 1 projet, 3 sons (dont 30 Mo) + 1 son de secours, puis export
(async()=>{ const inv=window.__TAURI__.core.invoke; const log=t=>inv('test_log',{text:t});
 try {
  localStorage.clear(); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mig1',name:'Projet migré',tracks:[{name:'Voix',clips:[{id:'c0'},{id:'c1'},{id:'c2'}]}]}));
  localStorage.setItem('pulse_alive', String(Date.now())); localStorage.setItem('pulse_session','{"open":true}');
  const db=await new Promise((r,j)=>{const q=indexedDB.open('pulse',2); q.onupgradeneeded=()=>{const d=q.result; d.createObjectStore('clips',{keyPath:'id'}); d.createObjectStore('projects',{keyPath:'id'});}; q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error);});
  const put=(st,v)=>new Promise((r,j)=>{const x=db.transaction(st,'readwrite').objectStore(st).put(v); x.onsuccess=r; x.onerror=()=>j(x.error);});
  const sizes=[3e7,1e6,12345];
  for (let i=0;i<3;i++){ const u=new Uint8Array(sizes[i]); for(let k=0;k<u.length;k+=101) u[k]=(k*7+i)%256; await put('clips',{id:'c'+i,blob:new Blob([u],{type:'audio/wav'}),mime:'audio/wav',savedAt:123,kind:'import'}); }
  await put('clips',{id:'rescue_x_0',blob:new Blob([new Uint8Array(4000)]),savedAt:5});
  await put('projects',{id:'mig1',name:'Projet migré',tracks:[]});
  document.body.innerHTML='<div id=m></div><div class=bar><i id=b></i></div><div id=d></div>';
  const t0=performance.now(); await window.PulseMigrate.exportAll(false); await log('export: '+Math.round(performance.now()-t0)+' ms');
 } catch(e){ await log('ERREUR export '+e); }
 await log('FIN'); await inv('test_exit'); })();
