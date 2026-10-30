// Pulse s'arrête net pendant une prise (plantage, Mac éteint) : au redémarrage la prise est remise sur sa piste
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, nav, sleep } = c;
  await boot(c, { id: 'resc', name: 'Sauvetage', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', armed: true, color: '#A855F7', clips: [], output: 'master' }] });
  await ev(`state.selectedTrack=0; state.playhead=2; toggleRec()`); await sleep(7600);
  const meta = await ev(`localStorage.getItem('pulse_rec_rescue')`);
  const m = JSON.parse(meta || '{}');
  console.log('pendant la prise: morceaux mis à l\'abri =', m.parts, 'projet =', m.project);
  if (!(m.parts >= 2)) throw new Error('la prise n\'est pas mise à l\'abri pendant l\'enregistrement');
  // arrêt brutal : rien ne s'arrête proprement (on empêche la page de finir la prise en partant)
  await ev(`PulseAudio.stopRecording = () => new Promise(() => {}); window.onbeforeunload = null`);
  await nav('http://localhost:8765/studio.html'); await sleep(4000);
  const r = JSON.parse(await ev(`JSON.stringify({ clips: state.project.tracks[0].clips.map(c => ({ d: +c.duration.toFixed(2), s: +c.start.toFixed(2), rec: !!c.recording, buf: PulseAudio.hasBuffer(c.id) })), meta: localStorage.getItem('pulse_rec_rescue') })`));
  console.log('après redémarrage:', JSON.stringify(r));
  const k = r.clips.filter(x => !x.rec);
  if (k.length !== 1) throw new Error('il faut exactement une prise récupérée');
  if (!(k[0].d >= 6.3 && k[0].d <= 8)) throw new Error('durée récupérée inattendue : ' + k[0].d);
  if (Math.abs(k[0].s - 2) > 0.01) throw new Error('mauvaise place : ' + k[0].s);
  if (!k[0].buf) throw new Error('son de la prise absent');
  if (r.clips.some(x => x.rec)) throw new Error('région « en cours » restée');
  if (r.meta) throw new Error('copie de secours pas nettoyée');
  // et elle survit à un 2e redémarrage (son enregistré dans la base)
  await nav('http://localhost:8765/studio.html'); await sleep(2500);
  const again = await ev(`state.project.tracks[0].clips.length + ':' + PulseAudio.hasBuffer(state.project.tracks[0].clips[0].id)`);
  console.log('2e redémarrage:', again);
  if (again !== '1:true') throw new Error('prise perdue au 2e redémarrage');
  // une prise arrêtée normalement ne laisse aucune copie de secours
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'}); PulseAudio.setCountIn(false); })()`);
  await ev(`state.project.tracks[0].armed=true; state.selectedTrack=0; state.playhead=12; toggleRec()`); await sleep(4000);
  await ev(`state.playing && togglePlay()`); await sleep(2000);
  const left = await ev(`(async()=>{ const ids = await PulsePersist.listIds(); return localStorage.getItem('pulse_rec_rescue') + ' / ' + ids.filter(i=>String(i).startsWith('rescue_')).length })()`);
  console.log('après une prise normale:', left);
  if (left !== 'null / 0') throw new Error('restes de secours après une prise normale');
  const n2 = await ev(`state.project.tracks[0].clips.length`);
  if (n2 !== 2) throw new Error('la prise normale n\'a pas été posée (' + n2 + ' régions)');
  console.log('OK sauvetage de prise');
};
