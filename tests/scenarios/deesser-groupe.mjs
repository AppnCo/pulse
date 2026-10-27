// De-esser (curseur « S adoucis ») et son de groupe
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'de1',name:'Deess',bpm:90,
    buses:[{id:'voix',name:'Voix',output:'master',color:'#A855F7'}],
    tracks:[{name:'Lead',type:'audio',armed:true,output:'voix',color:'#A855F7'},{name:'Back',type:'audio',output:'voix',color:'#C084FC'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('de-esser', `const ctx=await PulseAudio.init(); const sr=48000;
    const tone=(id,f,amp)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=amp*Math.sin(2*Math.PI*f*i/sr); PulseAudio.registerBuffer(id,b);};
    const mix=(id,parts)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(const [f,amp] of parts)for(let i=0;i<d.length;i++)d[i]+=amp*Math.sin(2*Math.PI*f*i/sr); PulseAudio.registerBuffer(id,b);};
    mix('voyelle',[[400,0.3],[7500,0.02]]); mix('sss',[[7500,0.3]]); mix('sssfaible',[[7500,0.03]]); mix('grave',[[150,0.4]]);
    const rms=async(id,fx)=>{const p={buses:[],tracks:[{volume:100,clips:[{id,start:0,duration:2}],effects:fx?['deess']:[],effectParams:{deess:{amount:60}}}]};
      const b=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer()); const d=b.getChannelData(0); let s=0,n=0; for(let i=sr*0.5;i<sr*1.5;i++){s+=d[i]*d[i];n++;} return Math.sqrt(s/n);};
    const o=[]; for(const [id,lo,hi] of [['voyelle',-0.1,0.1],['grave',-0.1,0.1],['sss',-11,-6],['sssfaible',-11,-6]]){const dB=20*Math.log10(await rms(id,true)/await rms(id,false)); o.push((dB>=lo&&dB<=hi?'PASS ':'FAIL ')+id+' '+dB.toFixed(2)+' dB');}
    return o.join(' | ');`);
  await R('compresseur (volume maîtrisé)', `const ctx=PulseAudio.getContext(); const sr=48000; const o=[];
    for(const [amp,lo,hi] of [[0.03,3,6.5],[0.3,-2,1.5],[0.7,-7,-3]]){const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=amp*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('c'+amp,b);
      const rms=async(tr)=>{const p={buses:[],tracks:[{volume:100,clips:[{id:'c'+amp,start:0,duration:2}],...tr}]}; const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr;i<sr*1.8;i++)s+=x[i]*x[i]; return Math.sqrt(s/(sr*0.8));};
      const t={sound:{preset:'raw',tone:0,hold:35,drive:0}}; applySound(t); const dB=20*Math.log10(await rms(t)/await rms({})); o.push((dB>=lo&&dB<=hi?'PASS ':'FAIL ')+(20*Math.log10(amp)).toFixed(0)+' dB → '+dB.toFixed(1));}
    return o.join(' | ');`);
  await R('limiteur du master', `const ctx=PulseAudio.getContext(); const sr=48000; const o=[];
    const mk=(id,amp)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=amp*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer(id,b);}; mk('doux',0.5); mk('fort',0.95);
    const run=async(id,n)=>{const p={buses:[],tracks:Array.from({length:n},()=>({volume:100,clips:[{id,start:0,duration:2}]}))}; const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer())).getChannelData(0);
      const rms=(a,z)=>{let s=0; for(let i=a*sr;i<z*sr;i++)s+=x[i]*x[i]; return Math.sqrt(s/((z-a)*sr));}; let pk=0; for(let i=0;i<x.length;i++)pk=Math.max(pk,Math.abs(x[i])); return {debut:rms(0.02,0.05), suite:rms(1,1.5), pk};};
    let r=await run('doux',1); const exp=0.8*Math.SQRT1_2*0.5/Math.SQRT2; o.push((Math.abs(r.debut/exp-1)<0.02&&Math.abs(r.suite/exp-1)<0.01?'PASS ':'FAIL ')+'transparent dès la 1re note: début '+(r.debut/exp).toFixed(3)+' suite '+(r.suite/exp).toFixed(3));
    r=await run('fort',3); o.push((r.pk<=0.9665&&r.pk>0.93?'PASS ':'FAIL ')+'3 pistes trop fortes (1,61 sans limiteur) → crête '+r.pk.toFixed(3));
    return o.join(' | ');`);
  await R('presets', `const t=state.project.tracks[0]; t.sound={preset:'lead',tone:0,hold:35,drive:0,space:0,deess:30}; applySound(t); const a=JSON.stringify(t.effects)+JSON.stringify(t.effectParams.deess);
    t.sound={preset:'back',tone:0,hold:55,drive:0}; applySound(t); const b=JSON.stringify(t.effects)+JSON.stringify(t.effectParams.reverb);
    t.sound={preset:'lead',tone:0,hold:35,drive:0,space:0,deess:0}; applySound(t); return a+' | ancien projet back: '+b+' | tout à zéro: '+JSON.stringify(t.effects);`);
  await R('son de groupe (clic)', `document.querySelector('.g-son').click(); await new Promise(r=>setTimeout(r,200)); const p=document.querySelector('.sound-panel');
    const chips=[...p.querySelectorAll('.sound-chip')].map(c=>c.textContent).join(','); const sliders=[...p.querySelectorAll('.fx-slider')].map(s=>s.dataset.key).join(',');
    [...p.querySelectorAll('.sound-chip')].find(c=>c.dataset.preset==='wide').click(); await new Promise(r=>setTimeout(r,200));
    const bus=state.project.buses[0]; return chips+' | curseurs '+sliders+' | bus.effects='+JSON.stringify(bus.effects)+JSON.stringify(bus.effectParams.reverb)+' sends='+JSON.stringify(bus.sends)+' | bouton actif='+document.querySelector('.g-son').classList.contains('active')+' | panneau rouvert='+!!document.querySelector('.sound-panel .sound-chip.active');`);
  await R('reverb commune dans le son', `const ctx=PulseAudio.getContext(); const sr=48000; const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<4800;i++)d[i]=0.5*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('clap',b);
    const mk=(fx)=>({sends:projectSends(),buses:[{id:'voix',output:'master',volume:100,...(fx?{effects:state.project.buses[0].effects,effectParams:state.project.buses[0].effectParams,sends:state.project.buses[0].sends}:{})}],tracks:[{volume:100,output:'voix',clips:[{id:'clap',start:0,duration:1}]}]});
    const meas=async(p)=>{const o=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer()); const x=o.getChannelData(0); let s=0; for(let i=sr*0.3;i<sr*0.9;i++)s+=x[i]*x[i]; return o.duration.toFixed(1)+'s queue='+Math.sqrt(s/(sr*0.6)).toFixed(5);};
    return 'sans: '+await meas(mk(false))+' | avec: '+await meas(mk(true));`);
  await R('annuler', `undoAction(); await new Promise(r=>setTimeout(r,200)); return 'bus.effects après ⌘Z='+JSON.stringify(state.project.buses[0].effects||[]);`);
};
