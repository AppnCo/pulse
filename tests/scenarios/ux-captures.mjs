// UX : captures des écrans clés en tant que débutant (W/H via env)
import { pos, mouse, key } from './qa-lib.mjs';
const W = +(process.env.UXW || 1440), H = +(process.env.UXH || 860), OUT = '/private/tmp/claude-501/ux/' + W + '-';
export default async ({ ev, nav, send, shot, sleep }) => {
  const Mo = mouse(send), K = key(send);
  const S = async (n) => { await sleep(500); await shot(OUT + n + '.jpg'); };
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear()`);
  await nav('http://localhost:8765/index.html'); await sleep(800);
  await S('01-accueil');
  // modèles
  await ev(`document.querySelector('.card-template').click()`); await S('02-modeles');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  // projet vide : Nouveau projet
  await ev(`document.querySelector('.card-new').click()`); await sleep(2500); await S('02b-studio-vide-onboarding');
  await ev(`localStorage.setItem('pulse_onboarded_v1','1'); document.getElementById('onboardOverlay')?.remove()`); await S('02c-studio-vide');
  await ev(`window.__h=document.getElementById('btnAddTrack').click()`); await S('02d-studio-vide-menu-plus'); await ev(`document.querySelectorAll('.track-ctx-menu').forEach(p=>p.remove())`);
  await ev(`localStorage.clear()`);
  await nav('http://localhost:8765/index.html'); await sleep(800);
  // instru déposée (vrai chemin startFromInstru)
  await ev(`(async()=>{ const sr=44100, sec=20, n=sr*sec, buf=new ArrayBuffer(44+n*2), v=new DataView(buf); const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVEfmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true);
    const beat=60/90; for(let i=0;i<n;i++){ const t=(i/sr)%beat; v.setInt16(44+i*2, t<0.05? Math.sin(2*Math.PI*60*t)*(1-t/0.05)*26000 : Math.sin(2*Math.PI*220*i/sr)*3000, true); }
    startFromInstru(new File([buf],'Mon instru trap.wav',{type:'audio/wav'})); })()`);
  await sleep(3500);
  await S('03-studio-apres-depot-onboarding');
  // 3 étapes d'onboarding
  for (let i = 0; i < 3; i++) { await ev(`document.getElementById('onboardNext')?.click()`); await sleep(300); if (i < 2) await S('03b-onboard' + (i + 2)); }
  await S('04-studio-apres-depot');
  // micro simulé
  await ev(`(async()=>{ const ctx=await PulseAudio.init(); const md=ctx.createMediaStreamDestination(); const o=ctx.createOscillator(); o.frequency.value=220; const g=ctx.createGain(); g.gain.value=0.2; o.connect(g); g.connect(md); o.start(); navigator.mediaDevices.getUserMedia=async()=>md.stream; navigator.permissions.query=async()=>({state:'granted'});
    window.__dl=[]; const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ window.__dl.push(this.download); return; } return oc.call(this); }; })()`);
  console.log('pistes', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,t.type,!!t.armed,(t.clips||[]).length]))`));
  await K('r'); await sleep(300); await shot(OUT+'05a-decompte.jpg'); await sleep(1200); await shot(OUT+'05b-decompte.jpg'); await sleep(1300); await shot(OUT+'05c-decompte.jpg');
  await sleep(4500); await S('06-pendant-enregistrement');
  await K('r'); await sleep(1500); await S('07-apres-prise');
  console.log('apres prise', await ev(`JSON.stringify(state.project.tracks.map(t=>[t.name,(t.clips||[]).length]))+' sel='+state.selectedTrack`));

  // pause : la prise devient visible
  await K(' '); await sleep(1200); await S('08-prise-apres-pause');
  // 2e prise : re-enregistrer depuis le début
  await K('Enter'); await sleep(300); await K('r'); await sleep(4200); await K('r'); await sleep(600); await K(' '); await sleep(1200); await S('09-deuxieme-prise');
  console.log('clips voix', await ev(`JSON.stringify(state.project.tracks[0].clips.map(c=>[c.take,+c.start.toFixed(1),+c.duration.toFixed(1)]))+' takes='+JSON.stringify((state.project.tracks[0].takes||[]).length)`));
  // clic droit sur la prise
  const cp = await pos(ev, '.clip');
  await Mo.rclick(cp.x + 50, cp.y + 10); await S('10-menu-clic-droit-prise'); await K('Escape');
  await ev(`document.querySelectorAll('.track-ctx-menu,.ctx-menu').forEach(e=>e.remove())`);
  // inspecteur : menu du son
  const snd = await pos(ev, '.insp-sound'); await Mo.click(snd.x, snd.y); await S('11-menu-son-voix');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await Mo.click(900, 600);
  // clic sur l'effet EQ / compresseur de l'inspecteur
  const fx = await pos(ev, '.insp-fx-row[data-fx]'); if (fx) { await Mo.click(fx.x, fx.y); await S('12-panneau-effet-eq'); await ev(`document.querySelectorAll('.fx-panel').forEach(p=>p.remove())`); }
  // envoi reverb : clic sur le nom
  console.log('inspecteur', (await ev(`document.getElementById('inspector').innerText`)).replace(/\n+/g,' | '));
  await ev(`toggleMixer()`); await S('13-mixeur');
  const tn = await pos(ev, '.strip-fx-slot[data-fx="tune"]'); if (tn) { await Mo.click(tn.x, tn.y); await S('14-autotune'); }
  const sb = await pos(ev, '.strip-sound'); if (sb) { await ev(`document.querySelectorAll('.fx-panel,.tune-panel').forEach(p=>p.remove())`); await Mo.click(sb.x, sb.y); await S('15-panneau-son'); }
  await ev(`document.querySelectorAll('.fx-panel,.tune-panel,.track-ctx-menu').forEach(p=>p.remove()); toggleMixer()`);
  await ev(`openExportModal()`); await S('16-export');
  await ev(`document.querySelectorAll('.modal-backdrop').forEach(p=>p.remove())`);
  await ev(`openSettings()`); await S('17-reglages');
  await ev(`document.querySelectorAll('.modal-backdrop').forEach(p=>p.remove())`);
  await ev(`setLyricsOpen(true)`); await S('18-texte');
  await ev(`setLyricsOpen(false)`);
  await ev(`openCheatSheet()`); await S('19-raccourcis');
  await ev(`document.querySelectorAll('.modal-backdrop,#cheatModal').forEach(p=>p.remove())`);
  await ev(`addTrack(null)`); await S('20-menu-ajout-piste');
  await ev(`document.querySelectorAll('.track-ctx-menu').forEach(p=>p.remove()); addTrack('keys')`); await sleep(800); await S('21-piano');
  await ev(`addTrack('drums')`); await sleep(800); await S('22-batterie');
};
