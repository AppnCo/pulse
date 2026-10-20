import { boot, instru, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, { id: 'd', name: 'D', bpm: 120, buses: [], tracks: [{ name: 'Instru', type: 'audio', preset: 'instru', color: '#60A5FA', clips: [] }, { name: 'Voix', type: 'audio', armed: true, color: '#A855F7', clips: [] }] });
  const K = key(send);
  await instru(ev, 10, 0, 0); await sleep(300);
  await ev(`PulseAudio.setCountIn(true); state.metronome=false; state.playhead=3; updatePlayhead();`);
  const st = () => ev(`JSON.stringify({rec:state.recording,play:state.playing,ph:+state.playhead.toFixed(2),cnt:PulseAudio.isCountingIn(),starting:!!state._recStarting,clips:state.project.tracks[1].clips.map(c=>c.start.toFixed(2)+'+'+c.duration.toFixed(2)+(c.recording?'*':''))})`);
  await K('r'); await sleep(300);
  console.log('R + 0.3 s :', await st(), 'flash=', await ev(`document.getElementById('flash').textContent`));
  await sleep(2400);
  console.log('R + 2.7 s :', await st());
  await sleep(1500);
  console.log('R + 4.2 s :', await st());
  await K(' '); await sleep(600);
  console.log('Espace    :', await st());
  // R pendant le décompte puis R de nouveau
  await ev(`state.playhead=1; updatePlayhead()`);
  await K('r'); await sleep(500); await K('r'); await sleep(500);
  console.log('R puis R pendant le décompte :', await st(), 'flash=', await ev(`document.getElementById('flash').textContent`));
  await K(' '); await sleep(800);
  console.log('Espace     :', await st());
  await K('r'); await sleep(500); await K(' '); await sleep(600);
  console.log('R puis Espace pendant décompte :', await st());
};
