// Instru longue importée : temps d'import, de dessin, de sauvegarde, de défilement, et poids de la page
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pf1',name:'Perf',bpm:120,buses:[],tracks:[{name:'Instru',type:'instru',preset:'instru',color:'#A855F7',clips:[]},{name:'Voix',type:'audio',armed:true,color:'#22D3EE'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('fabrication d\'un instru de 3 min stéréo 48 kHz', `
    const sr=48000, sec=${process.env.SEC || 180}, n=sr*sec, ctx=PulseAudio.getContext()||await PulseAudio.init();
    const buf=ctx.createBuffer(2,n,sr), L=buf.getChannelData(0), Rr=buf.getChannelData(1), beat=60/140;
    for(let i=0;i<n;i++){ const t=i/sr, ph=t%beat, bar=Math.floor(t/beat)%4;
      let v=0.25*Math.sin(2*Math.PI*55*t)*(0.6+0.4*Math.sin(t*2));
      if(ph<0.12) v+=0.7*Math.sin(2*Math.PI*(60+120*Math.exp(-ph*40))*ph)*Math.exp(-ph*18);
      if(bar%2===1 && ph<0.1) v+=0.5*(Math.random()*2-1)*Math.exp(-ph*30);
      v+=0.08*Math.sin(2*Math.PI*(440+110*Math.floor(t/2%4))*t); L[i]=v; Rr[i]=v*0.92+0.02*(Math.random()-.5); }
    window._wavBlob=PulseAudio.audioBufferToWav(buf);
    return 'WAV='+(window._wavBlob.size/1048576).toFixed(1)+' Mo'`);
  await R('import (decodage, pics, sauvegarde, tempo)', `
    const f=new File([window._wavBlob],'instru-test.wav',{type:'audio/wav'});
    const t0=performance.now(); await importAudioFile(f, 0); const t1=performance.now();
    return 'import='+Math.round(t1-t0)+' ms, BPM projet='+state.project.bpm+', clips='+state.project.tracks[0].clips.length+' pics='+(state.project.tracks[0].clips[0].peaks||[]).length`);
  await R('dessin de la timeline', `
    const t0=performance.now(); renderTimelineTracks(); const t1=performance.now();
    const rects=document.querySelectorAll('.clip-wave-svg rect').length, nodes=document.querySelectorAll('*').length;
    return 'renderTimelineTracks='+Math.round(t1-t0)+' ms, rect de forme d\\'onde='+rects+', noeuds DOM='+nodes+', largeur='+Math.round(document.querySelector('.timeline-tracks').scrollWidth)+'px'`);
  await R('sauvegarde du projet', `
    const t0=performance.now(); saveProject(); const t1=performance.now();
    const json=JSON.stringify(state.project).length; return 'saveProject='+Math.round(t1-t0)+' ms, JSON='+(json/1024).toFixed(0)+' Ko, localStorage='+Object.keys(localStorage).map(k=>k+':'+((localStorage.getItem(k)||'').length/1024).toFixed(0)+'Ko').join(' ')`);
  await R('défilement horizontal x20', `
    const tl=document.querySelector('.timeline'); const t0=performance.now();
    for(let i=0;i<20;i++){ tl.scrollLeft=i*400; await new Promise(r=>requestAnimationFrame(r)); }
    const dt=performance.now()-t0; return 'moyenne par image='+(dt/20).toFixed(1)+' ms (16,7 = 60 i/s)'`);
  await R('zoom x5', `
    const t0=performance.now(); for(let i=0;i<5;i++){ setZoom(state.pxPerSecond*1.25); await new Promise(r=>requestAnimationFrame(r)); } const dt=performance.now()-t0;
    return 'zoom='+(dt/5).toFixed(0)+' ms par pas, rect='+document.querySelectorAll('.clip-wave-svg rect').length`);
  await R('zoom maximal', `
    for(const z of [200,400,800]){ const t0=performance.now(); setZoom(z); await new Promise(r=>requestAnimationFrame(r)); var dt=Math.round(performance.now()-t0);
      console.log('  zoom '+z+' px/s ('+state.pxPerSecond+' réel) : '+dt+' ms, rect='+document.querySelectorAll('.clip-wave-svg rect').length+' largeur='+Math.round(document.querySelector('.timeline-tracks').scrollWidth)+'px'); }
    return 'ok'`);
  await R('lecture 2 s + curseur', `
    state.playhead=0; const t0=performance.now(); await togglePlay(); await new Promise(r=>setTimeout(r,2000)); const pos=state.playhead; await togglePlay();
    return 'curseur après 2 s='+pos.toFixed(2)+' s'`);
  await R('page elle-même', `return 'scrollY='+window.scrollY+' bodyScrollH='+document.documentElement.scrollHeight+' innerH='+innerHeight+' bodyScrollW='+document.documentElement.scrollWidth+' innerW='+innerWidth`);
};
