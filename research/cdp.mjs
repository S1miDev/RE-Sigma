// Minimal CDP probe for the research Chrome (port 9333).
// Usage: node research/cdp.mjs eval "<js>" | shot out.png | click x y | key Escape | cdp Method '{json}'
// Picks the open editor tab; set TAB=<url substring> to target another tab.
const [mode, arg] = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = (process.env.TAB && targets.find(t => t.type === 'page' && t.url.includes(process.env.TAB))) ?? targets.find(t => t.type === 'page' && /figma\.com\/(design|file|board)\//.test(t.url))
  ?? targets.find(t => t.type === 'page' && t.url.includes('figma.com'));
if (!page) throw new Error('No figma.com tab open in the research Chrome');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let id = 0;
const call = (method, params = {}) => new Promise((ok, fail) => {
  const my = ++id;
  ws.addEventListener('message', function h(e) {
    const m = JSON.parse(e.data);
    if (m.id !== my) return;
    ws.removeEventListener('message', h);
    m.error ? fail(new Error(m.error.message)) : ok(m.result);
  });
  ws.send(JSON.stringify({ id: my, method, params }));
});

if (mode === 'click') { // node research/cdp.mjs click <x> <y>  (CSS px), or key Escape
  const [x, y] = [Number(arg), Number(process.argv[4])];
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  console.log('clicked', x, y);
} else if (mode === 'cdp') { // node research/cdp.mjs cdp <Method> '<json params>'
  console.log(JSON.stringify(await call(arg, JSON.parse(process.argv[4] ?? '{}'))));
} else if (mode === 'key') {
  for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: arg, code: arg, windowsVirtualKeyCode: arg === 'Escape' ? 27 : 0 });
} else if (mode === 'shot') {
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
  console.log('saved', arg, page.url);
} else {
  const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
}
ws.close();
