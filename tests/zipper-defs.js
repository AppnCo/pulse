const fs=require('fs');const src=fs.readFileSync(process.argv[2],'utf8');
const i=src.indexOf('const FX_PANEL_DEFS = {');let d=0,j=src.indexOf('{',i);const st=j;
for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(!d)break;}}
const P=new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>0:P,apply:()=>P});
const scope=new Proxy({},{has:(t,k)=>typeof k==='string'&&!(k in globalThis),get:(t,k)=>k===Symbol.unscopables?undefined:P});
const obj=new Function('scope','with(scope){return '+src.slice(st,j+1)+'}')(scope);
const out={};for(const[k,v]of Object.entries(obj))if(Array.isArray(v))out[k]=v.map(x=>({key:x.key,min:x.min,max:x.max,def:x.def,log:!!x.log,choices:!!x.choices,toggle:!!x.toggle}));
fs.writeFileSync(process.argv[3],JSON.stringify(out));
for(const k in out)console.log(k, out[k].map(x=>x.key+(x.choices?'*':'')+(x.toggle?'!':'')).join(','));
