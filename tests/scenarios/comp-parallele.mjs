// Compresseur : curseur « Mélange » (compression parallèle) — 0 % = son d'origine, 100 % = tout compressé
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cp1',name:'CP',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('mélange 0 / 50 / 100 %', `const ctx=await PulseAudio.init(); const sr=48000; const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=0.7*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('cp',b);
    const rms=async(tr)=>{const p={buses:[],tracks:[{volume:100,clips:[{id:'cp',start:0,duration:2}],...tr}]}; const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr;i<sr*1.8;i++)s+=x[i]*x[i]; return Math.sqrt(s/(sr*0.8));};
    const ref=await rms({}); const o=[];
    for(const mix of [0,50,100]){ const v=await rms({effects:['comp'],effectParams:{comp:{threshold:-20,ratio:3.08,attack:10,release:50,mix}}}); o.push(mix+' % → '+(20*Math.log10(v/ref)).toFixed(1)+' dB'); }
    return o.join(' | ')+' (attendu ≈ 0 | -2.7 | -6.7 : la courbe réglée, depuis le maintien des crêtes)'`);
  await R('curseur dans le panneau', `openEffectPanel(0,'comp',document.body); const r=[...document.querySelectorAll('.fx-panel .fx-row, .fx-panel label')].map(e=>e.textContent.trim().slice(0,20)).join(' / '); return /Mélange/.test(document.querySelector('.fx-panel').textContent)?'présent':'ABSENT : '+r`);
};
