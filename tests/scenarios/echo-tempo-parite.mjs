// Parité échantillon par échantillon : écho 1/8 + tempo qui change PENDANT que des répétitions sont en route.
// Le navigateur exporte le mix ; le moteur Rust (pulse-render) mixe le même .pulse ; on compare les deux fichiers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export default async ({ ev, nav, sleep, check }) => {
  const bin = path.join(os.homedir(), 'pulse-build/target/debug/pulse-render');
  const engine = path.resolve('engine');
  execFileSync('bash', ['-c', `cd "${engine}" && PATH=$HOME/.cargo/bin:$PATH CARGO_TARGET_DIR=$HOME/pulse-build/target cargo build -q --bin pulse-render`]);
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'etp',name:'ETP',bpm:120,buses:[],sends:[],tracks:[{name:'Voix',type:'audio',color:'#60A5FA',volume:100,clips:[]}]}));`);
  await nav('http://localhost:8765/studio.html'); await sleep(2000);
  const r = JSON.parse(await ev(`(async()=>{
    const ctx = await PulseAudio.init(), sr = 48000;
    // son tenu de 1,5 à 2,5 s : le changement de tempo (2 s) tombe pendant que l'écho tourne
    const b = ctx.createBuffer(1, sr, sr), d = b.getChannelData(0); for (let i = 0; i < sr; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / sr) * Math.min(1, i / 480, (sr - i) / 480);
    PulseAudio.registerBuffer('ton', b);
    await PulsePersist.saveBlob('ton', PulseAudio.audioBufferToWav(b), { kind: 'rec' });
    const p = state.project, t = p.tracks[0];
    t.clips = [{ id: 'ton', start: 1.5, duration: 1, name: 'ton' }];
    t.effects = ['delay']; t.effectParams = { delay: { wet: 40, feedback: 50, beats: 0.5, pp: 1 } };
    p.tempos = [{ beat: 4, bpm: 75 }];
    p.masterVolume = 60; PulseAudio.setMasterVolume(60);   // le fader Master compte aussi dans Rust
    saveProject();
    const toB64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const { blob } = await PulseFile.pack(p);
    const wav = await PulseAudio.exportWav(p);
    return JSON.stringify({ pulse: await toB64(blob), wav: await toB64(wav) });
  })()`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etp-'));
  fs.writeFileSync(path.join(dir, 'p.pulse'), Buffer.from(r.pulse, 'base64'));
  fs.writeFileSync(path.join(dir, 'js.wav'), Buffer.from(r.wav, 'base64'));
  execFileSync(bin, [path.join(dir, 'p.pulse'), path.join(dir, 'rust.wav')]);
  // lecture WAV (16 / 24 / 32 bits flottants)
  const read = (f) => {
    const b = fs.readFileSync(f); let o = 12, fmt = null, data = null;
    while (o < b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), bits: b.readUInt16LE(o + 22) }; if (id === 'data') data = b.subarray(o + 8, o + 8 + n); o += 8 + n + (n & 1); }
    const bps = fmt.bits / 8, frames = data.length / bps / fmt.ch, L = new Float64Array(frames), R = new Float64Array(frames);
    const s = (i) => fmt.tag === 3 ? data.readFloatLE(i) : bps === 2 ? data.readInt16LE(i) / 32768 : data.readIntLE(i, 3) / 8388608;
    for (let k = 0; k < frames; k++) { L[k] = s(k * bps * fmt.ch); R[k] = s(k * bps * fmt.ch + bps); }
    return { L, R };
  };
  const a = read(path.join(dir, 'js.wav')), z = read(path.join(dir, 'rust.wav'));
  const n = Math.min(a.L.length, z.L.length);
  let worst = 0, at = 0, peak = 0;
  for (let k = 0; k < n; k++) { const e = Math.max(Math.abs(a.L[k] - z.L[k]), Math.abs(a.R[k] - z.R[k])); if (e > worst) { worst = e; at = k; } peak = Math.max(peak, Math.abs(a.L[k])); }
  // énergie de l'écho après le changement : il est bien là dans les deux
  const tail = (x) => { let s = 0; for (let k = Math.round(2.6 * 48000); k < Math.round(3.6 * 48000) && k < x.length; k++) s += x[k] * x[k]; return s; };
  console.log(JSON.stringify({ frames: [a.L.length, z.L.length], worst, at: at / 48000, peak, tailJs: tail(a.L), tailRust: tail(z.L) }));
  check('navigateur et Rust : même mix à l\'échantillon près (écart < 0,0005)', worst < 5e-4 && peak > 0.03, `écart max ${worst.toExponential(2)} à ${(at / 48000).toFixed(3)} s`);
  check('les répétitions continuent après le changement de tempo', tail(a.L) > 1 && Math.abs(tail(a.L) - tail(z.L)) / tail(a.L) < 0.01, `${tail(a.L).toFixed(2)} / ${tail(z.L).toFixed(2)}`);
};
