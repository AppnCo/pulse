// Shift + glisser : la plage reste sur la piste ; Suppr n'efface que là
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'pl1',name:'Plage',bpm:120,buses:[],tracks:[
    {name:'A',type:'audio',color:'#A855F7',clips:[{id:'a',name:'A',start:0,duration:8,offset:0}]},
    {name:'B',type:'audio',color:'#22D3EE',clips:[{id:'b',name:'B',start:0,duration:8,offset:0}]},
    {name:'C',type:'audio',color:'#34D399',clips:[{id:'c',name:'C',start:0,duration:8,offset:0}]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(600);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  const ME = (t, x, y, extra = '') => `new MouseEvent('${t}',{bubbles:true,clientX:${x},clientY:${y},button:0${extra}})`;
  const drag = (rowFrom, rowTo, label, del = true) => R(label, `
    const px=state.pxPerSecond, tl=document.querySelector('.timeline'), b=tl.getBoundingClientRect();
    const rA=document.querySelector('.timeline-track[data-i="${rowFrom}"]').getBoundingClientRect(), rB=document.querySelector('.timeline-track[data-i="${rowTo}"]').getBoundingClientRect();
    const x1=b.left+2*px-tl.scrollLeft, x2=b.left+4*px-tl.scrollLeft, tgt=document.querySelector('.timeline-track[data-i="${rowFrom}"]');
    tgt.dispatchEvent(${ME('mousedown','x1','rA.top+rA.height/2',',shiftKey:true')});
    document.dispatchEvent(${ME('mousemove','x2','rB.top+rB.height/2',',shiftKey:true')}); document.dispatchEvent(${ME('mouseup','x2','rB.top+rB.height/2')});
    await new Promise(r=>setTimeout(r,60));
    const sel=JSON.stringify(state.selection.tracks); const ov=document.querySelector('.range-selection'); const oh=Math.round(ov.getBoundingClientRect().height);
    ${del ? "deleteSelection(); await new Promise(r=>setTimeout(r,60));" : ""}
    return 'pistes='+sel+' hauteur='+oh+'px | clips: '+state.project.tracks.map(t=>t.clips.length+(t.clips.length?'('+t.clips.map(c=>c.start.toFixed(0)+'-'+(c.start+c.duration).toFixed(0)).join(',')+')':'')).join(' / ')`);
  await drag(1, 1, 'Shift+glisser sur la piste B seule, puis supprimer');
  await ev(`state.project.tracks[1].clips=[{id:'b',name:'B',start:0,duration:8,offset:0}]; clearRangeSelection(); renderTimelineTracks()`); await sleep(100);
  await drag(0, 1, 'Glisser de A vers B : deux pistes, C intacte');
};
