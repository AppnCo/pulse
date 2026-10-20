// Tirer dans le studio ne sélectionne pas de texte ; le logo ne se laisse pas glisser ; les champs restent éditables
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'st1',name:'Sel',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(700);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('texte sélectionnable dans le studio ?', `const cs=(s)=>getComputedStyle(document.querySelector(s)).userSelect; return 'corps='+cs('.timeline')+', topbar='+cs('.topbar')+', nom du projet='+cs('#projectName')`);
  await R('selectstart annulé sur le texte de l interface', `const el=document.querySelector('.tracks-title'); const e=new Event('selectstart',{bubbles:true,cancelable:true}); el.dispatchEvent(e); return 'annulé='+e.defaultPrevented`);
  await R('selectstart libre dans un champ', `const el=document.getElementById('projectName'); const e=new Event('selectstart',{bubbles:true,cancelable:true}); el.dispatchEvent(e); return 'annulé='+e.defaultPrevented+' (false attendu)'`);
  await R('glisser le logo : dragstart annulé', `const el=document.querySelector('.brand-mini'); const e=new Event('dragstart',{bubbles:true,cancelable:true}); el.dispatchEvent(e); return 'annulé='+e.defaultPrevented`);
};
