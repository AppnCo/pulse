// 31/10 : les sons de Pulse sont rangés en WAV 24 bits (comme Logic / Pro Tools) ; un import 24 bits garde sa finesse
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, check } = c;
  await boot(c, null, { mic: false });
  const r = JSON.parse(await ev(`(async()=>{
    const ctx = await PulseAudio.init(); const sr = 48000;
    const b = ctx.createBuffer(2, sr, sr);
    for (let i = 0; i < b.length; i++) { b.getChannelData(0)[i] = Math.sin(i / 30) * 0.5; b.getChannelData(1)[i] = 1e-5 * Math.sin(i / 7); }
    const blob = PulseAudio.audioBufferToWav(b); const u8 = new Uint8Array(await blob.arrayBuffer()); const dv = new DataView(u8.buffer);
    const bits = dv.getUint16(34, true), size = u8.length;
    const back = await ctx.decodeAudioData(u8.buffer.slice(0));
    let err = 0; for (let c = 0; c < 2; c++) { const a = b.getChannelData(c), d = back.getChannelData(c); for (let i = 0; i < a.length; i++) err = Math.max(err, Math.abs(a[i] - d[i])); }
    const b16 = new Uint8Array(await PulseAudio.audioBufferToWav(b, 16).arrayBuffer());
    // import : le son rangé garde ses 24 bits
    await importAudioFile(new File([blob], 'fin.wav', { type: 'audio/wav' }), 0, 0);
    const clip = state.project.tracks.flatMap(t => t.clips || []).pop();
    const rec = clip ? await PulsePersist.loadBlob(clip.id) : null;
    const rb = rec && new DataView(await rec.arrayBuffer());
    return JSON.stringify({ bits, size, err, len: back.length, b16: new DataView(b16.buffer).getUint16(34, true), s16: b16.length, imp: rb ? rb.getUint16(34, true) : null });
  })()`));
  check('en-tête 24 bits', r.bits === 24, JSON.stringify(r));
  check('taille 24 bits (3 octets × 2 canaux)', r.size === 44 + 48000 * 6);
  check('relu par le navigateur au pas du 24 bits près (un son à -100 dB survit)', r.len === 48000 && r.err < 2 / 8388608, String(r.err));
  check('16 bits encore possible', r.b16 === 16 && r.s16 === 44 + 48000 * 4);
  check('son importé rangé en 24 bits', r.imp === 24, String(r.imp));
};
