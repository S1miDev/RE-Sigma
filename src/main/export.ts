import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Prints an SVG document (produced by our own serializer) as a one-page PDF of the same size, in a hidden script-less window. */
export async function svgToPdf(svg: string): Promise<Buffer> {
  const m = /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg)
  if (!m) throw new Error('Invalid SVG')
  const page = path.join(app.getPath('temp'), `refig-print-${randomUUID()}.html`)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    // The SVG comes from the renderer, which isn't trusted: the page may load nothing but its inline style and data: images.
    const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'`
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>@page{margin:0;size:${m[1]}px ${m[2]}px}body{margin:0}svg{display:block}</style>${svg}`)
    await win.loadFile(page)
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  } finally {
    win.destroy()
    fs.rmSync(page, { force: true })
  }
}
