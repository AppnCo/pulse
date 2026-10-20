// Bloc-notes « Mon texte » : sauvegardé dans le projet, à l'abri des raccourcis et de ⌘Z
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tx1',name:'Texte',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('fermé au départ', `return 'caché='+document.getElementById('lyricsPanel').hidden`);
  await ev(`document.getElementById('btnLyrics').click()`); await sleep(200);
  await send('Input.insertText', { text: 'Premier couplet\nrrr qqq' });
  for (const key of [' ', 'r', 'q']) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key }); }
  await sleep(900);
  await R('écrire', `const ta=document.getElementById('lyricsText'); return JSON.stringify(ta.value)+' | lecture='+state.playing+' rec='+state.recording+' | projet='+JSON.stringify(state.project.lyrics)+' | largeur timeline='+document.querySelector('.timeline').offsetWidth`);
  await R('⌘Z ne touche pas au texte', `pushUndo(); state.project.tracks[0].name='X'; undoAction(); return JSON.stringify(state.project.lyrics)+' piste='+state.project.tracks[0].name`);
  if (SHOTS) await shot(SHOTS + '/shot-texte.jpg');
  await R('fichier .pulse', `await flushProjectDocSave?.(); const p=await PulseFile.pack(state.project); const u=await PulseFile.unpack(p.blob); return 'texte dans le fichier='+JSON.stringify((u.project||u).lyrics)`);
  await nav('http://localhost:8765/studio.html'); await sleep(600);
  await R('après rechargement', `return 'rouvert='+!document.getElementById('lyricsPanel').hidden+' | '+JSON.stringify(document.getElementById('lyricsText').value)`);
};
