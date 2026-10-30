// 18/10 : import d'une instru par lien (l'appel save_file vide = test du canal rapide de PulseNative, ignoré) (logiciel installé) — avec un faux Tauri : import_url renvoie un chemin, read_import_file les octets
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'il',name:'Il',bpm:120,buses:[],tracks:[{name:'Instru',type:'audio',preset:'instru',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  const R = (c) => ev(`(async()=>{${c}})()`);
  check('navigateur : pas d\'onglet « Lien »', (await R(`return document.querySelectorAll('.dz-tab[data-tab="url"]').length`)) === 0);
  await R(`const ctx=await PulseAudio.init(); const sr=ctx.sampleRate; const b=ctx.createBuffer(1,sr*3,sr); b.getChannelData(0).fill(0.1); window.__wav=new Uint8Array(await PulseAudio.audioBufferToWav(b).arrayBuffer());
    window.__calls=[]; window.__TAURI__={ core:{ invoke: async (cmd,args)=>{ window.__calls.push(cmd+' '+JSON.stringify(args||{})); if(cmd==='import_url'){ if(/fail/.test(args.url)) throw 'téléchargement impossible : vidéo privée'; return 'C:/Temp/pulse-import/Trap_Beat_Sombre.wav'; } if(cmd==='read_import_file') return window.__wav.buffer; return null; } } };
    rerenderTracks(); return 1`);
  check('logiciel : l\'onglet « Lien YouTube / SoundCloud » apparaît', (await R(`return document.querySelectorAll('.dz-tab[data-tab="url"]').length`)) === 1);
  const flashes = `JSON.stringify([...document.querySelectorAll('.flash, #flash, .toast')].map(e=>e.textContent))`;
  await R(`const i=document.querySelector('.dz-url-input'); i.value='https://evil.com/x'; document.querySelector('.dz-url-btn').click(); return 1`);
  check('lien d\'un autre site refusé sans rien télécharger', (await R(`return window.__calls.length`)) === 0);
  await R(`const i=document.querySelector('.dz-url-input'); i.value='https://www.youtube.com/watch?v=fail'; document.querySelector('.dz-url-btn').click(); await new Promise(r=>setTimeout(r,500)); return 1`);
  check('erreur de téléchargement : le bouton redevient « Importer »', (await R(`return document.querySelector('.dz-url-btn').textContent`)) === 'Importer');
  await R(`window.__calls=[]; const i=document.querySelector('.dz-url-input'); i.value='https://www.youtube.com/watch?v=abc'; document.querySelector('.dz-url-btn').click(); await new Promise(r=>setTimeout(r,1500)); return 1`);
  const res = JSON.parse(await R(`const t=state.project.tracks[0]; return JSON.stringify({calls:window.__calls.map(c=>c.split(' ')[0]).filter(c=>c!=='save_file'), clips:t.clips.length, name:t.clips[0]&&t.clips[0].name, dur:t.clips[0]&&+t.clips[0].duration.toFixed(2)})`));
  check('lien YouTube : import_url puis read_import_file', res.calls.join(',') === 'import_url,read_import_file', res.calls.join(','));
  check('le son téléchargé devient l\'instru (3 s)', res.clips === 1 && Math.abs(res.dur - 3) < 0.05, JSON.stringify(res));
};
