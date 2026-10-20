// Modèle de base (Rap Studio) : instru en haut, Rec, puis les voix rangées par groupe dans All Vocal
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); window.onbeforeunload=null; createProjectFromTemplate('rap-studio')`);
  await sleep(1500);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('page', `return location.pathname`);
  await R('liste', `const ok=(c)=>c?'PASS ':'FAIL '; const rows=[...document.querySelectorAll('#tracksList > .group-header, #tracksList > .track-item')].map(e=>e.classList.contains('group-header')?'['+e.querySelector('.group-name').textContent+'@'+e.style.getPropertyValue('--depth').trim()+']':e.querySelector('.track-name').childNodes[0].textContent.trim()).join(' ');
    return ok(rows==='Instru [All Vocal@0] Rec [Vocal 1@1] Lead [Back@1] Back [Ambiance@1] Ambiance [Mix Bus 1@0]')+rows`);
  await R('son sur les groupes, pas sur les pistes', `const ok=(c)=>c?'PASS ':'FAIL '; const b=(id)=>JSON.stringify(busById(id).effects||[]); const tr=state.project.tracks.map(t=>t.name+':'+JSON.stringify(t.effects||[])+JSON.stringify(t.sends||{})).join(' ');
    return ok(busById('vocal1').effects.includes('comp')&&busById('allvocal').effects.includes('comp')&&state.project.tracks.every(t=>!(t.effects||[]).length))+'Vocal 1='+b('vocal1')+' Back='+b('back')+' Ambiance='+b('ambiance')+' All Vocal='+b('allvocal')+' | pistes: '+tr`);
  await R('enregistrement : cible = Rec', `const i=state.project.tracks.findIndex(t=>t.isCapture); return 'piste Rec en position '+(i+1)+' | mixer: '+[...document.querySelectorAll('.strip .strip-name')].map(e=>e.textContent.trim()).join(', ')`);
  await R('le son traverse tout', `const ok=(c)=>c?'PASS ':'FAIL '; const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.2*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('ton',b);
    state.project.tracks.find(t=>t.name==='Lead').clips=[{id:'ton',start:0,duration:1}]; const m=async()=>{const x=(await ctx.decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer())).getChannelData(0); let s=0,pk=0; for(let i=sr*0.3;i<sr*0.8;i++){s+=x[i]*x[i];pk=Math.max(pk,Math.abs(x[i]));} return [Math.sqrt(s/(sr*0.5)),pk];};
    const [a,pk]=await m(); busById('allvocal').muted=true; const [c]=await m(); busById('allvocal').muted=false; return ok(a>0.02&&pk<0.9&&c<1e-5)+'niveau='+a.toFixed(4)+' crête='+pk.toFixed(3)+' All Vocal coupé='+c.toFixed(5)`);
  if (SHOTS) await shot(SHOTS + '/shot-modele.jpg');
};
