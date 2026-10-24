// Bus d'envoi façon Logic : il n'y a que des bus (pistes comme les autres, avec leurs inserts).
// Un ancien projet à retours Reverb / Écho est converti à l'ouverture, au même son.
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  const P = { id: 'be1', name: 'BE', bpm: 120,
    sends: [{ id: 'rv', name: 'Rev Long', type: 'reverb', size: 3.2, pre: 20, volume: 100 }, { id: 'dl', name: 'Del 1/4', type: 'delay', beats: 1, feedback: 40, volume: 80 }],
    tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', output: 'master', sends: { rv: 40, dl: 30 }, clips: [] },
             { name: 'Back', type: 'audio', color: '#C084FC', output: 'master', sends: { rv: 20 }, clips: [] }] };
  await boot(c, P);
  await ev(`(async()=>{ await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr/2,sr),d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=0.5*Math.sin(2*Math.PI*440*i/sr); PulseAudio.registerBuffer('bz',b);
    state.project.tracks[0].clips=[{id:'bz',start:0,duration:0.5}]; state.project.tracks[1].clips=[{id:'bz',start:0.25,duration:0.5}]; renderAll(); })()`);
  const meas = (proj = 'state.project') => ev(`(async()=>{ const w=await PulseAudio.exportWav(${proj},{normalize:false}); const x=await PulseAudio.getContext().decodeAudioData(await w.arrayBuffer()); const L=x.getChannelData(0),R=x.getChannelData(1);
    const rms=(a,e)=>{let s=0; for(let i=Math.floor(a*48000);i<Math.floor(e*48000);i++) s+=L[i]*L[i]+R[i]*R[i]; return Math.sqrt(s/(2*(Math.floor(e*48000)-Math.floor(a*48000))));};
    return [rms(0.1,0.5),rms(0.8,1.6),rms(1.6,3)].map(v=>+v.toFixed(5)) })()`);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await R('à l\'ouverture', `return 'retours='+projectSends().length+' | bus='+state.project.buses.map(b=>b.name+(b.isAux?'(envoi)':'')+':'+JSON.stringify(b.effects)).join(', ')+' | doses='+JSON.stringify(state.project.tracks.map(t=>t.busSends))`);
  // même son que l'ancien projet (le moteur sait encore lire les retours : on exporte la version d'avant conversion)
  const before = await meas(`(()=>{ const o=${JSON.stringify(P)}; o.tracks[0].clips=[{id:'bz',start:0,duration:0.5}]; o.tracks[1].clips=[{id:'bz',start:0.25,duration:0.5}]; return o; })()`);
  const after = await meas();
  const diff = Math.max(...before.map((v, i) => Math.abs(20 * Math.log10((after[i] + 1e-9) / (v + 1e-9)))));
  console.log('ancien / converti :', JSON.stringify(before), JSON.stringify(after), '| écart max', diff.toFixed(3), 'dB', diff < 0.1 ? 'PASS' : 'FAIL');
  // un plugin en plus sur le bus Reverb : un filtre coupe-bas qui doit changer la queue
  await ev(`state.project.buses.find(b=>b.name==='Del 1/4').muted=true`);
  const revOnly = await meas();
  await R('filtre coupe-bas ajouté sur le bus Reverb', `const b=state.project.buses.find(b=>b.name==='Rev Long'); b.effects.push('filter'); b.effectParams.filter={hpf:2000,lpf:20000,slope:24}; return JSON.stringify(b.effects)`);
  const withEq = await meas();
  console.log('queue de reverb sans / avec filtre :', revOnly[1], '/', withEq[1], withEq[1] < revOnly[1] * 0.3 ? 'PASS le plugin du bus agit' : 'FAIL');
  await ev(`state.project.buses.find(b=>b.name==='Del 1/4').muted=false; state.project.buses.find(b=>b.name==='Rev Long').effects.pop()`);
  // nouveau bus depuis le « + » des envois : un bus vide, et le menu d'effets s'ouvre dessus
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  await ev(`document.querySelector('#inspector .insp-strip[data-kind="track"] .slot-plus[data-plus="send"]').click()`); await sleep(200);
  await R('menu +', `return [...document.querySelectorAll('.track-ctx-menu .ctx-item,.track-ctx-menu .ctx-head')].map(e=>e.textContent).join(' / ')`);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent==='Nouveau bus').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(400);
  await R('bus vide', `const b=state.project.buses.find(b=>b.name==='Bus'); return 'créé='+!!b+' effets='+JSON.stringify(b&&b.effects)+' envoi Lead='+(state.project.tracks[0].busSends||{})[b&&b.id]+' menu effets ouvert='+!!document.querySelector('.fx-add-menu')+' tranche gauche='+[...document.querySelectorAll('#inspector .insp-strip .strip-name')].map(e=>e.textContent).join(' + ')`);
  await ev(`document.querySelector('.fx-add-menu .fam-fx[data-fx="chorus"]')?.click()`); await sleep(300);
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`);
  await R('chorus sur le bus', `return JSON.stringify(state.project.buses.find(b=>b.name==='Bus').effects)`);
  await R('annuler', `undoAction(); await new Promise(r=>setTimeout(r,200)); return JSON.stringify((state.project.buses.find(b=>b.name==='Bus')||{}).effects)`);
  // clic droit sur l'envoi → ouvrir le bus
  await ev(`state.selectedBus=null; renderInspector()`); await sleep(150);
  await R('clic droit envoi', `const row=document.querySelector('#inspector .insp-strip[data-kind="track"] [data-bsend]'); row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:400})); await new Promise(r=>setTimeout(r,100)); return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent).join(' / ')`);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.startsWith('Ouvrir le bus')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(300);
  await R('bus ouvert à gauche', `return [...document.querySelectorAll('#inspector .insp-strip .strip-name')].map(e=>e.textContent).join(' + ')`);
  await ev(`toggleMixer()`); await sleep(500);
  await R('table de mixage', `return [...document.querySelectorAll('.mixer-strips .strip .strip-name')].map(e=>e.textContent.trim()).join(' | ')+' | retours fermés='+document.querySelectorAll('.strip-return').length`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/bus-envoi.jpg');
};
