import { boot, J, key, pos, mouse, CMD, INVARIANTS } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const Mo = mouse(send);
  await boot(c, { id: 'sp', name: 'SonPro', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [], effects: ['comp'], effectParams: { comp: { threshold: -35, ratio: 8, attack: 5, release: 80, mix: 100 } }, sound: { preset: 'lead', tone: 0, hold: 35, drive: 0, space: 0, deess: 30 } }] });
  await ev(`applySound=applySound`);
  // état « à la main » : le compresseur a été réglé dans la fenêtre Comp (threshold -35, ratio 8)
  console.log('avant', await ev(`JSON.stringify({fx:state.project.tracks[0].effects, comp:state.project.tracks[0].effectParams.comp})`));
  await ev(`toggleMixer()`); await sleep(300);
  const b = await pos(ev, `.strip[data-kind="track"][data-i="0"] .strip-sound`); await Mo.click(b.x, b.y); await sleep(300);
  // bouge le curseur « Plus clair / Plus chaud » d'un cran
  await ev(`(()=>{const s=document.querySelector('.fx-panel .fx-slider[data-key="tone"]'); s.value=10; s.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(200);
  console.log('après curseur Ton', await ev(`JSON.stringify({fx:state.project.tracks[0].effects, comp:state.project.tracks[0].effectParams.comp})`));
  // Piste sans « son » : on active juste Comp, puis dose de la reverb dans le panneau
  await ev(`state.project.tracks.push({name:'Piano',type:'keys',midiInst:'piano',color:'#22D3EE',clips:[],effects:['comp']}); renderAll()`);
  await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); openSoundPanel(1, document.querySelector('.strip[data-i="1"]'))`); await sleep(200);
  await ev(`(()=>{const s=document.querySelector('.fx-panel .fx-slider[data-key="space"]'); s.value=20; s.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(200);
  console.log('Piano : après dose espace', await ev(`JSON.stringify({fx:state.project.tracks[1].effects, sound:state.project.tracks[1].sound})`));
};
