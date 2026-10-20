// Crash : l'éditeur de notes plante à la fermeture si sa région a disparu ; plage : exception si on la vide pendant le glisser
import { boot, instru, mouse, key, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  await boot(c, { id: 'e', name: 'E', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }, { name: 'V', type: 'audio', color: '#A855F7', clips: [] }] });
  const K = key(send), Ms = mouse(send);
  await ev(`createMidiClip(0, 0)`); await sleep(1200);
  console.log('éditeur ouvert:', await ev(`PulsePianoRoll.isOpen()`));
  // note posée (modif non encore validée) puis la région disparaît
  await ev(`(()=>{ const S=PulsePianoRoll._state(); S.notes.push({s:0,d:1,p:60,v:100}); S.dirty=true; S.t=null; })()`);
  await ev(`state.project.tracks[0].clips=[]`);
  await Ms.M('mouseMoved', 700, 700);
  await K('Escape');
  await sleep(400);
  console.log('après Échap : isOpen=', await ev(`PulsePianoRoll.isOpen()`), ' panneau présent=', await ev(`!!document.querySelector('.midi-editor, .pianoroll, #pianoRoll')`), 'body.midi-open=', await ev(`document.body.classList.contains('midi-open')`));
  await shot('/private/tmp/claude-501/qa/crash-editeur.jpg');
  // 2) plage : on tire dans le vide d'une piste puis Suppr pendant le glisser
  await boot(c, { id: 'e', name: 'E', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }, { name: 'V', type: 'audio', color: '#A855F7', clips: [] }] });
  const p0 = await pos(ev, '#timelineTracks .timeline-track[data-i="1"]', 0.3, 0.5); const p = { x: 700, y: p0.y };
  console.log('zone', JSON.stringify(p));
  await Ms.M('mouseMoved', p.x, p.y); await Ms.M('mousePressed', p.x, p.y);
  await Ms.M('mouseMoved', p.x + 30, p.y); await Ms.M('mouseMoved', p.x + 90, p.y);
  console.log('plage en cours', await ev(`JSON.stringify(state.selection)`));
  await K('Escape');
  console.log('après Échap', await ev(`JSON.stringify(state.selection)`));
  await Ms.M('mouseMoved', p.x + 160, p.y);
  await Ms.M('mouseReleased', p.x + 160, p.y);
  await sleep(200);
};
