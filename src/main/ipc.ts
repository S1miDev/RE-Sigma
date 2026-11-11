// One ipcMain.handle per RefigApi method. Every argument is validated before use; the renderer is not trusted.
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import { API_KEYS, type RefigApi } from '../shared/api'
import { svgToPdf } from './export'
import { UUID } from './format/refig'
import { sanitizeName, type ProjectStore } from './projects'

const MB = 1024 ** 2
const bad = (what: string): never => {
  throw new TypeError(`Invalid argument: ${what}`)
}
const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : bad('id'))
const text = (v: unknown, max: number, what: string) => (typeof v === 'string' && v.length <= max ? v : bad(what))
const bytes = (v: unknown, max: number, what: string) => (v instanceof Uint8Array && v.byteLength <= max ? v : bad(what))
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

type Handlers = { [K in keyof RefigApi]: (...args: unknown[]) => ReturnType<RefigApi[K]> | Awaited<ReturnType<RefigApi[K]>> }

export function registerIpc(store: ProjectStore, getWindow: () => BrowserWindow | null) {
  const win = () => getWindow() ?? bad('window')
  const handlers: Handlers = {
    listProjects: () => store.list(),
    createProject: (name) => store.create(text(name, 200, 'name')),
    openProject: (i) => store.open(id(i)),
    saveProject: (i, doc, thumb) => {
      const png = thumb === undefined ? undefined : bytes(thumb, 5 * MB, 'thumbnail')
      if (png && !isPng(png)) bad('thumbnail')
      return store.save(id(i), doc, png) // store.save validates the document shape
    },
    addImage: (i, b) => store.addImage(id(i), bytes(b, 50 * MB, 'image')),
    renameProject: (i, name) => store.rename(id(i), text(name, 200, 'name')),
    deleteProject: (i) => store.remove(id(i)),
    duplicateProject: (i) => store.duplicate(id(i)),
    async importProjects() {
      const r = await dialog.showOpenDialog(win(), {
        title: 'Import projects',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Refig and Figma files', extensions: ['refig', 'fig'] }],
      })
      return r.canceled ? [] : r.filePaths.map((p) => store.importFile(p))
    },
    resolveImportConflict: (token, choice) =>
      store.resolveConflict(id(token), choice === 'replace' || choice === 'keepBoth' || choice === 'cancel' ? choice : bad('choice')),
    async exportProject(i) {
      const pid = id(i)
      const r = await dialog.showSaveDialog(win(), {
        title: 'Export project',
        defaultPath: `${store.nameOf(pid)}.refig`,
        filters: [{ name: 'Refig project', extensions: ['refig'] }],
      })
      if (r.canceled || !r.filePath) return null
      store.exportTo(pid, r.filePath)
      return { path: r.filePath }
    },
    async exportImage(b, name, k) {
      const kind = k === 'png' || k === 'svg' || k === 'pdf' ? k : bad('kind')
      const data = bytes(b, 256 * MB, 'bytes')
      if (kind === 'png' && !isPng(data)) bad('bytes')
      let base = 'export'
      try {
        base = sanitizeName(text(name, 200, 'name'))
      } catch {
        // keep the fallback name
      }
      const r = await dialog.showSaveDialog(win(), {
        title: 'Export',
        defaultPath: `${base}.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      })
      if (r.canceled || !r.filePath) return null
      fs.writeFileSync(r.filePath, kind === 'pdf' ? await svgToPdf(Buffer.from(data).toString('utf8')) : data)
      return { path: r.filePath }
    },
  }

  for (const k of API_KEYS)
    ipcMain.handle(`refig:${k}`, (e, ...args) => {
      if (e.sender !== getWindow()?.webContents) throw new Error('Forbidden')
      return handlers[k](...args)
    })
}
