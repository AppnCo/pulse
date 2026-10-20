// Premaster (Mix Bus 1 + Finition), plafond de sécurité -0,3 dB, bus cachés et « Tout afficher »
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); window.onbeforeunload=null; createProjectFromTemplate('rap-studio')`);
  await sleep(1500);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{const ok=(c)=>c?'PASS ':'FAIL ';${code}})()`));
  await R('affichage', `const rows=[...document.querySelectorAll('#tracksList > .group-header')].map(e=>e.querySelector('.group-name').textContent+(e.classList.contains('is-row')?'(ligne)':'')).join(', ');
    const hL=document.getElementById('tracksList').scrollHeight, hT=document.getElementById('timelineTracks').scrollHeight; toggleMixer(); await new Promise(r=>setTimeout(r,400));
    const strips=[...document.querySelectorAll('.mixer-strips .strip .strip-name')].map(e=>e.textContent.trim()).join(', '); const master=getComputedStyle(document.querySelector('.mixer-master')).display;
    return ok(rows.endsWith('Mix Bus 1(ligne)')&&strips.includes('Mix Bus 2')&&master!=='none')+rows+' | mixer: '+strips+' | sortie='+master+' | hauteurs liste/timeline='+hL+'/'+hT`);
  const snd = `const ctx=await PulseAudio.init(); const sr=48000; if(!PulseAudio.getBuffer('mix')){const b=ctx.createBuffer(2,sr*2,sr),L=b.getChannelData(0),Rr=b.getChannelData(1); for(let i=0;i<L.length;i++){const t=i/sr; L[i]=0.25*Math.sin(2*Math.PI*60*t)+0.1*Math.sin(2*Math.PI*1000*t); Rr[i]=0.25*Math.sin(2*Math.PI*60*t)+0.1*Math.sin(2*Math.PI*12000*t);} PulseAudio.registerBuffer('mix',b);}
    const instru=state.project.tracks[0]; instru.volume=100; instru.clips=[{id:'mix',start:0,duration:2}];
    const meas=async()=>{const o=await ctx.decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer()); const L=o.getChannelData(0),Rr=o.getChannelData(1); let s=0,pk=0,side=0; for(let i=sr*0.5;i<sr*1.5;i++){s+=L[i]*L[i]; side+=(L[i]-Rr[i])**2;} for(let i=0;i<L.length;i++)pk=Math.max(pk,Math.abs(L[i]),Math.abs(Rr[i])); return {rms:Math.sqrt(s/sr),pk,side:Math.sqrt(side/sr)};};`;
  await R('finition « Fort »', `${snd} const a=await meas(); document.querySelector('.master-edit').click(); await new Promise(r=>setTimeout(r,200)); const p=document.querySelector('.master-panel'); const chips=[...p.querySelectorAll('.sound-chip')].map(c=>c.textContent).join(',');
    [...p.querySelectorAll('.sound-chip')].find(c=>c.dataset.preset==='loud').click(); await new Promise(r=>setTimeout(r,200)); const bus=busById('mixbus1'); const b=await meas();
    return ok(b.rms>a.rms*1.3&&b.pk<=0.9665&&bus.effects[0]==='master')+chips+' | '+JSON.stringify(bus.effectParams.master)+' | niveau '+a.rms.toFixed(3)+' → '+b.rms.toFixed(3)+' ('+(20*Math.log10(b.rms/a.rms)).toFixed(1)+' dB) | crête '+b.pk.toFixed(3)`);
  await R('largeur', `${snd} const bus=busById('mixbus1'); bus.master={preset:'off',body:0,air:0,glue:0,warm:0,width:0,push:0}; applyMaster(bus); const n=await meas(); bus.master.width=-100; applyMaster(bus); const narrow=await meas(); bus.master.width=100; applyMaster(bus); const wide=await meas();
    bus.master.width=0; applyMaster(bus); return ok(narrow.side<n.side*0.65&&wide.side>n.side*1.3&&bus.effects.length===0)+'écart gauche/droite : serré '+narrow.side.toFixed(4)+' | normal '+n.side.toFixed(4)+' | large '+wide.side.toFixed(4)+' | tout à zéro = aucun effet: '+JSON.stringify(bus.effects)`);
  await R('plafond de sécurité', `${snd} const tr=state.project.tracks; tr[0].volume=100; const loud=ctx.createBuffer(1,sr*2,sr),d=loud.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.95*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('fort',loud);
    tr[0].clips=[{id:'fort',start:0,duration:2,gain:2}]; tr[0].pan=-100; PulseAudio.setMasterVolume(125); const a=await meas(); openSettings(); await new Promise(r=>setTimeout(r,300)); const inp=document.getElementById('setCeiling'); const def=inp.value; inp.value='-2'; inp.dispatchEvent(new Event('change')); const b=await meas();
    inp.value='-0.3'; inp.dispatchEvent(new Event('change')); PulseAudio.setMasterVolume(100); return ok(Math.abs(a.pk-0.966)<0.003&&Math.abs(b.pk-0.794)<0.003&&JSON.stringify(busById('mixbus2').effects)==='["limit"]')+'limiteur sur Mix Bus 2='+JSON.stringify(busById('mixbus2').effects)+' | de base '+def+' dB → crête '+a.pk.toFixed(3)+' | réglé à -2 dB → crête '+b.pk.toFixed(3)+' | projet.ceilingDb='+state.project.ceilingDb`);
  await R('c\u2019est bien Mix Bus 2 qui retient', `${snd} state.project.tracks[0].clips=[{id:'fort',start:0,duration:2,gain:2}]; PulseAudio.setMasterVolume(62.5); const a=await meas(); PulseAudio.setMasterVolume(100); return ok(Math.abs(a.pk-0.483)<0.004)+'sortie à 50 % → crête '+a.pk.toFixed(3)+' (0,966 x 0,5 = limité avant la sortie ; sans Mix Bus 2 ce serait 0,95)'`);
  await R('tout afficher', `document.getElementById('setShowAll').click(); await new Promise(r=>setTimeout(r,300)); const strips=[...document.querySelectorAll('.mixer-strips .strip .strip-name')].map(e=>e.textContent.trim()).join(', '); const rows=[...document.querySelectorAll('#tracksList > .group-header.is-row')].map(e=>e.querySelector('.group-name').textContent).join(', ');
    const master=getComputedStyle(document.querySelector('.mixer-master')).display; document.getElementById('setShowAll').click(); await new Promise(r=>setTimeout(r,300));
    return ok(strips.includes('Mix Bus 2')&&master!=='none'&&rows.includes('Mix Bus 2')&&document.querySelectorAll('#tracksList > .group-header.is-row').length===1)+'lignes: '+rows+' | sortie='+master+' | puis recaché: '+document.querySelectorAll('#tracksList > .group-header.is-row').length+' ligne'`);
  await ev(`document.getElementById('settingsModal')?.remove(); document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); toggleMixer()`); await sleep(400);
  await ev(`document.querySelector('.group-header.is-row .g-son').click()`); await sleep(300);
  if (SHOTS) await shot(SHOTS + '/shot-finition.jpg');
};
