// Project store over a workspace folder: one .refig file per project. No Electron imports, so it runs under Vitest.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { ConflictChoice, ImportResult, Omitted, OpenedProject, ProjectContent, ProjectSummary, VersionInfo } from '../shared/api'
import { emptyDocument, FORMAT_VERSION, type Document } from '../shared/document'
import { imageType } from '../shared/image'
import { importFig } from './format/fig'
import { FormatError, readRefig, readRefigMeta, validateDocument, writeRefig, type HistoryEntry, type Meta, type RefigFile } from './format/refig'

const EXT = '.refig'
const MAX_IMPORT = 500 * 1024 ** 2
const AUTO_EVERY_MS = 10 * 60_000
const MAX_AUTO = 20
const MAX_NAMED = 50
const stem = (file: string) => path.basename(file).slice(0, -EXT.length)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Trimmed, 1–100 chars, safe as a Windows file name. */
export function sanitizeName(raw: string): string {
  const name = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '')
  if (!name || name.length > 100) throw new Error('Name must be 1–100 characters')
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `_${name}` : name
}

/** A crash leaves either the old file or the new one, never half of one. */
export function writeAtomic(file: string, bytes: Uint8Array) {
  const tmp = `${file}.tmp`
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** A UUID (v4 layout) derived from a file name, for a file whose stored id duplicates another's. */
function idFromName(file: string) {
  const h = createHash('sha256').update(file.toLowerCase()).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

interface Entry { path: string; meta: Meta; thumbnail?: Uint8Array; reid?: boolean }
export type ProjectStore = ReturnType<typeof createProjectStore>

export function createProjectStore(dir: string, deps: { trash(file: string): Promise<void>; appVersion: string; now?: () => number }) {
  let index = new Map<string, Entry>()
  // images and versions of the open project; `since` starts the first autosave's 10 minutes
  let session: { id: string; images: Record<string, Uint8Array>; history: HistoryEntry[]; since: number } | null = null
  const now = () => deps.now?.() ?? Date.now()
  const pending = new Map<string, { file: string; name: string; data: RefigFile; omitted?: Omitted }>()

  const fileFor = (name: string) => path.join(dir, name + EXT)
  const exists = (name: string) => fs.existsSync(fileFor(name))
  const summary = (e: Entry): ProjectSummary => ({
    id: e.meta.id,
    name: stem(e.path),
    modifiedAt: e.meta.modifiedAt,
    thumbnail: e.thumbnail ? `data:image/png;base64,${Buffer.from(e.thumbnail).toString('base64')}` : null,
  })
  const newMeta = (name: string): Meta => {
    const now = new Date().toISOString()
    return { format: 'refig', formatVersion: FORMAT_VERSION, id: randomUUID(), name, createdAt: now, modifiedAt: now, appVersion: deps.appVersion }
  }
  function unique(name: string) {
    let n = name
    for (let i = 2; exists(n); i++) n = `${name} (${i})`
    return n
  }

  // shortcut: every listing reads each file fully to get meta + thumbnail; add a cache keyed by mtime if the workspace gets large.
  function list(): ProjectSummary[] {
    fs.mkdirSync(dir, { recursive: true })
    const next = new Map<string, Entry>(), out: ProjectSummary[] = []
    for (const f of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(EXT)).sort()) {
      const file = path.join(dir, f)
      try {
        const { meta, thumbnail } = readRefigMeta(fs.readFileSync(file))
        const reid = next.has(meta.id)
        if (reid) meta.id = idFromName(f) // the same id every session, so a library linked through it stays found
        const e = { path: file, meta, thumbnail, reid }
        next.set(meta.id, e)
        out.push(summary(e))
      } catch (e) {
        // Damaged files are shown, never deleted.
        const reason = e instanceof FormatError ? e.message : "File can't be read"
        out.push({ id: '', name: stem(file), modifiedAt: new Date(0).toISOString(), thumbnail: null, damaged: reason })
      }
    }
    index = next
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  function entry(id: string): Entry {
    let e = index.get(id)
    if (!e || !fs.existsSync(e.path)) e = (list(), index.get(id))
    if (!e) throw new Error('Project not found')
    return e
  }
  function read(e: Entry): RefigFile {
    const f = readRefig(fs.readFileSync(e.path))
    f.meta.id = e.meta.id
    return f
  }
  function put(data: RefigFile, name: string): ProjectSummary {
    const e: Entry = { path: fileFor(name), meta: { ...data.meta, name }, thumbnail: data.thumbnail }
    writeAtomic(e.path, writeRefig({ ...data, meta: e.meta }))
    index.set(e.meta.id, e)
    return summary(e)
  }
  function sessionOf(e: Entry) {
    if (session?.id !== e.meta.id) {
      const f = read(e)
      session = { id: e.meta.id, images: f.images, history: f.history ?? [], since: now() }
    }
    return session
  }
  const imagesOf = (e: Entry) => sessionOf(e).images
  const hashesOf = (doc: Document, into = new Set<string>()) => {
    for (const n of Object.values(doc.nodes)) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') into.add(p.hash)
    return into
  }
  const versionHashes = new WeakMap<HistoryEntry, Set<string>>() // versions never change, so their images are found once
  const addVersionHashes = (h: HistoryEntry, into: Set<string>) => {
    let s = versionHashes.get(h)
    if (!s) versionHashes.set(h, (s = hashesOf(h.document)))
    for (const x of s) into.add(x)
  }
  const pick = (all: Record<string, Uint8Array>, hashes: Set<string>) => {
    const images: Record<string, Uint8Array> = {}
    for (const h of hashes) if (all[h]) images[h] = all[h]
    return images
  }
  const infoOf = (h: HistoryEntry[]): VersionInfo[] =>
    h.map(({ id, name, at, auto }): VersionInfo => ({ id, at, auto, ...(name !== undefined && { name }) })).sort((a, b) => b.at.localeCompare(a.at))

  function create(rawName: string): ProjectSummary {
    const name = unique(sanitizeName(rawName))
    return put({ meta: newMeta(name), document: emptyDocument(), images: {} }, name)
  }

  function open(id: string): OpenedProject {
    const e = entry(id), f = read(e)
    if (e.reid) {
      writeAtomic(e.path, writeRefig(f)) // persist the fresh id
      e.reid = false
    }
    session = { id, images: f.images, history: f.history ?? [], since: session?.id === id ? session.since : now() }
    return { summary: summary(e), document: f.document, images: f.images }
  }

  /** Writes the project. `add` also keeps `doc` as a version. Images used only by versions are kept. */
  function persist(e: Entry, doc: Document, thumbnail: Uint8Array | undefined, add?: { name?: string; auto: boolean }) {
    const ses = sessionOf(e)
    let history = ses.history
    if (add) {
      if (!add.auto && history.filter((h) => !h.auto).length >= MAX_NAMED) throw new Error(`A project keeps at most ${MAX_NAMED} saved versions. Delete one first.`)
      history = [...history, { id: randomUUID(), at: new Date(now()).toISOString(), auto: add.auto, ...(add.name !== undefined && { name: add.name }), document: doc }]
      const autos = history.filter((h) => h.auto)
      if (add.auto && autos.length > MAX_AUTO) history = history.filter((h) => h !== autos[0])
    }
    const used = hashesOf(doc)
    for (const h of history) addVersionHashes(h, used)
    const meta = { ...e.meta, name: stem(e.path), modifiedAt: new Date().toISOString(), appVersion: deps.appVersion }
    writeAtomic(e.path, writeRefig({ meta, document: doc, thumbnail: thumbnail ?? e.thumbnail, images: pick(ses.images, used), history }))
    ses.history = history
    e.meta = meta
    e.thumbnail = thumbnail ?? e.thumbnail
    return summary(e)
  }

  function save(id: string, document: unknown, thumbnail?: Uint8Array): ProjectSummary {
    const e = entry(id), doc = validateDocument(document), ses = sessionOf(e), h = ses.history
    const lastAuto = h.findLast((x) => x.auto), last = h[h.length - 1]
    const due = now() - (lastAuto ? Date.parse(lastAuto.at) : ses.since) >= AUTO_EVERY_MS
    return persist(e, doc, thumbnail, due && !same(last, doc) ? { auto: true } : undefined)
  }
  // shortcut: compares the whole document as JSON; only runs when a version is about to be added
  const same = (v: HistoryEntry | undefined, doc: Document) => !!v && JSON.stringify(v.document) === JSON.stringify(doc)

  const listVersions = (id: string) => infoOf(sessionOf(entry(id)).history)

  /** `auto`: a safety copy (e.g. before a restore) that rotates out with the autosaves and is skipped if the newest version is the same. */
  function saveVersion(id: string, rawName: string, document: unknown, auto = false): VersionInfo[] {
    const e = entry(id), name = rawName.trim(), doc = validateDocument(document), h = sessionOf(e).history
    if (!name || name.length > 100) throw new Error('Version name must be 1–100 characters')
    persist(e, doc, undefined, auto && same(h[h.length - 1], doc) ? undefined : { name, auto })
    return infoOf(sessionOf(e).history)
  }

  function getVersion(id: string, versionId: string): ProjectContent {
    const ses = sessionOf(entry(id)), v = ses.history.find((x) => x.id === versionId)
    if (!v) throw new Error('Version not found')
    return { document: v.document, images: pick(ses.images, hashesOf(v.document)) }
  }

  function deleteVersion(id: string, versionId: string): VersionInfo[] {
    const e = entry(id), ses = sessionOf(e)
    if (!ses.history.some((x) => x.id === versionId)) throw new Error('Version not found')
    const history = ses.history.filter((x) => x.id !== versionId)
    const f = read(e) // the file on disk holds the last saved document
    const used = hashesOf(f.document)
    for (const h of history) addVersionHashes(h, used)
    writeAtomic(e.path, writeRefig({ ...f, images: pick(ses.images, used), history }))
    ses.history = history // only once it is on disk
    return infoOf(history)
  }

  /** Another project's last saved document, for use as a library. Leaves the open project alone. */
  function readLibrary(id: string): ProjectContent {
    if (session?.id === id) throw new Error("A project can't be its own library")
    const f = read(entry(id))
    return { document: f.document, images: pick(f.images, hashesOf(f.document)) }
  }

  function addImage(id: string, bytes: Uint8Array): string {
    if (!imageType(bytes)) throw new Error('Unsupported image (use PNG, JPEG, GIF or WebP)')
    const hash = createHash('sha256').update(bytes).digest('hex')
    imagesOf(entry(id))[hash] = bytes
    return hash
  }

  function rename(id: string, rawName: string): ProjectSummary {
    const e = entry(id), name = sanitizeName(rawName), target = fileFor(name)
    if (name === stem(e.path)) return summary(e)
    if (exists(name) && target.toLowerCase() !== e.path.toLowerCase()) throw new Error('A project with this name already exists')
    const f = read(e)
    f.meta.name = name
    writeAtomic(e.path, writeRefig(f))
    fs.renameSync(e.path, target)
    e.path = target
    e.meta = f.meta
    return summary(e)
  }

  async function remove(id: string): Promise<void> {
    await deps.trash(entry(id).path)
    index.delete(id)
    if (session?.id === id) session = null
  }

  function duplicate(id: string): ProjectSummary {
    const e = entry(id), name = unique(`${stem(e.path)} copy`)
    return put({ ...read(e), meta: newMeta(name) }, name)
  }

  /** Writes the last saved document without its version history (old versions may hold content the user deleted before sharing). */
  function exportTo(id: string, dest: string) {
    const e = entry(id)
    if (path.resolve(dest).toLowerCase() === path.resolve(e.path).toLowerCase()) return
    const f = read(e)
    writeAtomic(dest, writeRefig({ ...f, images: pick(f.images, hashesOf(f.document)), history: [] }))
  }

  const imported = (file: string, data: RefigFile, name: string, omitted?: Omitted): ImportResult => ({
    file, status: 'imported', summary: put(data, name), ...(omitted && Object.keys(omitted).length ? { omitted } : {}),
  })

  /** Validates fully before writing anything. A clash with an existing id or name is returned as a conflict to resolve. */
  function importFile(src: string): ImportResult {
    const file = path.basename(src)
    try {
      list()
      if (fs.statSync(src).size > MAX_IMPORT) throw new FormatError('File is larger than 500 MB')
      const ext = path.extname(src).toLowerCase(), bytes = fs.readFileSync(src)
      const name = sanitizeName(path.basename(src, path.extname(src)))
      let data: RefigFile, omitted: Omitted | undefined
      if (ext === EXT) data = readRefig(bytes)
      else if (ext === '.fig') {
        const fig = importFig(bytes)
        omitted = fig.omitted
        data = { meta: newMeta(name), document: fig.document, thumbnail: fig.thumbnail, images: fig.images }
      } else throw new FormatError('Only .refig and .fig files can be imported')
      if (index.has(data.meta.id) || exists(name)) {
        const token = randomUUID()
        pending.set(token, { file, name, data, omitted })
        return { file, status: 'conflict', token, name }
      }
      return imported(file, data, name, omitted)
    } catch (e) {
      return { file, status: 'error', error: message(e) }
    }
  }

  async function resolveConflict(token: string, choice: ConflictChoice): Promise<ImportResult> {
    const p = pending.get(token)
    if (!p) throw new Error('This import is no longer available')
    pending.delete(token)
    const { file, name, data, omitted } = p
    if (choice === 'cancel') return { file, status: 'cancelled' }
    try {
      if (choice === 'keepBoth') return imported(file, { ...data, meta: { ...data.meta, id: randomUUID() } }, unique(name), omitted)
      list()
      for (const old of [index.get(data.meta.id)?.path, fileFor(name)]) if (old && fs.existsSync(old)) await deps.trash(old)
      session = null
      return imported(file, data, name, omitted)
    } catch (e) {
      return { file, status: 'error', error: message(e) }
    }
  }

  return { list, create, open, save, addImage, listVersions, saveVersion, getVersion, deleteVersion, readLibrary, rename, remove, duplicate, exportTo, importFile, resolveConflict, nameOf: (id: string) => stem(entry(id).path) }
}
