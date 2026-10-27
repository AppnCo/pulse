// Écho : calé sur le rythme du morceau ou réglé en millisecondes
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({sends:[{id:'revlong',name:'Rev Long',type:'reverb',size:3.2,pre:0,volume:100},{id:'del14',name:'Del 1/4',type:'delay',beats:1,feedback:35,volume:100}],id:'ec1',name:'Echo',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',armed:true,color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const tools = `const ctx=await PulseAudio.init(); const sr=48000; if(!PulseAudio.getBuffer('clap')){const b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<4800;i++)d[i]=0.5*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('clap',b);}
    const run=async(bpm,snd)=>{const t={volume:100,clips:[{id:'clap',start:0,duration:1}],effects:['delay'],effectParams:{delay:{wet:Math.round(snd.echo*0.5),feedback:Math.round(20+snd.echo*0.35),...(snd.echoMs?{ms:snd.echoMs}:{beats:snd.echoBeats})}}};
      const o=await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav({bpm,buses:[],tracks:[t]},0)).arrayBuffer()); const x=o.getChannelData(0);
      const rms=(a)=>{let s=0; for(let i=Math.round(a*sr);i<Math.round((a+0.1)*sr);i++)s+=x[i]*x[i]; return Math.sqrt(s/(0.1*sr));}; return {o,rms,fx:JSON.stringify(t.effectParams.delay)};};
    const f=(v)=>v.toFixed(5); const ok=(c)=>c?'PASS ':'FAIL ';`;
  await R('sur le rythme (120 BPM, ½ temps = 0,25 s)', `${tools} const r=await run(120,{echo:50,echoBeats:0.5});
    return ok(r.rms(0.25)>0.05&&r.rms(0.5)>0.01&&r.rms(0.5)<r.rms(0.25)&&r.rms(0.12)<1e-4)+r.fx+' direct='+f(r.rms(0))+' 1er écho='+f(r.rms(0.25))+' 2e='+f(r.rms(0.5))+' 3e='+f(r.rms(0.75))+' entre deux='+f(r.rms(0.12))+' durée='+r.o.duration.toFixed(1)+'s'`);
  await R('le tempo change, écho suit (60 BPM = 0,5 s)', `${tools} const r=await run(60,{echo:50,echoBeats:0.5}); return ok(r.rms(0.5)>0.05&&r.rms(0.25)<1e-4)+'à 0,25 s='+f(r.rms(0.25))+' à 0,5 s='+f(r.rms(0.5))`);
  await R('en millisecondes (400 ms)', `${tools} const r=await run(120,{echo:50,echoBeats:0.5,echoMs:400}); return ok(r.rms(0.4)>0.05&&r.rms(0.25)<1e-4)+r.fx+' à 0,25 s='+f(r.rms(0.25))+' à 0,4 s='+f(r.rms(0.4))`);
  await ev(`toggleMixer()`); await sleep(500); await ev(`document.querySelector('.mixer-strips .strip-sound').click()`); await sleep(300);
  await R('panneau Son → envois de base', `const p=document.querySelector('.sound-panel'); const sl=p.querySelector('[data-key="echo"]'); sl.value=40; sl.dispatchEvent(new Event('input')); const sp=document.querySelector('.sound-panel [data-key="space"]'); sp.value=25; sp.dispatchEvent(new Event('input'));
    const t=state.project.tracks[0]; const mix=[...document.querySelectorAll('.mixer-strips .strip[data-kind=track] .insp-send')].map(x=>x.value).join('/');
    return ok2(projectSends().length===0&&t.effects.includes('delay')&&t.effects.includes('reverb'))+'(plus de retours communs : le Réglage pose ses effets en insert) envois='+JSON.stringify(t.sends)+' | effets de la piste='+JSON.stringify(t.effects)+' | curseurs du mixer='+mix+' | puces de temps cachées='+document.querySelector('.sound-panel .echo-time').hidden;`.replace('ok2(','((c)=>c?"PASS ":"FAIL ")('));
  if (SHOTS) await shot(SHOTS + '/shot-echo.jpg');
};
