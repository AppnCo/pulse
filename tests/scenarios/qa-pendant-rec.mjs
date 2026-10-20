// Actions « interdites » pendant une prise : l'enregistrement doit rester cohérent
import { boot, instru, RAP, key, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, logs } = c;
  const K = key(send);
  const actions = {
    '⌘Z': async () => K('z', 4),
    'Suppr': async () => K('Delete'),
    'Q (couper)': async () => K('q'),
    'supprimer la piste Voix': async () => ev(`state.selectedTrack=1; deleteSelectedTrack()`),
    'ajouter une piste': async () => ev(`_doAddTrack('audio')`),
    'BPM 90': async () => ev(`state.project.bpm=90; document.getElementById('bpmInput').value=90; document.getElementById('bpmInput').dispatchEvent(new Event('change'))`),
    'dupliquer piste': async () => ev(`duplicateTrack(1)`),
    'dissoudre groupe': async () => ev(`state.project.buses.length&&dissolveGroup(state.project.buses[0].id)`),
    'recharger les sons': async () => ev(`restoreBuffersFromDisk()`),
    'importer un fichier': async () => instru(ev, 2, 0, 0),
    'exporter': async () => ev(`exportProject()`),
    'effacer tout (⌘A puis Suppr)': async () => { await K('a', 4); await K('Delete'); },
  };
  for (const [label, act] of Object.entries(actions)) {
    await boot(c, { id: 'pr', name: 'PR', bpm: 120, buses: [{ id: 'g1', name: 'G', isGroup: true, output: 'master', color: '#A855F7' }], tracks: [{ name: 'Instru', type: 'audio', preset: 'instru', color: '#60A5FA', clips: [], output: 'master' }, { name: 'Voix', type: 'audio', armed: true, color: '#A855F7', clips: [], output: 'g1' }] });
    await instru(ev, 8, 0, 0); await sleep(200);
    const l0 = logs.length;
    await ev(`state.selectedTrack=1; state.playhead=0; toggleRec()`); await sleep(1500);
    const rec0 = await ev(`state.recording`);
    try { await act.call ? await act() : 0; } catch (e) { console.log('err', e.message); }
    await sleep(700);
    const during = await ev(`'rec='+state.recording+' clips Voix='+state.project.tracks.map(t=>t.name+':'+t.clips.map(c=>(c.recording?'*':'')+c.duration.toFixed(1)).join('|')).join(' ; ')`);
    await ev(`state.recording&&togglePlay()`); await sleep(1200);
    const after = await ev(`'rec='+state.recording+' play='+state.playing+' '+state.project.tracks.map(t=>t.name+':'+t.clips.length+(t.clips.some(c=>c.recording)?'(*vivant)':'')).join(' ; ')+' invariants='+JSON.stringify(${INVARIANTS})`);
    console.log(label.padEnd(30), 'rec démarré=' + rec0, '|', during, '|| après stop:', after, logs.length > l0 ? ' EXC ' + logs.slice(l0).join(' / ').slice(0, 200) : '');
  }
};
