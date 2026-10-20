// Double-clic sur un .pulse (appli de bureau) : le projet s'ouvre et continue d'être enregistré dans son dossier — faux Tauri
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'op1',name:'Projet de départ',bpm:100,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(500);
  // on fabrique un vrai .pulse d'un autre projet
  const pack = await ev(`(async()=>{ const p={id:'autre1',name:'Projet ouvert par double-clic',bpm:133,buses:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',clips:[]}]}; const {blob}=await PulseFile.pack(p); const b=new Uint8Array(await blob.arrayBuffer()); let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); localStorage.setItem('fake_pulse_b64', btoa(s)); return b.length; })()`);
  console.log('fichier .pulse fabriqué:', pack, 'octets');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function(){ const calls=[]; window.__calls=calls; let pending = localStorage.getItem('fake_pending') ? [localStorage.getItem('fake_pending')] : [];
      window.__TAURI__ = { core: { invoke: async (cmd, args) => { calls.push(cmd);
        if (cmd==='take_pending_open') { const l=pending; pending=[]; localStorage.removeItem('fake_pending'); return l; }
        if (cmd==='read_pulse_file') { const s=atob(localStorage.getItem('fake_pulse_b64')); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
        if (cmd==='project_folder_ok') return true;
        return null; } }, event: { listen: async()=>()=>{} } };
    })();` });
  await ev(`localStorage.setItem('fake_pending','/Users/test/Documents/Mon morceau/Mon morceau.pulse')`);
  await nav('http://localhost:8765/studio.html'); await sleep(2500);   // charge, lit la liste, ouvre, recharge
  console.log('projet courant:', await ev(`(()=>{const p=JSON.parse(localStorage.getItem('pulse_current_project')); return p.name+' | '+p.bpm+' BPM | savedDir='+p.savedDir})()`));
  console.log('pas de boucle (liste vidée):', await ev(`localStorage.getItem('fake_pending')===null`));
};
