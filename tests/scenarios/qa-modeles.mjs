import { boot, key, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, nav, shot, logs } = c;
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const Ms = mouse(send);
  for (const id of ['rap-studio', 'voix-instru', 'podcast', 'beat-simple']) {
    await nav('http://localhost:8765/index.html');
    await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
    await nav('http://localhost:8765/index.html'); await sleep(500);
    const card = await pos(ev, '.card-template');
    await Ms.click(card.x, card.y); await sleep(600);
    const it = await pos(ev, `.template-item[data-template="${id}"]`);
    if (!it) { console.log(id, 'introuvable'); continue; }
    await Ms.click(it.x, it.y); await sleep(2500);
    console.log(id, await ev(`location.pathname+' | '+JSON.stringify({pistes:state.project.tracks.map(t=>t.name+'→'+(t.output||'master')), groupes:state.project.buses.map(b=>b.id), bpm:state.project.bpm})`));
    await shot(`/private/tmp/claude-501/qa/modele-${id}.jpg`);
  }
};
