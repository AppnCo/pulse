import { boot, RAP, J, key, pos, mouse, CMD } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep, send, shot } = c;
  for (const [w, h] of [[1000, 640], [1280, 720], [1440, 860]]) {
    await boot(c, { id: 'pe', name: 'PE', bpm: 120, buses: [], tracks: [{ name: 'Voix', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Voix 2', type: 'audio', color: '#A855F7', clips: [] }, { name: 'Piano', type: 'keys', midiInst: 'piano', color: '#22D3EE', clips: [] }] }, { w, h });
    await ev(`createMidiClip(2,0,true)`); await sleep(700);
    const r = await ev(`JSON.stringify((()=>{const s=PulsePianoRoll._state(); const e=document.querySelector('.midi-editor').getBoundingClientRect(); const tl=document.querySelector('.timeline').getBoundingClientRect(); return {editeur_h:Math.round(e.height), roll_h:s.h, rowH:s.rowH, lignes_visibles:Math.floor((s.h-22-70)/s.rowH), timeline_h:Math.round(tl.height), pistes_visibles:[...document.querySelectorAll('.timeline-track')].filter(t=>{const b=t.getBoundingClientRect(); return b.top>=tl.top-1&&b.bottom<=tl.bottom+1}).length}})())`);
    console.log(w + 'x' + h, r);
    // texte : suppose liste vide, texte coupé ?
  }
};
