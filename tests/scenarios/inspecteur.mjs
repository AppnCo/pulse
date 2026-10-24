// Tranche à gauche : la piste sélectionnée et là où elle sort ; Mix Bus 2 et la sortie visibles dans le mixer
const SHOTS = process.env.SHOTS || '';
export default async ({ ev, nav, send, shot, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); window.onbeforeunload=null; createProjectFromTemplate('rap-studio')`);
  await sleep(1500);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{const ok=(c)=>c?'PASS ':'FAIL '; const names=()=>[...document.querySelectorAll('#inspector .insp-strip .strip-name')].map(e=>e.textContent).join(' | '); const wait=(ms)=>new Promise(r=>setTimeout(r,ms));${code}})()`));
  await R('ouvert de base', `return ok(!document.getElementById('inspector').hidden&&document.querySelectorAll('#inspector .insp-strip').length===2)+names()+' | largeur timeline='+document.querySelector('.timeline').offsetWidth`);
  await R('Lead → Vocal 1', `selectTrack(state.project.tracks.findIndex(t=>t.name==='Lead')); await wait(100); const fx=[...document.querySelectorAll('#inspector .insp-strip')].map(s=>[...s.querySelectorAll('.insp-fx-row span')].map(e=>e.textContent).join(',')||'aucun').join(' || ');
    return ok(names()==='Lead | Vocal 1')+names()+' | effets: '+fx`);
  await R('Instru → Mix Bus 1', `selectTrack(0); await wait(100); const b=document.querySelectorAll('#inspector .insp-strip')[1]; return ok(names()==='Instru | Mix Bus 1'&&b.querySelector('.insp-sound').textContent.startsWith('Finition'))+names()+' | bouton='+b.querySelector('.insp-sound').textContent`);
  await R('volume et envoi depuis la tranche', `selectTrack(state.project.tracks.findIndex(t=>t.name==='Back')); await wait(100); const s=document.querySelectorAll('#inspector .insp-strip'); const f=s[0].querySelector('.insp-fader'); f.value=volToPos(55); f.dispatchEvent(new Event('input')); f.dispatchEvent(new Event('change'));
    const t=state.project.tracks.find(t=>t.name==='Back'); const envoisVides=document.querySelectorAll('#inspector .insp-strip')[0].querySelectorAll('.send-bar-row').length===0;
    const bf=document.querySelectorAll('#inspector .insp-strip')[1].querySelector('.insp-fader'); bf.value=volToPos(70); bf.dispatchEvent(new Event('input')); bf.dispatchEvent(new Event('change'));
    return ok(t.volume===55&&envoisVides&&projectSends().length===0&&!(state.project.buses||[]).some(b=>b.isAux)&&busById('back').volume===70)+'piste vol='+t.volume+' envois (modèle sans retour imposé)='+JSON.stringify(t.busSends||{})+' | groupe Back vol='+busById('back').volume`);
  await R('déplacer un effet', `const i=state.project.tracks.findIndex(t=>t.name==='Back'); const b=busById('back'); const before=chainOf(b).join('>'); const row=[...document.querySelectorAll('#inspector .insp-strip')[1].querySelectorAll('.insp-fx-row')].find(r=>r.dataset.fx==='comp'); moveEffect(b, 'comp', -1); renderInspector(); await wait(150);   // les flèches ont laissé place au glisser : même déplacement
    const after=chainOf(b).join('>'); const shown=[...document.querySelectorAll('#inspector .insp-strip')[1].querySelectorAll('.insp-fx-row')].map(r=>r.dataset.fx).join('>'); return ok(before!==after&&shown===after)+before+' → '+after+' | affiché: '+shown`);
  await R('l\u2019ordre change vraiment le son', `const ctx=await PulseAudio.init(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.6*Math.sin(2*Math.PI*150*i/sr); PulseAudio.registerBuffer('ton',b);
    const mk=(order)=>({buses:[],tracks:[{volume:100,clips:[{id:'ton',start:0,duration:1}],effects:['eq','comp'],effectParams:{eq:{hpf:400,midGain:0,presence:0,air:0},comp:{ratio:8,threshold:-30,attack:5,release:50}},fxOrder:order}]});
    const m=async(p)=>{const x=(await ctx.decodeAudioData(await (await PulseAudio.exportTrackWav(p,0)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr*0.4;i<sr*0.9;i++)s+=x[i]*x[i]; return Math.sqrt(s/(sr*0.5));};
    const a=await m(mk(undefined)), c=await m(mk(['comp','eq'])), same=await m(mk(['eq','comp'])); return ok(Math.abs(a-same)<1e-6&&Math.abs(a/c-1)>0.2)+'EQ puis compresseur='+a.toFixed(5)+' | compresseur puis EQ='+c.toFixed(5)+' | ordre habituel écrit en toutes lettres='+same.toFixed(5)`);
  await R('mixer : Mix Bus 2 et sortie visibles', `toggleMixer(); await wait(400); const strips=[...document.querySelectorAll('.mixer-strips .strip .strip-name')].map(e=>e.textContent.trim()); const master=getComputedStyle(document.querySelector('.mixer-master')).display; const rows=[...document.querySelectorAll('#tracksList > .group-header.is-row')].map(e=>e.querySelector('.group-name').textContent).join(',');
    toggleMixer(); return ok(strips.some(n=>n.startsWith('Mix Bus 2'))&&master!=='none'&&rows==='Mix Bus 1')+'mixer: '+strips.join(', ')+' | sortie='+master+' | lignes sous les pistes: '+rows`);
  if (SHOTS) await shot(SHOTS + '/shot-inspecteur.jpg');
  await R('cacher / rouvrir', `document.getElementById('btnInspector').click(); await wait(100); const a=document.getElementById('inspector').hidden; const w=document.querySelector('.timeline').offsetWidth; document.getElementById('btnInspector').click(); return ok(a===true)+'caché='+a+' largeur timeline='+w`);
};
