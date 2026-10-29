// 29/10 : un gros projet (16 pistes de 5 min) ne s'enregistrait pas dans son dossier : un seul bloc de ~1 Go ne passe pas.
// Les sons sont maintenant répartis en morceaux (Sons/…) de moins de 100 Mo, et se relisent à l'ouverture.
export default async ({ ev, nav, sleep, check }) => {
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gp1',name:'Gros mix',bpm:85,buses:[],tracks:[{name:'A',type:'audio'},{name:'B',type:'audio'},{name:'C',type:'audio'},{name:'D',type:'audio'}]})); 1`);
  await nav('http://localhost:8765/studio.html');
  const r = await ev(`(async()=>{
    window.__disk = new Map(); const sizes = [];
    window.__TAURI__ = { core: { invoke: async (cmd, args, opts) => {
      const h = opts && opts.headers ? { dir: decodeURIComponent(opts.headers.dir), path: decodeURIComponent(opts.headers.path) } : null;
      if (cmd === 'pick_folder') return '/Users/test/Bureau/';
      if (cmd === 'create_project_folder') return '/Users/test/Bureau/' + args.name;
      if (cmd === 'project_folder_ok') return true;
      if (cmd === 'save_file') { sizes.push(args.byteLength); __disk.set(h.dir + '/' + h.path, args.slice()); return h.dir + '/' + h.path; }
      if (cmd === 'read_pulse_file') { const b = __disk.get(args.path); if (!b) throw 'absent'; return b.buffer; }
      return null; } } };
    // 4 sons de 45 Mo (comme des pistes de 5 min)
    for (let i = 0; i < 4; i++) { const u = new Uint8Array(45e6); u[0] = i + 1; u[u.length - 1] = 7; await PulsePersist.saveBlob('gros' + i, new Blob([u], { type: 'audio/wav' }), {}); state.project.tracks[i].clips = [{ id: 'gros' + i, start: 0, duration: 300, name: 'son' + i }]; }
    await saveProjectFolder(false);
    const files = [...__disk.keys()].map(k => k.replace('/Users/test/Bureau/Gros mix/', ''));
    // on efface les sons de Pulse puis on relit depuis le « disque »
    const main = new File([__disk.get('/Users/test/Bureau/Gros mix/Gros mix.pulse')], 'Gros mix.pulse');
    const names = await PulseFile.partNames(main);
    const parts = names.map(n => new File([__disk.get('/Users/test/Bureau/Gros mix/' + n)], n.split('/').pop()));
    for (let i = 0; i < 4; i++) await PulsePersist.deleteBlob?.('gros' + i);
    const p = await PulseFile.unpack(main, parts);
    const back = []; for (let i = 0; i < 4; i++) { const b = await PulsePersist.loadBlob('gros' + i); const u = b ? new Uint8Array(await b.arrayBuffer()) : null; back.push(u ? (u.length === 45e6 && u[0] === i + 1 && u[u.length - 1] === 7) : false); }
    return JSON.stringify({ files, max: Math.max(...sizes), names, back, tracks: p.tracks.length, del: typeof PulsePersist.deleteBlob });
  })()`);
  console.log(r);
  const o = JSON.parse(r);
  check('le .pulse principal est écrit', o.files.includes('Gros mix.pulse'));
  check('sons répartis en plusieurs morceaux dans Sons/', o.names.length >= 2 && o.names.every(n => n.startsWith('Sons/')), o.names.join(', '));
  check('aucun envoi au-dessus de 100 Mo', o.max < 100 * 1048576, String(o.max));
  check('les 4 sons se relisent à l’identique', o.back.every(Boolean), JSON.stringify(o.back));
  check('effacement testé pour de vrai', o.del === 'function', o.del);
};
