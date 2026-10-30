// pulse:// : canal rapide, moteur natif, micro et AudioWorklet disponibles (page « sûre »)
(async()=>{ const inv=window.__TAURI__.core.invoke; const log=t=>inv('test_log',{text:t});
 try { let raw=false; try { await inv('save_file', new Uint8Array(0), {headers:{dir:'',path:''}}); raw=true; } catch(e){ raw=!/octets bruts/.test(String(e)); }
   const ctx=new AudioContext(); const blob=new Blob(["class P extends AudioWorkletProcessor{process(){return true}} registerProcessor('p',P)"],{type:'text/javascript'}); await ctx.audioWorklet.addModule(URL.createObjectURL(blob)); new AudioWorkletNode(ctx,'p');
   await log('locale: canal_rapide='+raw+' secure='+isSecureContext+' micro='+(!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia))+' worklet=ok');
 } catch(e){ await log('ERREUR locale '+e); }
 await log('FIN'); await inv('test_exit'); })();
