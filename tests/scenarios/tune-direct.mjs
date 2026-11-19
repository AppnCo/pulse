// PulseTune « Entendre corrigé » : le réglage part au retour casque natif (moteur de l'appli) ; dans Chrome, la case est grisée
import { boot, J, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, JSON.parse(JSON.stringify(RAP)), { mic: false });
  await ev(`(()=>{ const t=state.project.tracks[2]; t.autotune={on:true,notes:[1,0,1,1,0,1,0,1,1,0,1,0].map(Boolean),strength:0.9}; state.project.tracks.forEach(x=>{ x.inputMonitor=false; }); t.inputMonitor=true; openTunePanel(2,-1,300,60,true); })()`); await sleep(400);
  const box = await J(ev, `const b=document.querySelector('.tune-panel .tune-live-box'); return { has: !!b, disabled: b && b.disabled }`);
  check('case « Entendre corrigé » présente, grisée hors de l\'appli', box.has && box.disabled === true, JSON.stringify(box));
  let j = await J(ev, `return JSON.parse(nativeMonitorTrackJson()).track.autotune || null`);
  check('sans « live » : rien de corrigé dans le casque', j === null, JSON.stringify(j));
  await ev(`state.project.tracks[2].autotune.live = true`);
  j = await J(ev, `return JSON.parse(nativeMonitorTrackJson()).track.autotune || null`);
  check('« live » : la gamme et la vitesse partent au retour casque', j && j.on && j.live && j.strength === 0.9 && j.notes.length === 12 && j.notes[1] === false && j.notes[0] === true, JSON.stringify(j));
};
