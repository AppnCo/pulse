import { boot, instru } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, null);
  await instru(ev, 5, 0, 0); await sleep(300);
  await ev(`(async()=>{ window.__blobs=[]; const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){ fetch(this.href).then(r=>r.blob()).then(b=>window.__blobs.push({n:this.download,b})); return;} return oc.call(this); }; })()`);
  for (const [fmt, br] of [['mp3', 320], ['mp3', 128], ['wav', 0]]) {
    await ev(`window.__blobs.length=0; doExport('${fmt}', ${br}, false)`); await sleep(7000);
    console.log(fmt, br, await ev(`(async()=>{ const x=window.__blobs[0]; if(!x) return 'aucun fichier'; const ab=await x.b.arrayBuffer(); try{ const a=await PulseAudio.getContext().decodeAudioData(ab.slice(0)); let pk=0; const d=a.getChannelData(0); for(let i=0;i<d.length;i++) pk=Math.max(pk,Math.abs(d[i])); return x.n+' '+x.b.size+' o, '+a.duration.toFixed(2)+' s, '+a.sampleRate+' Hz, '+a.numberOfChannels+' ch, crête '+pk.toFixed(3);}catch(e){return x.n+' non décodable '+e.message} })()`));
  }
};
