// 18/10 : la croix × sur la ligne d'un effet le supprime (piste), Auto-Tune compris
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ef',name:'Ef',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7',effects:['eq','comp'],tuneSlot:true}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (l, c) => console.log(l + ':', await ev(`(async()=>{${c}})()`));
  await R('avant', `state.selectedTrack=0; renderInspector(); return [...document.querySelectorAll('#inspector .insp-fx-row')].map(r=>r.dataset.fx+(r.querySelector('.insp-del')?'×':'')).join(',')`);
  await R('clic sur × du compresseur', `document.querySelector('#inspector [data-fx="comp"] .insp-del').click(); await new Promise(r=>setTimeout(r,200)); return JSON.stringify(state.project.tracks[0].effects)`);
  await R('clic sur × de l Auto-Tune', `document.querySelector('#inspector [data-fx="tune"] .insp-del').click(); await new Promise(r=>setTimeout(r,300)); return 'tuneSlot='+state.project.tracks[0].tuneSlot+' lignes='+[...document.querySelectorAll('#inspector .insp-fx-row')].map(r=>r.dataset.fx).join(',')`);
  await R('⌘Z', `undoAction(); await new Promise(r=>setTimeout(r,300)); return 'tuneSlot='+state.project.tracks[0].tuneSlot`);
};
