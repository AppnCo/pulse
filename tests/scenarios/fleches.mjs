// Les flèches déplacent le curseur ; piste et clip passent par ⌘
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'fl1',name:'Flèches',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',clips:[{id:'a',name:'A',start:2,duration:3,offset:0},{id:'b',name:'B',start:8,duration:2,offset:0}]},{name:'Back',type:'audio',color:'#22D3EE'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const key = (code, extra = '') => `document.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}',key:'${code}',bubbles:true${extra}}))`;
  const ph = `state.playhead.toFixed(3)`;
  await R('départ', `state.playhead=0; state.selectedClip=null; state.selectedTrack=0; return ${ph}`);
  await R('→ = +1 temps (0,5 s à 120 bpm)', `${key('ArrowRight')}; ${key('ArrowRight')}; return ${ph}`);
  await R('← = -1 temps', `${key('ArrowLeft')}; return ${ph}`);
  await R('Shift+→ = +1 mesure, calé sur la grille', `${key('ArrowRight', ',shiftKey:true')}; return ${ph}`);
  await R('Tab = bord de clip suivant (5 s)', `state.playhead=2.7; ${key('Tab')}; return ${ph}`);
  await R('Tab encore = 8 s, puis 10 s', `${key('Tab')}; const a=${ph}; ${key('Tab')}; return a+' puis '+${ph}`);
  await R('Maj+Tab = bord précédent', `${key('Tab', ',shiftKey:true')}; return ${ph}`);
  await R('↓ change de piste', `state.selectedTrack=0; ${key('ArrowDown')}; const a=state.selectedTrack; ${key('ArrowUp')}; return a+' puis '+state.selectedTrack`);
  await R('⌥S = solo de la piste choisie', `state.selectedTrack=1; ${key('KeyS', ',altKey:true')}; return 'solo piste 2 = '+state.project.tracks[1].solo`);
  await R('Fin / Début', `${key('End')}; const e=${ph}; ${key('Home')}; return 'fin='+e+' début='+${ph}`);
  await R('⌘→ avec clip : nudge, curseur immobile', `state.selectedClip={trackIdx:0,clipIdx:0}; state.playhead=1; const s0=state.project.tracks[0].clips[0].start; ${key('ArrowRight', ',metaKey:true')}; return 'clip '+s0+' → '+state.project.tracks[0].clips[0].start+' curseur='+${ph}`);
};
