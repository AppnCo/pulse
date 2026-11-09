// Solo protégé (⌃ + clic sur S, comme Logic) : la piste joue même quand une autre est en solo ; ⌘Z le retire
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'sp', name: 'SP', bpm: 120, sends: [],
    tracks: [{ name: 'Voix', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Reverb', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Prod', type: 'audio', color: '#3B82F6', clips: [] }] }, { mic: false });
  const click = async (sel, modifiers = 0) => { const p = await J(ev, `const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, modifiers }); await sleep(250); };
  const aud = () => J(ev, `return state.project.tracks.map(t => PulseAudio.isTrackAudible(state.project, t))`);
  await click('.track-item[data-i="1"] .m-s', 2);
  check('⌃ + clic : solo protégé posé, pas de solo', await J(ev, `const t = state.project.tracks[1]; return t.soloSafe === true && !t.solo`));
  check('S marqué', await J(ev, `return document.querySelector('.track-item[data-i="1"] .m-s').classList.contains('safe')`));
  await click('.track-item[data-i="0"] .m-s');
  check('solo sur Voix : Voix + Reverb jouent, Prod coupée', JSON.stringify(await aud()) === '[true,true,false]', JSON.stringify(await aud()));
  await ev(`undoAction()`); await sleep(200); await ev(`undoAction()`); await sleep(300);
  check('⌘Z ×2 : plus de solo protégé', await J(ev, `return !state.project.tracks[1].soloSafe && !state.project.tracks[0].solo`));
  await ev(`state.project.tracks[1].soloSafe = true; if (!state.mixerOpen) toggleMixer()`); await sleep(400);
  check('table de mixage : S marqué aussi', await J(ev, `renderMixer(); return !!document.querySelector('.mixer-strips .strip[data-kind="track"][data-i="1"] .strip-s.safe')`));
};
