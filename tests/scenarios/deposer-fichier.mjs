// Comme Logic : un fichier du Finder lâché SUR une piste audio s'y pose à l'endroit visé ; lâché sous les pistes = nouvelle piste
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'dfi', name: 'DFI', bpm: 120, sends: [], buses: [{ id: 'g1', name: 'Vocal', isGroup: true, output: 'master', volume: 100 }],
    tracks: [{ name: 'Kick', type: 'audio', color: '#3B82F6', clips: [] }, { name: 'Lead', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }, { name: 'Back', type: 'audio', color: '#A855F7', output: 'g1', clips: [] }] }, { mic: false });
  await ev(`setZoom(40, 0); state.snap = 'off'`); await sleep(200);
  const drop = (sel, fx, below) => ev(`(async () => {
    const ctx = PulseAudio.getContext(); const sr = 48000, b = ctx.createBuffer(1, sr, sr); for (let i = 0; i < b.length; i++) b.getChannelData(0)[i] = Math.sin(i / 30) * 0.3;
    const f = new File([PulseAudio.audioBufferToWav(b)], 'snare.wav', { type: 'audio/wav' });
    const dt = new DataTransfer(); dt.items.add(f);
    const els = [...document.querySelectorAll('${sel}')]; const el = els[els.length - 1]; const r = el.getBoundingClientRect();
    const v = document.querySelector('.timeline').getBoundingClientRect(); const x = Math.max(r.left, v.left) + 400 * ${fx}, y = ${below ? 'r.bottom + 40' : 'r.top + r.height / 2'};
    const target = document.elementFromPoint(x, y) || document.body;
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 1500)); return 1; })()`);
  await drop('.timeline-track[data-i="2"]', 0.3, false);
  let s = await J(ev, `return { n: state.project.tracks.length, back: state.project.tracks[2].clips.length, at: state.project.tracks[2].clips[0] && +state.project.tracks[2].clips[0].start.toFixed(1) }`);
  check('lâché sur la piste Back (dans un groupe) : posé sur Back, pas de nouvelle piste', s.n === 3 && s.back === 1, JSON.stringify(s));
  check('… à l\'endroit visé (pas au début)', s.at > 1, JSON.stringify(s));
  await drop('.timeline-track', 0.5, true);
  s = await J(ev, `return { n: state.project.tracks.length, last: state.project.tracks[state.project.tracks.length - 1].clips.length }`);
  check('lâché sous les pistes : nouvelle piste', s.n === 4 && s.last === 1, JSON.stringify(s));
};
