// Fusionner une piste : le son ne doit ni bouger, ni changer de volume, ni recevoir ses effets deux fois
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'fu1',name:'Fusion',bpm:120,buses:[],
    tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7',sound:{preset:'back',tone:0,hold:55,drive:0,space:36,deess:40},effects:['eq','comp','deess','reverb'],effectParams:{reverb:{wet:22}}}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  // Sans envoi de reverb dans le projet (plus d'envois par défaut depuis le 23/10), la reverb reste en insert : rien n'est perdu
  await R('ancien projet migré', `const t=state.project.tracks[0]; const sansEnvoi=!(state.project.sends||[]).some(x=>x.type==='reverb'); return ((sansEnvoi ? t.effects.includes('reverb') : (!t.effects.includes('reverb')&&t.sends.revlong===36))?'PASS ':'FAIL ')+'effets='+JSON.stringify(t.effects)+' envois='+JSON.stringify(t.sends)`);
  await R('fusion', `const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<4800;i++)d[i]=0.5*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('clap',b);
    const t=state.project.tracks[0]; t.volume=60; t.pan=-40; t.sends.del14=40; t.clips=[{id:'clap',start:2,duration:1},{id:'clap',start:3.5,duration:1}]; t.automation={volume:{points:[{t:0,v:1},{t:4,v:0.5}]}};
    const snap=async()=>{const o=await ctx.decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer()); const m=(c,a)=>{const x=o.getChannelData(c); let s=0; for(let i=Math.round(a*sr);i<Math.round((a+0.1)*sr);i++)s+=x[i]*x[i]; return Math.sqrt(s/(0.1*sr));};
      return [m(0,2),m(1,2),m(0,2.5),m(0,3.5),m(0,4),m(0,1.9)];};
    const before=await snap(); await bounceTrack(0); await new Promise(r=>setTimeout(r,300)); const after=await snap();
    const worst=Math.max(...before.map((v,i)=>Math.abs(v-after[i])/(v+1e-4)));
    return (worst<0.02?'PASS ':'FAIL ')+'écart max '+(worst*100).toFixed(2)+' % | avant '+before.map(v=>v.toFixed(4)).join(' ')+' | après '+after.map(v=>v.toFixed(4)).join(' ')+' | clips='+t.clips.length+' début='+t.clips[0].start+' vol='+t.volume+' envois='+JSON.stringify(t.sends)+' son='+(t.sound||null)`);
  await R('annuler la fusion', `undoAction(); const t=state.project.tracks[0]; return 'clips='+t.clips.length+' vol='+t.volume+' envois='+JSON.stringify(t.sends)`);
};
