// Comme Logic : pendant qu'on tire un fader de volume, une bulle montre la valeur en dB près de la souris ; elle part au relâché
import { boot, J } from './qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep, check } = c;
  await boot(c, { id: 'fbd', name: 'FBD', bpm: 120, sends: [], tracks: [{ name: 'Lead', type: 'audio', color: '#A855F7', clips: [] }] }, { mic: false });
  await ev(`selectTrack(0); renderInspector()`); await sleep(300);
  const tip = () => J(ev, `const t = document.querySelector('.db-tip'); return t && !t.hidden ? t.textContent : null`);
  for (const sel of ['#inspector .insp-strip[data-kind="track"] .insp-fader', '.track-item[data-i="0"] .t-vol']) {
    const p = await J(ev, `const e = document.querySelector('${sel}'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: r.height > r.width }`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let k = 1; k <= 4; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (p.v ? 0 : -8 * k), y: p.y + (p.v ? 8 * k : 0), button: 'left', buttons: 1 });
    await sleep(100);
    const during = await tip();
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(700);
    const after = await tip();
    check(`${sel.includes('t-vol') ? 'liste' : 'inspecteur'} : bulle « … dB » pendant le glisser`, !!during && / dB$/.test(during), String(during));
    check(`${sel.includes('t-vol') ? 'liste' : 'inspecteur'} : la bulle part au relâché`, after === null, String(after));
  }
};
