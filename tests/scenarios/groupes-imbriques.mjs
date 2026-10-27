// Groupes dans des groupes, dupliquer un groupe (feat), réglages de voix sur le groupe
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'gi1',name:'Groupes',bpm:90,
    buses:[{id:'v1',name:'Voix 1',isGroup:true,output:'master',color:'#A855F7'}],
    tracks:[{name:'Rec',type:'audio',armed:true,color:'#F472B6'},{name:'Lead',type:'audio',output:'v1',color:'#A855F7'},{name:'Back',type:'audio',output:'v1',color:'#C084FC'},{name:'Instru',type:'audio',preset:'instru',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const ok = `const ok=(c)=>c?'PASS ':'FAIL '; const heads=()=>[...document.querySelectorAll('.group-header')].map(h=>h.querySelector('.group-name').textContent+(h.classList.contains('is-group-collapsed')?'(caché)':'')+'@'+h.style.getPropertyValue('--depth').trim()).join(', '); const vis=()=>[...document.querySelectorAll('.track-item')].filter(e=>!e.classList.contains('is-group-collapsed')).map(e=>e.querySelector('.track-name').textContent.trim()).join(',');`;
  await R('son du groupe = chaîne de voix', `${ok} document.querySelector('.g-son').click(); await new Promise(r=>setTimeout(r,200)); const p=document.querySelector('.sound-panel'); const chips=[...p.querySelectorAll('.sound-chip')].map(c=>c.textContent).join(',');
    [...p.querySelectorAll('.sound-chip')].find(c=>c.dataset.preset==='lead').click(); await new Promise(r=>setTimeout(r,200)); const b=state.project.buses[0]; document.querySelectorAll('.fx-panel').forEach(x=>x.remove());
    return ok(b.effects.includes('eq')&&b.effects.includes('comp')&&b.effects.includes('deess'))+chips+' | effets du groupe='+JSON.stringify(b.effects)`);
  await R('grand groupe', `${ok} wrapGroup('v1'); await new Promise(r=>setTimeout(r,200)); return ok(heads()==='Toutes les voix@0, Voix 1@1')+heads()+' | sortie de Voix 1='+busById('v1').output.slice(0,4)`);
  await R('dupliquer pour un feat', `${ok} duplicateGroup('v1'); await new Promise(r=>setTimeout(r,200)); const v2=state.project.buses.find(b=>b.name==='Voix 2'); const tr=state.project.tracks.filter(t=>t.output===v2.id);
    return ok(!!v2&&tr.length===2&&v2.output===busById('v1').output&&JSON.stringify(v2.effects)===JSON.stringify(busById('v1').effects)&&tr.every(t=>t.clips.length===0))+heads()+' | pistes de Voix 2='+tr.map(t=>t.name).join(',')+' | ordre='+state.project.tracks.map(t=>t.name).join(',')+' | mêmes réglages='+JSON.stringify(v2.effects)`);
  await R('replier Voix 1 seulement', `${ok} document.querySelector('.group-header[data-bus="v1"] .group-toggle').click(); await new Promise(r=>setTimeout(r,150)); return ok(vis()==='Rec,Lead 2,Back 2,Instru')+'visibles='+vis()+' | '+heads()`);
  if (SHOTS) await shot(SHOTS + '/shot-groupes.jpg');
  await R('replier le grand groupe', `${ok} const top=state.project.buses.find(b=>b.name==='Toutes les voix'); document.querySelector('.group-header[data-bus="'+top.id+'"] .group-toggle').click(); await new Promise(r=>setTimeout(r,150));
    const a=vis()+' | '+heads(); const rows=[...document.querySelectorAll('.timeline-track')].filter(e=>!e.classList.contains('is-group-collapsed')).length; document.querySelector('.group-header[data-bus="'+top.id+'"] .group-toggle').click(); return ok(vis()==='Rec,Instru'||a.startsWith('Rec,Instru'))+a+' | lignes de timeline visibles='+rows`);
  await R('le son passe par les deux groupes', `${ok} const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.2*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('ton',b);
    state.project.buses.forEach(x=>{delete x.effects; delete x.effectParams; delete x.sound;}); const lead=state.project.tracks.find(t=>t.name==='Lead'&&t.output==='v1'); lead.volume=100; lead.clips=[{id:'ton',start:0,duration:1}];
    const top=state.project.buses.find(x=>x.name==='Toutes les voix'); const m=async()=>{const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr*0.3;i<sr*0.8;i++)s+=x[i]*x[i]; return Math.sqrt(s/(sr*0.5));};
    const full=await m(); busById('v1').volume=50; top.volume=50; const quart=await m(); top.muted=true; const mute=await m(); top.muted=false; top.volume=100; busById('v1').volume=100;
    return ok(Math.abs(quart/full-0.25)<0.01&&mute<1e-5)+'plein='+full.toFixed(4)+' 50%x50%='+quart.toFixed(4)+' grand groupe coupé='+mute.toFixed(5)`);
  await R('sortir du grand groupe + annuler', `${ok} moveGroupInto('v1','master'); await new Promise(r=>setTimeout(r,150)); const a=heads(); undoAction(); await new Promise(r=>setTimeout(r,150)); return a+' | après ⌘Z: '+heads()`);
};
