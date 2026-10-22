// Auto-Tune : gamme lue sur l'instru + notes éteintes au clavier (méthode Ridwane)
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'tk1',name:'Clavier',bpm:90,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'},{name:'Instru',type:'audio',preset:'instru',color:'#60A5FA'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('import voix (300 Hz) + prod en La mineur', `const ctx=await PulseAudio.init(); const sr=48000; const hz=m=>440*Math.pow(2,(m-69)/12);
    let b=ctx.createBuffer(1,sr*3,sr),d=b.getChannelData(0),ph=0; for(let i=0;i<d.length;i++){ ph+=2*Math.PI*300/sr; let s=0; for(let h=1;h<=10;h++) s+=Math.sin(h*ph)/h; d[i]=0.3*s; }
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'voix.wav',{type:'audio/wav'}),0,0);
    const ch=[[[57,60,64],33],[[53,57,60],29],[[48,52,55],36],[[55,59,62],31]]; b=ctx.createBuffer(1,sr*24,sr); d=b.getChannelData(0);
    for(let i=0;i<d.length;i++){const t=i/sr,c=ch[Math.floor(t/2)%4]; let s=0; for(const m of c[0])for(let h=1;h<=4;h++)s+=Math.sin(2*Math.PI*hz(m)*h*t)/(h*3); s+=0.9*Math.sin(2*Math.PI*hz(c[1])*t); d[i]=0.2*s;}
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'prod.wav',{type:'audio/wav'}),1,0);
    return state.project.tracks.map(t=>t.name+':'+t.clips.length).join(' ')`);
  await ev(`(()=>{ const el=document.querySelector('.clip'); const r=el.getBoundingClientRect(); openTunePanel(0,0,r.left+20,r.bottom+10); })()`); await sleep(2500);
  await R('panneau', `const p=document.querySelector('.tune-panel'); return p.querySelector('.tune-status').textContent+' | allumées: '+[...p.querySelectorAll('.tune-key-btn.on')].map(k=>PulseTune.NOTE_NAMES[k.dataset.pc]).join(' ')+' | projet.key='+JSON.stringify(state.project.key?.label)`);
  await R('choisir Fa# mineur', `const p=document.querySelector('.tune-panel'); const sel=p.querySelector('.tune-tonic'); const lu=sel.value+'/'+p.querySelector('.tune-mode .on').textContent; sel.value='6'; sel.dispatchEvent(new Event('change'));
    p.querySelector('[data-minor="1"]').click(); const fm=[...p.querySelectorAll('.tune-key-btn.on')].map(k=>PulseTune.NOTE_NAMES[k.dataset.pc]).join(' '); p.querySelector('[data-minor="0"]').click(); const fM=[...p.querySelectorAll('.tune-key-btn.on')].length+' notes, Fa# allumé='+p.querySelector('[data-pc="6"]').classList.contains('on')+' La# allumé='+p.querySelector('[data-pc="10"]').classList.contains('on');
    sel.value='9'; sel.dispatchEvent(new Event('change')); p.querySelector('[data-minor="1"]').click();
    return 'lu sur instru='+lu+' | Fa# mineur: '+fm+' | Fa# majeur: '+fM+' | retour La mineur: '+[...p.querySelectorAll('.tune-key-btn.on')].map(k=>PulseTune.NOTE_NAMES[k.dataset.pc]).join(' ')`);
  await R('éteindre Ré', `const p=document.querySelector('.tune-panel'); p.querySelector('[data-pc="2"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,metaKey:true,button:0})); return p.querySelector('.tune-status').textContent+' | Ré allumé='+p.querySelector('[data-pc="2"]').classList.contains('on')`);
  if (SHOTS) await shot(SHOTS + '/shot-tune-clavier.jpg');
  await ev(`document.querySelector('.tb-power').click()`); await sleep(3000);
  await R('résultat', `const c=state.project.tracks[0].clips[0]; const b=PulseAudio.getBuffer(c.id); const f=await PulseTune.trackPitch(b.getChannelData(0).subarray(24000,120000),b.sampleRate); const s=Array.from(f).filter(v=>v>0).sort((p,q)=>p-q); const m=s[s.length>>1];
    return (Math.abs(1200*Math.log2(m/329.63))<12?'PASS ':'FAIL ')+'note '+m.toFixed(1)+' Hz (Ré éteint → Mi 329,6) | tune.source='+c.tune.source+' | gamme du morceau gardée='+state.project.key.notes.filter(Boolean).length+' notes | message: '+(document.querySelector('.flash')?.textContent||'')`);
  await ev(`(()=>{ openTunePanel(0,0,200,200); })()`); await sleep(300);
  await R('rouvrir', `const p=document.querySelector('.tune-panel'); return 'allumées: '+[...p.querySelectorAll('.tune-key-btn.on')].length+' | bouton='+(p.classList.contains('is-on')?'allumé':'éteint')`);
  await R('tout éteindre', `const p=document.querySelector('.tune-panel'); p.querySelectorAll('.tune-key-btn.on').forEach(k=>k.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,metaKey:true,button:0}))); p.querySelector('.tb-power').click(); return 'panneau encore là='+!!document.querySelector('.tune-panel')`);
};
