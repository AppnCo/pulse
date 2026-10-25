// Délai de piste : le son est décalé de N ms (régions immobiles) — mêmes chiffres que delai_de_piste (Rust)
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'dp1',name:'DP',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000;
    const b=ctx.createBuffer(1,sr,sr); b.getChannelData(0)[100]=0.8; PulseAudio.registerBuffer('clic',b);   // un clic 100 échantillons après le début
    const at=async(delayMs)=>{ const p={buses:[],sends:[],tracks:[{volume:100,delayMs,clips:[{id:'clic',start:1,duration:1}]}]};
      const x=(await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      let k=0; for(let i=0;i<x.length;i++) if(Math.abs(x[i])>Math.abs(x[k])) k=i; return k; };
    const t=state.project.tracks[0]; t.clips=[{id:'clic',start:1,duration:1,offset:0,name:'c'}]; renderAll();
    openTrackContextMenu(300,200,0,t); await new Promise(r=>setTimeout(r,100));
    const row=[...document.querySelectorAll('.track-ctx-menu .ctx-has-sub')].find(e=>/Réglages/.test(e.textContent)); row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); await new Promise(r=>setTimeout(r,80));
    [...document.querySelectorAll('.ctx-subpanel .ctx-item')].find(e=>/Délai de piste/.test(e.textContent)).click(); await new Promise(r=>setTimeout(r,120));
    const inp=document.querySelector('.track-delay-panel .td-ms'); inp.value='12,5'; document.querySelector('.track-delay-panel .td-ok').click(); await new Promise(r=>setTimeout(r,100));
    return JSON.stringify({ zero: await at(0), plus: await at(10), moins: await at(-10), ui: state.project.tracks[0].delayMs, regionImmobile: state.project.tracks[0].clips[0].start });
  })()`));
  console.log(JSON.stringify(r));
  check('sans délai : clic à 1 s + 100 éch. (48 100)', r.zero === 48100, r.zero);
  check('+10 ms : 480 échantillons plus tard', r.plus === 48580, r.plus);
  check('−10 ms : 480 échantillons plus tôt', r.moins === 47620, r.moins);
  check('le panneau écrit le délai (12,5 ms), la région ne bouge pas', r.ui === 12.5 && r.regionImmobile === 1, r.ui + ' / ' + r.regionImmobile);
};
