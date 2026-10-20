// UX : re-enregistrer sans revenir au début, puis ajouter de la reverb en glissant l'envoi
import { boot, RAP, instru, pos, mouse, key } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c; const K = key(send), Mo = mouse(send);
  const P = { id: 'u1', name: 'Test', bpm: 90, buses: [], tracks: [{ name: 'Voix', type: 'audio', armed: true, color: '#A855F7' }, { name: 'Instru', type: 'audio', preset: 'instru', color: '#60A5FA' }] };
  await boot(c, P); await instru(ev, 20, 1, 0);
  await ev(`PulseAudio.setCountIn(false)`);
  const D = async (l) => console.log(l, await ev(`'play='+state.playing+' rec='+state.recording+' head='+state.playhead.toFixed(2)+' '+JSON.stringify(state.project.tracks[0].clips.map(c=>[c.take,+c.start.toFixed(1),+c.duration.toFixed(1)]))`));
  await K('r'); await sleep(3000); await K('r'); await sleep(500); await D('apres R,R');
  await K(' '); await sleep(1000); await D('apres Espace');
  await K('r'); await sleep(3000); await K(' '); await sleep(1000); await D('2e R sans Entree (tete en fin de prise)');
  await shot('/private/tmp/claude-501/ux/rerec-1.jpg');
  // reverb : glisser l'envoi
  const s = await pos(ev, '.insp-send input, #inspector input[type=range][data-send], #inspector .insp-send-row input'); console.log('slider send', JSON.stringify(s));
  console.log('html insp envois', (await ev(`document.querySelector('#inspector').innerHTML.match(/ENVOIS[\\s\\S]{0,900}/)?.[0]||''`)).replace(/\s+/g,' ').slice(0,700));
};
