// Menus clic droit : une icône SVG devant chaque action, plus d'emoji
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mi1',name:'MI',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[{id:'k',name:'Prise',start:0,duration:4,offset:0}]},{name:'Piano',type:'keys',midiInst:'piano',color:'#A855F7',volume:80,clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(500);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`openClipContextMenu(300,200,0,0)`); await sleep(150);
  await R('menu région : icônes', `const it=[...document.querySelectorAll('.clip-ctx-menu .ctx-item:not(.ctx-colors)')]; const emoji=it.filter(e=>/[\\u{1F300}-\\u{1FAFF}\\u23E9-\\u23FF\\u2B00-\\u2BFF]/u.test(e.textContent)).length; return it.length+' actions, avec icône='+it.filter(e=>e.querySelector('svg.ctx-ic')).length+', emojis restants='+emoji+' | '+it.map(e=>e.textContent).join(' / ')`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/menu.jpg');
  await ev(`closeAllMenus()`);
  await ev(`document.querySelector('.track-item[data-i="1"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}))`); await sleep(150);
  await R('menu piste : icônes', `const it=[...document.querySelectorAll('.track-ctx-menu .ctx-item:not(.ctx-colors)')]; return it.length+' actions, avec icône='+it.filter(e=>e.querySelector('svg.ctx-ic')).length+' | '+it.map(e=>e.textContent).join(' / ')`);
};
