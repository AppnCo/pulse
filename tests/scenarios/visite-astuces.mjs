// 18/10 : visite guidée à 4 étapes (dont la boucle) ; astuces affichées une seule fois
export default async ({ ev, nav, send, sleep, check }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(1200);
  const R = (c) => ev(`(async()=>{${c}})()`);
  const steps = [];
  for (let i = 0; i < 4; i++) {
    steps.push(await R(`const o=document.getElementById('onboardOverlay'); if(!o) return null; const t=o.querySelector('h3').textContent+' | '+o.querySelector('.onboard-step').textContent; document.getElementById('onboardNext').click(); await new Promise(r=>setTimeout(r,250)); return t`));
  }
  check('visite guidée : 4 étapes', steps.every(Boolean) && steps[3].includes('4 / 4'), steps.join(' ; '));
  check('l\'étape « Répète un passage » existe (la boucle)', steps.some(s => s && s.startsWith('Répète un passage')));
  check('la visite se termine et ne revient pas', (await R(`return !document.getElementById('onboardOverlay') && localStorage.getItem('pulse_onboarded_v1')==='1'`)) === true);
  // astuce de la boucle : une seule fois
  const loopTip = async () => R(`const ru=document.getElementById('timelineRuler').getBoundingClientRect(); window.__fl=[]; const of=window.flash; window.flash=(m)=>{window.__fl.push(m); of(m)}; state.loop=null; return {y:ru.top+4, l:document.querySelector('.timeline').getBoundingClientRect().left, px:state.pxPerSecond}`);
  const drag = async (g) => { const x0 = g.l + g.px, x1 = g.l + 4 * g.px; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: g.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (x0 + x1) / 2, y: g.y, button: 'left', buttons: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: g.y, button: 'left', buttons: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: g.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300); };
  let g = await loopTip(); await drag(g);
  const first = JSON.parse(await R(`return JSON.stringify(window.__fl)`));
  check('1re boucle dessinée : l\'astuce s\'affiche', first.some(m => /Boucle allumée/.test(m)), JSON.stringify(first));
  await R(`state.loop=null; renderLoopOverlay(); return 1`);
  g = await loopTip(); await drag(g);
  const second = JSON.parse(await R(`return JSON.stringify(window.__fl)`));
  check('2e boucle : l\'astuce ne revient pas', !second.some(m => /Boucle allumée/.test(m)), JSON.stringify(second));
};
