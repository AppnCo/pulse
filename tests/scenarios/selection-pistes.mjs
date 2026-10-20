// Sélection de pistes : ⌘ + clic ajoute, Shift + clic prend tout jusqu'à la piste choisie ; M agit sur toutes
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'sp1',name:'Sel',bpm:120,buses:[],tracks:[
    {name:'A',type:'audio',color:'#A855F7'},{name:'B',type:'audio',color:'#22D3EE'},{name:'C',type:'audio',color:'#34D399'},{name:'D',type:'audio',color:'#F87171'},{name:'E',type:'audio',color:'#FBBF24'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const click = (i, extra = '') => `(()=>{ const el=document.querySelector('.track-item[data-i="${i}"] .track-info'); const r=el.getBoundingClientRect(); const o={bubbles:true,clientX:r.left+5,clientY:r.top+5,button:0${extra}}; el.dispatchEvent(new MouseEvent('mousedown',o)); document.dispatchEvent(new MouseEvent('mouseup',o)); })()`;
  const sel = `[...document.querySelectorAll('.track-item.selected')].map(e=>e.dataset.i).join(',')`;
  await R('clic simple sur B', `${click(1)}; return 'sélection='+${sel}+' active='+state.selectedTrack`);
  await R('⌘ + clic sur D : B et D', `${click(3, ',metaKey:true')}; return 'sélection='+${sel}+' active='+state.selectedTrack`);
  await R('⌘ + clic sur B : retire B', `${click(1, ',metaKey:true')}; return 'sélection='+${sel}`);
  await R('clic simple sur A puis Shift + clic sur D', `${click(0)}; ${click(3, ',shiftKey:true')}; return 'sélection='+${sel}+' ancre='+state.selectedTrack`);
  await R('M coupe toutes les pistes choisies', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'m',code:'KeyM',bubbles:true})); return state.project.tracks.map(t=>t.muted?'M':'-').join('')`);
  await R('↓ revient à une seule piste', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true})); return 'sélection='+${sel}`);
};
