// EQ automatisé : retirer un point recale les courbes des points suivants (fx:eq:bN-…), ↶ de l'EQ et ⌘Z les rendent ;
// en mode A, toucher l'EQ intégré d'une Reverb n'écrit pas de courbe sur l'EQ de la piste
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1')`);
  await nav('http://localhost:8765/studio.html'); await sleep(800);
  const ok = (label, cond, info) => { console.log(label + ':', info, cond ? 'PASS' : 'FAIL'); if (!cond) throw new Error('FAIL ' + label); };
  const keys = `JSON.stringify(Object.keys(state.project.tracks[0].automation||{}).filter(k=>k.startsWith('fx:eq:')).sort().map(k=>k+'='+state.project.tracks[0].automation[k].points[0].v))`;
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effects=[...new Set([...(t.effects||[]),'eq'])]; t.effectParams=t.effectParams||{};
    t.effectParams.eq={bands:[{type:'hpf',freq:80,gain:0,q:1},{type:'bell',freq:300,gain:-2,q:1},{type:'bell',freq:4000,gain:2,q:0.7},{type:'highshelf',freq:10000,gain:1,q:0.7}]};
    const c=(v)=>({points:[{t:0,v},{t:4,v}]}); t.automation={'fx:eq:b1-gain':c(1),'fx:eq:b2-freq':c(2),'fx:eq:b3-gain':c(3),volume:c(0.5)}; t.autoParam='fx:eq:b1-gain'; })()`);
  await ev(`openEqPanel(0, document.body)`); await sleep(300);
  const k0 = await ev(keys);
  // choisir le point n° 1 (le creux à 300 Hz) puis Suppr
  const pt = JSON.parse(await ev(`JSON.stringify((()=>{const p=document.querySelectorAll('.eq-pt')[1].getBoundingClientRect(); return {x:p.left+p.width/2,y:p.top+p.height/2}})())`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}))`); await sleep(200);
  const n = await ev(`eqBandsOf(state.project.tracks[0].effectParams.eq).length`);
  const k1 = await ev(keys);
  ok('point retiré', n === 3, n + ' points');
  ok('courbes recalées', k1 === JSON.stringify(['fx:eq:b1-freq=2', 'fx:eq:b2-gain=3']), k1);
  ok('volume intact', await ev(`!!state.project.tracks[0].automation.volume`), '');
  ok('courbe affichée revenue au volume', await ev(`state.project.tracks[0].autoParam`) === 'volume', await ev(`state.project.tracks[0].autoParam`));
  await ev(`document.querySelector('.eq-panel .eq-undo').click()`); await sleep(150);
  ok('↶ de l EQ rend les courbes', await ev(keys) === k0, await ev(keys));
  await ev(`document.querySelector('.eq-panel .eq-redo').click()`); await sleep(150);
  ok('↷ les recale', await ev(keys) === k1, await ev(keys));
  await ev(`undoAction()`); await sleep(200);
  ok('⌘Z rend les courbes', await ev(keys) === k0, await ev(keys));
  // EQ intégré d'une Reverb, mode A : pas de courbe fx:eq sur la piste
  await ev(`closeTransientPanels && closeTransientPanels(); document.querySelectorAll('.eq-panel').forEach(p=>p.remove())`);
  await ev(`(()=>{ const t=state.project.tracks[0]; t.automation={}; t.effects=[...new Set([...(t.effects||[]),'reverb'])]; t.effectParams.reverb={...(t.effectParams.reverb||{}), eq:[{type:'bell',freq:1000,gain:0,q:1}]}; state.automationMode=true;
    openEffectPanel(0, 'reverb', document.body); const p=[...document.querySelectorAll('.fx-panel')].pop(); p.style.left='40px'; p.style.top='40px'; })()`); await sleep(400);
  const has = await ev(`!!document.querySelector('.eq-embed .eq-pt')`);
  ok('EQ intégré ouvert', has, '');
  if (has) {
    const p2 = JSON.parse(await ev(`JSON.stringify((()=>{const p=document.querySelector('.eq-embed .eq-pt').getBoundingClientRect(); return {x:p.left+p.width/2,y:p.top+p.height/2}})())`));
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p2.x, y: p2.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p2.x, y: p2.y - 30, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p2.x, y: p2.y - 30, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
    const g = await ev(`state.project.tracks[0].effectParams.reverb.eq[0].gain`);
    ok('point de la reverb monté', g > 0.5, g);
    const ka = await ev(`JSON.stringify(Object.keys(state.project.tracks[0].automation||{}))`);
    ok('aucune courbe fx:eq écrite', !/fx:eq:/.test(ka), ka);
  }
  await ev(`state.automationMode=false`);
};
