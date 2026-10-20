// Retour terrain 17/10 : ⌘S = choisir le dossier la 1re fois, projet en dossier (fichier .pulse + Audio/ + Bounces/ + Pistes.txt) — avec un faux « native » (Tauri simulé)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sd1',name:'Mon morceau',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('faux appli de bureau', `window.__calls=[]; window.__picks=0; window.__TAURI__ = { core: { invoke: async (cmd, args, opts) => {
      const h = opts && opts.headers ? { dir: decodeURIComponent(opts.headers.dir), path: decodeURIComponent(opts.headers.path) } : null;
      window.__calls.push(cmd + (h ? ' ' + h.path : '') + (args && args.byteLength ? ' ('+args.byteLength+' o)' : ''));
      if (cmd === 'pick_folder') { window.__picks++; return '/Users/test/Documents/'; }
      if (cmd === 'create_project_folder') return '/Users/test/Documents/' + args.name;
      if (cmd === 'project_folder_ok') return true;
      if (cmd === 'save_file') return h.dir + '/' + h.path;
      return null; } } }; return 'ok'`);
  await R('un son sur la piste', `const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*2,sr); b.getChannelData(0).fill(0.1); PulseAudio.registerBuffer('snd1',b); state.project.tracks[0].clips=[{id:'snd1',start:0,duration:2,name:'prise'}]; return 'ok'`);
  const key = async (k, code, mods = 0) => { for (const type of ['rawKeyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, modifiers: mods, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); await sleep(900); };
  await key('s', 'KeyS', 4);   // ⌘S
  await R('1er ⌘S (sans WAV : option décochée)', `return window.__picks+' choix de dossier | '+window.__calls.join(' ; ')`);
  await R('option cochée → WAV dans Audio/', `localStorage.setItem('pulse_folder_audio','1'); window.__calls=[]; await saveProjectFolder(false); return window.__calls.filter(c=>c.includes('Audio/')).join(' ; ')||'aucun WAV'`);
  await ev(`localStorage.removeItem('pulse_folder_audio'); window.__calls=[]; state._savedAudio=new Set()`);
  await R('projet connaît son dossier', `return state.project.savedDir`);
  await ev(`window.__calls=[]`);
  await key('s', 'KeyS', 4);
  await R('2e ⌘S : plus de question', `return window.__picks+' choix de dossier | '+window.__calls.join(' ; ')`);
  await ev(`window.__calls=[]`);
  await key('s', 'KeyS', 5);   // ⌘ + ⌥ + S : enregistrer sous
  await R('⌘⌥S : on redemande', `return window.__picks+' choix de dossier'`);
  await ev(`window.__calls=[]`);
  await R('export WAV rangé dans Bounces', `const r=await deliverFile(new Blob([new Uint8Array(10)]),'Mon_morceau.wav'); return JSON.stringify(r)+' | '+window.__calls.join(' ; ')`);
};
