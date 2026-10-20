// Option + molette : au-dessus d'une piste, seule cette piste change de hauteur ; sur la règle ou le vide, toutes
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'oh1',name:'OH',bpm:120,buses:[],tracks:[
    {name:'A',type:'audio',color:'#A855F7',clips:[]},{name:'B',type:'audio',color:'#22D3EE',clips:[]},{name:'C',type:'audio',color:'#34D399',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const H = `state.project.tracks.map(t=>t.height||'auto').join(' / ')+' ; base='+state.trackHeight`;
  await R('départ', `return ${H}`);
  // un geste = molette puis Option relâchée (la cible est verrouillée tant qu'Option est tenue)
  const wheel0 = (sel, dy, alt = true) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); const r=e.getBoundingClientRect(); e.dispatchEvent(new WheelEvent('wheel',{deltaY:${dy},altKey:${alt},bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()`);
  const wheel = async (sel, dy, alt = true) => { await wheel0(sel, dy, alt); await sleep(120); await ev(`document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',bubbles:true}))`); };
  await wheel('.timeline-track[data-i="1"]', -100); await sleep(250);
  await R('⌥ + molette sur la piste B : B seule', `return ${H}`);
  await wheel('.track-item[data-i="2"]', -100); await sleep(250);
  await R('⌥ + molette sur la piste C (liste) : C seule', `return ${H}`);
  await wheel('#timelineRuler', -100); await sleep(250);
  await R('⌥ + molette sur la règle : toutes', `return ${H}`);
};
