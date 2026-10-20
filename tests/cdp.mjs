// Mini driver CDP : node cdp.mjs <scenario.mjs>
const port = parseInt(process.env.PULSE_CDP_PORT || '9333');
const HTTP = process.env.PULSE_HTTP_PORT || '8765';   // un 2e jeu de ports permet de lancer des tests en parallèle
const tabs = await (await fetch(`http://localhost:${port}/json`)).json();
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); export const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
  if (d.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(d.params.type)) logs.push(d.params.type.toUpperCase() + ' ' + d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
};
export const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
export const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result.exceptionDetails) return 'EVAL-ERR ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); (await import('fs')).writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
export const nav = async (url) => { await send('Page.navigate', { url: url.replace('localhost:8765', 'localhost:' + HTTP) }); await sleep(1500); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });
// check(libellé, condition, détail) : un scénario peut vérifier ses résultats ; un échec donne un code de sortie 1
const results = [];
const check = (label, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail !== '' ? ' — ' + detail : '')); return !!ok; };
const sc = await import(process.argv[2]); await sc.default({ send, ev, sleep, shot, nav, logs, check });
console.log('--- console/exceptions:', logs.length ? '\n' + [...new Set(logs)].join('\n') : 'aucune');
const failed = results.filter(r => !r).length;
if (results.length) console.log('--- vérifications : ' + (results.length - failed) + '/' + results.length + (failed ? ' — ' + failed + ' ÉCHEC(S)' : ' OK'));
ws.close(); process.exit(failed ? 1 : 0);
