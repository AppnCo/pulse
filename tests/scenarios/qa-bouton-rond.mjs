// Le repère du bouton rond gauche/droite du mixeur et les infobulles des poignées de redimensionnement sont cassés (conflit data-tooltip / ::after)
import { boot, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, RAP);
  await ev(`toggleMixer()`); await sleep(500);
  console.log('bouton rond (mixeur) ::after =', await ev(`(()=>{const k=document.querySelector('.strip-pan-knob'); const cs=getComputedStyle(k,'::after'); return JSON.stringify({opacity:cs.opacity, zIndex:cs.zIndex, content:cs.content, tooltip:k.dataset.tooltip})})()`), '(attendu : opacity 1 pour le repère OU infobulle visible ; ici opacity 0 et content vide)');
  for (const sel of ['.track-resize', '.group-resize', '#panelResizer', '#inspResizer']) {
    console.log(sel, await ev(`(()=>{const k=document.querySelector(${JSON.stringify(sel)}); if(!k) return 'absent'; const cs=getComputedStyle(k,'::after'); return JSON.stringify({content:cs.content, tooltip:(k.dataset.tooltip||'').slice(0,40)})})()`));
  }
};
