// Piano roll + séquenceur de pas : créer une région, poser des notes, cases de batterie, son rendu, tempo
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'mid1',name:'Midi',bpm:120,buses:[],tracks:[{name:'Piano 1',type:'keys',midiInst:'piano',color:'#A855F7',clips:[],volume:80},{name:'Batterie 1',type:'drums',midiInst:'drums',color:'#F472B6',clips:[],volume:80}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(800);
  const R = async (label, code) => { const r = await ev(`(async()=>{${code}})()`); console.log(label + ':', r); return r; };
  const wait = `await new Promise(r=>setTimeout(r,60));`;
  await R('double-clic dans le vide : région créée + éditeur ouvert', `
    const tr=document.querySelector('.timeline-track[data-i="0"]'); const r=tr.getBoundingClientRect();
    tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+30,clientY:r.top+20}));
    await new Promise(r=>setTimeout(r,500));
    const c=state.project.tracks[0].clips[0];
    return 'régions='+state.project.tracks[0].clips.length+', midi='+!!(c&&c.midi)+', buffer='+(c&&PulseAudio.hasBuffer(c.id))+', éditeur='+PulsePianoRoll.isOpen()+', durée='+(c&&c.duration)`);
  await R('poser 2 notes à la souris', `
    const cv=document.querySelector('.me-cv'), cr=cv.getBoundingClientRect(), S=PulsePianoRoll._state();
    const at=(beat,p)=>({clientX:cr.left+66+beat*S.pxBeat-S.sx+3, clientY:cr.top+22+(127-p)*S.rowH-S.sy+S.rowH/2});
    const click=(b,p,drag)=>{ const a=at(b,p); cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,...a})); if(drag){ const z=at(b+drag,p); window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,...z})); } window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); };
    click(0,60,1); ${wait} click(2,64,0.5); ${wait}
    PulsePianoRoll.flush(); await new Promise(r=>setTimeout(r,900));
    const c=state.project.tracks[0].clips[0];
    return 'notes='+JSON.stringify(c.midi.notes)`);
  await R('le son est rendu et la région dessine les notes', `
    const c=state.project.tracks[0].clips[0], b=PulseAudio.getBuffer(c.id); let pk=0; const d=b.getChannelData(0); for(let i=0;i<d.length;i+=7) pk=Math.max(pk,Math.abs(d[i]));
    const dd=(document.querySelector('.timeline-track[data-i="0"] .midi-notes path')?.getAttribute('d')||'');
    return 'crête='+pk.toFixed(2)+', durée buffer='+b.duration.toFixed(2)+' s, notes dessinées='+(dd.split('M').length-1)`);
  await R('flèche haut : la note monte d un demi-ton', `
    const S=PulsePianoRoll._state(); S.sel=new Set([S.notes[0]]); document.querySelector('.midi-editor').dispatchEvent(new MouseEvent('mouseenter'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
    return 'p='+S.notes[0].p+' (61 attendu)'`);
  await R('⌘Z dans l éditeur annule', `
    const S=PulsePianoRoll._state(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));
    return 'p='+S.notes[0].p+' (60 attendu)'`);
  await R('Échap ferme et enregistre', `
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,600));
    return 'éditeur='+PulsePianoRoll.isOpen()+', notes='+state.project.tracks[0].clips[0].midi.notes.length`);
  await R('batterie : séquenceur de pas, modèle Trap', `
    const tr=document.querySelector('.timeline-track[data-i="1"]'); const r=tr.getBoundingClientRect();
    tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+30,clientY:r.top+20}));
    await new Promise(r=>setTimeout(r,500));
    const S=PulsePianoRoll._state(); const tpl=document.querySelector('.me-tpl'); tpl.value='trap'; tpl.dispatchEvent(new Event('change'));
    PulsePianoRoll.flush(); await new Promise(r=>setTimeout(r,900));
    const c=state.project.tracks[1].clips[0]; const k=c.midi.notes.filter(n=>n.p===36).length, h=c.midi.notes.filter(n=>n.p===42).length;
    return 'vue='+S.view+', kicks='+k+', hats='+h+', coups='+c.midi.notes.length`);
  await R('un clic dans une case ajoute un coup, un second le retire', `
    const cv=document.querySelector('.me-cv'), cr=cv.getBoundingClientRect(), S=PulsePianoRoll._state();
    const x=cr.left+110+S.pxBeat*0.25*3+4, y=cr.top+22+S.stepRowH*3+S.stepRowH/2;   // rim, pas 3
    const n0=S.notes.length;
    cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x,clientY:y})); window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    const n1=S.notes.length;
    cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x,clientY:y})); window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    return n0+' → '+n1+' → '+S.notes.length`);
  await R('le tempo change : les régions suivent', `
    PulsePianoRoll.close(); await new Promise(r=>setTimeout(r,300));
    const c=state.project.tracks[1].clips[0], d0=c.duration; const bi=document.getElementById('bpmInput'); bi.value='90'; bi.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,1800));
    return 'durée '+d0.toFixed(2)+' → '+c.duration.toFixed(2)+' s (2,67 attendu), bpm midi='+c.midi.bpm`);
  await R('tous les sons sont en mémoire', `
    const ids=state.project.tracks.flatMap(t=>t.clips.map(c=>c.id)); return 'régions='+ids.length+', buffers='+ids.filter(i=>PulseAudio.hasBuffer(i)).length`);

  // --- Mélange FL / Logic : accords, gamme, outils, swing, régions liées, jeu en direct
  await R('accord majeur posé d un clic + calé sur la gamme', `
    const tr=document.querySelector('.timeline-track[data-i="0"]'); const clip=state.project.tracks[0].clips[0];
    document.querySelector('.timeline-track[data-i="0"] .clip').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const S=PulsePianoRoll._state(), cv=document.querySelector('.me-cv'), cr=cv.getBoundingClientRect();
    S.notes.length=0; S.midi.notes=S.notes;
    const ch=document.querySelector('.me-chord'); ch.value='1'; ch.dispatchEvent(new Event('change'));
    const sc=document.querySelector('.me-scale'); sc.value='t:0:0'; sc.dispatchEvent(new Event('change'));
    const lk=document.querySelector('.me-lock'); lk.checked=true; lk.dispatchEvent(new Event('change'));
    const at=(b,p)=>({clientX:cr.left+66+b*S.pxBeat-S.sx+3, clientY:cr.top+22+S.rowIdx[p]*S.rowH-S.sy+S.rowH/2});
    const nRows=S.rows.length, hid=S.rows.includes(61);
    cv.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,...at(1,62)})); window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    return 'rangées='+nRows+' (75 attendues), Do# visible='+hid+', notes='+S.notes.map(n=>n.p).sort((a,b)=>a-b).join(',')+' (accord de la gamme sur Ré : Ré Fa La = 62,65,69)'`);
  await R('outil Legato', `
    const S=PulsePianoRoll._state(); S.sel.clear(); S.notes.length=0; S.midi.notes=S.notes;
    [[0,60],[1,62],[2.5,64]].forEach(([s,p])=>S.notes.push({s,d:0.25,p,v:100}));
    const t=document.querySelector('.me-tools'); t.value='legato'; t.dispatchEvent(new Event('change'));
    return 'durées='+S.notes.map(n=>n.d).join(',')+' (1, 1.5, 1.5)'`);
  await R('outil Arpège sur un accord', `
    const S=PulsePianoRoll._state(); S.sel.clear(); S.notes.length=0; S.midi.notes=S.notes;
    [60,64,67].forEach(p=>S.notes.push({s:0,d:1,p,v:100}));
    const t=document.querySelector('.me-tools'); t.value='arp'; t.dispatchEvent(new Event('change'));
    return 'notes='+S.notes.length+' pas de '+S.notes[0].d+' : '+S.notes.map(n=>n.p+'@'+n.s).join(' ')`);
  await R('swing : le 2e seizième est rendu plus tard', `
    PulsePianoRoll.close(); await new Promise(r=>setTimeout(r,200));
    const mk=(sw)=>{ const b=renderMidiBuffer({inst:'drums',beats:4,swing:sw,notes:[{s:0.25,d:0.25,p:42,v:120}]},120); const d=b.getChannelData(0); let i=0; while(i<d.length&&Math.abs(d[i])<0.01) i++; return i/b.sampleRate; };
    const a=mk(0), b=mk(1); return 'attaque '+a.toFixed(3)+' s → '+b.toFixed(3)+' s (écart attendu ≈ 0,042 s)'`);
  await R('copie liée : modifier l une modifie l autre', `
    linkDuplicateMidi(0,0); await new Promise(r=>setTimeout(r,200));
    const cs=state.project.tracks[0].clips; const a=cs[0], b=cs[1];
    openMidiEditor(0,0); const S=PulsePianoRoll._state(); S.notes.push({s:3,d:0.5,p:72,v:100}); S.sel=new Set([S.notes[S.notes.length-1]]);
    document.querySelector('.midi-editor').dispatchEvent(new MouseEvent('mouseenter'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
    PulsePianoRoll.flush(); await new Promise(r=>setTimeout(r,900));
    return 'régions='+cs.length+', même pid='+(a.midi.pid===b.midi.pid&&!!a.midi.pid)+', même son='+(a.id===b.id)+', notes B='+b.midi.notes.length+' (dernière '+b.midi.notes[b.midi.notes.length-1].p+')'`);
  await R('jouer en direct : une touche enregistre une note', `
    const S=PulsePianoRoll._state(); state.playing=true; state.playhead=state.project.tracks[0].clips[0].start+0.5;
    document.querySelector('.me-rec').click();
    const n0=S.notes.length;
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'d',bubbles:true,cancelable:true}));
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'d',bubbles:true}));
    state.playing=false; PulsePianoRoll.close(); await new Promise(r=>setTimeout(r,900));
    const nn=state.project.tracks[0].clips[0].midi.notes; return n0+' → '+nn.length+' (note '+nn[nn.length-1].p+' attendue 64 : Mi)'`);

  await R('jouer en direct sans caler : garde le jeu exact', `
    await openMidiEditor(0,0); await new Promise(r=>setTimeout(r,300));
    const S=PulsePianoRoll._state(); const bpm=state.project.bpm; const c=state.project.tracks[0].clips[0];
    state.playing=true; state.playhead=c.start+0.53*60/bpm*2;
    document.querySelector('.me-rec').click(); const cb=document.querySelector('.me-recq'); cb.checked=false; cb.dispatchEvent(new Event('change'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}));
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'f',bubbles:true}));
    const n=S.notes[S.notes.length-1]; const off=Math.abs(n.s*4-Math.round(n.s*4));
    state.playing=false; PulsePianoRoll.close(); await new Promise(r=>setTimeout(r,600));
    return 'début '+n.s.toFixed(3)+' temps, écart à la grille '+off.toFixed(2)+' (doit être > 0)'`);

  await R('import .mid : une région avec les notes du fichier', `
    PulsePianoRoll.close(); await new Promise(r=>setTimeout(r,300));
    const bytes=PulseMidiFile.encode([{notes:[{s:0,d:1,p:60,v:100},{s:4,d:2,p:67,v:90},{s:8,d:1,p:72,v:80}]}],100);
    const f=new File([bytes],'melodie.mid',{type:'audio/midi'});
    const n0=state.project.tracks[0].clips.length;
    await importMidiFile(f,0,10);
    const cs=state.project.tracks[0].clips, c=cs[cs.length-1];
    return 'régions '+n0+' → '+cs.length+', notes='+c.midi.notes.length+', mesures='+c.midi.beats/4+', start='+c.start.toFixed(2)+' s, son='+PulseAudio.hasBuffer(c.id)`);
  await R('export de la piste en .mid puis relecture', `
    let got=null; const orig=window.triggerDownload; window.triggerDownload=(b,n)=>{ got={b,n}; };
    exportMidiTrack(0); window.triggerDownload=orig;
    if(!got) return 'pas de téléchargement';
    const r=PulseMidiFile.decode(await got.b.arrayBuffer());
    return got.n+' : '+r.notes.length+' notes, '+r.bpm+' BPM, dernière note à '+r.notes[r.notes.length-1].s.toFixed(1)+' temps'`);
};
