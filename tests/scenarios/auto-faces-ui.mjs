// Mode A : toucher n'importe quel bouton des nouvelles façades affiche sa courbe sur la piste (comme Logic)
import { boot } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, { id: 'au1', name: 'AU', bpm: 120, sends: [], tracks: [{ name: 'V', type: 'audio', color: '#A855F7', volume: 100, clips: [] }] }, { mic: false });
  const out = await ev(`(async()=>{ const t=state.project.tracks[0]; state.automationMode=true; const res=[];
    const faces={ gate:{}, deess:{thr:-26,range:10}, limit:{}, mband:{bands:[{lo:20,hi:300,thr:-30,range:-6}]}, msat:{bands:[{base:true,sty:'bande',va:1,heat:30}]} };
    for (const [fx,p] of Object.entries(faces)) {
      t.effects=[fx]; t.effectParams={[fx]:p}; document.querySelectorAll('.fx-panel').forEach(x=>x.remove());
      openEffectPanel(0,fx,document.body); await new Promise(r=>setTimeout(r,250));
      // Anticipation du limiteur : change le retard du son, pas automatisable (comme dans Logic)
      const pks=[...document.querySelectorAll('.fx-panel .pk')].filter(e=>e.querySelector('.pk-l')?.textContent!=='Anticipation');
      const ok=[], miss=[];
      for (const el of pks) {
        const lab=el.querySelector('.pk-l')?.textContent; t.autoParam='volume';
        el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:5,clientY:5})); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
        (t.autoParam!=='volume' ? ok : miss).push(lab+(t.autoParam!=='volume'?'→'+t.autoParam:''));
      }
      res.push(fx+' : '+pks.length+' boutons, courbe affichée '+ok.length+(miss.length?' | SANS COURBE: '+miss.join(', '):'')+' | '+ok.join(' '));
    }
    await new Promise(r=>setTimeout(r,100));
    return res.join('\\n'); })()`);
  console.log(out);
  console.log(out.includes('SANS COURBE') ? 'FAIL' : 'PASS tous les boutons');
};
