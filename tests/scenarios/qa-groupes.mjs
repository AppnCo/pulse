// Groupes : routage audio réel (export), suppression / duplication, références partagées
import { boot, instru, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 'g', name: 'G', bpm: 120, buses: [
      { id: 'g1', name: 'Voix', isGroup: true, output: 'master', color: '#A855F7', volume: 50 },
      { id: 'g2', name: 'Fx', isGroup: true, output: 'master', color: '#22D3EE', volume: 100 },
      { id: 'g3', name: 'Sous', isGroup: true, output: 'g1', color: '#22D3EE', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', volume: 100, output: 'g1', clips: [] },
      { name: 'B', type: 'audio', color: '#22D3EE', volume: 100, output: 'g2', clips: [] },
      { name: 'C', type: 'audio', color: '#34D399', volume: 100, output: 'g3', clips: [] },
      { name: 'D', type: 'audio', color: '#F472B6', volume: 100, output: 'master', clips: [], effectParams: { eq: { bands: [{ f: 1000, g: 3, q: 1, type: 'bell' }] } }, effects: ['eq'], sends: { revlong: 30 } }] });
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{try{${code}}catch(e){return 'EXC '+e.stack}})()`));
  const rms = `const ctx=PulseAudio.getContext(); const sr=48000; const m=async()=>{const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(state.project)).arrayBuffer())).getChannelData(0); let s=0; for(let i=sr*0.3;i<sr*0.8;i++)s+=x[i]*x[i]; return +Math.sqrt(s/(sr*0.5)).toFixed(4);};`;
  await R('prépare', `await PulseAudio.init(); const ctx=PulseAudio.getContext(); const sr=48000,b=ctx.createBuffer(1,sr,sr),d=b.getChannelData(0); for(let i=0;i<sr;i++)d[i]=0.2*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('ton',b);
    state.project.tracks.forEach(t=>t.clips=[]); state.project.tracks[0].clips=[{id:'ton',start:0,duration:1}]; renderAll(); return 'ok'`);
  await R('A sous g1(50%) seul', `${rms} return await m()`);
  await R('A déplacée dans g2 (100%)', `${rms} moveTrackToGroup(0,'g2'); await new Promise(r=>setTimeout(r,200)); return 'out='+state.project.tracks.find(t=>t.name==='A').output+' rms='+await m()`);
  await R('annuler -> g1', `${rms} undoAction(); await new Promise(r=>setTimeout(r,200)); return 'out='+state.project.tracks.find(t=>t.name==='A').output+' rms='+await m()`);
  await R('groupe g1 muet', `${rms} busById('g1').muted=true; const r=await m(); busById('g1').muted=false; return 'rms muet='+r`);
  await R('dissoudre g1 : A et g3 vont à master', `${rms} dissolveGroup('g1'); await new Promise(r=>setTimeout(r,200)); return J=JSON.stringify(state.project.tracks.map(t=>t.name+'→'+t.output))+' buses='+JSON.stringify(state.project.buses.map(b=>b.id+'→'+b.output))+' rms='+await m()`);
  await R('annuler dissoudre', `undoAction(); await new Promise(r=>setTimeout(r,100)); return JSON.stringify(state.project.buses.map(b=>b.id+'→'+b.output))`);
  await R('retirer C (dernière de g3) du groupe g3 : g3 supprimé ?', `removeTrackFromGroup(2); await new Promise(r=>setTimeout(r,100)); return JSON.stringify(state.project.buses.map(b=>b.id+'→'+b.output))+' C→'+state.project.tracks[2].output`);
  await R('annuler', `undoAction(); return state.project.buses.length`);
  await R('retirer A (dernière piste directe de g1, g1 contient g3 avec C) : g1 supprimé et g3 orphelin ?', `removeTrackFromGroup(0); await new Promise(r=>setTimeout(r,100)); const bs=state.project.buses; return JSON.stringify(bs.map(b=>b.id+'→'+b.output))+' orphelins='+bs.filter(b=>b.output!=='master'&&!bs.some(x=>x.id===b.output)).map(b=>b.id)`);
  await R('annuler', `undoAction(); return state.project.buses.length`);
  await R('supprimer la dernière piste de un groupe (B de g2) : g2 reste vide ?', `state.selectedTrack=1; state.selectedTracks=new Set(); deleteSelectedTrack(); await new Promise(r=>setTimeout(r,100)); return 'g2 présent='+!!busById('g2')+' lignes groupe='+document.querySelectorAll('.group-header').length+' ; pistes='+state.project.tracks.map(t=>t.name)`);
  await R('annuler', `undoAction(); return state.project.tracks.length`);
  await R('duplicateTrack D : objets partagés ?', `duplicateTrack(3); const o=state.project.tracks[3], cp=state.project.tracks[4]; return 'effectParams partagé='+(o.effectParams===cp.effectParams)+' sends partagé='+(o.sends===cp.sends)+' sound='+(o.sound&&o.sound===cp.sound)+' nom='+cp.name`);
  await R('modifier la copie modifie original ?', `const cp=state.project.tracks[4]; cp.sends.revlong=99; cp.effectParams.eq.bands[0].g=9; return 'original sends='+state.project.tracks[3].sends.revlong+' gain='+state.project.tracks[3].effectParams.eq.bands[0].g`);
  await R('annuler duplication : original est-il intact ?', `undoAction(); return JSON.stringify(state.project.tracks[3].sends)+' '+state.project.tracks[3].effectParams.eq.bands[0].g+' n='+state.project.tracks.length`);
};
