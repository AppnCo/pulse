// ⌘Z / ⇧⌘Z pendant la lecture : le son suit tout de suite (avant : il fallait relancer la lecture)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const R = (s, d) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), name: 'r', start: s, duration: d, offset: 0, peaks: [0.5, 0.5] });
  const T = (name) => ({ name, type: 'audio', color: '#3B82F6', output: 'master', clips: [R(0, 60)] });
  await boot(c, { id: 'apl', name: 'APL', bpm: 92, sends: [], tracks: [T('Kick'), T('Snare'), T('Bass')] }, { mic: false });
  await ev(`state.playhead = 0; togglePlay()`); await sleep(800);
  const key = async (mods) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: mods }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: mods }); };
  const live = () => J(ev, `return PulseAudio.debugLive().map(n => n.name + (n.audible ? '+' : '-')).join(' ')`);
  const same = () => J(ev, `const p = state.project; const l = PulseAudio.debugLive(); return state.playing && l.length === p.tracks.length && l.every(n => p.tracks[n.i].name === n.name && PulseAudio.isTrackAudible(p, p.tracks[n.i]) === n.audible)`);
  await ev(`document.activeElement && document.activeElement.blur(); selectTrack(0)`);
  // mute Kick, puis ⌘Z
  await ev(`(() => { pushUndo(); state.project.tracks[0].muted = true; PulseAudio.refreshAudibility(state.project); renderAll(); })()`); await sleep(300);
  check('Kick coupée', (await live()).startsWith('Kick-'), await live());
  await key(4); await sleep(400);
  check('⌘Z : Kick s entend de nouveau tout de suite', await same() && (await live()).startsWith('Kick+'), await live());
  await key(12); await sleep(400);
  check('⇧⌘Z : Kick recoupée tout de suite', await same() && (await live()).startsWith('Kick-'), await live());
  // solo de Bass annulé
  await key(4); await sleep(300);
  await ev(`(() => { pushUndo(); state.project.tracks[2].solo = true; PulseAudio.refreshAudibility(state.project); renderAll(); })()`); await sleep(300);
  await key(4); await sleep(400);
  check('solo annulé : tout le monde s entend', await same() && (await live()) === 'Kick+ Snare+ Bass+', await live());
  // ordre des pistes changé puis annulé : chaque piste garde son son
  await ev(`(() => { pushUndo(); const t = state.project.tracks; [t[0], t[2]] = [t[2], t[0]]; t[2].muted = true; renderAll(); refreshPlaybackSoon(); })()`); await sleep(500);
  await key(4); await sleep(500);
  check('ordre annulé : le moteur suit le bon ordre', await same(), await live());
  // une piste supprimée pendant la lecture : les pistes du dessous gardent leurs propres réglages
  await ev(`(() => { state.project.tracks[2].muted = true; PulseAudio.refreshAudibility(state.project); selectTrack(0); state.selectedTracks = new Set(); deleteSelectedTrack(); })()`); await sleep(500);
  check('piste supprimée en lecture : le moteur suit', await same(), await live());
  check('toujours en lecture', await J(ev, `return state.playing`));
};
