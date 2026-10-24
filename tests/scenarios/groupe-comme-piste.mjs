// Un groupe (Vocal, Back…) se règle comme une piste : Son, EQ, Comp, envois (Rev, Écho), gauche/droite
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gp1',name:'GP',bpm:120,
    buses:[{id:'g1',name:'Vocal',isGroup:true,output:'master',color:'#A855F7',volume:100}],
    tracks:[{name:'Lead',type:'audio',color:'#A855F7',output:'g1',clips:[]},{name:'Back',type:'audio',color:'#C084FC',output:'g1',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`document.getElementById('btnMixer').click()`); await sleep(500);
  await R('tranche du groupe', `const s=document.querySelector('.strip[data-kind="bus"]'); return 'son='+!!s.querySelector('.strip-sound')+' plus='+s.querySelectorAll('.slot-plus').length+' cases='+s.querySelectorAll('.insp-slot-empty').length+' envois='+s.querySelectorAll('.insp-send').length+' pan='+!!s.querySelector('.bus-pan')`);
  // un envoi de reverb sur le groupe (on crée d'abord une reverb : un projet neuf n'en a pas)
  await ev(`addSend('reverb')`); await sleep(300); await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await ev(`(()=>{const s=document.querySelector('.mixer-strips .strip[data-kind="bus"] .insp-send'); s.value=40; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await R('envoi du groupe', `return JSON.stringify(state.project.buses[0].sends)`);
  // pan
  await ev(`(()=>{const p=document.querySelector('.strip[data-kind="bus"] .bus-pan'); p.value=-30; p.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await R('pan du groupe', `return state.project.buses[0].pan`);
  // EQ : ouvre la fenêtre et active l'effet
  await ev(`document.querySelector('.mixer-strips .strip[data-kind="bus"] .slot-plus[data-plus="fx"]').click()`); await sleep(200);
  await ev(`document.querySelector('.fx-add-menu .fam-fx[data-fx="eq"]').click()`); await sleep(400);
  await R('EQ du groupe', `return 'effets='+JSON.stringify(state.project.buses[0].effects)+' ; fenêtre='+!!document.querySelector('.eq-panel')+' ; titre='+(document.querySelector('.eq-panel .fx-panel-header span')||{}).textContent`);
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  // Son du groupe
  await ev(`document.querySelector('.strip[data-kind="bus"] .strip-sound').click()`); await sleep(400);
  await R('Son du groupe', `return 'panneau='+!!document.querySelector('.sound-panel')+' ; titre='+(document.querySelector('.sound-panel .fx-panel-header span')||{}).textContent`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/groupe-piste.jpg');
  // l'inspecteur d'une piste du groupe montre aussi les envois du groupe
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); document.getElementById('btnMixer').click()`); await sleep(300);
  await R('inspecteur : tranche du groupe', `const s=document.querySelector('#inspector .insp-strip[data-kind="bus"]'); return s? 'envois='+s.querySelectorAll('.insp-send').length+' pan='+!!s.querySelector('.insp-pan-input') : 'absente'`);
};
