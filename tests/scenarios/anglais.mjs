// 18/10 : traduction anglaise à l'affichage (i18n/en-texts.json) — rien ne change en français, les noms donnés par l'utilisateur ne sont jamais traduits
export default async ({ ev, nav, send, sleep, check, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  const R = (c) => ev(`(async()=>{${c}})()`);
  const project = { id: 'en1', name: 'Mon son', bpm: 120, buses: [], tracks: [{ name: 'Pistes', type: 'audio', color: '#A855F7' }, { name: 'Réglages', type: 'audio', color: '#60A5FA' }] };
  const boot = async (lang) => {
    await nav('http://localhost:8765/index.html');
    await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_lang','${lang}'); localStorage.setItem('pulse_current_project', ${JSON.stringify(JSON.stringify(project))})`);
    await nav('http://localhost:8765/studio.html'); await sleep(1000);
  };
  const flashText = async (msg) => R(`flash(${JSON.stringify(msg)}); await new Promise(r=>setTimeout(r,120)); return document.getElementById('flash').textContent`);

  // ---- anglais ----
  await boot('en');
  check('anglais : le titre des Réglages', (await R(`openSettings(); await new Promise(r=>setTimeout(r,200)); const t=document.querySelector('.settings-modal .modal-title').textContent; document.getElementById('settingsClose').click(); return t`)) === 'Settings');
  check('anglais : un message fixe', (await flashText('Clip copié')) === 'Clip copied');
  check('anglais : un message avec une valeur', (await flashText('Import de mon beat.wav…')) === 'Importing mon beat.wav…');
  check('anglais : une infobulle', (await R(`return document.getElementById('btnAddTrack').getAttribute('data-tooltip')`)) === 'Add a track');
  const names = await R(`return [...document.querySelectorAll('.track-name')].map(e=>e.textContent.trim()).join('|')`);
  check('anglais : les noms de pistes donnés par l\'utilisateur restent tels quels', names === 'Pistes|Réglages', names);
  check('anglais : le nom du projet reste tel quel', (await R(`return document.getElementById('projectName').textContent.trim()`)) === 'Mon son');
  check('anglais : le choix de langue est dans les Réglages', (await R(`openSettings(); await new Promise(r=>setTimeout(r,200)); const b=[...document.querySelectorAll('.set-lang-btn')].map(x=>x.textContent+(x.classList.contains('on')?'*':'')).join(' '); document.getElementById('settingsClose').click(); return b`)) === 'Français English (beta)*');
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/anglais.jpg');

  // ---- français (par défaut) : aucune traduction ----
  await boot('fr');
  check('français : le message reste en français', (await flashText('Clip copié')) === 'Clip copié');
  check('français : les Réglages restent « Réglages »', (await R(`openSettings(); await new Promise(r=>setTimeout(r,200)); const t=document.querySelector('.settings-modal .modal-title').textContent; document.getElementById('settingsClose').click(); return t`)) === 'Réglages');
  check('français : pas de traduction active', (await R(`return PulseI18n.tx('Clip copié')`)) === 'Clip copié');
};
