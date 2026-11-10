import { boot, J } from '/Volumes/KINGSTON/CLAUDE/PULSE/tests/scenarios/qa-lib.mjs';
export default async (c) => {
  const { ev, send, sleep } = c;
  const buses = Array.from({ length: 6 }, (_, g) => ({ id: 'g' + g, name: 'Groupe ' + g, isGroup: true, output: 'master', color: '#A855F7', volume: 100 }));
  const tracks = Array.from({ length: 48 }, (_, i) => ({ name: 'P' + (i + 1), type: 'audio', color: '#3B82F6', output: 'g' + (i % 6), effects: ['eq', 'comp'], clips: Array.from({ length: 4 }, (_, k) => ({ id: 'c' + i + '_' + k, name: 'r', start: k * 20, duration: 15, offset: 0, peaks: Array.from({ length: 200 }, () => Math.random()) })) }));
  await boot(c, { id: 'bl', name: 'BL', bpm: 120, sends: [], buses, tracks }, { mic: false });
  await sleep(1000);
  if (process.env.INJ) await ev(`document.body.style.animation='none'; hideRecLevelHint = () => {}`); if (process.env.INJ > 1) console.log(await ev((await import('fs')).readFileSync('/private/tmp/claude-501/-Users-redrecords/68dcd37a-8ddc-4ad7-bf1c-9da58f211203/scratchpad/inj2.js','utf8'))); await send('Performance.enable'); await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 });
  const phase = async (name, ms = 4000) => {
    await ev(`window.__fr=[]; window.__lt=0; (function f(t){ if(!window.__fr) return; window.__fr.push(t); requestAnimationFrame(f); })(performance.now())`);
    const m0 = Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value])); await send('Profiler.start'); await sleep(ms);
    const p = (await send('Profiler.stop')).result.profile;
    const fr = await J(ev, `const a=window.__fr; window.__fr=null; const d=[]; for(let i=1;i<a.length;i++) d.push(a[i]-a[i-1]); d.sort((x,y)=>x-y); return { n:d.length, p50:d[d.length>>1], p95:d[Math.floor(d.length*.95)], max:d[d.length-1], lent:d.filter(x=>x>20).length }`);
    const self = new Map(); const dt = p.timeDeltas; const byId = new Map(p.nodes.map(n => [n.id, n])); let tot = 0;
    p.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ':' + (n.callFrame.url.split('/').pop() || '') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); tot += dt[i] || 0; });
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => (v / 1000).toFixed(0) + 'ms ' + k);
    const m1 = Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value])); const d = (k) => Math.round((m1[k] - m0[k]) * 1000); console.log('   metrics ms: layout', d('LayoutDuration'), 'style', d('RecalcStyleDuration'), 'script', d('ScriptDuration'), 'task', d('TaskDuration'), 'layouts', m1.LayoutCount - m0.LayoutCount, 'styles', m1.RecalcStyleCount - m0.RecalcStyleCount);
    console.log('## ' + name, JSON.stringify(fr), '\n  ' + top.join('\n  '));
  };
  const tabs = await (await fetch('http://localhost:' + process.env.PULSE_CDP_PORT + '/json')).json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let evs = [], done = null; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Tracing.dataCollected') evs.push(...d.params.value); if (d.method === 'Tracing.tracingComplete') done && done(); };
  const trace = async (name, ms = 3000) => { evs = []; ws.send(JSON.stringify({ id: 1, method: 'Tracing.start', params: { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,gpu,viz,blink', transferMode: 'ReportEvents' } })); await sleep(ms);
    const p = new Promise(r => done = r); ws.send(JSON.stringify({ id: 2, method: 'Tracing.end' })); await p;
    const tot = new Map(); for (const e of evs) if (e.ph === 'X' && e.dur) { const k = e.name; const o = tot.get(k) || [0, 0]; o[0] += e.dur; o[1]++; tot.set(k, o); }
    console.log('## trace ' + name + '\n  ' + [...tot.entries()].sort((a, b) => b[1][0] - a[1][0]).filter(([k]) => /RunTask|Layerize|FunctionCall|DrawAndSwap|^Paint$|Layout|UpdateLayoutTree|PrePaint/.test(k)).map(([k, v]) => (v[0] / 1000).toFixed(0) + 'ms x' + v[1] + ' ' + k).join('\n  '));
    const paints = evs.filter(e => e.name === 'Paint' && e.args?.data?.clip).map(e => { const c = e.args.data.clip; return Math.round(c[2] - c[0]) + 'x' + Math.round(c[5] - c[1]) + '@' + Math.round(c[0]) + ',' + Math.round(c[1]); }); const pc = new Map(); paints.forEach(k => pc.set(k, (pc.get(k) || 0) + 1));
    console.log('  paints: ' + [...pc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' x' + v).join(' | ')); };
  if (process.env.VAR) console.log('VAR', await ev(process.env.VAR));
  if (process.env.TRACE) { await ev(`togglePlay()`); await sleep(600); await trace('lecture'); await ev(`toggleMixer()`); await sleep(600); await trace('lecture + table'); return; }
  await phase('repos');
  await ev(`togglePlay()`); await sleep(600);
  await phase('lecture');
  await ev(`toggleMixer()`); await sleep(600);
  await phase('lecture + table');
  await ev(`togglePlay()`); await sleep(300);
  await phase('table au repos');
};
