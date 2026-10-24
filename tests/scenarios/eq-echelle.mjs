// EQ : l'échelle s'agrandit quand on tire un point au-delà de l'écran, et se tape à la main
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_eq_range','12'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'es',name:'ES',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100,effects:['eq'],effectParams:{eq:{bands:[{type:'bell',freq:1000,gain:6,q:1}]}}}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`openEqPanel(0, document.body)`); await sleep(200);
  await R('tirer le point au-dessus de l écran', `const pt=document.querySelector('.eq-pt[data-i="0"]'), r=document.querySelector('.eq-svg').getBoundingClientRect(), p=pt.getBoundingClientRect();
    pt.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:p.left+5,clientY:p.top+5}));
    for (let k=1;k<=6;k++) document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:p.left+5,clientY:r.top-10*k}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,30));
    return 'gain='+state.project.tracks[0].effectParams.eq.bands[0].gain+' échelle='+document.querySelector('.eq-range-in').value+' dB (avant 12)'`);
  await R('taper 9 dans la case', `const i=document.querySelector('.eq-range-in'); i.value='9'; i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); return 'échelle='+localStorage.getItem('pulse_eq_range')+' ; repères: '+[...document.querySelectorAll('.eq-svg .viz-txt[text-anchor="end"]')].map(t=>t.textContent).join(' ')`);
  await R('double-clic tout à gauche / tout à droite', `const svg=document.querySelector('.eq-svg'), r=svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+r.width*0.02,clientY:r.top+r.height*0.4}));
    document.querySelector('.eq-svg').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+r.width*0.98,clientY:r.top+r.height*0.4})); await new Promise(r=>setTimeout(r,40));
    return state.project.tracks[0].effectParams.eq.bands.slice(1).map(b=>b.type+'@'+b.freq+' '+b.slope+'dB/oct').join(' ; ')`);
};
