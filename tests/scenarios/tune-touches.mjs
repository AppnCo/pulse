// Clavier de l'Auto-Tune : clic = jouer (note tenue), ⌘ + clic = allumer / éteindre la note
import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', tuneSlot: true, clips: [] }] });
  await instru(ev, 4, 0, 0); await sleep(300);
  await ev(`openTunePanel(0, -1, 300, 200, true)`); await sleep(400);
  const on = () => ev(`[...document.querySelectorAll('.tune-panel .tune-key-btn.on')].map(k=>k.dataset.pc).join()`);
  const before = await on();
  await ev(`document.querySelector('.tune-panel [data-pc="4"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`); await sleep(300);
  check('clic tenu : la touche est enfoncée et joue', await ev(`document.querySelector('.tune-panel [data-pc="4"]').classList.contains('pressed')`));
  check('clic simple : la gamme ne change pas', await on() === before, before);
  await ev(`document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`); await sleep(100);
  check('relâché : la touche remonte', await ev(`!document.querySelector('.tune-panel [data-pc="4"]').classList.contains('pressed')`));
  await ev(`document.querySelector('.tune-panel [data-pc="4"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,metaKey:true}))`); await sleep(200);
  check('⌘ + clic : la note change d’état', await on() !== before, `${before} → ${await on()}`);
  // Façade B : ⏻ allume (et garde la fenêtre ouverte), ⏻ éteint en gardant les réglages
  await ev(`document.querySelector('.tune-panel .tb-power').click()`); await sleep(1500);
  check('⏻ : Auto-Tune allumé, fenêtre toujours ouverte', await ev(`!!(state.project.tracks[0].autotune && state.project.tracks[0].autotune.on) && !!document.querySelector('.tune-panel.is-on')`));
  await ev(`document.querySelector('.tune-panel .tb-power').click()`); await sleep(1500);
  check('⏻ à nouveau : éteint, réglages gardés, Auto-Tune toujours sur la piste', await ev(`(()=>{ const a=state.project.tracks[0].autotune; return !!a && a.on===false && Array.isArray(a.notes) && showTuneSlot(state.project.tracks[0])===isVoiceTrack(state.project.tracks[0]); })()`), await ev(`'voix=' + isVoiceTrack(state.project.tracks[0]) + ' preset=' + state.project.tracks[0].preset`));
  check('fenêtre Auto-Tune déplaçable comme un plug', await ev(`document.querySelector('.tune-panel').classList.contains('plug-win')`));
  // PulseTune : tourner « Humain » (allumé) enregistre le réglage sur la piste et relance la correction
  await ev(`document.querySelector('.tune-panel .tb-power').click()`); await sleep(1200);
  const kb = await ev(`(()=>{ const r=document.querySelector('.tp-k[data-k="human"] .tp-knob').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: kb.x, y: kb.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: kb.x, y: kb.y - 10 * i, button: 'left' });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: kb.x, y: kb.y - 60, button: 'left', clickCount: 1 });
  await sleep(1500);
  check('PulseTune : Humain tourné → enregistré sur la piste', await ev(`(state.project.tracks[0].autotune||{}).human`) >= 0.25, JSON.stringify(await ev(`state.project.tracks[0].autotune`)));
  await ev(`document.querySelector('.tp-voice [data-v="low"]').click()`); await sleep(1200);
  check('PulseTune : type de voix « Grave » enregistré', await ev(`(state.project.tracks[0].autotune||{}).voice`) === 'low');
  await ev(`document.querySelector('.tune-mode [data-chroma="1"]').click()`); await sleep(300);
  check('PulseTune : Chromatique = toutes les notes', await ev(`document.querySelectorAll('.tune-panel .tune-key-btn.on').length`) === 12);
};
