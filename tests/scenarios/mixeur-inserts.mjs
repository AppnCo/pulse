// Table de mixage façon Logic : listes d'effets et d'envois comme la tranche de gauche, « + », croix, glisser pour l'ordre
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mi1',name:'MI',bpm:120,
    sends:[{id:'rv1',name:'Reverb',type:'reverb',size:2,pre:0,volume:100}],
    buses:[{id:'g1',name:'Vocal',isGroup:true,output:'master',color:'#A855F7',volume:100}],
    tracks:[{name:'Lead',type:'audio',color:'#A855F7',output:'g1',effects:['eq','comp'],sends:{rv1:30},clips:[]},{name:'Back',type:'audio',color:'#C084FC',output:'g1',clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`document.getElementById('btnMixer').click()`); await sleep(500);
  const S = `document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="0"]')`;
  await R('tranche piste', `const s=${S}; return 'effets='+[...s.querySelectorAll('.insp-fx-row')].map(r=>r.dataset.fx).join(',')+' vides='+s.querySelectorAll('.insp-fx-box .insp-slot-empty').length+' envois='+s.querySelectorAll('.send-bar-row').length+' plus='+s.querySelectorAll('.slot-plus').length+' croix='+s.querySelectorAll('.insp-del').length`);
  await R('tranche groupe', `const s=document.querySelector('.mixer-strips .strip[data-kind="bus"]'); return 'plus='+s.querySelectorAll('.slot-plus').length+' vides='+s.querySelectorAll('.insp-slot-empty').length+' pan='+!!s.querySelector('.bus-pan')`);
  await R('gauche a aussi les +', `return document.querySelectorAll('#inspector .slot-plus').length`);
  // « + » des effets : le menu d'ajout s'ouvre, on prend la saturation
  await ev(`${S}.querySelector('.slot-plus[data-plus="fx"]').click()`); await sleep(200);
  await R('menu d ajout', `return !!document.querySelector('.fx-add-menu')`);
  await ev(`document.querySelector('.fx-add-menu .fam-fx[data-fx="sat"]').click()`); await sleep(300);
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await R('après ajout', `return JSON.stringify(state.project.tracks[0].effects)+' | table='+[...${S}.querySelectorAll('.insp-fx-row')].map(r=>r.dataset.fx).join(',')+' | gauche='+[...document.querySelectorAll('#inspector .insp-strip[data-kind="track"] .insp-fx-row')].map(r=>r.dataset.fx).join(',')`);
  // glisser : la saturation (3e) monte en tête
  await R('glisser', `const s=${S}; const rows=[...s.querySelectorAll('.insp-fx-row.can-drag')]; const sat=rows.find(r=>r.dataset.fx==='sat'), top=rows[0].getBoundingClientRect();
    const b=sat.getBoundingClientRect(), y0=b.top+b.height/2, x0=b.left+10;
    sat.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x0,clientY:y0}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x0,clientY:y0-10}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x0,clientY:top.top+2}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x0,clientY:top.top+2}));
    await new Promise(r=>setTimeout(r,200));
    return 'ordre='+chainOf(state.project.tracks[0]).join(',')+' | table='+[...${S}.querySelectorAll('.insp-fx-row')].map(r=>r.dataset.fx).join(',')`);
  // croix : retire le compresseur
  await ev(`${S}.querySelector('.insp-fx-row[data-fx="comp"] .insp-del').click()`); await sleep(300);
  await R('croix', `return JSON.stringify(state.project.tracks[0].effects)+' | table='+[...${S}.querySelectorAll('.insp-fx-row')].map(r=>r.dataset.fx).join(',')`);
  // l'ancien retour « Reverb » du projet est devenu un bus d'envoi à l'ouverture
  await R('retour converti', `const b=state.project.buses.find(b=>b.isAux); return 'retours='+projectSends().length+' bus='+(b&&b.name)+' effets='+JSON.stringify(b&&b.effects)+' dose Lead='+(state.project.tracks[0].busSends||{})[b&&b.id]`);
  // « + » des envois : seulement « Nouveau bus » et les bus existants
  await ev(`${S}.querySelector('.slot-plus[data-plus="send"]').click()`); await sleep(200);
  await R('menu envois', `return [...document.querySelectorAll('.track-ctx-menu .ctx-item,.track-ctx-menu .ctx-head')].map(e=>e.textContent).join(' / ')`);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent==='Nouveau bus').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(400);
  await ev(`document.querySelectorAll('.fx-panel,.fx-add-menu').forEach(p=>p.remove())`);
  await R('envois après', `return state.project.buses.filter(b=>b.isAux).map(b=>b.name+':'+JSON.stringify(b.effects)).join(',')+' | table='+${S}.querySelectorAll('.send-bar-row').length`);
  // envoi réglé dans la table → enregistré
  await R('dose envoi', `const b=state.project.buses.find(b=>b.isAux); const sl=${S}.querySelector('[data-bsend="'+b.id+'"] .insp-send'); sl.value=55; sl.dispatchEvent(new Event('input',{bubbles:true})); sl.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,100)); return state.project.tracks[0].busSends[b.id]+' | Back intact='+JSON.stringify(state.project.tracks[1].busSends||{})`);
  // ⌘Z ramène le compresseur
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/mixeur-inserts.jpg');
};
