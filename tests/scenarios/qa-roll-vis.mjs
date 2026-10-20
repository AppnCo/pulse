import { boot, instru, mouse, pos } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  for (const [w, h] of [[1440, 860], [1000, 700]]) {
    await boot(c, { id: 'r', name: 'R', bpm: 120, buses: [], tracks: [{ name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }, { name: 'Batterie', type: 'drums', midiInst: 'drums', color: '#F59E0B', clips: [] }, { name: 'V', type: 'audio', color: '#A855F7', clips: [] }] }, { w, h });
    await ev(`createMidiClip(0, 0)`); await sleep(1200);
    await ev(`(()=>{ const S=PulsePianoRoll._state(); S.notes.push({s:0,d:1,p:60,v:100},{s:1,d:2,p:64,v:90},{s:2,d:1,p:67,v:80}); S.dirty=true; PulsePianoRoll.flush(); })()`); await sleep(1000);
    await shot(`/private/tmp/claude-501/qa/roll-${w}.jpg`);
    // toolbar overflow
    console.log(w, 'barre outils', await ev(`JSON.stringify((()=>{ const el=document.querySelector('.midi-editor, #midiEditor, .pianoroll'); if(!el) return 'no el'; const r=el.getBoundingClientRect(); const over=[...el.querySelectorAll('button,select,label,input')].filter(b=>{const q=b.getBoundingClientRect(); return q.width>0 && (q.right>r.right+1||q.left<r.left-1)}).map(b=>b.textContent.trim().slice(0,20)||b.className); return {cls:el.className, l:r.left,r:r.right,t:r.top,h:r.height, scrollW:el.scrollWidth, clientW:el.clientWidth, over}})())`));
    await ev(`PulsePianoRoll.close(true); createMidiClip(1, 0)`); await sleep(1200);
    await shot(`/private/tmp/claude-501/qa/steps-${w}.jpg`);
  }
};
