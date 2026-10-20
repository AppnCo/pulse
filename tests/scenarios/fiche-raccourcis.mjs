// 18/10 : la fiche de raccourcis (?) s'ouvre et contient les nouveautés
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  console.log(await ev(`(async()=>{openCheatSheet(); await new Promise(r=>setTimeout(r,300)); const m=document.getElementById('cheatModal'); const t=m?m.textContent:''; return JSON.stringify({ouverte:!!m, lignes:SHORTCUT_GROUPS.reduce((n,g)=>n+g.items.length,0), boucle:/Dessiner la boucle/.test(t), moitiés:/moitié BASSE/.test(t), tout:/⌘A · ⌥⌘A/.test(t), outils:/Ciseaux/.test(t), Q:/Caler les notes choisies/.test(t)})})()`));
};
