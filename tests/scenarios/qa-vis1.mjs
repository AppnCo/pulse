import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot } = c;
  for (const [w, h] of [[1440, 860], [1000, 700], [1920, 1080]]) {
    await boot(c, RAP, { w, h });
    await instru(ev, 8, 0, 0); await sleep(300);
    await shot(`/private/tmp/claude-501/qa/vis1-${w}.jpg`);
    await ev(`toggleMixer()`); await sleep(500);
    await shot(`/private/tmp/claude-501/qa/vis1-${w}-mixer.jpg`);
  }
};
