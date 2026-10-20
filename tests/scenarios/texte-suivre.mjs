// Mon texte : le mode « Suivre » allume la ligne qui correspond à la mesure en cours
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ts1',name:'TS',bpm:120,buses:[],lyrics:'Première ligne\\nDeuxième ligne\\n\\nTroisième ligne\\nQuatrième ligne',tracks:[{name:'A',type:'audio',color:'#A855F7',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('panneau ouvert avec le texte', `return 'ouvert='+!document.getElementById('lyricsPanel').hidden+' texte='+document.getElementById('lyricsText').value.split('\\n').length+' lignes'`);
  await ev(`document.getElementById('lyricsFollow').click()`); await sleep(200);
  await R('mode suivre', `return 'lignes='+document.querySelectorAll('.lf-line').length+' ; textarea caché='+document.getElementById('lyricsText').hidden+' ; bouton='+document.getElementById('lyricsFollow').textContent`);
  await R('à l arrêt : aucune ligne allumée', `return document.querySelectorAll('.lf-line.now').length`);
  await R('mesure 3 (4,2 s à 120 bpm) : 3e ligne', `state.playing=true; state.playhead=4.2; updatePlayhead(); const n=document.querySelector('.lf-line.now'); return n? n.textContent+' | passées='+document.querySelectorAll('.lf-line.past').length : 'aucune'`);
  await R('ligne 1 à la mesure 3', `const s=document.getElementById('lfStart'); s.value=3; s.dispatchEvent(new Event('change',{bubbles:true})); const n=document.querySelector('.lf-line.now'); return n? n.textContent : 'aucune'`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/texte-suivre.jpg');
  await R('retour à l écriture', `state.playing=false; document.getElementById('lyricsFollow').click(); return 'textarea visible='+!document.getElementById('lyricsText').hidden`);
};
