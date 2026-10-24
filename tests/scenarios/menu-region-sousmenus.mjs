// Menu d'une région en sous-menus : rangement, Joindre, Décaler, Verrouiller (rien de l'ancien menu ne disparaît)
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ms1',name:'MS',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html');
  await sleep(2000);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*4,sr); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.2*Math.sin(i*0.05); PulseAudio.registerBuffer('k',b);
    state.project.tracks[0].clips=[{id:'k',start:1,duration:2,offset:0,name:'a'},{id:'k',start:4,duration:2,offset:0,name:'b'}]; state.selectedTrack=0; renderAll(); })()`);
  await sleep(300);
  await R('menu : lignes du premier niveau', `openClipContextMenu(300,200,0,0); await new Promise(r=>setTimeout(r,150)); const m=document.querySelector('.clip-ctx-menu'); return [...m.children].filter(e=>e.classList.contains('ctx-item')).map(e=>e.textContent.trim()).join(' | ')`);
  await R('sous-menu Édition (ouverture au survol)', `const row=[...document.querySelectorAll('.clip-ctx-menu .ctx-has-sub')].find(e=>/Édition/.test(e.textContent)); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,100)); const p=document.querySelector('.ctx-subpanel'); return p?[...p.querySelectorAll('.ctx-item')].map(e=>e.textContent.trim()).join(' | '):'AUCUN SOUS-MENU'`);
  await R('sous-menu Son (inverser et volume toujours là)', `const row=[...document.querySelectorAll('.clip-ctx-menu .ctx-has-sub')].find(e=>/^\\s*Son/.test(e.textContent)); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,100)); const p=document.querySelector('.ctx-subpanel'); return [...p.querySelectorAll('.ctx-item')].map(e=>e.textContent.trim()).join(' | ')`);
  await R('clic sur une action de sous-menu ferme tout (Inverser)', `const items=[...document.querySelectorAll('.ctx-subpanel .ctx-item')]; items.find(e=>/Inverser/.test(e.textContent)).click(); await new Promise(r=>setTimeout(r,200)); return 'rev='+!!state.project.tracks[0].clips[0].rev+' menuOuvert='+!!document.querySelector('.clip-ctx-menu')`);
  await R('Décaler +10 ms', `const c=state.project.tracks[0].clips[0]; c.rev=false; const before=c.start; nudgeClipsMs([c],10); return 'avant='+before+' après='+c.start.toFixed(3)`);
  await R('Verrouiller puis tenter de décaler/glisser', `const c=state.project.tracks[0].clips[0]; toggleClipsLocked([c]); const s0=c.start; nudgeClipsMs([c],50); const blocked=(c.start===s0); const el=document.querySelector('.timeline-track[data-i="0"] .clip[data-ci="0"]'); startClipDrag(new MouseEvent('mousedown',{clientX:100,clientY:100,bubbles:true}),el,0); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return 'locked='+c.locked+' décalage bloqué='+blocked+' après tentative de glisser start='+c.start.toFixed(3)`);
  await R('Déverrouiller', `const c=state.project.tracks[0].clips[0]; toggleClipsLocked([c]); return 'locked='+!!c.locked`);
  await R('Joindre 2 régions en une', `const t=state.project.tracks[0]; state.selectedClips=new Set(['0:0','0:1']); state.selectedClip={trackIdx:0,clipIdx:0}; await joinSelectedClips(0,0); await new Promise(r=>setTimeout(r,500)); const c=t.clips[0]; return 'régions='+t.clips.length+' début='+(c?c.start.toFixed(2):'?')+' durée='+(c?c.duration.toFixed(2):'?')+' (attendu ≈1.01 → 6, durée ≈5)'`);
  await R('⌘Z remet les 2 régions', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,300)); return 'régions='+state.project.tracks[0].clips.length`);
};
