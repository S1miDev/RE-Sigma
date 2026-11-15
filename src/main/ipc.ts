// One ipcMain.handle per RefigApi method. Every argument is validated before use; the renderer is not trusted.
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { API_KEYS, type ExportKind, type RefigApi } from '../shared/api'
import { imageType } from '../shared/image'
import { svgToPdf } from './export'
import { UUID } from './format/refig'
import { listPlugins, readCode } from './plugins'
import { sanitizeName, type ProjectStore } from './projects'

const MB = 1024 ** 2
const bad = (what: string): never => {
  throw new TypeError(`Invalid argument: ${what}`)
}
const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : bad('id'))
const text = (v: unknown, max: number, what: string) => (typeof v === 'string' && v.length <= max ? v : bad(what))
const bytes = (v: unknown, max: number, what: string) => (v instanceof Uint8Array && v.byteLength <= max ? v : bad(what))
const isPng = (b: Uint8Array) => imageType(b) === 'image/png'
const KINDS = ['png', 'jpg', 'webp', 'svg', 'pdf'] as const
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const
const kindOf = (k: unknown) => (KINDS as readonly unknown[]).includes(k) ? (k as ExportKind) : bad('kind')
/** Validated file contents for `kind`: raster bytes must have the right header, a PDF is printed from the SVG. */
async function encode(kind: ExportKind, b: unknown): Promise<Uint8Array> {
  const data = bytes(b, 256 * MB, 'bytes')
  if (kind !== 'svg' && kind !== 'pdf' && imageType(data) !== MIME[kind]) bad('bytes')
  return kind === 'pdf' ? await svgToPdf(Buffer.from(data).toString('utf8')) : data
}
const safeName = (v: unknown) => {
  try {
    return sanitizeName(text(v, 200, 'name'))
  } catch {
    return 'export'
  }
}

type Handlers = { [K in keyof RefigApi]: (...args: unknown[]) => ReturnType<RefigApi[K]> | Awaited<ReturnType<RefigApi[K]>> }

export function registerIpc(store: ProjectStore, getWindow: () => BrowserWindow | null, pluginsDir: string) {
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
      const kind = kindOf(k), data = await encode(kind, b)
      const r = await dialog.showSaveDialog(win(), {
        title: 'Export',
        defaultPath: `${safeName(name)}.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      })
      if (r.canceled || !r.filePath) return null
      fs.writeFileSync(r.filePath, data)
      return { path: r.filePath }
    },
    async exportFiles(files) {
      if (!Array.isArray(files) || !files.length || files.length > 200) bad('files')
      const list = await Promise.all((files as { name: unknown; kind: unknown; bytes: unknown }[]).map(async (f) => {
        const kind = kindOf(f?.kind)
        return { base: safeName(f.name), kind, data: await encode(kind, f.bytes) }
      }))
      const r = await dialog.showOpenDialog(win(), { title: 'Export to folder', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      const taken = new Set<string>()
      return list.map(({ base, kind, data }) => {
        let name = `${base}.${kind}`
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i}).${kind}`
        taken.add(name.toLowerCase())
        const file = path.join(r.filePaths[0], name)
        fs.writeFileSync(file, data)
        return file
      })
    },
    openExternal: (url) => shell.openExternal(/^https?:\/\//.test(text(url, 2048, 'url')) ? (url as string) : bad('url')),
    listPlugins: () => listPlugins(pluginsDir),
    readPluginCode: (i) => readCode(pluginsDir, text(i, 64, 'id')),
    async openPluginsFolder() {
      fs.mkdirSync(pluginsDir, { recursive: true })
      await shell.openPath(pluginsDir) // fixed path, nothing from the renderer
    },
  }

  for (const k of API_KEYS)
    ipcMain.handle(`refig:${k}`, (e, ...args) => {
      if (e.sender !== getWindow()?.webContents) throw new Error('Forbidden')
      return handlers[k](...args)
    })
}
