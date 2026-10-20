// Envois : reverb et écho communs, 100 % effet, dosés par piste, à part des effets de la piste
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'en1',name:'Envois',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'},{name:'Back',type:'audio',color:'#C084FC'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`toggleMixer()`); await sleep(500);
  await R('envois de base', `return projectSends().map(s=>s.name+'('+s.type+')').join(', ')+' | curseurs par piste='+document.querySelectorAll('.mixer-strips .strip[data-kind=track]')[0].querySelectorAll('.send-level').length+' | retours='+document.querySelectorAll('.strip-return').length+' | séparés des inserts='+!document.querySelector('.strip-fx .send-level')`);
  const tools = `const ctx=await PulseAudio.init(); const sr=48000; if(!PulseAudio.getBuffer('clap')){const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<4800;i++)d[i]=0.5*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('clap',b);}
    const run=async(sends,extra={},defs)=>{const p={bpm:120,buses:[],sends:defs||projectSends(),tracks:[{volume:100,clips:[{id:'clap',start:0,duration:1}],sends,...extra}]};
      const o=await ctx.decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer()); const x=o.getChannelData(0);
      const rms=(a,len=0.1)=>{let s=0; for(let i=Math.round(a*sr);i<Math.round((a+len)*sr);i++)s+=x[i]*x[i]; return Math.sqrt(s/(len*sr));}; return {o,rms};};
    const f=(v)=>v.toFixed(5); const ok=(c)=>c?'PASS ':'FAIL ';`;
  await R('sans envoi', `${tools} const r=await run({}); return ok(r.rms(0.3,0.5)<1e-5&&r.o.duration<1.1)+'direct='+f(r.rms(0))+' après='+f(r.rms(0.3,0.5))+' durée='+r.o.duration.toFixed(1)+'s'`);
  await R('écho 1 temps (0,5 s à 120 BPM)', `${tools} const r=await run({del14:50}); return ok(Math.abs(r.rms(0)-0.2)<0.002&&r.rms(0.5)>0.05&&r.rms(0.25)<1e-5)+'direct intact='+f(r.rms(0))+' à 0,25 s='+f(r.rms(0.25))+' à 0,5 s='+f(r.rms(0.5))+' à 1 s='+f(r.rms(1))+' durée='+r.o.duration.toFixed(1)+'s'`);
  await R('la dose compte', `${tools} const a=await run({del14:50}), b=await run({del14:25}); return ok(Math.abs(a.rms(0.5)/b.rms(0.5)-2)<0.02)+'50 → '+f(a.rms(0.5))+' | 25 → '+f(b.rms(0.5))`);
  await R('reverb longue', `${tools} const r=await run({revlong:40}); const d=PulseAudio; return ok(Math.abs(r.rms(0)-0.2)<0.02&&r.rms(0.3,0.5)>0.005&&r.rms(1.5,0.5)>0.0005)+'direct='+f(r.rms(0))+' queue='+f(r.rms(0.3,0.5))+' tard='+f(r.rms(1.5,0.5))+' durée='+r.o.duration.toFixed(1)+'s'`);
  await R('pré-délai 100 ms', `${tools} const defs=JSON.parse(JSON.stringify(projectSends())); const a=await run({revlong:100},{},defs); defs[0].pre=100; const b=await run({revlong:100},{},defs);
    const first=(r)=>{const x=r.o.getChannelData(0); const dry=r.o; return 0;}; return ok(b.rms(0.105,0.02)<a.rms(0.105,0.02)*0.5)+'juste après la note, sans pré-délai='+f(a.rms(0.105,0.02))+' avec='+f(b.rms(0.105,0.02))`);
  await R('piste coupée = plus d’envoi', `${tools} const r=await run({del14:50},{muted:true}); return ok(r.rms(0.5)<1e-5)+'à 0,5 s='+f(r.rms(0.5))`);
  await R('curseur dans le mixer', `const sl=document.querySelectorAll('.mixer-strips .strip[data-kind=track]')[0].querySelector('[data-send=del14] .send-level'); sl.value=35; sl.dispatchEvent(new Event('input')); sl.dispatchEvent(new Event('change'));
    return JSON.stringify(state.project.tracks[0].sends)+' | autre piste='+JSON.stringify(state.project.tracks[1].sends||{})`);
  await ev(`document.querySelector('.strip-return[data-send=revlong] .return-edit').click()`); await sleep(300);
  if (SHOTS) await shot(SHOTS + '/shot-envois.jpg');
  await R('régler la reverb', `const p=document.querySelector('.send-panel'); const pre=p.querySelector('.send-pre'); const a='pré-délai de base='+pre.value; pre.value='20'; pre.dispatchEvent(new Event('change')); return a+' → '+projectSends()[0].pre+' ms'`);
  await R('ajouter puis retirer', `addSend('delay'); await new Promise(r=>setTimeout(r,200)); const n=projectSends().length; const id=projectSends()[2].id; state.project.tracks[0].sends[id]=20; removeSend(id);
    return 'après ajout='+n+' | après retrait='+projectSends().length+' | dose nettoyée='+!(id in state.project.tracks[0].sends)+' | retours affichés='+document.querySelectorAll('.strip-return').length`);
  await R('retirer Rev Long ne laisse pas de reverb fantôme', `const t=state.project.tracks[0]; t.sound={preset:'back',tone:0,hold:55,drive:0,space:36,deess:40,echo:0}; applySound(t); const a=t.sends.revlong; removeSend('revlong'); applySound(t);
    return ((a===36&&!t.effects.includes('reverb')&&t.sound.space===0)?'PASS ':'FAIL ')+'dose avant='+a+' | après retrait: effets='+JSON.stringify(t.effects)+' espace='+t.sound.space+' | ⌘Z: '+(undoAction(),projectSends().length)+' envois'`);
};
