// Projet vide : les trois étapes sont affichées ; poser un fichier les fait disparaître
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pv1',name:'Vide',bpm:120,buses:[],tracks:[{name:'Piste 1',type:'audio',color:'#A855F7',volume:80}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(700);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/vide.jpg');
  await R('projet vide : carte d aide', `const c=document.querySelector('.empty-cta'); return 'carte='+!!c+' étapes='+(c?c.querySelectorAll('.empty-cta-step').length:0)`);
  await R('un fichier posé : la carte disparaît', `const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr*3,sr); b.getChannelData(0).fill(0.1);
    await importAudioFile(new File([PulseAudio.audioBufferToWav(b)],'instru.wav',{type:'audio/wav'}),0,0); await new Promise(r=>setTimeout(r,500));
    return 'carte='+!!document.querySelector('.empty-cta')+' (false) ; clips='+state.project.tracks[0].clips.length`);
};
