// Automation des réglages d'effet : le moteur suit la courbe (compresseur, filtre, écho, reverb), à l'export comme en lecture
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ap',name:'AP',bpm:120,sends:[],buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html'); await sleep(900);
  const ramp = `[{t:0,v:0},{t:2,v:0},{t:2.5,v:1}]`, down = `[{t:0,v:1},{t:2,v:1},{t:2.5,v:0}]`;
  const out = await ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000; const b=ctx.createBuffer(1,sr*4,sr),d=b.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=0.7*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('ap',b);
    const seg=async(tr)=>{ const p={buses:[],sends:[],tracks:[{volume:100,clips:[{id:'ap',start:0,duration:4}],...tr}]};
      const x=(await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);
      const r=(a,z)=>{let s=0; for(let i=a*sr;i<z*sr;i++)s+=x[i]*x[i]; return 20*Math.log10(Math.sqrt(s/((z-a)*sr))+1e-9);}; return [r(0.3,1.2), r(2.8,3.7)]; };
    const res={};
    res.comp=await seg({effects:['comp'],effectParams:{comp:{threshold:-20,ratio:8,makeup:0}},automation:{'fx:comp:threshold':{points:${ramp}}}});
    res.compFixe=await seg({effects:['comp'],effectParams:{comp:{threshold:-20,ratio:8,makeup:0}}});
    res.filtre=await seg({effects:['filter'],effectParams:{filter:{hpf:20,lpf:20000,slope:24}},automation:{'fx:filter:hpf':{points:${down}}}});
    res.echo=await seg({effects:['delay'],effectParams:{delay:{beats:0.25,feedback:20,wet:50,dry:0}},automation:{'fx:delay:wet':{points:${ramp}}}});
    res.rev=await seg({effects:['reverb'],effectParams:{reverb:{wet:50,size:1.8}},automation:{'fx:reverb:wet':{points:${ramp}}}});
    return JSON.stringify(res);
  })()`);
  const r = JSON.parse(out), f = (a) => a.map(x => x.toFixed(1)).join(' → ') + ' dB';
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  ok(r.comp[0] < r.comp[1] - 6, 'compresseur : seuil automatisé (écrasé puis libre) ' + f(r.comp));
  ok(Math.abs(r.compFixe[0] - r.compFixe[1]) < 1, 'sans courbe : même niveau partout ' + f(r.compFixe));
  ok(r.filtre[0] < r.filtre[1] - 6, 'filtre : coupe-bas automatisé (1 kHz puis ouvert) ' + f(r.filtre));
  ok(r.echo[0] < r.echo[1] - 20, 'écho : quantité automatisée ' + f(r.echo));
  ok(Math.abs(r.rev[0] - r.rev[1]) > 0.5, 'reverb : quantité automatisée ' + f(r.rev));
};
