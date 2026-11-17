import type { ExportKind } from '../../../shared/api'
import type { ExportSetting, Node } from '../../../shared/document'
import { dataUrl } from '../../util'
import { fontFaces, preloadFonts } from '../fontFile'
import { renderToCanvas } from '../canvas/render'
import { worldBox, type Box } from '../model/geometry'
import { childrenOf, topLevel } from '../model/ops'
import type { EditorStore } from '../store'
import { toSvg } from './svg'

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const
const isRaster = (kind: ExportKind): kind is keyof typeof MIME => kind in MIME

/** `base`, or `base@2x` for a raster image above 1x. */
export const scaledName = (base: string, kind: ExportKind, scale: number) => (scale !== 1 && isRaster(kind) ? `${base}@${scale}x` : base)

/** Image or SVG bytes of `ids` (cropped to `region` when given). SVG and PDF ignore `scale`; JPG gets a white background. */
async function render(store: EditorStore, ids: string[], kind: ExportKind, scale: number, region?: Box): Promise<Uint8Array> {
  const { doc } = store.get()
  if (isRaster(kind)) {
    const canvas = renderToCanvas(doc, ids, scale, store.image, region, kind === 'jpg' ? '#fff' : undefined)
    const blob = canvas && (await new Promise<Blob | null>((done) => canvas.toBlob(done, MIME[kind], 0.92)))
    if (!blob || blob.type !== MIME[kind]) throw new Error("Couldn't render the image")
    return new Uint8Array(await blob.arrayBuffer())
  }
  // shortcut: each used weight embeds the whole font file (no subsetting), so an SVG with text can be large.
  const texts: Node[] = [], walk = (n: Node) => { if (!n.visible) return; if (n.type === 'TEXT') texts.push(n); else childrenOf(doc, n.id).forEach(walk) }
  ids.forEach((id) => walk(doc.nodes[id]))
  const warning = await preloadFonts(texts)
  if (warning) store.set({ toast: warning })
  return new TextEncoder().encode(toSvg(doc, ids, (hash) => (store.imageBytes(hash) ? dataUrl(store.imageBytes(hash)!) : undefined), (hash) => { const b = store.image(hash); return b ? { w: b.width, h: b.height } : undefined }, region, fontFaces(texts)))
}

/** What a node exports: itself; a page, its layers; a slice, the page content under it. Null when there is nothing to draw. */
function jobOf(store: EditorStore, n: Node): { ids: string[]; region?: Box } | null {
  const { doc, pageId } = store.get(), page = childrenOf(doc, pageId).filter((c) => !c.slice).map((c) => c.id)
  if (n.type === 'PAGE') return page.length ? { ids: page } : null
  if (n.slice) return { ids: page, region: worldBox(doc, [n.id]) ?? undefined }
  return { ids: [n.id] }
}

/** Saves one file (save dialog) or several (folder picker). Resolves to the first saved path, or null if cancelled. */
async function save(store: EditorStore, files: { name: string; kind: ExportKind; bytes: Uint8Array }[]): Promise<string | null> {
  if (files.length === 1) return (await store.api.exportImage(files[0].bytes, files[0].name, files[0].kind))?.path ?? null
  return (await store.api.exportFiles(files))?.[0] ?? null
}

/** Exports the selection as one image: PNG, JPG, WebP (at `scale`), SVG or PDF. Main shows the save dialog. Resolves to the saved path, or null if cancelled. */
export async function exportSelection(store: EditorStore, kind: ExportKind, scale = 1): Promise<string | null> {
  const { doc, selection, name } = store.get(), ids = topLevel(doc, selection)
  if (!ids.length) return null
  const base = ids.length === 1 ? doc.nodes[ids[0]].name : name
  const job = ids.length === 1 && doc.nodes[ids[0]].slice ? jobOf(store, doc.nodes[ids[0]]) : { ids, region: undefined }
  return job ? save(store, [{ name: scaledName(base, kind, scale), kind, bytes: await render(store, job.ids, kind, scale, job.region) }]) : null
}

/** Exports every saved setting of every given node (a page, a slice or a layer), one file per setting. */
export async function exportSettings(store: EditorStore, nodeIds: string[]): Promise<string | null> {
  const files = []
  for (const id of nodeIds) {
    const n = store.get().doc.nodes[id], job = n && jobOf(store, n)
    if (job) for (const e of n.exports ?? []) files.push({ name: `${n.name}${e.suffix}`, kind: e.format, bytes: await render(store, job.ids, e.format, e.scale, job.region) })
  }
  return files.length ? save(store, files) : null
}

/** Exports the whole current page as one image. */
export async function exportPage(store: EditorStore, kind: ExportKind, scale = 1): Promise<string | null> {
  const { doc, pageId } = store.get(), page = doc.nodes[pageId], job = jobOf(store, page)
  return job ? save(store, [{ name: scaledName(page.name, kind, scale), kind, bytes: await render(store, job.ids, kind, scale) }]) : null
}

export const defaultSetting = (format: ExportSetting['format'], scale: number): ExportSetting => ({ suffix: scale !== 1 && format !== 'svg' && format !== 'pdf' ? `@${scale}x` : '', format, scale })
