// Faces Écho et Reverb : notes calées sur le tempo, ducking, filtres, écrans qui suivent les réglages
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'er',name:'ER',bpm:92,sends:[],buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',volume:100,effects:['delay','reverb'],effectParams:{delay:{beats:0.5,feedback:45,wet:30,pp:1,duck:40},reverb:{wet:20,size:2.2,pre:30,duck:50}}}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`openEffectPanel(0,'delay',document.body)`); await sleep(250);
  await R('écho : écran + notes', `const p=document.querySelector('.fx-panel'); return 'écran='+!!p.querySelector('.viz-delay')+' répétitions='+p.querySelectorAll('.dl-rep').length+' notes='+[...p.querySelectorAll('.fx-choice[data-key="beats"] button')].map(b=>b.textContent).join(' ')`);
  await R('choisir 1/8 triolet', `document.querySelector('.fx-choice[data-key="beats"] button[data-v="${1/3}"]').click(); await new Promise(r=>setTimeout(r,40)); return 'beats='+state.project.tracks[0].effectParams.delay.beats.toFixed(4)+' ; écran : '+document.querySelector('.viz-delay text[text-anchor="end"]').textContent`);
  await ev(`(()=>{const p=document.querySelector('.fx-panel'); p.style.left='20px'; p.style.top='60px';})()`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/echo-face.jpg');
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); openEffectPanel(0,'reverb',document.body)`); await sleep(250);
  await R('reverb : écran + ducking', `const p=document.querySelector('.fx-panel'); return 'écran='+!!p.querySelector('.viz-rev')+' pointillés (sans ducking)='+!!p.querySelector('.rv-ref')+' réglages='+[...p.querySelectorAll('.fx-label')].map(l=>l.textContent).join(', ')`);
  await ev(`(()=>{const p=document.querySelector('.fx-panel'); p.style.left='20px'; p.style.top='60px';})()`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/rev-face.jpg');
};
