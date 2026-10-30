// Mise à jour depuis un faux site local (PULSE_WEB_BASE) : 1 fichier changé, puis « à jour », puis page servie = nouvelle
(async()=>{ const inv=window.__TAURI__.core.invoke; const log=t=>inv('test_log',{text:t});
 try { const a=await inv('web_update'); const b=await inv('web_update'); const html=await (await fetch(location.origin.startsWith('pulse')?'pulse://localhost/studio.html':'/studio.html',{cache:'no-store'})).text();
   await log('maj: 1re='+a+' 2e='+b+' servie_nouvelle='+html.includes('version-de-test-locale')); } catch(e){ await log('ERREUR maj '+e); }
 await log('FIN'); await inv('test_exit'); })();
