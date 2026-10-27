const SP = new URL('.', import.meta.url).pathname;
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rap1',name:'Mon son',bpm:90,
    buses:[{id:'allvocal',name:'All Vocal',output:'mixbus1',color:'#A855F7'},{id:'mixbus1',name:'Mix Bus 1',output:'mixbus2',color:'#7C3AED'},{id:'mixbus2',name:'Mix Bus 2',output:'master',locked:true,color:'#DC2626'}],
    tracks:[{name:'Capture',type:'audio',isCapture:true,armed:true,output:'allvocal',color:'#F472B6'},{name:'Lead Vocal',type:'audio',output:'allvocal',color:'#A855F7',effects:['eq','comp']},
            {name:'Doublage L',type:'audio',pan:-50,output:'allvocal',color:'#C084FC'},{name:'Instru',type:'audio',preset:'instru',output:'mixbus1',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('moteur', `const ctx=await PulseAudio.init(); const sr=48000,buf=ctx.createBuffer(1,sr*10,sr),d=buf.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.4*i/d.length; PulseAudio.registerBuffer('a',buf);
    const dec=async(bl)=>new OfflineAudioContext(1,1,48000).decodeAudioData(await bl.arrayBuffer()); const at=(b,t)=>b.getChannelData(0)[Math.round(t*b.sampleRate)]; const k=0.8*Math.SQRT1_2*0.4;
    const P=(clip,tr={},buses=[])=>({buses,tracks:[{volume:100,clips:[{id:'a',...clip}],...tr}]}); const o=[];
    const chk=(n,v,exp,tol=0.004)=>o.push((Math.abs(v-exp)<tol?'PASS ':'FAIL ')+n+' '+v.toFixed(4)+'/'+exp.toFixed(4));
    let b=await dec(await PulseAudio.exportWav(P({start:1,duration:2,offset:3}))); chk('offset',at(b,1.5)/k,0.35);
    b=await dec(await PulseAudio.exportWav(P({start:0,duration:1,offset:2,loopEnd:3.5}))); chk('loop',at(b,2.25)/k,0.225);
    b=await dec(await PulseAudio.exportWav(P({start:0,duration:2,offset:5,fadeIn:1,gain:0.5}))); chk('fade+gain',at(b,0.5)/k,0.1375);
    const buses=[{id:'g',output:'m2',volume:50},{id:'m2',output:'master',volume:50}];
    b=await dec(await PulseAudio.exportWav(P({start:0,duration:2,offset:5},{output:'g'},buses))); chk('bus chaînés 50%x50%',at(b,1)/k,0.6*0.25);
    buses[0].muted=true; b=await dec(await PulseAudio.exportWav(P({start:0,duration:2,offset:5},{output:'g'},buses))); chk('groupe muté',at(b,1)/k,0);
    b=await dec(await PulseAudio.exportTrackWav(P({start:0,duration:2,offset:5},{output:'g'},buses),0)); chk('stem ignore le bus',at(b,1)/(Math.SQRT1_2*0.4),0.6);
    return o.join(' | ');`);
  await R('bpm', `const ctx=PulseAudio.getContext(); const sr=48000; const mk=(bpm,sec=30)=>{const b=ctx.createBuffer(1,sr*sec,sr),d=b.getChannelData(0); const beat=60/bpm;
      for(let i=0;i<d.length;i++){const t=i/sr; const ph=t%beat, ph2=t%(beat/2); const n=Math.floor(t/beat)%4;
        d[i]=(ph<0.05?Math.sin(2*Math.PI*60*ph)*(1-ph/0.05)*0.9:0) + ((n===1||n===3)&&ph<0.04?(Math.random()*2-1)*0.5*(1-ph/0.04):0) + (ph2<0.01?(Math.random()*2-1)*0.2:0) + Math.sin(2*Math.PI*110*t)*0.05;} return b;};
    return [90,140,97,128,75,162].map(x=>x+'→'+detectBpmStub(mk(x))).join('  ')+'  bruit→'+detectBpmStub((()=>{const b=ctx.createBuffer(1,sr*20,sr),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*0.3;return b;})());`);
  await R('groupes', `const g=[...document.querySelectorAll('.group-header')].map(h=>h.querySelector('.group-name').textContent);
    const rows=document.querySelectorAll('.timeline-group-row').length; const hA=document.getElementById('tracksList').scrollHeight, hB=document.getElementById('timelineTracks').scrollHeight;
    document.querySelector('.group-toggle').click(); const hidden=document.querySelectorAll('.track-item.is-group-collapsed').length+'/'+document.querySelectorAll('.timeline-track.is-group-collapsed').length;
    document.querySelector('.group-toggle').click();
    createGroupWithTrack(3); const g2=document.querySelectorAll('.group-header').length; moveTrackToGroup(2, state.project.buses.find(b=>b.isGroup).id);
    const order=state.project.tracks.map(t=>t.name+'>'+t.output.slice(0,4)).join(', '); removeTrackFromGroup(state.project.tracks.findIndex(t=>t.name==='Doublage L')); dissolveGroup(state.project.buses.find(b=>b.isGroup).id);
    return JSON.stringify({g,rows,alignés:hA+' vs '+hB,hidden,g2,order,apres:state.project.tracks.map(t=>t.output).join(','),buses:state.project.buses.length});`);
  await R('.pulse', `const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr*3,sr); b.getChannelData(0).fill(0.25);
    const f=new File([PulseAudio.audioBufferToWav(b)],'voix.wav',{type:'audio/wav'}); await importAudioFile(f,1,2); splitClipAt(1,0,3);
    const {blob,clips,missing}=await PulseFile.pack(state.project); const before=JSON.stringify(state.project.tracks[1].clips.map(c=>[c.start,c.duration,c.offset||0]));
    await PulsePersist.clearAll(); const p=await PulseFile.unpack(new File([blob],'x.pulse'));
    const id=p.tracks[1].clips[0].id; const back=await PulsePersist.loadBlob(id);
    return JSON.stringify({taille:blob.size,clips,missing,memeProjet:JSON.stringify(p.tracks[1].clips.map(c=>[c.start,c.duration,c.offset||0]))===before,audioRestaure:!!back&&back.size});`);
  await ev(`saveProject(); flushProjectDocSave()`); await sleep(500);
  await nav('http://localhost:8765/index.html'); await sleep(500);
  await R('accueil', `return JSON.stringify({recents:[...document.querySelectorAll('.recent-item-name')].map(e=>e.textContent), docs:(await PulsePersist.listProjectDocs()).map(d=>d.name+':'+((d.tracks[1]||d.tracks[0]||{clips:[]}).clips.length)+'clips'), bouton:!!document.getElementById('btnOpenFile')})`);
};
