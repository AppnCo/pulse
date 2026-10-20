import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send } = c;
  await boot(c, RAP);
  const flash = () => ev(`document.getElementById('flash').textContent`);
  const drop = (name, type, bytes) => ev(`(async()=>{ const dt=new DataTransfer(); dt.items.add(new File([new Uint8Array(${bytes})],${JSON.stringify(name)},{type:${JSON.stringify(type)}})); const e=new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}); document.querySelector('.timeline').dispatchEvent(e); await new Promise(r=>setTimeout(r,1200)); return state.project.tracks.length })()`);
  console.log('faux mp3 (octets nuls) :', await drop('faux.mp3', 'audio/mpeg', 5000), '|', await flash());
  console.log('fichier vide .wav :', await drop('vide.wav', 'audio/wav', 0), '|', await flash());
  console.log('texte .txt :', await drop('notes.txt', 'text/plain', 20), '|', await flash());
  console.log('image .png :', await drop('cover.png', 'image/png', 20), '|', await flash());
  console.log('pistes:', await ev(`state.project.tracks.map(t=>t.name+'→'+t.output).join(', ')`));
  // piste ajoutée avec + dans le modèle Rap : où va-t-elle ?
  await ev(`_doAddTrack('audio')`); await sleep(200);
  console.log('nouvelle piste via + :', await ev(`JSON.stringify({n:state.project.tracks[state.project.tracks.length-1].name,out:state.project.tracks[state.project.tracks.length-1].output})`));
  // R sans piste prête dans un projet où toutes ont des clips
  console.log('pistes vides restantes (créées par un fichier invalide) :', await ev(`state.project.tracks.filter(t=>!t.clips.length&&t.name.match(/faux|vide|notes|cover/)).map(t=>t.name).join(',')`));
};
