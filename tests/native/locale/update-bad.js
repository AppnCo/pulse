// Liste annonçant une empreinte fausse : refus, ancienne copie gardée
(async()=>{ const inv=window.__TAURI__.core.invoke; const log=t=>inv('test_log',{text:t});
 let msg=''; try { msg='accepté '+await inv('web_update'); } catch(e){ msg='refusé'; }
 const html=await (await fetch('pulse://localhost/studio.html',{cache:'no-store'})).text();
 await log('maj abîmée: '+msg+' ancienne_gardée='+html.includes('version-de-test-locale')); await log('FIN'); await inv('test_exit'); })();
