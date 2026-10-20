import { boot, instru, RAP } from './qa-lib.mjs';
export default async (c) => {
  const { ev, sleep } = c;
  await boot(c, RAP);
  await instru(ev, 6, 0, 0); await ev(`toggleMixer()`); await sleep(600);
  const res = await ev(`JSON.stringify((()=>{
    const parse=(s)=>{const m=s.match(/rgba?\\(([^)]+)\\)/); if(!m) return null; const p=m[1].split(',').map(x=>parseFloat(x)); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
    const lum=(c)=>{const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
    const bgOf=(el)=>{ let layers=[]; let e=el; while(e){ const c=parse(getComputedStyle(e).backgroundColor); if(c&&c.a>0){ layers.push(c); if(c.a>=0.99) break;} e=e.parentElement; } let base={r:14,g:10,b:20}; for(let i=layers.length-1;i>=0;i--){ const l=layers[i]; base={r:base.r*(1-l.a)+l.r*l.a,g:base.g*(1-l.a)+l.g*l.a,b:base.b*(1-l.a)+l.b*l.a}; } return base; };
    const out=[]; const seen=new Set();
    const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while(n=walker.nextNode()){ const t=n.textContent.trim(); if(!t||t.length<2) continue; const el=n.parentElement; if(!el) continue; const r=el.getBoundingClientRect(); if(r.width<2||r.height<2||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth) continue; const cs=getComputedStyle(el); if(cs.visibility==='hidden'||parseFloat(cs.opacity)===0) continue; if(['SCRIPT','STYLE'].includes(el.tagName)) continue;
      const fg=parse(cs.color); if(!fg) continue; const bg=bgOf(el); const op=parseFloat(cs.opacity); const a=fg.a*op; const f={r:bg.r*(1-a)+fg.r*a,g:bg.g*(1-a)+fg.g*a,b:bg.b*(1-a)+fg.b*a};
      const L1=lum(f), L2=lum(bg); const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); const size=parseFloat(cs.fontSize);
      if(ratio<3.2){ const k=t.slice(0,24)+'|'+(el.className||'').toString().slice(0,24); if(seen.has(k)) continue; seen.add(k); out.push({t:t.slice(0,28),ratio:+ratio.toFixed(2),size,cls:(el.className||'').toString().slice(0,30)}); } }
    return out.sort((a,b)=>a.ratio-b.ratio).slice(0,60); })())`);
  for (const r of JSON.parse(res)) console.log(r.ratio, r.size + 'px', JSON.stringify(r.t), r.cls);
};
