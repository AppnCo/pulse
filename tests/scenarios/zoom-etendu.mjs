// Zoom étendu : de 1 px/s (séance entière) à 2400 px/s (milliseconde), règle et forme d'onde qui suivent
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'zm1',name:'Zoom',bpm:120,buses:[],tracks:[{name:'Instru',type:'instru',preset:'instru',color:'#A855F7',clips:[]},{name:'Voix',type:'audio',armed:true,color:'#22D3EE'}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('instru de 3 min', `
    const sr=48000, n=sr*180, ctx=PulseAudio.getContext()||await PulseAudio.init(), buf=ctx.createBuffer(2,n,sr), L=buf.getChannelData(0), Rr=buf.getChannelData(1), beat=60/120;
    for(let i=0;i<n;i++){ const t=i/sr, ph=t%beat; let v=0.2*Math.sin(2*Math.PI*55*t); if(ph<0.1) v+=0.7*Math.sin(2*Math.PI*90*ph)*Math.exp(-ph*20); L[i]=v; Rr[i]=v; }
    await importAudioFile(new File([PulseAudio.audioBufferToWav(buf)],'i.wav',{type:'audio/wav'}),0); return 'clip='+state.project.tracks[0].clips.length+' bpm='+state.project.bpm`);
  const probe = (z) => `const t0=performance.now(); setZoom(${z}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const dt=Math.round(performance.now()-t0);
    const tl=document.querySelector('.timeline'); const ticks=document.querySelectorAll('#timelineRuler .ruler-tick').length, labels=[...document.querySelectorAll('#timelineRuler .ruler-label.major')].map(e=>e.textContent);
    const gaps=[...document.querySelectorAll('#timelineRuler .ruler-label.major')].map(e=>parseFloat(e.style.left)); const minGap=gaps.length>1?Math.min(...gaps.slice(1).map((g,i)=>g-gaps[i])):0;
    const fine=document.querySelector('.clip-wave-svg.fine-wave'); const paths=document.querySelectorAll('.clip-wave-svg path').length; const w=Math.round(document.querySelector('.timeline-tracks').scrollWidth);
    return 'zoom='+state.pxPerSecond+' px/s | '+dt+' ms | largeur='+w+' px | repères='+ticks+' (écart mini entre numéros de mesure='+Math.round(minGap)+' px) | forme fine='+!!fine+' | snap auto='+getEffectiveSnap()`;
  await R('zoom minimal (1 px/s)', `${probe(0.1)}`);
  await R('zoom normal (48 px/s)', `${probe(48)}`);
  await R('zoom 400 px/s (ancien maximum)', `${probe(400)}`);
  await R('zoom maximal (2400 px/s)', `${probe(5000)}`);
  await R('défiler en zoom serré : forme redessinée', `const tl=document.querySelector('.timeline'); const a=document.querySelector('.clip-wave-svg.fine-wave')?.style.left; tl.scrollLeft=200000; await new Promise(r=>setTimeout(r,200)); const b=document.querySelector('.clip-wave-svg.fine-wave')?.style.left; return 'avant='+a+' après='+b+' scrollLeft='+Math.round(tl.scrollLeft)`);
  await R('la règle suit le défilement', `setZoom(48); await new Promise(r=>setTimeout(r,100)); const tl=document.querySelector('.timeline'), ru=document.getElementById('timelineRuler'); tl.scrollLeft=4000; await new Promise(r=>setTimeout(r,100)); const r=ru.getBoundingClientRect(), t=tl.getBoundingClientRect(); return 'bord droit règle='+Math.round(r.right)+' px, bord droit timeline='+Math.round(t.right)+' px -> couvre='+(r.right>=t.right-1)`);
  await R('retour tout le projet', `zoomToFit(); await new Promise(r=>setTimeout(r,150)); return 'zoom='+state.pxPerSecond.toFixed(1)+' px/s'`);
};
