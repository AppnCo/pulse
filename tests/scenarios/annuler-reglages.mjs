// ⌘Z : un mouvement de fader, un geste dans l'EQ, un curseur du compresseur = une seule étape d'annulation
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ar1',name:'AR',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7',volume:80,pan:0,clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  // fader de gauche : 5 mouvements = une étape
  await ev(`(()=>{const f=document.querySelector('#inspector .insp-fader'); for(const v of [60,55,50,45,40]){f.value=v; f.dispatchEvent(new Event('input',{bubbles:true}));} f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await R('volume après le fader', `return state.project.tracks[0].volume`);
  await R('⌘Z : volume revient d un coup', `undoAction(); return state.project.tracks[0].volume`);
  // pan inspecteur
  await ev(`(()=>{const p=document.querySelector('#inspector .insp-pan-input'); for(const v of [10,20,30]){p.value=v; p.dispatchEvent(new Event('input',{bubbles:true}));} p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await R('pan', `return state.project.tracks[0].pan`);
  await R('⌘Z : pan revient', `undoAction(); return state.project.tracks[0].pan`);
  // compresseur : curseur
  await ev(`openEffectPanel(0,'comp',document.querySelector('#btnMixer'))`); await sleep(300);
  await ev(`(()=>{const s=document.querySelector('.fx-slider[data-key="threshold"]'); for(const v of [-30,-26,-20]){s.value=v; s.dispatchEvent(new Event('input',{bubbles:true}));} s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await R('seuil', `return JSON.stringify(state.project.tracks[0].effectParams.comp)`);
  await R('⌘Z : seuil revient (et la fenêtre se ferme)', `undoAction(); return JSON.stringify(state.project.tracks[0].effectParams||{})+' ; fenêtre='+!!document.querySelector('.fx-panel')`);
};
