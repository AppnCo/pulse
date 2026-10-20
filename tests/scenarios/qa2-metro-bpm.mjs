import { boot, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c; const K = key(send);
  await boot(c, { id: 'mb', name: 'Metro', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }] });
  await ev(`window.__clk=[]; const os=OscillatorNode.prototype.start; OscillatorNode.prototype.start=function(w){ if(this.type==='square') window.__clk.push(+w.toFixed(3)); return os.apply(this,arguments); }`);
  await ev(`state.project.tracks[0].clips=[{id:'x',start:0,duration:30}]; PulseAudio.registerBuffer('x', PulseAudio.getContext().createBuffer(1,48000*30,48000)); renderAll()`);
  await K('k'); await K(' '); await sleep(1500);
  await ev(`window.__clk=[]`);
  await ev(`document.getElementById('btnBpmHalf').click()`);     // 120 -> 60
  await sleep(4000);
  const clk = JSON.parse(await ev(`JSON.stringify(window.__clk)`));
  const iv = clk.slice(1).map((v, i) => +(v - clk[i]).toFixed(2));
  console.log('BPM projet', await ev(`state.project.bpm`), '| écarts entre clics après ÷2 (s) :', JSON.stringify(iv), '| attendu : 1.0');
};
