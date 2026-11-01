// fenêtre de plugin minuscule (comme une fenêtre que Logic vient de réduire) : le panneau garde sa taille
export default async ({ ev, nav, sleep, send, check }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 200, height: 300, deviceScaleFactor: 1, mobile: false });
  for (const fx of ['eq', 'limit', 'deess', 'gate', 'delay', 'reverb', 'mband', 'msat', 'comp', 'sat', 'filter']) {
    await nav(`http://localhost:8765/plugins/ui/dev.html?fx=${fx}`); await sleep(500);
    const w = await ev(`Math.round(document.querySelector('.plug-win').getBoundingClientRect().width)`);
    check(`${fx} : largeur dans une fenêtre de 200 px`, w >= 330, w + ' px');
  }
};
