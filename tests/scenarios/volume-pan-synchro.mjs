// Volume et gauche/droite : le réglage fait à gauche (fader d'inspecteur), sur la piste ou dans le mixeur se voit partout
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'vp1',name:'VP',bpm:120,buses:[],tracks:[
    {name:'Lead',type:'audio',color:'#A855F7',volume:80,pan:0,clips:[]},{name:'Back',type:'audio',color:'#22D3EE',volume:80,pan:0,clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('fader sur la piste', `return !!document.querySelector('.t-vol[data-i="0"]')`);
  // pan de l'inspecteur -> bouton rond de la piste
  await ev(`(()=>{const p=document.querySelector('#inspector .insp-pan-input'); p.value=60; p.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await R('pan inspecteur -> bouton rond', `const k=document.querySelector('.t-knob[data-i="0"]'); return 'bouton='+k.dataset.pan+' piste='+state.project.tracks[0].pan`);
  // fader de la piste -> inspecteur
  await ev(`(()=>{const s=document.querySelector('.t-vol[data-i="0"]'); s.value=50; s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await R('fader piste -> fader de gauche', `const f=document.querySelector('#inspector .insp-fader'); return 'volume='+state.project.tracks[0].volume+' ; fader gauche='+f.value+' ; piste='+document.querySelector('.t-vol[data-i="0"]').value+' ; texte='+document.querySelector('#inspector .strip-db').textContent`);
  // fader de gauche -> piste
  await ev(`(()=>{const f=document.querySelector('#inspector .insp-fader'); f.value=70; f.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await R('fader gauche -> piste', `return 'volume='+state.project.tracks[0].volume+' ; fader piste='+document.querySelector('.t-vol[data-i="0"]').value`);
  // pan du bouton rond -> inspecteur
  await R('bouton rond -> pan inspecteur', `const k=document.querySelector('.t-knob[data-i="0"]'); k.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,100)); return 'pan='+state.project.tracks[0].pan+' ; inspecteur='+document.querySelector('#inspector .insp-pan-input').value`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/vol-piste.jpg');
};
