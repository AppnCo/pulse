// Joindre des régions de notes : une région, toutes les notes à leur place (répétition comprise), annulable
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'jn1',name:'JN',bpm:120,buses:[],sends:[],tracks:[{name:'Piano',type:'keys',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    await PulseAudio.init(); const t=state.project.tracks[0];
    const a={start:0,duration:2,offset:0,name:'A'}; await bakeMidiClip(a,{inst:'piano',beats:4,notes:[{s:0,d:1,p:60,v:100},{s:2,d:1,p:64,v:100}]},120); a.loopEnd=4;
    const b={start:6,duration:2,offset:0,name:'B'}; await bakeMidiClip(b,{inst:'piano',beats:4,notes:[{s:1,d:1,p:67,v:90}]},120);
    t.clips=[a,b]; renderAll();
    state.selectedClips=new Set(['0:0','0:1']); state.selectedClip={trackIdx:0,clipIdx:0};
    await joinSelectedClips(0,0); await new Promise(r=>setTimeout(r,300));
    const c=t.clips[0];
    const res={n:t.clips.length, start:c.start, dur:c.duration, beats:c.midi.beats, notes:c.midi.notes.map(n=>n.s+':'+n.p).join(' '), son:!!PulseAudio.getBufferDuration(c.id)};
    res.pile=_undoStack.length; res.piano=!!(window.PulsePianoRoll&&PulsePianoRoll.isOpen());
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,300));
    res.apresZ=state.project.tracks[0].clips.length;
    return JSON.stringify(res);
  })()`));
  console.log(JSON.stringify(r));
  check('une seule région de 0 à 8 s (16 temps)', r.n === 1 && r.start === 0 && Math.abs(r.dur - 8) < 1e-6 && Math.abs(r.beats - 16) < 1e-6, r.dur + ' s / ' + r.beats);
  check('notes à leur place (A deux fois, puis B)', r.notes === '0:60 2:64 4:60 6:64 13:67', r.notes);
  check('le son de la région est rendu', r.son);
  check('⌘Z remet les deux régions', r.apresZ === 2, r.apresZ);
};
