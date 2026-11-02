// Plugin Saturation : la fenêtre envoie tous les réglages (famille = numéro) et reprend ce que le logiciel lui renvoie
// (automation, préréglage du logiciel) ; Classique / valeurs d'origine = clés absentes.
export default async ({ ev, nav, sleep, check, shot }) => {
  await nav('http://localhost:8765/plugins/ui/dev.html?fx=sat'); await sleep(600);
  const r = JSON.parse(await ev(`(async () => {
    const sent = []; window.sendToPlugin = (m) => sent.push(m);
    document.querySelector('.sat-panel .ms-sty[data-k="ampli"]').click(); await new Promise(r => setTimeout(r, 120));
    const set = sent.filter(m => m.type === 'Set').pop();
    window.onPluginMessage({ type: 'params', values: { drive: 70, sty: 2, input: 6, tone: -40, mix: 80, out: -2, ag: 0 }, bypass: 0 });
    await new Promise(r => setTimeout(r, 300));
    const back = JSON.stringify(state.project.tracks[0].effectParams.sat), on = document.querySelector('.sat-panel .ms-sty.on')?.dataset.k;
    window.onPluginMessage({ type: 'params', values: { drive: 25, sty: 0, input: 0, tone: 0, mix: 100, out: 0, ag: 1 }, bypass: 0 });
    await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ set: set && set.values, back, on, reset: JSON.stringify(state.project.tracks[0].effectParams.sat) });
  })()`));
  console.log(JSON.stringify(r));
  check('famille Ampli envoyée au plugin (n° 3)', r.set && r.set.sty === 3 && r.set.drive === 25 && r.set.ag === 1, JSON.stringify(r.set));
  check('réglages du logiciel repris dans la fenêtre', r.back === JSON.stringify({ drive: 70, sty: 'lampe', input: 6, tone: -40, mix: 80, out: -2, ag: false }) && r.on === 'lampe', r.back + ' ' + r.on);
  check('retour aux valeurs d\'origine = projet léger', r.reset === JSON.stringify({ drive: 25 }), r.reset);
  await shot('/private/tmp/claude-501/qa/plugin-sat.jpg');
};
