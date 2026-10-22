// Pitch −/+ et Écho ping-pong dans le moteur du navigateur (mêmes mesures que les tests Rust de engine/src/fx.rs)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, buses: [], tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [] }] });
  await sleep(300);
  const render = (fx, params, sig) => ev(`(async()=>{
    await PulseAudio.init(); const sr=48000, ctx=PulseAudio.getContext();
    const b=ctx.createBuffer(1,sr,sr), d=b.getChannelData(0); for(let n=0;n<sr;n++) d[n]=${sig};
    PulseAudio.registerBuffer('sig', b);
    const proj={id:'x',bpm:120,buses:[],sends:[],tracks:[{name:'A',type:'audio',volume:100,effects:['${fx}'],effectParams:${JSON.stringify(params)},clips:[{id:'sig',start:0,duration:1,offset:0}]}]};
    const wav=await PulseAudio.exportWav(proj); const ab=await ctx.decodeAudioData(await wav.arrayBuffer());
    return { l:Array.from(ab.getChannelData(0).slice(0,sr)), r:Array.from(ab.getChannelData(1).slice(0,sr)) };
  })()`);
  const freq = (s) => { let z = 0; for (let i = 4800; i < s.length - 1; i++) if (s[i] <= 0 && s[i + 1] > 0) z++; return z / ((s.length - 4800) / 48000); };
  const base = freq((await render('pitch', { pitch: { semi: 0 } }, 'Math.sin(2*Math.PI*440*n/sr)*0.5')).l);   // référence sans transposition
  for (const semi of [12, -12, 5]) {
    const o = await render('pitch', { pitch: { semi, mix: 100 } }, 'Math.sin(2*Math.PI*440*n/sr)*0.5');
    const want = base * 2 ** (semi / 12), f = freq(o.l);
    check(`Pitch ${semi > 0 ? '+' : ''}${semi} : rapport ${(2 ** (semi / 12)).toFixed(3)}`, Math.abs(f - want) / want < 0.03, `${base.toFixed(1)} → ${f.toFixed(1)} Hz`);
  }
  // Ping-pong : on découpe en tranches de 50 ms et on suit les échos après la rafale (le côté qui sonne doit alterner)
  const o = await render('delay', { delay: { ms: 100, feedback: 50, wet: 100, pp: 1 } }, '(n>=2400&&n<2880)?0.8:0');
  const seg = (v) => { const r = []; for (let k = 0; k < 20; k++) r.push(Math.max(...v.slice(k * 2400, (k + 1) * 2400).map(Math.abs))); return r; };
  const L = seg(o.l), R = seg(o.r);
  const sides = []; for (let k = 0; k < 20; k++) { if (L[k] > 0.02 && R[k] < 0.005) sides.push('G'); else if (R[k] > 0.02 && L[k] < 0.005) sides.push('D'); }
  check('Ping-pong : les échos alternent gauche / droite', sides.length >= 4 && sides.slice(0, 4).join('') === 'GDGD', sides.join(' '));
  const o2 = await render('delay', { delay: { ms: 100, feedback: 50, wet: 100, pp: 0 } }, '(n>=2400&&n<2880)?0.8:0');
  check('Écho normal : rien ne change (les deux côtés ensemble)', seg(o2.l).every((v, k) => Math.abs(v - seg(o2.r)[k]) < 1e-6));
};
