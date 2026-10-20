// Auto-Tune dans l'app : appliquer, vérifier la note, sauvegarder, retirer
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tu1',name:'Tune',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('import voix fausse (452 Hz)', `const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*4,sr),d=b.getChannelData(0); let ph=0;
    for(let i=0;i<d.length;i++){ ph+=2*Math.PI*452/sr; let s=0; for(let h=1;h<=10;h++) s+=Math.sin(h*ph)/h; d[i]=0.3*s; }
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'voix.wav',{type:'audio/wav'}),0,1); splitClipAt(0,0,3);
    return state.project.tracks[0].clips.map(c=>c.start+'→'+(c.start+c.duration)+' off'+(c.offset||0)).join(' | ')`);
  const pitch = `const med=async(id,from,to)=>{ const b=PulseAudio.getBuffer(id); const f=await PulseTune.trackPitch(b.getChannelData(0).subarray(from*48000,to*48000),48000); const s=Array.from(f).filter(v=>v>0).sort((p,q)=>p-q); return s.length? s[s.length>>1].toFixed(1):'aucune'; };`;
  await R('appliquer sur le 2e clip', `${pitch} const c=state.project.tracks[0].clips[1]; const before=c.id; await applyTune(c,{root:'auto',strength:1});
    return JSON.stringify({change:c.id!==before, tune:c.tune, noteDansLeClip: await med(c.id,2.2,3.8), noteAvantLeClip: await med(c.id,0.3,1.5), clip1Intact: state.project.tracks[0].clips[0].id===before, texte: document.querySelector('.clip-gain-tag')?.textContent})`);
  await R('.pulse garde original + corrigé', `saveProject(); const p=await PulseFile.pack(state.project); return p.clips+' sons, '+p.missing+' manquant'`);
  await R('undo / redo', `undoAction(); const a=!!state.project.tracks[0].clips[1].tune; redoAction(); return 'après undo tune='+a+', après redo tune='+!!state.project.tracks[0].clips[1].tune`);
  await ev(`(()=>{ const el=document.querySelectorAll('.clip')[1]; const r=el.getBoundingClientRect(); openTunePanel(0,1,r.left+20,r.bottom+10); })()`); await sleep(300);
  if (SHOTS) await shot(SHOTS + '/shot-tune.jpg');
  await R('retirer', `${pitch} const c=state.project.tracks[0].clips[1]; await removeTune(c); return JSON.stringify({tune:c.tune||null, note: await med(c.id,2.2,3.8)})`);
  await R('instru sans note', `const ctx=PulseAudio.getContext(); const b=ctx.createBuffer(1,48000*2,48000); const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*0.2;
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'bruit.wav',{type:'audio/wav'}),0,6); const c=state.project.tracks[0].clips.find(c=>c.start===6); await applyTune(c,{root:'auto',strength:1}); return 'tune='+!!c.tune+' | message: '+(document.querySelector('.flash')?.textContent||document.getElementById('flash')?.textContent||'?')`);
};
