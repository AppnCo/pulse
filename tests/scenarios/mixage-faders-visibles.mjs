// Table de mixage : quel que soit l'écran, le fader de chaque tranche est entier et utilisable (pas coupé en bas)
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  const T = (name, out, fx = []) => ({ name, type: 'audio', color: '#3B82F6', output: out, clips: [], effects: fx });
  const G = (id, name) => ({ id, name, isGroup: true, output: 'master', color: '#A855F7', volume: 100 });
  await boot(c, { id: 'mfv', name: 'MFV', bpm: 120, sends: [], buses: [G('dr', 'Drums'), G('vx', 'Voix')],
    tracks: [T('Kick', 'dr'), T('Snare', 'dr'), T('Bass', 'master'), T('Lead', 'vx', ['eq', 'comp', 'sat']), T('Back', 'vx')] }, { mic: false, w: 1600, h: 940 });
  await ev(`toggleMixer()`); await sleep(700);
  for (const h of [760, 940, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(600);
    const r = await J(ev, `const box = document.querySelector('.mixer-strips').getBoundingClientRect(); const out = [];
      document.querySelectorAll('.mixer-strips .strip').forEach(s => { const f = s.querySelector('.strip-fader-wrap .fader') || s.querySelector('.fader'); if (!f) return; const fr = f.getBoundingClientRect(), wr = s.querySelector('.strip-fader-wrap').getBoundingClientRect();
        out.push({ n: (s.querySelector('.strip-name') || {}).textContent, bas: Math.round(wr.bottom - box.bottom), haut: Math.round(Math.max(fr.height, fr.width)) }); });
      return { scroll: document.querySelector('.mixer-strips').scrollHeight - document.querySelector('.mixer-strips').clientHeight, out }`);
    const bad = r.out.filter(x => x.bas > 1);
    check(`écran ${h} px : aucun fader coupé en bas`, r.out.length >= 7 && !bad.length, JSON.stringify(r));
    check(`écran ${h} px : faders assez longs (≥ 90 px)`, r.out.every(x => x.haut >= 90), JSON.stringify(r.out.map(x => x.haut)));
  }
};
