// Accords de la gamme : sept pavés, un clic = l'accord posé à la suite
export default async ({ ev, nav, send, sleep, shot }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/index.html');
  await ev(`localStorage.clear(); localStorage.setItem('pulse_onboarded_v1','1'); localStorage.setItem('pulse_tip_headphones','1'); localStorage.setItem('pulse_current_project', JSON.stringify({id:'ac1',name:'Accords',bpm:90,buses:[],tracks:[{name:'Piano',type:'keys',midiInst:'piano',color:'#A855F7',volume:80,clips:[]}]}))`);
  await nav('http://localhost:8765/studio.html');
  await sleep(700);
  const R = async (label, code) => console.log(label + ':', await ev(`(async()=>{${code}})()`));
  await ev(`(()=>{ const tr=document.querySelector('.timeline-track[data-i="0"]'); const r=tr.getBoundingClientRect(); tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+30,clientY:r.top+20})); })()`); await sleep(600);
  await R('sans gamme : message d aide', `return 'pavés='+document.querySelectorAll('.me-pad').length+' | '+document.querySelector('.me-pads-row').textContent.trim().slice(0,60)`);
  await R('choisir Do majeur : 7 accords', `const sc=document.querySelector('.me-scale'); sc.value='t:0:0'; sc.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,100));
    return [...document.querySelectorAll('.me-pad')].map(b=>b.querySelector('b').textContent+'('+b.querySelector('em').textContent+')').join(' ')`);
  await R('I puis V puis vi', `const pads=[...document.querySelectorAll('.me-pad')]; pads[0].click(); pads[4].click(); pads[5].click(); await new Promise(r=>setTimeout(r,100));
    const S=PulsePianoRoll._state(); const by={}; S.notes.forEach(n=>{ (by[n.s]=by[n.s]||[]).push(n.p); });
    return Object.keys(by).map(s=>'t'+s+': '+by[s].sort((a,b)=>a-b).join(',')).join(' | ')+' | mesures='+S.midi.beats/4+' (Do 60,64,67 | Sol 55,59,62 | La m 57,60,64)'`);
  await R('Maj + clic = avec la 7e', `const pads=[...document.querySelectorAll('.me-pad')]; pads[3].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true})); await new Promise(r=>setTimeout(r,100));
    const S=PulsePianoRoll._state(); const last=S.notes.filter(n=>n.s===12).map(n=>n.p).sort((a,b)=>a-b); return 'Fa maj7 à t12: '+last.join(',')+' (53,57,60,64)'`);
  await R('durée 2 temps puis le motif s agrandit si besoin', `document.querySelector('.me-pad-len').value='2'; document.querySelectorAll('.me-pad')[1].click(); await new Promise(r=>setTimeout(r,100)); const S=PulsePianoRoll._state(); const n=S.notes[S.notes.length-1]; return 'dernier accord à t='+n.s+' durée='+n.d.toFixed(2)+' ; mesures='+S.midi.beats/4`);
  if (process.env.SHOTS) await shot(process.env.SHOTS + '/accords.jpg');
  await R('annuler d un coup', `const S=PulsePianoRoll._state(); const n0=S.notes.length; document.querySelector('.midi-editor').dispatchEvent(new MouseEvent('mouseenter')); document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,100)); return n0+' → '+S.notes.length+' notes'`);
};
