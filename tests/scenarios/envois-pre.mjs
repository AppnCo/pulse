// Envois avant le fader (Pre) : fader à zéro, l'envoi passe quand même ; clic droit pour choisir Pre / Post
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, check } = c;
  await boot(c, { id: 'p', name: 'P', bpm: 120, sends: [], buses: [{ id: 'g', name: 'Parallèle', output: 'master', volume: 100 }],
    tracks: [{ name: 'A', type: 'audio', color: '#A855F7', clips: [], busSends: { g: 100 } }] });
  const lvl = async (pre) => ev(`(async()=>{
    const ctx=await PulseAudio.init(); const sr=48000; const b=ctx.createBuffer(1,sr*2,sr),d=b.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=0.3*Math.sin(2*Math.PI*300*i/sr); PulseAudio.registerBuffer('pre',b);
    const p={bpm:120,sends:[],buses:[{id:'g',name:'G',output:'master',volume:100}],tracks:[{volume:0,busSends:{g:100},preSends:${pre ? "{'busSend:g':true}" : '{}'},clips:[{id:'pre',start:0,duration:2}]}]};
    const x=(await new OfflineAudioContext(1,1,48000).decodeAudioData(await (await PulseAudio.exportWav(p)).arrayBuffer())).getChannelData(0);
    let s=0; for(let i=sr*0.3;i<sr*1.5;i++)s+=x[i]*x[i]; return Math.sqrt(s/(sr*1.2)); })()`);
  const post = await lvl(false), pre = await lvl(true);
  check('Post : fader à zéro → l’envoi est muet', post < 1e-4, String(post));
  check('Pre : fader à zéro → l’envoi passe en entier (0,3 eff. × sortie 0,8 ≈ 0,17)', Math.abs(pre - 0.17) < 0.01, String(pre));
  // interface : clic droit sur l'envoi → Avant le fader
  await ev(`state.selectedTrack=0; renderInspector()`); await sleep(200);
  await ev(`document.querySelector('#inspector .send-bar-row[data-bsend="g"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:300}))`); await sleep(150);
  await ev(`[...document.querySelectorAll('.track-ctx-menu .ctx-item')].find(e=>/Avant le fader/.test(e.textContent)).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await sleep(200);
  check('clic droit → Avant le fader : enregistré et marqué PRE', await ev(`!!(state.project.tracks[0].preSends||{})['busSend:g'] && !!document.querySelector('#inspector .send-bar-row[data-bsend="g"] .sb-pre')`));
};
