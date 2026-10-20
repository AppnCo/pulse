import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, nav, send, sleep, shot } = c;
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  for (const [w, h] of [[1440, 860], [1000, 700], [390, 800]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await nav('http://localhost:8765/index.html');
    await ev(`localStorage.clear()`);
    await nav('http://localhost:8765/index.html'); await sleep(800);
    await shot(`/private/tmp/claude-501/qa/acc-${w}-first.jpg`);
    await ev(`localStorage.setItem('pulse_onboarded_v1','1')`);
    await nav('http://localhost:8765/index.html'); await sleep(800);
    await shot(`/private/tmp/claude-501/qa/acc-${w}.jpg`);
    console.log(w, await ev(`JSON.stringify({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth})`));
  }
};
