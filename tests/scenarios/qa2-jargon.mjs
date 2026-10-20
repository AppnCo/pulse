import { boot, RAP, instru, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  const proj = JSON.parse(JSON.stringify(RAP));
  proj.tracks.push({ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', output: 'master', clips: [] });
  await boot(c, proj);
  await instru(ev, 8, 0, 0); await sleep(300);
  const bag = new Set();
  const grab = async () => { const a = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-tooltip],[title],[placeholder]')].map(e=>e.dataset.tooltip||e.title||e.placeholder).concat([...document.querySelectorAll('button,label,h1,h2,h3,span,div,option')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.offsetParent!==null).map(e=>e.textContent.trim())))`)); a.forEach(s => bag.add(s)); };
  await grab();
  await ev(`toggleMixer()`); await sleep(300); await grab(); await ev(`toggleMixer()`);
  await ev(`setInspectorOpen(true)`); await sleep(200); await grab();
  await ev(`setLyricsOpen(true)`); await grab(); await ev(`setLyricsOpen(false)`);
  for (const code of [`openExportModal()`, `openSettings()`, `openEffectPanel(2,'comp',document.querySelector('.track-item[data-i="2"]'))`, `openEffectPanel(2,'reverb',document.querySelector('.track-item[data-i="2"]'))`, `openEqPanel(2,document.querySelector('.track-item[data-i="2"]'))`, `openSoundPanel(2,document.querySelector('.track-item[data-i="2"]'))`, `openSoundPanel(state.project.buses[0],document.querySelector('.track-item[data-i="2"]'))`, `openTunePanel(2,-1,300,200,true)`, `openMasterPanel(state.project.buses.find(b=>b.premaster),document.querySelector('.track-item[data-i="2"]'))`, `openSendPanel(projectSends()[0].id, document.querySelector('.track-item[data-i="2"]'))`, `createMidiClip(5,0,true)`, `openCheatSheet()`]) {
    await ev(`document.querySelectorAll('.fx-panel,.modal-backdrop,#cheatModal').forEach(p=>p.remove()); try{ ${code} }catch(e){}`); await sleep(350); await grab();
  }
  const words = /\b(bus|buffer|preset|latence|offset|bounce|stem|sidechain|wet|dry|fader|master|clip|sample|render|quantiz|mix\s?bus|premaster|limiteur|ceiling|plafond|gain|ratio|seuil|release|attack|threshold|bypass|snap|loop|rec\b|tempo|BPM|MIDI|velocit|swing)\b/i;
  const hits = [...bag].filter(s => words.test(s) && s.length < 220);
  console.log('textes avec jargon (' + hits.length + ' / ' + bag.size + ') :');
  hits.sort().forEach(s => console.log('  - ' + s.replace(/\s+/g, ' ').slice(0, 170)));
};
