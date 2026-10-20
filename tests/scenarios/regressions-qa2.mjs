// Correctifs issus du rapport QA n°2 : tempo et régions MIDI, texte, voix déposée, Son vs Pro, touche D, armer un piano
import { boot, RAP, instru, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  const bad = [];
  const ok = (cond, label) => { console.log((cond ? '✓ ' : '✗ ') + label); if (!cond) bad.push(label); };
  const J = async (code) => JSON.parse(await ev(`JSON.stringify((async()=>{${code}})())`).then(x => x) || 'null');
  const val = (code) => ev(`(async()=>{${code}})()`);

  // 1. Tempo : deux régions MIDI collées restent collées
  await boot(c, { id: 'q2', name: 'Q2', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await val(`addTrack('drums')`); await sleep(700);
  await val(`await createMidiClip(state.project.tracks.length-1, 2)`); await sleep(500);
  await val(`const i=document.getElementById('bpmInput'); i.value='90'; i.dispatchEvent(new Event('change'))`); await sleep(2500);
  const geo = JSON.parse(await val(`const t=state.project.tracks[state.project.tracks.length-1]; return JSON.stringify(t.clips.map(c=>[+c.start.toFixed(3), +c.duration.toFixed(3)]))`));
  ok(geo.length === 2 && Math.abs(geo[1][0] - geo[0][0] - geo[0][1]) < 0.02, `tempo : les régions restent collées ${JSON.stringify(geo)}`);

  // 5. Annuler ne perd pas le calage du texte
  await val(`state.project.lyricsMap={start:5,per:2}; addTrack('audio')`); await sleep(300);
  await val(`undoAction()`); await sleep(300);
  ok(await val(`return !!state.project.lyricsMap && state.project.lyricsMap.start===5`), 'texte : le calage survit à ⌘Z');

  // 6. Une voix déposée sur Lead (rangée dans un groupe) reste une voix
  await boot(c, RAP);
  await instru(ev, 2, 2, 0); await sleep(500);
  ok(await val(`return state.project.tracks[2].type!=='inst'`), 'voix déposée sur Lead : reste une piste voix');

  // 8. Le curseur « Son » ne casse pas un compresseur réglé à la main
  ok(await val(`const t=state.project.tracks[2]; t.proKeep={comp:true}; t.effectParams={comp:{threshold:-35,ratio:8,attack:10,release:50}}; t.effects=['comp'];
    t.sound={preset:'lead',tone:10,hold:35,drive:0}; applySound(t); return t.effectParams.comp.ratio===8 && t.effects.includes('comp')`), 'Son : le compresseur réglé à la main est gardé');

  // 12. La touche D ne pose plus de clip de démo
  const K = key(send);
  const n0 = await val(`return state.project.tracks.reduce((a,t)=>a+t.clips.length,0)`);
  await K('d'); await sleep(200);
  ok(await val(`return state.project.tracks.reduce((a,t)=>a+t.clips.length,0)`) === n0, 'touche D : aucun clip ajouté');

  // 13. Armer une piste Piano : refusé avec un message
  await val(`addTrack('keys')`); await sleep(700);
  const idx = await val(`return state.project.tracks.length-1`);
  await val(`PulsePianoRoll.close(true); document.querySelector('.t-mini.m-r[data-i="${idx}"]').click()`); await sleep(200);
  ok(await val(`return !state.project.tracks[${idx}].armed`), 'piste Piano : ne peut pas être armée pour la voix');

  // 27. Pas de noms de pistes en double
  await val(`addTrack('audio'); addTrack('audio'); state.project.tracks.splice(state.project.tracks.length-2,1); addTrack('audio')`); await sleep(300);
  ok(await val(`const n=state.project.tracks.map(t=>t.name); return new Set(n).size===n.length`), 'noms de pistes : jamais en double');

  // 25. Le fader Master est sauvegardé avec le projet
  await boot(c, { id: 'm1', name: 'M', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await val(`const f=document.querySelector('.mixer-master .fader'); f.value=60; f.dispatchEvent(new Event('input')); f.dispatchEvent(new Event('change'))`); await sleep(300);
  await c.nav('http://localhost:8765/studio.html'); await sleep(900);
  ok(await val(`return Math.round(PulseAudio.getMasterVolume())===60`), 'fader Master : retrouvé à la réouverture');

  if (bad.length) throw new Error('Régressions : ' + bad.join(' ; '));
};
