import fs from 'fs';
export function readWav(p) {
  const b = fs.readFileSync(p); let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') { data = b.subarray(o + 8, Math.min(b.length, o + 8 + sz)); break; }
    o += 8 + sz + (sz & 1); }
  const bps = fmt.bits / 8, n = Math.floor(data.length / (bps * fmt.ch));
  const chans = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) { const p = (i * fmt.ch + c) * bps; let v;
    if (fmt.tag === 3) v = bps === 4 ? data.readFloatLE(p) : data.readDoubleLE(p);
    else if (bps === 2) v = data.readInt16LE(p) / 32768; else if (bps === 3) v = data.readIntLE(p, 3) / 8388608; else v = data.readInt32LE(p) / 2147483648;
    chans[c][i] = v; }
  return { sr: fmt.sr, chans };
}
export function writeWav(p, chans, sr) {
  const n = chans[0].length, ch = chans.length, b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), 44 + (i * ch + c) * 2);
  fs.writeFileSync(p, b);
}
