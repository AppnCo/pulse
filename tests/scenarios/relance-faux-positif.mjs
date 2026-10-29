// 29/10 : « Pulse vient d'être relancé par le système » ne doit apparaître qu'après un vrai plantage,
// pas quand on rouvre l'appli après un ⌘Q (où la fermeture propre n'est pas toujours notée)
export default async ({ ev, nav, sleep, check }) => {
  const base = `localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'rf1',name:'Relance',bpm:120,buses:[],tracks:[{name:'Voix',type:'audio',color:'#A855F7',fx:[],clips:[]}]}));`;
  const essai = async (ilYa) => {
    await nav('http://localhost:8765/index.html');
    await ev(`${base} localStorage.setItem('pulse_alive', String(Date.now() - ${ilYa})); localStorage.removeItem('pulse_clean_exit'); 1`);
    await nav('http://localhost:8765/studio.html');
    await sleep(1800);
    return ev(`(document.getElementById('flash')?.textContent || '').includes('relancé par le système')`);
  };
  check('rouvert 1 min après un ⌘Q : pas de message', (await essai(60000)) === false);
  check('rechargé 2 s après un plantage : message affiché', (await essai(2000)) === true);
  check('le battement est rafraîchi', await ev(`(async()=>{ const a=+localStorage.getItem('pulse_alive'); await new Promise(r=>setTimeout(r,3500)); return +localStorage.getItem('pulse_alive') > a; })()`) === true);
};
