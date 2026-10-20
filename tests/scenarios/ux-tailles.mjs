import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev } = c;
  await boot(c, { id: 'u2', name: 'T', bpm: 90, buses: [], tracks: [{ name: 'Voix', type: 'audio', armed: true, color: '#A855F7' }, { name: 'Instru', type: 'audio', preset: 'instru', color: '#60A5FA' }] });
  await instru(ev, 8, 1, 0);
  console.log(await ev(`JSON.stringify([...document.querySelectorAll('#inspector *, .track-item *, .save-indicator, #mixer *, .t-mini, .clip-name, .clip-label')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.offsetParent!==null).map(e=>{const s=getComputedStyle(e);return [e.textContent.trim().slice(0,22),parseFloat(s.fontSize),s.color,e.className.toString().slice(0,30)]}).filter(a=>a[1]<11).slice(0,40))`));
};
