// 18/10 : le curseur « étirer la région » (bord, 7 px) et le curseur « fondu » (coin haut) sont différents, et le bord n'est plus recouvert par la zone de fondu
export default async ({ ev, nav, send }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'cu',name:'Cu',bpm:120,buses:[],tracks:[{name:'A',type:'audio',color:'#A855F7'}]}))`);
  await nav('http://localhost:8765/studio.html');
  const r = await ev(`(async()=>{const ctx=await PulseAudio.init(); const b=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate); PulseAudio.registerBuffer('cu',b); state.project.tracks[0].clips=[{id:'cu',start:1,duration:3,name:'A'}]; renderTimelineTracks(); await new Promise(r=>setTimeout(r,300));
    const c=document.querySelector('.clip'); const rc=c.getBoundingClientRect();
    const at=(dx,dy)=>{const el=document.elementFromPoint(rc.left+dx, rc.top+dy); return getComputedStyle(el).cursor.slice(0,40)+' <'+(el.className||'').toString().split(' ')[0]+'>'};
    return JSON.stringify({bordHaut:at(3,8), bordMilieu:at(3,rc.height*0.7), coinFondu:at(20,8), centre:at(rc.width/2,rc.height/2)})})()`);
  console.log(r);
};
