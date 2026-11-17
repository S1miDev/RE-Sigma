importScripts('refig.js') // defines the global `refig`

refig.onRun(async () => {
  await refig.showUI({ width: 260, height: 120 })
})

// Messages from ui.html arrive here.
refig.onUIMessage(async (msg) => {
  if (msg.type !== 'make') return
  for (let i = 0; i < msg.count; i++)
    await refig.createNode('RECTANGLE', { name: 'Hello', x: i * 70, y: 0, width: 60, height: 60, fills: [{ r: 0.2, g: 0.5, b: 1 }] })
  await refig.notify(`Made ${msg.count} rectangles`)
  await refig.closePlugin()
})
