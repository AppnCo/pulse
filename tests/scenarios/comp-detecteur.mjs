// Compresseur : coupe-bas du détecteur et plage — mêmes chiffres que le test Rust `compresseur_detecteur_et_plage`
// (60 Hz fort + 3 kHz faible : on mesure ce que le compresseur retire au 3 kHz) ; puis les deux boutons en mode Avancé
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cd1',name:'CD',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#60A5FA',volume:100}]}))`);
  await nav('http://localhost:8765/studio.html');
  const r = JSON.parse(await ev(`(async()=>{ const ctx=await PulseAudio.init(); const sr=48000;
    const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++){const t=i/sr; d[i]=0.5*Math.sin(2*Math.PI*60*t)+0.1*Math.sin(2*Math.PI*3000*t);} PulseAudio.registerBuffer('cdt',b);
    const run=async(cp)=>{const p={buses:[],tracks:[{volume:100,clips:[{id:'cdt',start:0,duration:2}],...(cp?{effects:['comp'],effectParams:{comp:cp}}:{})}]};
      return (await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0);};
    const amp=(x)=>{let re=0,im=0; for(let i=sr;i<sr*1.8;i++){const a=2*Math.PI*3000*i/sr; re+=x[i]*Math.cos(a); im+=x[i]*Math.sin(a);} return Math.hypot(re,im);};
    const ref=amp(await run(null)), base={threshold:-20,ratio:4,attack:10,release:50,knee:0,makeup:0};
    const db=async(e)=>+(20*Math.log10(amp(await run({...base,...e}))/ref)).toFixed(2);
    return JSON.stringify({ base: await db({}), sc: await db({scHp:300}), rg: await db({range:6}) }); })()`));
  const near = (a, b) => Math.abs(a - b) < 0.06;
  check('sans option : comme le moteur natif (−11,67 dB)', near(r.base, -11.67), r.base + ' dB');
  check('détecteur coupé à 300 Hz : la basse ne déclenche plus (−0,70 dB)', near(r.sc, -0.70), r.sc + ' dB');
  check('plage 6 dB : jamais plus de 6 dB retirés (−6,00 dB)', near(r.rg, -6.0), r.rg + ' dB');
  const ui = JSON.parse(await ev(`(()=>{ openEffectPanel(0,'comp',document.body); const p=document.querySelector('.fx-panel'); p.querySelector('.fx-mode [data-mode=adv]').click();
    const row=(k)=>p.querySelector('.fx-row[data-key='+k+']'); const vis=(e)=>!!e&&getComputedStyle(e).display!=='none';
    return JSON.stringify({ sc: vis(row('scHp')), rg: vis(row('range')), scTxt: (p.querySelector('.fx-val[data-key=scHp]')||{}).textContent, rgTxt: (p.querySelector('.fx-val[data-key=range]')||{}).textContent }); })()`));
  check('mode Avancé : boutons Détecteur et Plage présents', ui.sc && ui.rg, JSON.stringify(ui));
};
