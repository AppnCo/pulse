// Ajouter une piste Piano : la région est créée et l'éditeur de notes s'ouvre aussitôt
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`document.getElementById('btnAddTrack').click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('.track-ctx-menu *')].find(e=>/Piano/.test(e.textContent)&&e.children.length===0||/^Piano/.test(e.textContent.trim())).dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(1200);
  await R('piano : région + éditeur ouvert', `const t=state.project.tracks[state.project.tracks.length-1]; return t.name+' clips='+t.clips.length+' editeur='+PulsePianoRoll.isOpen()`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/piano.jpg');
};
