// ⌘ + clic = muter la région ; clic droit + glisser = volume ; réglable
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'os1',name:'Souris',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',clips:[{id:'a',name:'A',start:1,duration:4,offset:0}]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const ME = (t, x, y, extra = '') => `new MouseEvent('${t}',{bubbles:true,cancelable:true,clientX:${x},clientY:${y}${extra}})`;
  const clipC = `const el=document.querySelector('.timeline-track[data-i="0"] .clip'); const r=el.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2;`;
  await R('défauts', `return localStorage.getItem('pulse_mouse_tools')+' | cmd='+mouseTool('cmd')+' droit='+mouseTool('right')`);
  await R('⌘ + clic mute la région', `${clipC} el.dispatchEvent(${ME('mousedown','x','y',',button:0,metaKey:true')}); document.dispatchEvent(${ME('mouseup','x','y',',button:0,metaKey:true')}); await new Promise(r=>setTimeout(r,60)); return 'muted='+state.project.tracks[0].clips[0].muted+' classe='+document.querySelector('.clip').classList.contains('is-muted-clip')`);
  await R('⌘ + clic le réactive', `${clipC} el.dispatchEvent(${ME('mousedown','x','y',',button:0,metaKey:true')}); document.dispatchEvent(${ME('mouseup','x','y',',button:0,metaKey:true')}); await new Promise(r=>setTimeout(r,60)); return 'muted='+state.project.tracks[0].clips[0].muted`);
  await R('clic droit + glisser vers le bas = volume baisse', `${clipC} el.dispatchEvent(${ME('mousedown','x','y',',button:2')});
    document.dispatchEvent(${ME('mousemove','x','y+60',',button:2')}); document.dispatchEvent(${ME('mouseup','x','y+60',',button:2')}); await new Promise(r=>setTimeout(r,60));
    const g=state.project.tracks[0].clips[0].gain; return 'gain='+g+' ('+(20*Math.log10(g)).toFixed(1)+' dB) menu ouvert='+!!document.querySelector('.clip-ctx-menu')`);
  await R('Option + clic droit = volume remis à 0 dB', `${clipC} el.dispatchEvent(${ME('mousedown','x','y',',button:2,altKey:true')}); document.dispatchEvent(${ME('mouseup','x','y',',button:2,altKey:true')}); await new Promise(r=>setTimeout(r,60));
    const c=state.project.tracks[0].clips[0]; return 'gain='+c.gain+' (undefined = 0 dB) menu ouvert='+!!document.querySelector('.clip-ctx-menu')`);
  await R('glisser puis Option en tirant = retour à 0 dB', `${clipC} el.dispatchEvent(${ME('mousedown','x','y',',button:2')}); document.dispatchEvent(${ME('mousemove','x','y+40',',button:2')});
    const avant=state.project.tracks[0].clips[0].gain; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',bubbles:true})); document.dispatchEvent(${ME('mouseup','x','y+40',',button:2')}); await new Promise(r=>setTimeout(r,60));
    return 'avant='+avant+' après='+state.project.tracks[0].clips[0].gain+' (undefined)'`);
  await R('clic droit sans bouger = le menu', `${clipC} el.dispatchEvent(${ME('mousedown','x','y',',button:2')}); document.dispatchEvent(${ME('mouseup','x','y',',button:2')}); await new Promise(r=>setTimeout(r,60)); return 'menu ouvert='+!!document.querySelector('.clip-ctx-menu')`);
  await ev(`closeAllMenus()`);
  await R('réglage : clic droit = menu', `localStorage.setItem('pulse_mouse_tools', JSON.stringify({right:'menu'})); ${clipC} el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y})); await new Promise(r=>setTimeout(r,60)); return 'menu ouvert='+!!document.querySelector('.clip-ctx-menu')`);
  await ev(`openSettings()`); await sleep(300);
  await R('Réglages : les deux choix', `return document.getElementById('setToolCmd').value+' / '+document.getElementById('setToolRight').value`);
};
