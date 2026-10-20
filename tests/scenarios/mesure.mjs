// Temps par mesure : la règle, la grille, l'aimant et le chrono suivent (3 temps = valse)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ms1',name:'MS',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('4/4 : une mesure = 2 s à 120 BPM', `const ticks=[...document.querySelectorAll('#timelineRuler .ruler-label.major')].slice(0,3).map(e=>Math.round(parseFloat(e.style.left)/state.pxPerSecond*100)/100); return 'mesures à '+ticks.join(', ')+' s (0, 2, 4)'`);
  await R('3 temps : une mesure = 1,5 s', `state.project.beatsPerBar=3; renderRuler(); const ticks=[...document.querySelectorAll('#timelineRuler .ruler-label.major')].slice(0,3).map(e=>Math.round(parseFloat(e.style.left)/state.pxPerSecond*100)/100); return 'mesures à '+ticks.join(', ')+' s (0, 1.5, 3)'`);
  await R('aimant sur la mesure', `localStorage.setItem('pulse_snap','bar'); const t=snapTime(1.6,false); return 'snap(1.6 s) mesure ou temps = '+t.toFixed(2)`);
  await R('chrono mesure | temps', `_chronoMode='bars'; state.playhead=1.5; updateChrono(); const a=document.getElementById('chrono').textContent.trim(); state.playhead=2.25; updateChrono(); return a+' (mesure 2 | temps 1) ; '+document.getElementById('chrono').textContent.trim()+' (mesure 2 | temps 2)'`);
};
