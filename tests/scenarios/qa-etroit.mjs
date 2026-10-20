import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  await boot(c, RAP, { w: 1000, h: 700 });
  await instru(ev, 8, 0, 0);
  await ev(`setLyricsOpen(true)`); await sleep(500);
  await shot('/private/tmp/claude-501/qa/etroit-texte.jpg');
  console.log('largeur zone timeline', await ev(`document.querySelector('.timeline').getBoundingClientRect().width`), 'texte', await ev(`document.querySelector('.lyrics-panel,#lyricsPanel')?.getBoundingClientRect().width`));
  await ev(`toggleMixer()`); await sleep(500);
  await shot('/private/tmp/claude-501/qa/etroit-texte-mixer.jpg');
  await ev(`toggleMixer(); setLyricsOpen(false); document.body.style.zoom=1`);
  // fenêtre très étroite
  for (const w of [800, 700]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 600, deviceScaleFactor: 1, mobile: false }); await sleep(500);
    console.log(w, 'débordement horizontal page =', await ev(`document.documentElement.scrollWidth - innerWidth`), 'topbar:', await ev(`JSON.stringify((()=>{const t=document.querySelector('.topbar'); const o=[...t.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().right>innerWidth||b.getBoundingClientRect().left<0).map(b=>b.id||b.textContent.trim()); return o})())`), 'transport:', await ev(`JSON.stringify([...document.querySelectorAll('.transport button, .transport input')].filter(b=>b.getBoundingClientRect().right>innerWidth).map(b=>b.id||b.textContent.trim()))`));
    await shot(`/private/tmp/claude-501/qa/etroit-${w}.jpg`);
  }
};
