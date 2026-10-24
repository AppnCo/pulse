// EQ : point dynamique ⚡ — creuse seulement quand sa zone dépasse le seuil. Mêmes chiffres que eq_point_dynamique (Rust).
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'dq',name:'DQ',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('export : fort / faible / loin de la zone', `
    const ctx=await PulseAudio.init(); const sr=48000;
    const mk=(id,f,a)=>{const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=a*Math.sin(2*Math.PI*f*i/sr); PulseAudio.registerBuffer(id,b);};
    mk('fort',1000,0.5); mk('faible',1000,0.005); mk('loin',100,0.5);
    const lvl=async(id,fx)=>{ const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id,start:0,duration:2}],...fx}]};
      const x=(await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      let s=0; for(let i=sr;i<2*sr;i++) s+=x[i]*x[i]; return 20*Math.log10(Math.sqrt(s/sr)+1e-12); };
    const eq={effects:['eq'],effectParams:{eq:{bands:[{type:'bell',freq:1000,gain:0,q:1,dyn:-12,thr:-30}]}}};
    const out=[]; for(const id of ['fort','faible','loin']) out.push(id+' '+((await lvl(id,eq))-(await lvl(id,{}))).toFixed(2));
    return out.join(' / ')+'  (Rust : fort -12.00 / faible 0.00 / 100 Hz -0.04)';`);
  await ev(`openEqPanel(0, document.body)`); await sleep(200);
  await R('poser un point et le passer en dynamique', `const svg=document.querySelector('.eq-svg'); const r=svg.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+r.width*0.5,clientY:r.top+r.height*0.3})); await new Promise(r=>setTimeout(r,40));
    document.querySelector('.eq-dyn').click(); await new Promise(r=>setTimeout(r,40)); const b=state.project.tracks[0].effectParams.eq.bands[0];
    return 'dyn='+b.dyn+' seuil='+b.thr+' ; rangée='+!!document.querySelector('.eq-dynrow')+' ; pointillés='+!!document.querySelector('.eq-dyn-lim')`);
  await R('plage + et seuil tapé', `document.querySelector('.eq-dp').click(); await new Promise(r=>setTimeout(r,30)); const i=document.querySelector('.eq-thr'); i.value='-24'; i.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,30)); const b=state.project.tracks[0].effectParams.eq.bands[0]; return 'dyn='+b.dyn+' seuil='+b.thr`);
  await R('⚡ à nouveau = point fixe', `document.querySelector('.eq-dyn').click(); await new Promise(r=>setTimeout(r,30)); const b=state.project.tracks[0].effectParams.eq.bands[0]; return 'dyn='+b.dyn+' dynamique='+PulseAudio.eqIsDynamic(b)`);
  // capture : un point dynamique qui travaille pendant la lecture
  await ev(`(async()=>{const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr*8,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(0.12*(Math.random()*2-1)+0.4*Math.sin(2*Math.PI*300*i/sr))*(0.5+0.5*Math.sin(2*Math.PI*1.3*i/sr)); await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'v.wav',{type:'audio/wav'}),0,0);})()`);
  await sleep(600);
  await ev(`(()=>{const t=state.project.tracks[0]; t.effects=['eq']; t.effectParams.eq={bands:[{type:'hpf',freq:70,q:0.71,slope:24},{type:'bell',freq:300,gain:-1,q:1.3,dyn:-8,thr:-26},{type:'bell',freq:3500,gain:3,q:0.9}]}; document.querySelectorAll('.eq-panel').forEach(p=>p.remove()); openEqPanel(0, document.body); const p=document.querySelector('.eq-panel'); p.style.left='20px'; p.style.top='40px'; const q=document.querySelector('.eq-pt[data-i="1"]'); q.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`);
  await ev(`state.playhead=0; togglePlay()`); await sleep(1700);
  await R('anneau en direct', `return 'anneaux='+document.querySelectorAll('.eq-dyn-ring').length+' gain='+(PulseAudio.getEqDyn('t0:1')||0).toFixed(1)`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/eq-dyn.jpg');
  await ev(`togglePlay()`);
};
