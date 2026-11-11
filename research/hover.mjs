// node research/hover.mjs <x> <y> : move mouse only (opens hover submenus)
const t=(await (await fetch('http://127.0.0.1:9333/json')).json()).find(t=>t.type==='page'&&t.url.includes('figma.com/design'));
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
ws.send(JSON.stringify({id:1,method:'Input.dispatchMouseEvent',params:{type:'mouseMoved',x:+process.argv[2],y:+process.argv[3]}}));
await new Promise(r=>ws.onmessage=r);ws.close();
