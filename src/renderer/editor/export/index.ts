import type { ExportKind } from '../../../shared/api'
import { dataUrl } from '../../util'
import { renderToCanvas } from '../canvas/render'
import { topLevel } from '../model/ops'
import type { EditorStore } from '../store'
import { toSvg } from './svg'

/** Exports the selection as PNG (at `scale`), SVG or PDF. Main shows the save dialog. Resolves to the saved path, or null if cancelled. */
export async function exportSelection(store: EditorStore, kind: ExportKind, scale = 1): Promise<string | null> {
  const { doc, selection, name } = store.get(), ids = topLevel(doc, selection)
  if (!ids.length) return null
  const base = ids.length === 1 ? doc.nodes[ids[0]].name : name
  let bytes: Uint8Array
  if (kind === 'png') {
    const canvas = renderToCanvas(doc, ids, scale, store.image)
    const blob = canvas && (await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png')))
    if (!blob) throw new Error("Couldn't render the image")
    bytes = new Uint8Array(await blob.arrayBuffer())
  } else {
    // shortcut: text keeps its font by name; a PDF/SVG opened where the font is missing falls back to sans-serif. Embed the font if that matters.
    bytes = new TextEncoder().encode(toSvg(doc, ids, (hash) => (store.imageBytes(hash) ? dataUrl(store.imageBytes(hash)!) : undefined), (hash) => { const b = store.image(hash); return b ? { w: b.width, h: b.height } : undefined }))
  }
  const saved = await store.api.exportImage(bytes, scale > 1 && kind === 'png' ? `${base}@${scale}x` : base, kind)
  return saved?.path ?? null
}
