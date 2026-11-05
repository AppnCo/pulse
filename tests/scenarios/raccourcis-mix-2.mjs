// Raccourcis Logic : ⌃⌥⌘S = plus aucun solo, ⌃⌥⌘M = plus aucun mute, ⌥⌘C / ⌥⌘V = copier / coller les réglages de tranche
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'rm2', name: 'RM2', bpm: 120, sends: [], tracks: [
    { name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [], effects: ['comp', 'eq'], effectParams: { comp: { threshold: -22 } }, eqBands: [{ f: 3000, g: 4, q: 1 }] },
    { name: 'Choeur', type: 'audio', color: '#22C55E', volume: 100, clips: [], effects: [] },
    { name: 'Basse', type: 'audio', color: '#3B82F6', volume: 100, clips: [], effects: ['sat'] },
  ] }, { mic: false });
  // modifiers CDP : Alt 1, Ctrl 2, Meta 4
  const key = async (k, modifiers) => { const code = 'Key' + k.toUpperCase();
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers }); await sleep(250); };
  await ev(`document.activeElement && document.activeElement.blur()`);
  await ev(`state.project.tracks[0].solo = true; state.project.tracks[2].solo = true; state.project.tracks[1].muted = true; state.project.tracks[2].muted = true; PulseAudio.refreshAudibility(state.project); renderTracksPanel(); bindTrackEvents();`);
  await key('s', 7);
  check('⌃⌥⌘S : plus aucun solo', await J(ev, `return state.project.tracks.every(t => !t.solo)`));
  check('⌃⌥⌘S n\'ouvre pas « Enregistrer sous »', await J(ev, `return state.project.tracks[1].muted === true`));
  await key('m', 7);
  check('⌃⌥⌘M : plus aucun mute', await J(ev, `return state.project.tracks.every(t => !t.muted)`));
  await ev(`state.selectedTrack = 0; state.selectedTracks = new Set([0]);`);
  await key('c', 5);
  check('⌥⌘C : réglages copiés', await J(ev, `return !!state._stripClip && state._stripClip.effects.length === 2`));
  await ev(`state.selectedTrack = 1; state.selectedTracks = new Set([1, 2]);`);
  await key('v', 5);
  const r = await J(ev, `return state.project.tracks.map(t => ({ e: (t.effects||[]).join(','), th: t.effectParams && t.effectParams.comp && t.effectParams.comp.threshold, eq: t.eqBands && t.eqBands[0] && t.eqBands[0].g }))`);
  check('⌥⌘V : collé sur les 2 pistes choisies', r[1].e === 'comp,eq' && r[2].e === 'comp,eq', JSON.stringify(r));
  check('⌥⌘V : réglages et bandes d\'EQ suivent', r[1].th === -22 && r[2].eq === 4, JSON.stringify(r));
  await ev(`state.project.tracks[1].effectParams.comp.threshold = -5`);
  check('copie indépendante (pas de lien entre pistes)', await J(ev, `return state.project.tracks[2].effectParams.comp.threshold === -22 && state.project.tracks[0].effectParams.comp.threshold === -22`));
  await ev(`undoAction()`); await sleep(300);
  check('⌘Z : un seul retour annule le collage', await J(ev, `return (state.project.tracks[2].effects||[]).join(',') === 'sat' && (state.project.tracks[1].effects||[]).length === 0`));
  check('aide : les raccourcis y sont', await J(ev, `const all = SHORTCUT_GROUPS.flatMap(g => g.items.map(i => i[1])); return ['Plus aucun solo','Plus aucun mute'].every(x => all.includes(x)) && all.some(x => x.startsWith('Copier / coller les réglages de tranche'))`));
};
