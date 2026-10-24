// Reverb : préréglages par type de salle, EQ intégré (poser / tirer / forme / retirer), Brillance et Largeur
import { boot, mouse } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, shot, send } = c;
  await boot(c, { id: 'rf1', name: 'RF', bpm: 120, sends: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const m = mouse(send);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(()=>{ const t=state.project.tracks[0]; t.effects=['reverb']; t.effectParams={reverb:{wet:20,size:2}}; openEffectPanel(0,'reverb',document.body); const p=document.querySelector('.fx-panel.fx-pro'); p.style.left='40px'; p.style.top='20px'; })()`); await sleep(300);
  await R('façade', `const p=document.querySelector('.fx-panel.fx-pro'); return 'EQ='+!!p.querySelector('.rveq-svg')+' boutons='+[...p.querySelectorAll('.fx-label')].map(l=>l.textContent).join(',')+' | familles='+[...p.querySelectorAll('.fx-preset optgroup')].map(g=>g.label+'('+g.children.length+')').join(', ')`);
  // préréglage Cathédrale
  await R('Cathédrale', `const sel=document.querySelector('.fx-preset'); const o=[...sel.options].find(o=>o.textContent==='Cathédrale'); sel.value=o.value; sel.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,300));
    const rp=state.project.tracks[0].effectParams.reverb, p=document.querySelector('.fx-panel.fx-pro'); return JSON.stringify(rp)+' | points affichés='+p.querySelectorAll('.rveq-pt').length+' | queue: '+p.querySelector('.viz-rev text[text-anchor=end]').textContent`);
  // ⌘Z ramène l'ancien réglage
  await R('annuler', `undoAction(); await new Promise(r=>setTimeout(r,200)); return JSON.stringify(state.project.tracks[0].effectParams.reverb)`);
  await ev(`redoAction ? redoAction() : null`); await sleep(200);
  await ev(`(()=>{ document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); openEffectPanel(0,'reverb',document.body); const p=document.querySelector('.fx-panel.fx-pro'); p.style.left='40px'; p.style.top='20px'; })()`); await sleep(300);
  // effacer, puis poser un point au milieu par double-clic, le tirer vers le bas
  await ev(`document.querySelector('.rv-eq-clear').click()`); await sleep(100);
  const box = JSON.parse(await ev(`JSON.stringify(document.querySelector('.rveq-svg').getBoundingClientRect())`));
  const X = (f) => box.x + Math.log(f / 20) / Math.log(1000) * box.width, Ymid = box.y + box.height / 2;
  await m.click(X(1000), Ymid - 10, 1); await m.click(X(1000), Ymid - 10, 2); await sleep(150);
  await R('point posé', `return JSON.stringify(state.project.tracks[0].effectParams.reverb.eq)+' | '+document.querySelector('.rv-eq-read').textContent`);
  await m.drag(X(1000), Ymid - 10, X(3000), Ymid + 25, 8); await sleep(150);
  await R('point tiré', `return JSON.stringify(state.project.tracks[0].effectParams.reverb.eq)+' | '+document.querySelector('.rv-eq-read').textContent`);
  // double-clic tout à gauche = coupe-bas
  await m.click(box.x + 6, Ymid, 1); await m.click(box.x + 6, Ymid, 2); await sleep(150);
  await R('coupe-bas', `return state.project.tracks[0].effectParams.reverb.eq.map(b=>b.type+'@'+b.freq+(b.slope?'/'+b.slope:'')).join(', ')`);
  // clic droit sur le point 1 → Plateau aigu
  const p1 = JSON.parse(await ev(`JSON.stringify(document.querySelector('.rveq-pt[data-i="0"] circle').getBoundingClientRect())`));
  await m.rclick(p1.x + p1.width / 2, p1.y + p1.height / 2); await sleep(150);
  await R('menu forme', `return [...document.querySelectorAll('.track-ctx-menu .ctx-item')].map(e=>e.textContent.trim()).join(' / ')`);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>e.textContent.includes('Plateau aigu')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(150);
  // molette sur le point 1 : sa largeur
  await ev(`(()=>{ const c=document.querySelector('.rveq-pt[data-i="0"] circle'); for(let k=0;k<5;k++) c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100})); })()`); await sleep(100);
  await R('forme + largeur', `const b=state.project.tracks[0].effectParams.reverb.eq[0]; return b.type+' q='+b.q+' | '+document.querySelector('.rv-eq-read').textContent`);
  // Brillance tournée via le curseur caché
  await R('brillance', `const sl=document.querySelector('.fx-slider[data-key="bright"]'); sl.value=20; sl.dispatchEvent(new Event('input',{bubbles:true})); sl.dispatchEvent(new Event('change',{bubbles:true})); return state.project.tracks[0].effectParams.reverb.bright`);
  // le son suit : l'export avec l'EQ diffère de celui sans
  await R('le son change', `const sr=48000, ctx=PulseAudio.getContext(), b=ctx.createBuffer(1,sr,sr); let r=1; for(let i=0;i<4800;i++){ r=(r*16807)%2147483647; b.getChannelData(0)[i]=0.5*(r/1073741823.5-1); } PulseAudio.registerBuffer('clap',b);
    const t=state.project.tracks[0]; t.clips=[{id:'clap',start:0,duration:1}];
    const tail=async()=>{ const w=await PulseAudio.exportTrackWav(state.project,0); const x=await ctx.decodeAudioData(await w.arrayBuffer()), L=x.getChannelData(0); let s=0; for(let i=14400;i<43200;i++) s+=L[i]*L[i]; return Math.sqrt(s/28800); };
    const a=await tail(); const keep=t.effectParams.reverb.eq; t.effectParams.reverb.eq=[]; const z=await tail(); t.effectParams.reverb.eq=keep; return 'queue avec EQ '+a.toFixed(5)+' / sans '+z.toFixed(5)+(Math.abs(a-z)/z>0.05?' PASS':' FAIL')`);
  // double-clic sur un point = le retirer
  const p2 = JSON.parse(await ev(`JSON.stringify(document.querySelector('.rveq-pt[data-i="1"] circle').getBoundingClientRect())`));
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/reverb-face.jpg');
  await m.click(p2.x + p2.width / 2, p2.y + p2.height / 2, 1); await m.click(p2.x + p2.width / 2, p2.y + p2.height / 2, 2); await sleep(150);
  await R('point retiré', `return (state.project.tracks[0].effectParams.reverb.eq||[]).map(b=>b.type).join(',')`);
  // un bus d'envoi venu d'un ancien retour garde sa sortie (-9,54 dB) quand on choisit un préréglage
  await R('sortie gardée', `const t=state.project.tracks[0]; t.effectParams.reverb.out=-9.54; document.querySelectorAll('.fx-panel').forEach(p=>p.remove()); openEffectPanel(0,'reverb',document.body);
    const sel=document.querySelector('.fx-preset'); sel.value=[...sel.options].find(o=>o.textContent==='Salle').value; sel.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,200)); const a=t.effectParams.reverb.out;
    document.querySelector('.fx-panel.fx-pro .fx-reset').click(); return 'préréglage → '+a+' | réinitialiser → '+JSON.stringify(t.effectParams.reverb)`);
};
